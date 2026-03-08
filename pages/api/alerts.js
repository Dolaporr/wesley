// pages/api/alerts.js — API endpoint for dev sell alerts
import { recentAlerts } from "./_store";

// Re-export the alerts from tokens.js (shared in-memory)
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  return res.status(200).json({
    alerts: recentAlerts,
    count: recentAlerts.length,
  });
}
