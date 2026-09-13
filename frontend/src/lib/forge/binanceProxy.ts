const BINANCE_KLINES_URL = "https://fapi.binance.com/fapi/v1/klines";
const ALLOWED_SYMBOLS = new Set([
  "XAUUSDT",
  "XAGUSDT",
  "COPPERUSDT",
  "CLUSDT",
  "BZUSDT",
  "NATGASUSDT",
]);
const MAX_WINDOW_MS = 60 * 60 * 1000;
const MAX_KLINES = 60;
const MAX_UPSTREAM_BYTES = 512 * 1024;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function parseTimestamp(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function validPrice(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value)) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

export async function handleBinanceKlines(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const symbol = requestUrl.searchParams.get("symbol");
  const interval = requestUrl.searchParams.get("interval");
  const startTime = parseTimestamp(requestUrl.searchParams.get("startTime"));
  const endTime = parseTimestamp(requestUrl.searchParams.get("endTime"));

  if (!symbol || !ALLOWED_SYMBOLS.has(symbol))
    return json({ error: "Unsupported Forge Binance symbol." }, 400);
  if (interval !== "1m") return json({ error: "Only the 1m interval is supported." }, 400);
  if (
    startTime === null ||
    endTime === null ||
    startTime % 60_000 !== 0 ||
    endTime <= startTime ||
    endTime - startTime > MAX_WINDOW_MS
  )
    return json({ error: "Invalid Forge market candle window." }, 400);

  const upstreamUrl = new URL(BINANCE_KLINES_URL);
  upstreamUrl.searchParams.set("symbol", symbol);
  upstreamUrl.searchParams.set("interval", interval);
  upstreamUrl.searchParams.set("startTime", String(startTime));
  upstreamUrl.searchParams.set("endTime", String(endTime));
  upstreamUrl.searchParams.set("limit", String(MAX_KLINES));

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 10_000);
  try {
    const upstream = await fetch(upstreamUrl, { signal: controller.signal });
    const body = await upstream.text();
    if (new TextEncoder().encode(body).byteLength > MAX_UPSTREAM_BYTES)
      return json({ error: "Binance response exceeded the supported size." }, 502);
    if (!upstream.ok) return json({ error: `Binance returned HTTP ${upstream.status}.` }, 502);

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      return json({ error: "Binance returned malformed JSON." }, 502);
    }
    if (!Array.isArray(payload) || payload.length > MAX_KLINES)
      return json({ error: "Binance returned an invalid candle payload." }, 502);

    const klines: Array<{ openTime: number; open: string; close: string }> = [];
    let previousOpenTime = -1;
    for (const raw of payload) {
      if (!Array.isArray(raw) || raw.length < 7)
        return json({ error: "Binance returned a malformed candle." }, 502);
      const openTime =
        typeof raw[0] === "number"
          ? raw[0]
          : typeof raw[0] === "string" && /^\d+$/.test(raw[0])
            ? Number(raw[0])
            : Number.NaN;
      if (
        !Number.isSafeInteger(openTime) ||
        openTime < startTime ||
        openTime >= endTime ||
        openTime % 60_000 !== 0 ||
        openTime <= previousOpenTime ||
        !validPrice(raw[1]) ||
        !validPrice(raw[4])
      )
        return json({ error: "Binance returned an invalid candle window." }, 502);
      previousOpenTime = openTime;
      klines.push({ openTime, open: raw[1], close: raw[4] });
    }

    return json({ symbol, interval, startTime, endTime, klines });
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error && error.name === "AbortError"
            ? "Binance request timed out."
            : "Binance request failed.",
      },
      502,
    );
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
