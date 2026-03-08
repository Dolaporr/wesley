// pages/api/token/[mint].js — On-demand detail with full rug analysis
import { fetchTokenDetail } from "../../../lib/tokenData";

export default async function handler(req, res) {
  const { mint } = req.query;
  if (!mint) return res.status(400).json({ error: "mint required" });

  try {
    const detail = await fetchTokenDetail(mint);
    res.setHeader("Cache-Control", "s-maxage=15");
    return res.status(200).json(detail);
  } catch (err) {
    console.error("[/api/token/:mint]", err.message);
    return res.status(500).json({ error: "Failed to fetch token detail" });
  }
}
