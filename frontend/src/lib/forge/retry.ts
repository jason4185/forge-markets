export const MAX_QUERY_RETRIES = 2;
export const POST_WRITE_RECONCILIATION_ATTEMPTS = 10;
export const POST_WRITE_RECONCILIATION_DELAY_MS = 1_500;

export interface RetryReadOptions {
  attempts?: number;
  delayMs?: number;
  onWaiting?: () => void;
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { status?: unknown; statusCode?: unknown };
  const value = candidate.status ?? candidate.statusCode;
  return typeof value === "number" ? value : undefined;
}

function errorText(error: unknown): string {
  if (!error || typeof error !== "object") return String(error).toLowerCase();
  const candidate = error as {
    message?: unknown;
    details?: unknown;
    shortMessage?: unknown;
    cause?: unknown;
  };
  return [candidate.message, candidate.details, candidate.shortMessage, errorText(candidate.cause)]
    .filter((value) => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

export function isRecoverableReadError(error: unknown): boolean {
  const status = errorStatus(error);
  if (status === 429 || (status !== undefined && status >= 500)) return true;
  if (status !== undefined && status >= 400) return false;
  const message = errorText(error);
  if (/rate limit|too many requests|\b429\b/.test(message)) return true;
  if (
    /invalid|mismatch|not found|not supported|outside the supported|already|closed|started|not open|minimum bet|execution failed/i.test(
      message,
    )
  ) {
    return false;
  }
  return /fetch|network|timeout|temporar|rpc|gateway|connection|genlayer|http request failed|unavailable/i.test(
    message,
  );
}

export function shouldRetryRead(failureCount: number, error: unknown): boolean {
  return failureCount < MAX_QUERY_RETRIES && isRecoverableReadError(error);
}

export function queryRetryDelay(attemptIndex: number, error?: unknown): number {
  if (/rate limit|too many requests|\b429\b/.test(errorText(error)))
    return Math.min(10_000 * 2 ** attemptIndex, 30_000);
  return Math.min(250 * 2 ** attemptIndex, 1_000);
}

export async function retryRead<T>(
  read: () => Promise<T>,
  isReady: (value: T) => boolean,
  options: RetryReadOptions = {},
): Promise<T | undefined> {
  const {
    attempts = POST_WRITE_RECONCILIATION_ATTEMPTS,
    delayMs = POST_WRITE_RECONCILIATION_DELAY_MS,
    onWaiting,
  } = options;
  const count = Math.max(1, Math.floor(attempts));
  for (let attempt = 0; attempt < count; attempt += 1) {
    try {
      const value = await read();
      if (isReady(value)) return value;
    } catch {
      // Accepted writes remain successful even while the read path catches up.
    }
    if (attempt < count - 1) {
      onWaiting?.();
      if (delayMs > 0)
        await new Promise<void>((resolve) => globalThis.setTimeout(resolve, delayMs));
    }
  }
  return undefined;
}

export async function reconcileAcceptedWrite<T>(
  result: { ok: boolean; confirmed?: boolean },
  read: () => Promise<T>,
  isReady: (value: T) => boolean,
  options?: RetryReadOptions,
): Promise<T | undefined> {
  if (!result.ok || result.confirmed !== true) return undefined;
  let waitingNotified = false;
  return retryRead(read, isReady, {
    ...options,
    onWaiting: () => {
      if (waitingNotified) return;
      waitingNotified = true;
      options?.onWaiting?.();
    },
  });
}
