import type { Asset, MarketView } from "./types";

interface BinanceKline {
  openTime: number;
  open: string;
  close: string;
}

interface BinanceKlinesResponse {
  symbol: string;
  interval: string;
  startTime: number;
  endTime: number;
  klines: BinanceKline[];
}

export interface BinanceChartPoint {
  timeMs: number;
  [asset: string]: number;
}

export interface BinancePerformance {
  points: BinanceChartPoint[];
}

function parseSafeTimestamp(value: unknown): number {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new Error("Invalid Binance candle timestamp.");
  return parsed;
}

function parsePrice(value: unknown): number {
  if (typeof value !== "string") throw new Error("Invalid Binance candle price.");
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("Invalid Binance candle price.");
  return parsed;
}

function asResponse(
  value: unknown,
  symbol: string,
  startTime: number,
  endTime: number,
): BinanceKlinesResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Invalid Binance response shape.");
  const data = value as Record<string, unknown>;
  if (
    data["symbol"] !== symbol ||
    data["interval"] !== "1m" ||
    parseSafeTimestamp(data["startTime"]) !== startTime ||
    parseSafeTimestamp(data["endTime"]) !== endTime ||
    !Array.isArray(data["klines"]) ||
    data["klines"].length > 60
  )
    throw new Error("Binance response does not match the requested market window.");

  let previous = -1;
  const klines = data["klines"].map((value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw new Error("Invalid Binance candle shape.");
    const candle = value as Record<string, unknown>;
    const openTime = parseSafeTimestamp(candle["openTime"]);
    if (
      openTime < startTime ||
      openTime >= endTime ||
      openTime % 60_000 !== 0 ||
      openTime <= previous
    )
      throw new Error("Binance candle timestamp is outside the requested window.");
    previous = openTime;
    parsePrice(candle["open"]);
    parsePrice(candle["close"]);
    return {
      openTime,
      open: String(candle["open"]),
      close: String(candle["close"]),
    };
  });
  return { symbol, interval: "1m", startTime, endTime, klines };
}

async function fetchKlines(
  symbol: string,
  startTime: number,
  endTime: number,
): Promise<BinanceKline[]> {
  const params = new URLSearchParams({
    symbol,
    interval: "1m",
    startTime: String(startTime),
    endTime: String(endTime),
  });
  const response = await fetch(`/api/binance/klines?${params.toString()}`);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("Binance proxy returned malformed JSON.");
  }
  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
        ? body.error
        : "Binance performance data unavailable.";
    throw new Error(message);
  }
  return asResponse(body, symbol, startTime, endTime).klines;
}

export async function fetchBinancePerformance(
  market: MarketView,
  endTime: number,
): Promise<BinancePerformance> {
  const symbols = market.symbolsBySource.BINANCE;
  if (symbols.length !== market.assets.length || market.assets.length !== 3)
    throw new Error("Contract market has an invalid Binance symbol mapping.");

  const candles = await Promise.all(
    symbols.map((symbol) => fetchKlines(symbol, market.startMs, endTime)),
  );
  const byAsset = new Map<Asset, BinanceKline[]>();
  market.assets.forEach((asset, index) => byAsset.set(asset, candles[index]!));
  const baseline = new Map<Asset, number>();
  for (const asset of market.assets) {
    const candle = byAsset.get(asset)?.find((row) => row.openTime === market.startMs);
    if (!candle) throw new Error("Binance did not return the market-start candle.");
    baseline.set(asset, parsePrice(candle.open));
  }

  const first = byAsset.get(market.assets[0]!);
  if (!first || first.length === 0) throw new Error("Binance returned no candles for this market.");
  const commonTimes = first
    .map((candle) => candle.openTime)
    .filter((time) =>
      market.assets.every((asset) => byAsset.get(asset)?.some((row) => row.openTime === time)),
    );
  if (commonTimes.length === 0) throw new Error("Binance returned no common candle timestamps.");

  const points = commonTimes.map((timeMs) => {
    const point = { timeMs } as BinanceChartPoint;
    for (const asset of market.assets) {
      const candle = byAsset.get(asset)?.find((row) => row.openTime === timeMs);
      const base = baseline.get(asset);
      if (!candle || base === undefined) throw new Error("Binance candle series is incomplete.");
      point[asset] = (parsePrice(candle.close) / base - 1) * 100;
    }
    return point;
  });
  const initialPoint = { timeMs: market.startMs } as BinanceChartPoint;
  for (const asset of market.assets) initialPoint[asset] = 0;
  if (points[0]?.timeMs === market.startMs) points[0] = initialPoint;
  else points.unshift(initialPoint);
  return { points };
}
