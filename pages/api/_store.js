export const recentAlerts = [];
const MAX_ALERTS = 50;

export function addAlert(input = {}) {
  const time = Number(input.time) || Date.now();
  const entry = {
    id:
      input.id ||
      input.signature ||
      `${input.type || "ALERT"}:${input.mint || "na"}:${time}:${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    time,
    type: input.type || "ALERT",
    source: input.source || "system",
    symbol: input.symbol || null,
    mint: input.mint || null,
    soldPct: input.soldPct ?? null,
    message: input.message || null,
    signature: input.signature || null,
  };

  if (entry.signature) {
    const alreadyExists = recentAlerts.some((a) => a.signature === entry.signature);
    if (alreadyExists) return null;
  }

  recentAlerts.unshift(entry);
  if (recentAlerts.length > MAX_ALERTS) {
    recentAlerts.length = MAX_ALERTS;
  }

  return entry;
}
