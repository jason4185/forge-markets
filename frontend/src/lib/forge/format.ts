import { ASSET_LABEL, GEN_SCALE } from "./constants";

export function formatAsset(asset: string | null | undefined): string {
  return asset ? (ASSET_LABEL[asset] ?? asset) : "—";
}

export function formatGen(value: bigint | string | number, fractionDigits = 2): string {
  const amount = typeof value === "bigint" ? value : BigInt(value);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const whole = absolute / GEN_SCALE;
  const remainder = absolute % GEN_SCALE;
  if (fractionDigits <= 0) return `${negative ? "-" : ""}${whole.toString()}`;
  const precision = Math.min(18, Math.max(0, Math.floor(fractionDigits)));
  const fraction = remainder.toString().padStart(18, "0").slice(0, precision);
  const trimmed = fraction.replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toString()}${trimmed ? `.${trimmed}` : ""}`;
}

export function parseGen(value: string): bigint | null {
  const normalized = value.trim();
  if (!/^\d+(\.\d{0,18})?$/.test(normalized)) return null;
  const [whole = "0", fraction = ""] = normalized.split(".");
  return BigInt(whole) * GEN_SCALE + BigInt(fraction.padEnd(18, "0") || "0");
}

export function timestampMsFromSeconds(seconds: bigint | string | number): number {
  const value = typeof seconds === "bigint" ? seconds : BigInt(seconds);
  if (value < 0n || value > BigInt(Math.floor(Number.MAX_SAFE_INTEGER / 1000))) {
    throw new Error("Timestamp is outside the supported display range.");
  }
  const milliseconds = Number(value * 1000n);
  if (!Number.isSafeInteger(milliseconds)) throw new Error("Invalid timestamp.");
  return milliseconds;
}

export function formatUtcDate(milliseconds: number): string {
  return new Date(milliseconds).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatUtcTime(milliseconds: number): string {
  const date = new Date(milliseconds);
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")} UTC`;
}

export function formatUtcWindow(startMs: number, endMs: number): string {
  return `${formatUtcTime(startMs)} → ${formatUtcTime(endMs)}`;
}

export function relativeActivityTime(timestampMs: number): string {
  const delta = Math.max(0, Date.now() - timestampMs);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function truncateAddress(address?: string): string {
  if (!address) return "";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
