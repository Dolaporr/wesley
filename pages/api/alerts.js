// pages/api/alerts.js — API endpoint for dev sell alerts
import { addAlert, recentAlerts } from "./_store";

function isAuthorized(req) {
  const expected = process.env.HELIUS_AUTH_HEADER;
  if (!expected) return false;
  const got = req.headers.authorization || req.headers.Authorization || "";
  return got === expected;
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({
      alerts: recentAlerts,
      count: recentAlerts.length,
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const payload = req.body || {};
  const incoming = Array.isArray(payload) ? payload : [payload];
  let added = 0;

  for (const item of incoming) {
    const saved = addAlert(item);
    if (saved) added += 1;
  }

  return res.status(200).json({
    ok: true,
    added,
    count: recentAlerts.length,
  });
}
