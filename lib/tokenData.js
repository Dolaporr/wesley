// lib/tokenData.js — Core data fetching and rug detection logic
import axios from "axios";
import { Connection, PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";

const RPC = process.env.NEXT_PUBLIC_RPC_ENDPOINT || "https://api.mainnet-beta.solana.com";
const BIRDEYE_KEY = process.env.BIRDEYE_API_KEY;
const DEXSCREENER_BASE = process.env.DEXSCREENER_BASE_URL || "https://api.dexscreener.com/latest";
const PUMP_PROGRAM = "6EF8rrecthR5DkzonEZu5uWDNKrGLuVPm26PCJZiUJFN";

// Known LP lock program addresses
const LOCK_PROGRAMS = [
  "strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m", // Streamflow
  "7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqtj2G5", // Raydium lock
];

export const connection = new Connection(RPC, "confirmed");

// ─────────────────────────────────────────────
// 1. Fetch new Pump.fun token launches
//    Strategy: Poll Dexscreener for Solana tokens
//    sorted by creation date, filter Pump.fun pairs
// ─────────────────────────────────────────────
export async function fetchNewPumpTokens(limit = 30) {
  try {
    // Dexscreener "new pairs" endpoint
    const { data } = await axios.get(`${DEXSCREENER_BASE}/dex/search?q=pump.fun`, {
      timeout: 8000,
    });

    const pairs = (data.pairs || [])
      .filter((p) => p.chainId === "solana")
      .sort((a, b) => (b.pairCreatedAt || 0) - (a.pairCreatedAt || 0))
      .slice(0, limit);

    return pairs.map(normalizeDexscreenerPair);
  } catch (err) {
    console.error("[fetchNewPumpTokens] Dexscreener failed:", err.message);
    // Fallback: try Birdeye
    return fetchViaBirdeye(limit);
  }
}

// ─────────────────────────────────────────────
// 2. Birdeye fallback
// ─────────────────────────────────────────────
async function fetchViaBirdeye(limit) {
  if (!BIRDEYE_KEY) return [];
  try {
    const { data } = await axios.get("https://public-api.birdeye.so/defi/token_list", {
      headers: { "X-API-KEY": BIRDEYE_KEY },
      params: { sort_by: "v24hUSD", sort_type: "desc", offset: 0, limit, min_liquidity: 1000 },
      timeout: 8000,
    });
    return (data.data?.tokens || []).map(normalizeBirdeye);
  } catch (err) {
    console.error("[fetchViaBirdeye] failed:", err.message);
    return [];
  }
}

// ─────────────────────────────────────────────
// 3. On-chain rug detection checks
//    Returns a rugScore (0-100) and flag reasons
// ─────────────────────────────────────────────
export async function analyzeRug(mintAddress) {
  const flags = [];
  let rugScore = 0;
  let lpLocked = false;

  try {
    const mintPubkey = new PublicKey(mintAddress);
    const mintInfo = await getMint(connection, mintPubkey);

    // Flag 1: Mint authority not revoked (devs can print more tokens)
    if (mintInfo.mintAuthority !== null) {
      flags.push({ label: "Mint authority active", severity: "HIGH", score: 25 });
      rugScore += 25;
    }

    // Flag 2: Freeze authority not revoked (devs can freeze wallets)
    if (mintInfo.freezeAuthority !== null) {
      flags.push({ label: "Freeze authority active", severity: "HIGH", score: 20 });
      rugScore += 20;
    }

    // Flag 3: Check top holder concentration via Helius
    const concentration = await checkHolderConcentration(mintAddress);
    if (concentration.topHolderPct > 50) {
      flags.push({ label: `Top holder ${concentration.topHolderPct.toFixed(0)}% supply`, severity: "CRITICAL", score: 40 });
      rugScore += 40;
    } else if (concentration.topHolderPct > 20) {
      flags.push({ label: `Dev holds ${concentration.topHolderPct.toFixed(0)}%`, severity: "HIGH", score: 20 });
      rugScore += 20;
    }

    // Flag 4: Low liquidity
    const liquidity = concentration.liquidity || 0;
    if (liquidity < 5000) {
      flags.push({ label: `Low liquidity $${liquidity.toFixed(0)}`, severity: "HIGH", score: 15 });
      rugScore += 15;
    }

    // Flag 5: Check LP lock status on-chain
    lpLocked = await checkLPLock(mintAddress);
    if (!lpLocked) {
      flags.push({ label: "LP not locked on-chain", severity: "HIGH", score: 20 });
      rugScore += 20;
    }

  } catch (err) {
    console.error("[analyzeRug] on-chain check failed:", err.message);
    // Can't read chain = slightly suspicious
    flags.push({ label: "Unable to verify on-chain", severity: "MED", score: 10 });
    rugScore += 10;
  }

  return {
    rugScore: Math.min(100, rugScore),
    flags,
    locked: lpLocked, // Include lock status in return
    risk: rugScore >= 80 ? "CRITICAL" : rugScore >= 60 ? "HIGH" : rugScore >= 35 ? "MED" : "LOW",
  };
}

// ─────────────────────────────────────────────
// 4. Check holder concentration via Helius RPC
//    (getTokenLargestAccounts is a standard RPC method)
// ─────────────────────────────────────────────
async function checkHolderConcentration(mintAddress) {
  try {
    const result = await connection.getTokenLargestAccounts(new PublicKey(mintAddress));
    const accounts = result.value;
    if (!accounts.length) return { topHolderPct: 0, liquidity: 0 };

    const totalSupply = accounts.reduce((s, a) => s + Number(a.amount), 0);
    const topHolderPct = totalSupply > 0
      ? (Number(accounts[0].amount) / totalSupply) * 100
      : 0;

    return { topHolderPct, totalAccounts: accounts.length, liquidity: 0 };
  } catch {
    return { topHolderPct: 0, liquidity: 0 };
  }
}

// ─────────────────────────────────────────────
// 5. Check LP lock status on-chain
//    Verifies if the LP account is owned by known lock programs
// ─────────────────────────────────────────────
async function checkLPLock(mintAddress) {
  try {
    // Get largest token accounts for this mint
    const accounts = await connection.getTokenLargestAccounts(
      new PublicKey(mintAddress)
    );

    if (!accounts.value || accounts.value.length === 0) {
      return false;
    }

    // Check top 5 accounts and see if account owner is a known lock program
    for (const account of accounts.value.slice(0, 5)) {
      const accountInfo = await connection.getAccountInfo(account.address);
      const owner = accountInfo?.owner?.toString();
      if (LOCK_PROGRAMS.includes(owner)) {
        return true; // LP is locked
      }
    }

    return false; // No lock program ownership found
  } catch (err) {
    console.error("[checkLPLock] failed:", err.message);
    return false;
  }
}

// ─────────────────────────────────────────────
// 6. Dev wallet monitoring - track top holder changes
//    Stores snapshots and detects when dev sells
// ─────────────────────────────────────────────
const devWalletSnapshots = new Map(); // mint → { address, amount, timestamp }

export async function watchDevWallet(mintAddress) {
  try {
    const result = await connection.getTokenLargestAccounts(new PublicKey(mintAddress));
    const accounts = result.value;
    
    if (!accounts || accounts.length === 0) {
      return { devSold: false, soldPct: 0, devAddress: null };
    }

    // Top holder is assumed to be dev wallet
    const topHolder = accounts[0];
    const currentAmount = Number(topHolder.amount);
    const currentAddress = topHolder.address.toString();

    const snapshot = devWalletSnapshots.get(mintAddress);

    if (!snapshot) {
      // First time seeing this mint - store snapshot
      devWalletSnapshots.set(mintAddress, {
        address: currentAddress,
        amount: currentAmount,
        timestamp: Date.now(),
      });
      return { devSold: false, soldPct: 0, devAddress: currentAddress };
    }

    // Compare to previous snapshot
    if (currentAmount < snapshot.amount) {
      const soldPct = ((snapshot.amount - currentAmount) / snapshot.amount) * 100;
      
      if (soldPct >= 10) {
        // Dev sold more than 10%
        devWalletSnapshots.set(mintAddress, {
          address: currentAddress,
          amount: currentAmount,
          timestamp: Date.now(),
        });
        return { devSold: true, soldPct: soldPct.toFixed(1), devAddress: currentAddress };
      }
    }

    // Update snapshot with new amount
    devWalletSnapshots.set(mintAddress, {
      address: currentAddress,
      amount: currentAmount,
      timestamp: Date.now(),
    });

    return { devSold: false, soldPct: 0, devAddress: currentAddress };

  } catch (err) {
    console.error("[watchDevWallet] failed:", err.message);
    return { devSold: false, soldPct: 0, devAddress: null };
  }
}

// ─────────────────────────────────────────────
// 7. Fetch single token detail (for drill-down)
// ─────────────────────────────────────────────
export async function fetchTokenDetail(mintAddress) {
  const [dexData, rugAnalysis] = await Promise.allSettled([
    axios.get(`${DEXSCREENER_BASE}/dex/tokens/${mintAddress}`, { timeout: 8000 }),
    analyzeRug(mintAddress),
  ]);

  const pair = dexData.status === "fulfilled"
    ? normalizeDexscreenerPair((dexData.value.data?.pairs || [])[0])
    : {};

  const rug = rugAnalysis.status === "fulfilled" ? rugAnalysis.value : { rugScore: 50, flags: [], risk: "MED" };

  return { ...pair, ...rug, mintAddress };
}

// ─────────────────────────────────────────────
// 6. Normalizers — unify data shapes
// ─────────────────────────────────────────────
function normalizeDexscreenerPair(pair) {
  if (!pair) return null;

  return {
    id: pair.pairAddress,
    mint: pair.baseToken?.address,
    name: pair.baseToken?.name || "UNKNOWN",
    symbol: pair.baseToken?.symbol || "???",
    price: parseFloat(pair.priceUsd || 0),
    change: parseFloat(pair.priceChange?.h24 || 0),
    mcap: pair.marketCap || pair.fdv || 0,
    vol24h: pair.volume?.h24 || 0,
    liquidity: pair.liquidity?.usd || 0,
    txCount: (pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0),
    createdAt: pair.pairCreatedAt || Date.now(),
    pairAddress: pair.pairAddress,
    dexUrl: pair.url,
    source: "dexscreener",
  };
}

function normalizeBirdeye(token) {
  return {
    id: token.address,
    mint: token.address,
    name: token.name || "UNKNOWN",
    symbol: token.symbol || "???",
    price: token.v24hUSD / (token.v24hChangePercent || 1),
    change: token.v24hChangePercent || 0,
    mcap: token.mc || 0,
    vol24h: token.v24hUSD || 0,
    liquidity: token.liquidity || 0,
    age: "?",
    source: "birdeye",
  };
}

function formatAge(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}
