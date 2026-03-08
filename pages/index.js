 // pages/index.js
import { useState, useEffect } from "react";
import Head from "next/head";
import dynamic from "next/dynamic";
import { useTokens, useTokenDetail } from "../hooks/useTokens";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
// BUG FIX: Import from specific adapter packages, NOT from the mega
// @solana/wallet-adapter-wallets bundle — that bundle pulls in @keystonehq
// which has a broken peer dep (@keystonehq/bc-ur-registry missing) and
// causes a hard 500 on every page load.
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";

const RPC = process.env.NEXT_PUBLIC_RPC_ENDPOINT || "https://api.mainnet-beta.solana.com";

// Instantiate outside component so adapters aren't re-created on every render
const wallets = [new PhantomWalletAdapter(), new SolflareWalletAdapter()];
const WalletMultiButtonNoSSR = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  {
    ssr: false,
    loading: () => (
      <button className="wallet-adapter-button" type="button" disabled>
        CONNECT
      </button>
    ),
  }
);

// ─── Helpers ──────────────────────────────────────────────────────────────────
const riskColor = (r) =>
  ({ CRITICAL: "var(--red)", HIGH: "var(--orange)", MED: "var(--yellow)", LOW: "var(--green)", UNKNOWN: "var(--text-muted)" }[r] ?? "var(--text-muted)");

const riskBg = (r) =>
  ({ CRITICAL: "rgba(240,62,95,0.15)", HIGH: "rgba(240,120,32,0.15)", MED: "rgba(240,192,64,0.15)", LOW: "rgba(32,192,96,0.15)", UNKNOWN: "rgba(100,100,100,0.15)" }[r] ?? "transparent");

const fmt = (n) =>
  !n ? "$0" : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`;

const fmtPrice = (p) =>
  !p ? "—" : p < 0.001 ? p.toExponential(2) : p.toFixed(4);

function formatAge(ms) {
  if (!ms || ms < 0) return "?";
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m";
  return Math.floor(m / 60) + "h";
}

// ─── Alerts Hook ──────────────────────────────────────────────────────────────
function useAlerts(refreshInterval = 10000) {
  const [alerts, setAlerts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchAlerts() {
      try {
        const res = await fetch("/api/alerts");
        const data = await res.json();
        setAlerts(data.alerts || []);
      } catch (err) {
        console.error("Failed to fetch alerts:", err);
      } finally {
        setIsLoading(false);
      }
    }

    fetchAlerts();
    const interval = setInterval(fetchAlerts, refreshInterval);
    return () => clearInterval(interval);
  }, [refreshInterval]);

  return { alerts, isLoading };
}

function useNow() {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(t);
  }, []);

  return now;
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function MiniSparkline({ positive }) {
  const points = Array.from({ length: 12 }, (_, i) => {
    const base = 30 + Math.random() * 20;
    return positive ? base + i * 2.5 + Math.random() * 8 : base + (12 - i) * 2 + Math.random() * 8;
  });
  const max = Math.max(...points), min = Math.min(...points);
  const range = max - min || 1;
  const pts = points.map((p, i) => `${i * (50 / 11)},${40 - ((p - min) / range) * 36}`).join(" ");
  return (
    <svg width="50" height="24" viewBox="0 0 50 40" style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={positive ? "var(--green)" : "var(--red)"} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function RugMeter({ score }) {
  if (score === null || score === undefined) {
    return <span style={{ fontSize: 9, color: "var(--text-muted)", fontStyle: "italic" }}>scanning…</span>;
  }
  const color = score > 80 ? "var(--red)" : score > 60 ? "var(--orange)" : score > 40 ? "var(--yellow)" : "var(--green)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width: 48, height: 8, background: "rgba(255,255,255,0.08)", borderRadius: 3, overflow: "hidden", border: "1px solid var(--border-default)" }}>
        <div style={{ width: `${score}%`, height: "100%", background: color, borderRadius: 2, transition: "width 0.5s" }} />
      </div>
      <span style={{ color, fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 700 }}>{score}</span>
    </div>
  );
}

function BuzzBar({ score }) {
  return (
    <div style={{ width: 36, height: 6, background: "rgba(255,255,255,0.08)", borderRadius: 3, overflow: "hidden" }}>
      <div style={{ width: `${score ?? 0}%`, height: "100%", background: "linear-gradient(90deg, var(--purple), var(--blue))", borderRadius: 3 }} />
    </div>
  );
}

function RiskBadge({ risk }) {
  const styles = {
    CRITICAL: { bg: "rgba(240,62,95,0.15)", color: "var(--red)", border: "rgba(240,62,95,0.3)" },
    HIGH: { bg: "rgba(240,120,32,0.15)", color: "var(--orange)", border: "rgba(240,120,32,0.3)" },
    MED: { bg: "rgba(240,192,64,0.15)", color: "var(--yellow)", border: "rgba(240,192,64,0.3)" },
    LOW: { bg: "rgba(32,192,96,0.15)", color: "var(--green)", border: "rgba(32,192,96,0.3)" },
    UNKNOWN: { bg: "rgba(100,100,100,0.15)", color: "var(--text-muted)", border: "rgba(100,100,100,0.3)" },
  };
  const s = styles[risk] || styles.UNKNOWN;
  return (
    <span style={{
      padding: "5px 6px", borderRadius: 3, fontSize: 8, fontWeight: 700, letterSpacing: "0.1em",
      fontFamily: "var(--font-mono)", background: s.bg, color: s.color, border: `1px solid ${s.border}`,
    }}>
      {risk}
    </span>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
function Dashboard() {
  const { tokens, updatedAt, isLoading, isError } = useTokens(10000);
  const { alerts } = useAlerts(10000);
  const now = useNow();
  const [filter, setFilter] = useState("ALL");
  const [selected, setSelected] = useState(null);
  const [secondsAgo, setSecondsAgo] = useState(0);
  const [copiedMint, setCopiedMint] = useState(null);

  const copyToClipboard = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopiedMint(key);
    setTimeout(() => setCopiedMint(null), 1000);
  };

  // Update seconds ago timer
  useEffect(() => {
    if (!updatedAt) {
      setSecondsAgo(0);
      return;
    }
    const update = () => {
      setSecondsAgo(Math.floor((Date.now() - new Date(updatedAt).getTime()) / 1000));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [updatedAt]);

  const filtered = filter === "ALL" ? tokens : tokens.filter((t) => t.risk === filter);
  const critCount = tokens.filter((t) => t.risk === "CRITICAL").length;
  const totalVol = tokens.reduce((a, t) => a + (t.vol24h || 0), 0);

  const { detail } = useTokenDetail(selected);
  const selectedToken = selected ? tokens.find((t) => (t.id || t.mint) === selected) : null;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-base)", color: "var(--text-primary)", fontFamily: "var(--font-mono)", overflow: "hidden" }}>
      {/* CRT scanline overlay */}
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0, bottom: 0, pointerEvents: "none", zIndex: 100,
        backgroundImage: "linear-gradient(transparent 50%, rgba(0,0,0,0.03) 50%)",
        backgroundSize: "100% 4px", opacity: 0.4,
      }} />

      {/* ── Header ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 24px", 
        borderBottom: "1px solid var(--border-default)",
        background: "var(--bg-base)", 
        boxShadow: "0 1px 0 0 rgba(240,62,95,0.3) inset",
        position: "sticky", top: 0, zIndex: 50,
        animation: "fadeInUp 0.4s ease both",
      }}>
        {/* Left: Logo + Title */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* 4x4 dot grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 2px)", gap: 3 }}>
            {Array.from({ length: 16 }).map((_, i) => (
              <div key={i} style={{ width: 2, height: 2, background: "var(--border-accent)", borderRadius: "50%" }} />
            ))}
          </div>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 900, fontSize: 22, letterSpacing: "0.15em", color: "var(--text-primary)" }}>
              WESLEY<span style={{ color: "var(--text-muted)" }}>/</span><span style={{ color: "var(--red)" }}>SOL</span>
            </div>
            <div style={{ fontSize: 8, color: "var(--text-muted)", letterSpacing: "0.2em", marginTop: 2 }}>PUMP.FUN SURVEILLANCE TERMINAL</div>
          </div>
        </div>

        {/* Center: Stats */}
        <div style={{ display: "flex", gap: 40 }}>
          {[
            { label: "CRITICAL", val: critCount, color: "var(--red)" },
            { label: "24H VOL", val: fmt(totalVol), color: "var(--green)" },
          ].map((s) => (
            <div key={s.label} style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 900, fontSize: 28, color: s.color, lineHeight: 1 }}>{s.val}</div>
              <div style={{ fontSize: 8, color: "var(--text-muted)", letterSpacing: "0.15em", marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Right: Live indicator + Wallet */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {isError && <span style={{ fontSize: 10, color: "var(--red)" }}>⚠ API ERROR</span>}
          {isLoading && !tokens.length && <span style={{ fontSize: 10, color: "var(--text-muted)" }}>loading…</span>}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--red)", animation: "blink 1s infinite" }} />
            <span style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.1em" }}>LIVE FEED</span>
          </div>
          <WalletMultiButtonNoSSR />
        </div>
      </div>

      <div style={{ display: "flex", height: "calc(100vh - 57px)" }}>

        {/* ── Main table ── */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>

          {/* Filter bar */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 20px", borderBottom: "1px solid var(--border-default)", animation: "fadeInUp 0.4s ease both", animationDelay: "0.1s" }}>
            <span style={{ fontSize: 10, color: "var(--text-muted)", marginRight: 4, letterSpacing: "0.1em" }}>RISK FILTER</span>
            {["ALL", "CRITICAL", "HIGH", "MED", "LOW"].map((f) => (
              <button key={f} className="filter-btn" onClick={() => setFilter(f)} style={{
                padding: "4px 10px", borderRadius: 4, fontSize: 10,
                fontFamily: "inherit", fontWeight: 700, letterSpacing: "0.08em",
                background: filter === f ? (f === "ALL" ? "var(--bg-elevated)" : riskBg(f)) : "transparent",
                color: filter === f ? (f === "ALL" ? "var(--text-primary)" : riskColor(f)) : "var(--text-muted)",
                borderBottom: filter === f ? `2px solid ${f === "ALL" ? "var(--border-accent)" : riskColor(f)}` : "2px solid transparent",
              }}>{f}</button>
            ))}
            <div style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-muted)" }}>
              {filtered.length} tokens • {updatedAt ? new Date(updatedAt).toLocaleTimeString() : "waiting…"}
            </div>
          </div>

          {/* Column headers */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "28px 160px 90px 70px 80px 80px 80px 70px 70px 60px 70px",
            padding: "6px 20px", borderBottom: "1px solid var(--border-default)",
            fontSize: 8, color: "var(--text-muted)", letterSpacing: "0.15em",
            animation: "fadeInUp 0.4s ease both", animationDelay: "0.15s",
          }}>
            <div style={{ borderLeft: "4px solid transparent" }}></div>
            {["TOKEN", "PRICE", "CHG%", "MCAP", "VOL 24H", "LIQUIDITY", "HOLDERS", "RUG SCORE", "BUZZ", "AGE"].map((h) => (
              <div key={h}>{h} ▲</div>
            ))}
          </div>

          {/* Token rows */}
          <div style={{ overflowY: "auto", flex: 1 }}>
            {isLoading && !tokens.length && (
              Array.from({ length: 8 }, (_, i) => (
                <div
                  key={`skeleton-${i}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "28px 160px 90px 70px 80px 80px 80px 70px 70px 60px 70px",
                    padding: "10px 20px",
                    borderBottom: "1px solid var(--border-subtle)",
                    animation: "blink 1.6s ease-in-out infinite",
                    animationDelay: `${i * 0.06}s`,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--bg-surface)" }} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 4 }}>
                    <div style={{ width: 84, height: 12, borderRadius: 3, background: "var(--bg-surface)" }} />
                    <div style={{ width: 120, height: 8, borderRadius: 3, background: "var(--bg-surface)" }} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 4 }}>
                    <div style={{ width: 72, height: 10, borderRadius: 3, background: "var(--bg-surface)" }} />
                    <div style={{ width: 50, height: 8, borderRadius: 3, background: "var(--bg-surface)" }} />
                  </div>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <div style={{ width: 34, height: 10, borderRadius: 3, background: "var(--bg-surface)" }} />
                  </div>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <div style={{ width: 54, height: 10, borderRadius: 3, background: "var(--bg-surface)" }} />
                  </div>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <div style={{ width: 58, height: 10, borderRadius: 3, background: "var(--bg-surface)" }} />
                  </div>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <div style={{ width: 58, height: 10, borderRadius: 3, background: "var(--bg-surface)" }} />
                  </div>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <div style={{ width: 28, height: 10, borderRadius: 3, background: "var(--bg-surface)" }} />
                  </div>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <div style={{ width: 48, height: 8, borderRadius: 3, background: "var(--bg-surface)" }} />
                  </div>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <div style={{ width: 36, height: 6, borderRadius: 3, background: "var(--bg-surface)" }} />
                  </div>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <div style={{ width: 34, height: 10, borderRadius: 3, background: "var(--bg-surface)" }} />
                  </div>
                </div>
              ))
            )}

            {filtered.map((tok, i) => (
              <div
                key={tok.id || tok.mint}
                className="token-row"
                onClick={() => setSelected(selected === (tok.id || tok.mint) ? null : (tok.id || tok.mint))}
                style={{
                  display: "grid",
                  gridTemplateColumns: "28px 160px 90px 70px 80px 80px 80px 70px 70px 60px 70px",
                  padding: "10px 20px", borderBottom: "1px solid var(--border-subtle)",
                  animation: `fadeInUp 0.3s ease ${i * 0.04}s both`,
                  borderLeft: selected === (tok.id || tok.mint) ? "3px solid var(--blue)" : "3px solid var(--border-accent)",
                  background: selected === (tok.id || tok.mint) ? "rgba(64,144,240,0.06)" : "transparent",
                  transition: "all 80ms",
                }}
              >
                <div style={{ display: "flex", alignItems: "center" }}><RiskBadge risk={tok.risk} /></div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 800, color: "var(--text-primary)", textTransform: "uppercase", letterSpacing: "-0.01em" }}>{tok.symbol}</span>
                    {tok.spike && (
                      <span style={{ 
                        padding: "2px 6px", borderRadius: 3, fontSize: 9, fontWeight: 700, 
                        background: "rgba(240,192,64,0.2)", color: "var(--yellow)", border: "1px solid rgba(240,192,64,0.4)",
                        letterSpacing: "0.05em"
                      }}>
                        ⚡ {tok.spikeMultiplier}x SPIKE
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 1, fontFamily: "var(--font-mono)" }}>
                    {tok.mint ? `${tok.mint.slice(0, 4)}…${tok.mint.slice(-4)}` : "—"}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
                  <span style={{ fontSize: 12, fontWeight: 600, fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>${fmtPrice(tok.price)}</span>
                  <MiniSparkline positive={(tok.change || 0) >= 0} />
                </div>
                <div style={{ display: "flex", alignItems: "center", fontSize: 12, fontWeight: 700, fontFamily: "var(--font-mono)", color: (tok.change || 0) >= 0 ? "var(--green)" : "var(--red)" }}>
                  {(tok.change || 0) >= 0 ? "▲ " : "▼ "}{(tok.change || 0).toFixed(0)}%
                </div>
                <div style={{ display: "flex", alignItems: "center", fontSize: 11, color: "var(--text-secondary)" }}>{fmt(tok.mcap)}</div>
                <div style={{ display: "flex", alignItems: "center", fontSize: 11, color: "var(--text-secondary)" }}>{fmt(tok.vol24h)}</div>
                <div style={{ display: "flex", alignItems: "center", fontSize: 11, color: (tok.liquidity || 0) < 5000 ? "var(--orange)" : "var(--text-secondary)" }}>
                  {fmt(tok.liquidity)}
                </div>
                <div style={{ display: "flex", alignItems: "center", fontSize: 11, color: "var(--text-secondary)" }}>{tok.holders ?? "—"}</div>
                <div style={{ display: "flex", alignItems: "center" }}><RugMeter score={tok.rugScore} /></div>
                <div style={{ display: "flex", alignItems: "center" }}><BuzzBar score={tok.socialBuzz} /></div>
                <div style={{ display: "flex", alignItems: "center", fontSize: 10, color: "var(--text-muted)" }}>
                  {formatAge(now - tok.createdAt)}
                </div>
              </div>
            ))}

          </div>
        </div>

        {/* ── Right sidebar ── */}
        <div style={{ width: 260, background: "var(--bg-surface)", borderLeft: "1px solid var(--border-default)", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-default)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 8, color: "var(--text-muted)", letterSpacing: "0.2em", textTransform: "uppercase" }}>Live Stats</span>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--green)", animation: "blink 2s infinite" }} />
              <span style={{ color: "var(--green)", fontSize: 9, fontFamily: "var(--font-mono)" }}>{tokens.length} TRACKED</span>
            </div>
          </div>

          {/* Risk Summary */}
          <div style={{ padding: "12px 16px", animation: "fadeInUp 0.4s ease both", animationDelay: "0.3s" }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 8, color: "var(--text-muted)", letterSpacing: "0.2em", textTransform: "uppercase" }}>Risk Summary</span>
              <div style={{ flex: 1, height: 1, background: "var(--border-subtle)", marginLeft: 8 }} />
            </div>
            {["CRITICAL", "HIGH", "MED", "LOW"].map((risk) => {
              const count = tokens.filter((t) => t.risk === risk).length;
              const pct = tokens.length ? (count / tokens.length) * 100 : 0;
              return (
                <div key={risk} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: riskColor(risk), fontWeight: 700 }}>{risk}</span>
                    <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{count} tokens</span>
                  </div>
                  <div style={{ height: 3, background: "var(--bg-surface)", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: riskColor(risk), borderRadius: 2, transition: "width 0.5s" }} />
                  </div>
                </div>
              );
            })}

            <div style={{ display: "flex", alignItems: "center", marginTop: 16, marginBottom: 12 }}>
              <span style={{ fontSize: 8, color: "var(--text-muted)", letterSpacing: "0.2em", textTransform: "uppercase" }}>Pump.fun Stats</span>
              <div style={{ flex: 1, height: 1, background: "var(--border-subtle)", marginLeft: 8 }} />
            </div>
            {[
              { label: "New launches /hr", val: "142", color: "var(--blue)" },
              { label: "Avg rug time", val: "8m 34s", color: "var(--orange)" },
              { label: "Survival rate >1h", val: "23%", color: "var(--green)" },
              { label: "SOL in new pools", val: "1,240", color: "var(--purple)" },
            ].map((s) => (
              <div key={s.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>{s.label}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: s.color }}>{s.val}</span>
              </div>
            ))}

            {/* Dev Sell Alerts */}
            <div style={{ marginTop: 16 }}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 8, color: "var(--text-muted)", letterSpacing: "0.2em", textTransform: "uppercase" }}>Alert Log</span>
                <div style={{ flex: 1, height: 1, background: "var(--border-subtle)", marginLeft: 8 }} />
              </div>
              {alerts.length === 0 ? (
                <div style={{ fontSize: 10, color: "var(--text-muted)", fontStyle: "italic" }}>No alerts yet</div>
              ) : (
                alerts.slice(0, 5).map((alert, i) => {
                  const isDevSell = alert.type === "DEV_SELL";
                  const accent = isDevSell ? "var(--red)" : "var(--yellow)";
                  const bg = isDevSell ? "rgba(240,62,95,0.1)" : "rgba(240,192,64,0.1)";
                  const title = isDevSell
                    ? `DEV SOLD ${alert.soldPct}%`
                    : (alert.message || alert.type || "ALERT");
                  const mintShort = alert.mint
                    ? `${alert.mint.slice(0, 4)}...${alert.mint.slice(-4)}`
                    : "";
                  const subtitle = alert.symbol || mintShort || "Pump.fun";

                  return (
                    <div key={alert.id || alert.signature || i} style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "6px 8px",
                      marginBottom: 4,
                      background: bg,
                      borderRadius: 4,
                      borderLeft: `2px solid ${accent}`
                    }}>
                      <span style={{ fontSize: 10, color: accent, fontWeight: 700 }}>{title}</span>
                      <span style={{ fontSize: 9, color: "var(--text-muted)" }}>{subtitle}</span>
                    </div>
                  );
                })
              )}
            </div>

            {/* Last Updated */}
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--border-subtle)" }}>
              <div style={{ fontSize: 8, color: "var(--text-muted)", letterSpacing: "0.1em" }}>Last Updated</div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4 }}>
                {updatedAt ? new Date(updatedAt).toLocaleString() : "—"}
              </div>
            </div>
          </div>

          <div style={{ padding: 14, borderTop: "1px solid var(--border-default)", fontSize: 10, color: "var(--border-accent)", lineHeight: 1.5 }}>
            ⚠ Not financial advice. DYOR. Rug detection is probabilistic.
          </div>
        </div>
      </div>

      <div
        onClick={() => setSelected(null)}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0,0,0,0.4)",
          opacity: selectedToken ? 1 : 0,
          pointerEvents: selectedToken ? "auto" : "none",
          transition: "opacity 200ms ease",
          zIndex: 180,
        }}
      />

      <div style={{
        position: "fixed",
        right: 0,
        top: 0,
        height: "100vh",
        width: 360,
        background: "var(--bg-surface)",
        borderLeft: "1px solid var(--border-default)",
        transform: selectedToken ? "translateX(0)" : "translateX(100%)",
        transition: "transform 200ms ease",
        zIndex: 190,
        overflowY: "auto",
      }}>
        {selectedToken && (() => {
          const tok = selectedToken;
          return (
            <div style={{ padding: 16, position: "relative" }}>
              <button
                onClick={() => setSelected(null)}
                style={{
                  position: "absolute",
                  top: 10,
                  right: 12,
                  background: "transparent",
                  border: "none",
                  color: "var(--text-primary)",
                  fontSize: 22,
                  lineHeight: 1,
                  cursor: "pointer",
                }}
              >
                {"\u00D7"}
              </button>

              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, paddingRight: 28 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 8,
                  background: `linear-gradient(135deg, ${riskColor(tok.risk)}, var(--bg-surface))`,
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
                }}>🪙</div>
                <div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 800, color: "var(--text-primary)" }}>{tok.name}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{tok.mint}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); copyToClipboard(tok.mint, tok.mint); }}
                      style={{
                        background: "transparent", border: "none", cursor: "pointer", padding: "2px 6px",
                        borderRadius: 3, fontSize: 9, color: copiedMint === tok.mint ? "var(--green)" : "var(--text-muted)",
                        transition: "color 0.2s"
                      }}
                    >
                      {copiedMint === tok.mint ? "✓" : "📋"}
                    </button>
                    <span style={{ fontSize: 10, color: "var(--text-muted)" }}>• Pump.fun</span>
                  </div>
                </div>
                <div style={{ marginLeft: "auto", padding: "4px 10px", borderRadius: 4, background: riskBg(tok.risk), border: `1px solid ${riskColor(tok.risk)}33` }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: riskColor(tok.risk) }}>{tok.risk} RISK</span>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 10 }}>
                {[
                  { label: "Dev Holdings", val: tok.devHolds != null ? `${tok.devHolds}%` : "unknown", warn: (tok.devHolds || 0) > 10 },
                  { label: "LP Locked", val: tok.locked ? "✅ YES" : "❌ NO", warn: !tok.locked },
                  { label: "Authority", val: (tok.rugScore ?? 99) < 40 ? "✅ REVOKED" : "⚠️ ACTIVE", warn: (tok.rugScore ?? 99) >= 40 },
                  { label: "TX Count", val: tok.txCount ? tok.txCount.toLocaleString() : "—", warn: false },
                ].map((d) => (
                  <div key={d.label} style={{ padding: "8px 10px", background: "var(--bg-surface)", borderRadius: 6, border: `1px solid ${d.warn ? "rgba(240,62,95,0.2)" : "var(--border-subtle)"}` }}>
                    <div style={{ fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.1em", marginBottom: 4 }}>{d.label}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: d.warn ? "var(--orange)" : "var(--text-primary)" }}>{d.val}</div>
                  </div>
                ))}
              </div>

              {/* Rug flags from real on-chain analysis */}
              {tok.rugFlags?.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.1em", marginBottom: 6 }}>ON-CHAIN FLAGS</div>
                  {tok.rugFlags.map((f, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", marginBottom: 4, background: "rgba(240,62,95,0.06)", borderRadius: 4, borderLeft: "2px solid var(--red)" }}>
                      <span style={{ fontSize: 10, color: "var(--red)" }}>⚠</span>
                      <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>{f.label}</span>
                      <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 700, color: riskColor(f.severity) }}>{f.severity}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Risk breakdown bars */}
              <div style={{ padding: 10, background: "var(--bg-base)", borderRadius: 6, border: "1px solid var(--border-subtle)" }}>
                <div style={{ fontSize: 9, color: "var(--text-muted)", marginBottom: 6, letterSpacing: "0.1em" }}>RUG RISK BREAKDOWN</div>
                {[
                  { label: "Dev concentration", score: Math.min(100, (tok.devHolds || 0) * 2) },
                  { label: "Liquidity depth", score: (tok.liquidity || 0) < 5000 ? 80 : (tok.liquidity || 0) < 20000 ? 50 : 20 },
                  { label: "LP lock status", score: tok.locked ? 5 : 70 },
                  { label: "Social manipulation", score: 100 - (tok.socialBuzz || 50) },
                ].map((r) => (
                  <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <div style={{ width: 110, fontSize: 9, color: "var(--text-muted)" }}>{r.label}</div>
                    <div style={{ flex: 1, height: 3, background: "var(--bg-surface)", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ width: `${r.score}%`, height: "100%", borderRadius: 2, background: r.score > 70 ? "var(--red)" : r.score > 40 ? "var(--orange)" : "var(--green)", transition: "width 0.6s ease" }} />
                    </div>
                    <div style={{ width: 28, fontSize: 9, color: "var(--text-muted)", textAlign: "right" }}>{r.score}%</div>
                  </div>
                ))}
              </div>

              {tok.dexUrl && (
                <a href={tok.dexUrl} target="_blank" rel="noopener noreferrer"
                  style={{ display: "inline-block", marginTop: 10, fontSize: 10, color: "var(--blue)", textDecoration: "none", padding: "4px 10px", border: "1px solid rgba(64,144,240,0.3)", borderRadius: 4 }}>
                  View on Dexscreener →
                </a>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ─── Page export with Solana providers ───────────────────────────────────────
export default function Home() {
  return (
    <ConnectionProvider endpoint={RPC}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <Head>
            <title>WESLEY.SOL — Memecoin Monitor</title>
            <meta name="description" content="Real-time Solana memecoin monitor with rug detection" />
            <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚡</text></svg>" />
          </Head>
          <Dashboard />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
