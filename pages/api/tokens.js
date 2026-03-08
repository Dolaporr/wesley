// pages/api/tokens.js — Server-side polling endpoint with in-memory cache
// Polls Dexscreener / Birdeye every 10s and caches results
// to avoid hammering free tier API limits.

import { fetchNewPumpTokens, analyzeRug, watchDevWallet } from "../../lib/tokenData";
import { addAlert } from "./_store";

// ─── Simple in-memory cache ───────────────────────────────────────────────────
let cache = { tokens: [], updatedAt: 0 };
const CACHE_TTL = 10_000; // 10 seconds
let initialLoadDone = false;
let enrichmentInFlight = false;
let lastEnrichmentAt = 0;
const alertedMints = new Set();

// ─── Dev Wallet Alerts ───────────────────────────────────────────────────────
function addDevSellAlert(symbol, mint, soldPct) {
  addAlert({
    time: Date.now(),
    type: "DEV_SELL",
    source: "engine",
    symbol,
    mint,
    soldPct,
  });
}

// ─── Volume Spike Detection ───────────────────────────────────────────────────
const volumeHistory = new Map(); // mint → [{vol, timestamp}, ...]
const MAX_HISTORY = 6; // Keep last 6 readings (~1 minute at 10s polling)

function detectSpike(mint, currentVol) {
  const history = volumeHistory.get(mint) || [];
  if (history.length === 0) return { spike: false, multiplier: 0 };
  
  // Get oldest reading
  const oldest = history[0];
  if (!oldest || oldest.vol === 0) return { spike: false, multiplier: 0 };
  
  const multiplier = currentVol / oldest.vol;
  return {
    spike: multiplier >= 3,
    multiplier: multiplier.toFixed(1)
  };
}

function updateVolumeHistory(tokens) {
  for (const tok of tokens) {
    if (!tok.mint || !tok.vol24h) continue;
    
    const history = volumeHistory.get(tok.mint) || [];
    history.push({ vol: tok.vol24h, timestamp: Date.now() });
    
    // Keep only last MAX_HISTORY readings
    if (history.length > MAX_HISTORY) {
      history.shift();
    }
    
    volumeHistory.set(tok.mint, history);
  }
}

// ─── Background enrichment queue ─────────────────────────────────────────────
// Rug analysis is expensive (on-chain calls), so we do it async and
// merge results back into the cache as they arrive.
const rugCache = new Map(); // mint → { rugScore, risk, flags }

async function sendTelegramAlert(tok, rug) {
  if (!tok?.mint || (rug?.rugScore ?? 0) <= 85 || alertedMints.has(tok.mint)) return;

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return;

  alertedMints.add(tok.mint);
  const flags = Array.isArray(rug.flags) ? rug.flags : [];
  const joinedFlags = flags.length
    ? flags.map((f) => (typeof f === "string" ? f : f?.label || String(f))).join(", ")
    : "None";

  const text = [
    "🚨 CRITICAL RUG DETECTED",
    `Token: ${tok.symbol ?? "UNKNOWN"}`,
    `Mint: ${tok.mint}`,
    `Rug Score: ${rug.rugScore}/100`,
    `Flags: ${joinedFlags}`,
  ].join("\n");

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (err) {
    console.error("[/api/tokens] telegram alert failed:", err.message);
  }
}

async function enrichWithRug(tokens) {
  const toEnrich = tokens.filter((t) => t.mint && !rugCache.has(t.mint));
  // Enrich in parallel but cap at 5 concurrent on-chain calls
  const chunks = chunkArray(toEnrich, 5);
  for (const chunk of chunks) {
    await Promise.allSettled(
      chunk.map(async (tok) => {
        try {
          const [rugResult, devResult] = await Promise.all([
            analyzeRug(tok.mint),
            watchDevWallet(tok.mint),
          ]);
          
          rugCache.set(tok.mint, rugResult);
          await sendTelegramAlert(tok, rugResult);
          
          // Check for dev sell
          if (devResult.devSold) {
            addDevSellAlert(tok.symbol, tok.mint, devResult.soldPct);
          }
        } catch {
          rugCache.set(tok.mint, { rugScore: 50, risk: "MED", flags: [] });
        }
      })
    );
  }
}

function scheduleRugEnrichment(tokens) {
  if (enrichmentInFlight) return;
  // After initial warm-up, avoid launching enrichment too frequently.
  if (initialLoadDone && Date.now() - lastEnrichmentAt < CACHE_TTL) return;

  enrichmentInFlight = true;
  lastEnrichmentAt = Date.now();

  enrichWithRug(tokens)
    .catch((err) => {
      console.error("[/api/tokens] background enrich failed:", err.message);
    })
    .finally(() => {
      enrichmentInFlight = false;
      initialLoadDone = true;
    });
}

function chunkArray(arr, size) {
  return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  );
}

// ─── API Handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  const now = Date.now();
  const stale = now - cache.updatedAt > CACHE_TTL;

  if (stale) {
    try {
      const fresh = await fetchNewPumpTokens(50);
      cache = { tokens: fresh.filter(Boolean), updatedAt: now };
      
      // Update volume history before enrichment
      updateVolumeHistory(cache.tokens);

      // Always keep response fast in serverless; enrich asynchronously.
      scheduleRugEnrichment(cache.tokens);
    } catch (err) {
      console.error("[/api/tokens] fetch failed:", err.message);
      // Return stale cache rather than error
    }
  }

  // Merge rug data and spike detection into tokens
  const enriched = cache.tokens.map((tok) => {
    const rug = tok.mint ? rugCache.get(tok.mint) : null;
    const spike = tok.mint ? detectSpike(tok.mint, tok.vol24h) : { spike: false, multiplier: 0 };
    return {
      ...tok,
      rugScore: rug?.rugScore ?? null, // null = pending
      risk: rug?.risk ?? "UNKNOWN",
      rugFlags: rug?.flags ?? [],
      spike: spike.spike,
      spikeMultiplier: spike.multiplier,
    };
  });

  res.setHeader("Cache-Control", "s-maxage=10, stale-while-revalidate=20");
  return res.status(200).json({
    tokens: enriched,
    updatedAt: cache.updatedAt,
    count: enriched.length,
  });
}
