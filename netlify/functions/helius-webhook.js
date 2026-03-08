const PUMP_PROGRAM_ID = "6EF8rrecthR5DkzonEZu5uWDNKrGLuVPm26PCJZiUJFN";
const SEEN_SIGNATURES = new Set();
const MAX_SEEN_SIGNATURES = 1000;

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

function extractSymbol(tx) {
  if (!tx || typeof tx !== "object") return null;

  const transferSymbol = tx.tokenTransfers?.find((t) => t?.tokenSymbol)?.tokenSymbol;
  if (transferSymbol) return transferSymbol;

  return null;
}

function rememberSignature(signature) {
  if (!signature) return false;
  if (SEEN_SIGNATURES.has(signature)) return true;
  SEEN_SIGNATURES.add(signature);
  if (SEEN_SIGNATURES.size > MAX_SEEN_SIGNATURES) {
    const oldest = SEEN_SIGNATURES.values().next().value;
    SEEN_SIGNATURES.delete(oldest);
  }
  return false;
}

function buildAlert(tx) {
  const signature = tx.signature || null;
  const mint = extractMint(tx);
  const symbol = extractSymbol(tx);
  const txType = tx.type || "ACTIVITY";
  const timestampMs =
    typeof tx.timestamp === "number" ? tx.timestamp * 1000 : Date.now();

  return {
    id: signature || undefined,
    time: timestampMs,
    type: "PUMP_ACTIVITY",
    source: "helius",
    symbol,
    mint,
    signature,
    message: `Pump ${txType}`,
  };
}

function resolveBaseUrl(event) {
  const explicit = process.env.SITE_URL || process.env.URL || "";
  if (explicit) return explicit.replace(/\/$/, "");

  const proto = event.headers?.["x-forwarded-proto"] || "https";
  const host = event.headers?.["x-forwarded-host"] || event.headers?.host || "";
  if (!host) return null;
  return `${proto}://${host}`;
}

async function forwardAlertsToApp(event, alerts, requestId, authHeader) {
  if (!alerts.length) return { ok: true, added: 0, status: 200 };

  const baseUrl = resolveBaseUrl(event);
  if (!baseUrl) {
    console.warn(
      `[helius-webhook] requestId=${requestId} ingest_skipped reason=missing_base_url`
    );
    return { ok: false, added: 0, status: 0 };
  }

  const endpoint = `${baseUrl}/api/alerts`;
  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify(alerts),
    });

    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.warn(
        `[helius-webhook] requestId=${requestId} ingest_failed status=${resp.status} endpoint=${endpoint}`
      );
      return { ok: false, added: 0, status: resp.status };
    }

    const added = Number(json?.added) || alerts.length;
    return { ok: true, added, status: resp.status };
  } catch (err) {
    console.error(
      `[helius-webhook] requestId=${requestId} ingest_error message=${err.message}`
    );
    return { ok: false, added: 0, status: 0 };
  }
}

exports.handler = async (event) => {
  const requestId =
    event.headers?.["x-nf-request-id"] ||
    event.headers?.["X-Nf-Request-Id"] ||
    "unknown";
  const method = event.httpMethod || "unknown";
  const hasBody = Boolean(event.body);

  console.log(
    `[helius-webhook] request received requestId=${requestId} method=${method} hasBody=${hasBody}`
  );

  if (event.httpMethod !== "POST") {
    console.log(
      `[helius-webhook] requestId=${requestId} rejected status=405 reason=method_not_allowed`
    );
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const configuredSecret = process.env.HELIUS_AUTH_HEADER;
  const incomingAuth =
    event.headers?.authorization || event.headers?.Authorization || "";

  if (!configuredSecret) {
    console.error(
      `[helius-webhook] requestId=${requestId} rejected status=500 reason=missing_env_secret`
    );
    return { statusCode: 500, body: "Server misconfigured" };
  }

  if (incomingAuth !== configuredSecret) {
    console.warn(
      `[helius-webhook] requestId=${requestId} rejected status=401 reason=auth_mismatch`
    );
    return { statusCode: 401, body: "Unauthorized" };
  }

  const events = parseBody(event.body);
  if (events.length === 0) {
    console.log(
      `[helius-webhook] requestId=${requestId} auth=ok events=0 pumpEvents=0 status=200`
    );
    return { statusCode: 200, body: JSON.stringify({ received: true, count: 0 }) };
  }

  const pumpEvents = events.filter(isPumpRelatedEvent);
  const alertBatch = [];

  for (const tx of pumpEvents) {
    if (rememberSignature(tx.signature)) {
      continue;
    }

    const mint = extractMint(tx);
    const symbol = extractSymbol(tx);
    console.log(
      `[helius-webhook] Pump event: signature=${tx.signature || "unknown"} mint=${
        mint || "unknown"
      } symbol=${symbol || "unknown"} type=${tx.type || "unknown"}`
    );

    alertBatch.push(buildAlert(tx));
  }

  const ingest = await forwardAlertsToApp(
    event,
    alertBatch,
    requestId,
    configuredSecret
  );

  console.log(
    `[helius-webhook] requestId=${requestId} auth=ok events=${events.length} pumpEvents=${pumpEvents.length} alertsSent=${alertBatch.length} alertsAdded=${ingest.added} ingestStatus=${ingest.status} status=200`
  );

  return {
    statusCode: 200,
    body: JSON.stringify({
      received: true,
      count: events.length,
      pumpEvents: pumpEvents.length,
    }),
  };
};
