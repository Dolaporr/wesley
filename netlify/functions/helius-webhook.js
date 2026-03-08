const PUMP_PROGRAM_ID = "6EF8rrecthR5DkzonEZu5uWDNKrGLuVPm26PCJZiUJFN";

function parseBody(body) {
  if (!body) return [];
  try {
    const parsed = JSON.parse(body);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function isPumpRelatedEvent(tx) {
  if (!tx || typeof tx !== "object") return false;

  if (tx.programId === PUMP_PROGRAM_ID) return true;

  if (Array.isArray(tx.accountData)) {
    const hit = tx.accountData.some((a) => a?.account === PUMP_PROGRAM_ID);
    if (hit) return true;
  }

  if (Array.isArray(tx.instructions)) {
    const hit = tx.instructions.some((ix) => ix?.programId === PUMP_PROGRAM_ID);
    if (hit) return true;
  }

  return false;
}

function extractMint(tx) {
  if (!tx || typeof tx !== "object") return null;

  const transferMint = tx.tokenTransfers?.find((t) => t?.mint)?.mint;
  if (transferMint) return transferMint;

  if (typeof tx.description === "string") {
    const match = tx.description.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
    if (match) return match[0];
  }

  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const configuredSecret = process.env.HELIUS_AUTH_HEADER;
  const incomingAuth =
    event.headers?.authorization || event.headers?.Authorization || "";

  if (!configuredSecret) {
    console.error("[helius-webhook] HELIUS_AUTH_HEADER is not configured");
    return { statusCode: 500, body: "Server misconfigured" };
  }

  if (incomingAuth !== configuredSecret) {
    return { statusCode: 401, body: "Unauthorized" };
  }

  const events = parseBody(event.body);
  if (events.length === 0) {
    return { statusCode: 200, body: JSON.stringify({ received: true, count: 0 }) };
  }

  const pumpEvents = events.filter(isPumpRelatedEvent);

  for (const tx of pumpEvents) {
    const mint = extractMint(tx);
    console.log(
      `[helius-webhook] Pump event: signature=${tx.signature || "unknown"} mint=${
        mint || "unknown"
      } type=${tx.type || "unknown"}`
    );
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      received: true,
      count: events.length,
      pumpEvents: pumpEvents.length,
    }),
  };
};
