import { createClient, isSuccessful } from "genlayer-js";
import {
  ExecutionResult,
  TransactionStatus,
  executionResultNumberToName,
  transactionsStatusNumberToName,
  type CalldataEncodable,
  type GenLayerTransaction,
  type TransactionHash,
  TransactionHashVariant,
} from "genlayer-js/types";
import { isAddress, type Address, type EIP1193Provider } from "viem";
import {
  ASSET_LABEL,
  CATEGORY_ASSETS,
  CATEGORIES,
  forgeChain,
  FORGE_CHAIN_ID,
  FORGE_CONTRACT_ADDRESS,
  FORGE_NETWORK_NAME,
  FORGE_RPC_URL,
  MAX_PAGE_SIZE,
  MARKET_STATES,
  SOURCES,
  type Category,
  type ContractMarketState,
  type Source,
} from "./constants";
import { getActiveInjectedProvider } from "./walletConfig";
import { formatGen, timestampMsFromSeconds } from "./format";
import { logForgeError, mapForgeError, type ForgeErrorContext } from "./errors";
import type {
  ActivityRecord,
  BettingState,
  EvidenceAsset,
  MarketView,
  PositionView,
  ProtocolConfig,
  SourceEvidence,
  SourceStatus,
  UserPosition,
} from "./types";

export type TransactionStage =
  "AWAITING_SIGNATURE" | "SUBMITTED" | "PROCESSING" | "SUCCESS" | "UNCERTAIN";
export type TransactionStageHandler = (stage: TransactionStage) => void;
export interface ContractWriteResult {
  ok: boolean;
  hash?: string;
  confirmed?: boolean;
  error?: string;
}

export const TRANSACTION_POLL_INTERVAL_MS = 2_000;
export const TRANSACTION_MAX_ATTEMPTS = 75;
export const FINALIZATION_MAX_ATTEMPTS = 49;

type RawMap = Record<string, unknown>;
const readClient = createClient({ chain: forgeChain as never });

function debugForgeTransaction(label: string, details: RawMap) {
  if (import.meta.env.DEV) console.debug(label, details);
}

function debugTransactionValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(debugTransactionValue);
  if (isMap(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, debugTransactionValue(nested)]),
    );
  return typeof value === "bigint" ? value.toString() : value;
}

function debugError(error: unknown): RawMap {
  if (error instanceof Error) {
    const details: RawMap = { name: error.name, message: error.message, stack: error.stack };
    if (isMap(error)) {
      for (const key of ["code", "shortMessage", "details", "cause"]) {
        const value = error[key];
        if (typeof value === "string" || typeof value === "number") details[key] = value;
        else if (value instanceof Error) details[key] = value.message;
      }
    }
    return details;
  }
  return { message: String(error) };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readErrorContext(functionName: string): ForgeErrorContext {
  switch (functionName) {
    case "get_market":
    case "get_market_by_category_start":
      return "READ_MARKET";
    case "get_markets":
    case "get_open_markets":
    case "get_market_count":
      return "READ_MARKETS";
    case "categories":
    case "category_assets":
      return "READ_CATEGORIES";
    case "get_source_evidence":
      return "READ_SOURCE_EVIDENCE";
    case "get_my_activity":
    case "get_my_activity_count":
      return "READ_ACTIVITY";
    case "get_my_position":
    case "get_my_market_count":
    case "get_my_positions":
    case "get_my_claimable_markets":
    case "get_betting_state":
      return "READ_PORTFOLIO";
    default:
      return "GENERAL";
  }
}

function isUserRejected(error: unknown): boolean {
  const code = isMap(error) ? error["code"] : undefined;
  const message = errorMessage(error).toLowerCase();
  return code === 4001 || /user rejected|user denied|denied|cancelled|canceled/.test(message);
}

function providerType(provider: unknown): string {
  if (provider && typeof provider === "object") {
    const constructorName = (provider as { constructor?: { name?: unknown } }).constructor?.name;
    if (typeof constructorName === "string" && constructorName) return constructorName;
  }
  return "EIP-1193";
}

function debugProvider(provider: EIP1193Provider, functionName: string): EIP1193Provider {
  return {
    request: async (request) => {
      if (import.meta.env.DEV && request.method === "eth_sendTransaction") {
        const transaction = Array.isArray(request.params) ? request.params[0] : undefined;
        const data = isMap(transaction) ? transaction : {};
        debugForgeTransaction(
          functionName === "settle_market"
            ? "[FORGE SETTLE WALLET REQUEST]"
            : "[FORGE WRITE 6 PROVIDER_REQUEST]",
          {
            method: request.method,
            from: data["from"] ?? "not exposed",
            chainId: data["chainId"] ?? FORGE_CHAIN_ID,
            to: data["to"] ?? "not exposed",
            data: data["data"] ?? "not exposed",
            value: data["value"] ?? "not exposed",
          },
        );
      }
      return provider.request(request as never);
    },
  } as EIP1193Provider;
}

type ForgeWriteClient = ReturnType<typeof createClient>;
type ForgeWriteCall = {
  address: Address;
  functionName: string;
  args: CalldataEncodable[];
  value: bigint;
};
type ForgeFeeEstimate = Awaited<ReturnType<ForgeWriteClient["estimateTransactionFeesForWrite"]>>;

function isTransientFeeError(error: unknown): boolean {
  const details = debugError(error);
  const code = details["code"];
  const text = Object.values(details)
    .filter((value) => typeof value === "string" || typeof value === "number")
    .join(" ")
    .toLowerCase();
  return (
    code === 429 ||
    code === 502 ||
    code === 503 ||
    code === 504 ||
    /\b429\b|\b502\b|\b503\b|\b504\b|rate limit|too many requests|bad gateway|failed to fetch|network|timeout|temporar/.test(
      text,
    )
  );
}

function exposedReceiptField(receipt: RawMap, names: string[]): string | number {
  for (const name of names) {
    const value = receipt[name];
    if (typeof value === "string" || typeof value === "number") return value;
  }
  return "not exposed by GenLayer receipt";
}

function isMap(value: unknown): value is RawMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asMap(value: unknown): RawMap {
  if (!isMap(value)) throw new Error("Invalid contract response shape.");
  return value;
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Invalid contract response array.");
  return value;
}

function asString(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid string in contract response.");
  return value;
}

function asBool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Invalid boolean in contract response.");
  return value;
}

function asBigInt(value: unknown): bigint {
  try {
    if (typeof value === "bigint" && value >= 0n) return value;
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
      return BigInt(value);
    if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  } catch {
    // Normalize all malformed numeric responses to one safe error below.
  }
  throw new Error("Invalid unsigned integer in contract response.");
}

function asSignedBigInt(value: unknown): bigint {
  try {
    if (typeof value === "bigint") return value;
    if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
    if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  } catch {
    // Normalize malformed signed values below.
  }
  throw new Error("Invalid signed integer in contract response.");
}

function asNumber(value: unknown): number {
  const number =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (Number.isFinite(number)) return number;
  throw new Error("Invalid number in contract response.");
}

function asCategory(value: unknown): Category {
  const category = asString(value);
  if (category === "METALS" || category === "ENERGY") return category;
  throw new Error("Contract response has an invalid category.");
}

function asAsset(value: unknown, category: Category): keyof typeof ASSET_LABEL {
  const asset = asString(value);
  if (CATEGORY_ASSETS[category].includes(asset)) return asset as keyof typeof ASSET_LABEL;
  throw new Error("Contract response has an invalid asset.");
}

function asSource(value: unknown): Source {
  const source = asString(value);
  if (SOURCES.includes(source as Source)) return source as Source;
  throw new Error("Contract response has an invalid source.");
}

function asSourceStatus(value: unknown): SourceStatus {
  const status = asString(value);
  if (status === "VALID" || status === "TIE" || status === "UNAVAILABLE") return status;
  throw new Error("Contract response has an invalid source status.");
}

function asContractState(value: unknown): ContractMarketState {
  const state = asString(value);
  if ((MARKET_STATES as readonly string[]).includes(state)) return state as ContractMarketState;
  throw new Error("Contract response has an invalid market state.");
}

function asTimestampSeconds(value: unknown): bigint {
  const timestamp = asBigInt(value);
  timestampMsFromSeconds(timestamp);
  return timestamp;
}

function asMarketId(value: unknown): string {
  return asBigInt(value).toString();
}

function requestedMarketId(value: string): bigint {
  if (!/^\d+$/.test(value) || BigInt(value) === 0n) throw new Error("Market not found.");
  return BigInt(value);
}

function pageArgs(offset: number, limit: number): [bigint, bigint] {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid page offset.");
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > MAX_PAGE_SIZE) {
    throw new Error(`Page size must be between 0 and ${MAX_PAGE_SIZE}.`);
  }
  return [BigInt(offset), BigInt(limit)];
}

function expectedSymbols(category: Category, source: Source): string[] {
  if (category === "METALS") {
    return source === "GATE"
      ? ["XAU_USDT", "XAG_USDT", "XCU_USDT"]
      : ["XAUUSDT", "XAGUSDT", "COPPERUSDT"];
  }
  return source === "GATE" ? ["CL_USDT", "BZ_USDT", "NG_USDT"] : ["CLUSDT", "BZUSDT", "NATGASUSDT"];
}

function normalizeSymbols(value: unknown, category: Category, source: Source): string[] {
  const symbols = asArray(value).map(asString);
  const expected = expectedSymbols(category, source);
  if (
    symbols.length !== expected.length ||
    symbols.some((symbol, index) => symbol !== expected[index])
  ) {
    throw new Error("Contract response has invalid source symbols.");
  }
  return symbols;
}

function displayState(state: ContractMarketState, startMs: number, endMs: number, nowMs: number) {
  if (state === "SETTLED" || state === "INCONCLUSIVE" || state === "SETTLEMENT_PENDING")
    return state;
  if (nowMs < startMs) return "UPCOMING" as const;
  if (nowMs >= endMs) return "SETTLEMENT_PENDING" as const;
  return "OPEN" as const;
}

function poolShare(pool: bigint, total: bigint): number {
  if (total === 0n) return 0;
  return Number((pool * 10_000n) / total) / 100;
}

function normalizeMarket(raw: unknown, nowMs: number): MarketView {
  const data = asMap(raw);
  const category = asCategory(data["category"]);
  const assets = asArray(data["assets"]).map((asset) => asAsset(asset, category));
  const expectedAssets = CATEGORY_ASSETS[category];
  if (assets.length !== 3 || assets.some((asset, index) => asset !== expectedAssets[index])) {
    throw new Error("Contract response has invalid category assets.");
  }
  const symbolsBySource = {} as Record<Source, string[]>;
  const rawSymbolsBySource = asMap(data["symbols_by_source"]);
  for (const source of SOURCES)
    symbolsBySource[source] = normalizeSymbols(rawSymbolsBySource[source], category, source);
  const symbols = normalizeSymbols(data["symbols"], category, "BINANCE");
  const startSeconds = asTimestampSeconds(data["market_start"]);
  const endSeconds = asTimestampSeconds(data["market_end"]);
  const deadlineSeconds = asTimestampSeconds(data["settlement_deadline"]);
  const startMs = timestampMsFromSeconds(startSeconds);
  const endMs = timestampMsFromSeconds(endSeconds);
  if (endSeconds - startSeconds !== 3600n || startSeconds % 3600n !== 0n || endMs <= startMs) {
    throw new Error("Contract market has an invalid time window.");
  }
  const state = asContractState(data["state"]);
  const durationSeconds = asBigInt(data["duration_seconds"]);
  if (durationSeconds !== 3600n || deadlineSeconds !== endSeconds + 1800n) {
    throw new Error("Contract market has invalid timing configuration.");
  }
  const rawPools = asMap(data["outcome_pools"]);
  const pools = {} as Record<keyof typeof ASSET_LABEL, bigint>;
  let poolTotal = 0n;
  for (const asset of assets) {
    const value = asBigInt(rawPools[asset]);
    pools[asset] = value;
    poolTotal += value;
  }
  const totalPool = asBigInt(data["total_pool"]);
  if (poolTotal !== totalPool) throw new Error("Contract market pool totals are inconsistent.");
  const claimedPool = asBigInt(data["claimed_pool"]);
  const refundedPool = asBigInt(data["refunded_pool"]);
  const winningPool = asBigInt(data["winning_pool"]);
  const remainingPool = asBigInt(data["remaining_pool"]);
  if (
    claimedPool > totalPool ||
    refundedPool > totalPool ||
    winningPool > totalPool ||
    remainingPool > totalPool
  ) {
    throw new Error("Contract market accounting is inconsistent.");
  }
  const winnerValue = asString(data["winner"]);
  const winner = winnerValue ? asAsset(winnerValue, category) : null;
  const poolShares = {} as Record<keyof typeof ASSET_LABEL, number>;
  for (const asset of assets) poolShares[asset] = poolShare(pools[asset] ?? 0n, totalPool);
  return {
    id: asMarketId(data["id"]),
    category,
    assets,
    symbols,
    symbolsBySource,
    startSeconds,
    endSeconds,
    settlementDeadlineSeconds: deadlineSeconds,
    startMs,
    endMs,
    bettingCloseMs: startMs,
    durationSeconds: Number(durationSeconds),
    contractState: state,
    state: displayState(state, startMs, endMs, nowMs),
    winner,
    pools,
    poolShares,
    totalPool,
    bettingOpen: asBool(data["betting_open"]),
    settlementAvailable: asBool(data["settlement_available"]),
    winningPool,
    claimedPool,
    refundedPool,
    remainingPool,
  };
}

function normalizePosition(raw: unknown, wallet: string, expectedMarketId?: string): PositionView {
  const data = asMap(raw);
  const marketId = asMarketId(data["market_id"]);
  if (expectedMarketId !== undefined && marketId !== expectedMarketId)
    throw new Error("User position market mismatch.");
  const category = asCategory(data["category"]);
  const hasPosition = asBool(data["has_position"]);
  const selectedValue = asString(data["selected_asset"]);
  const selectedAsset = hasPosition ? asAsset(selectedValue, category) : null;
  const claimType = asString(data["claim_type"]);
  if (claimType !== "NONE" && claimType !== "WINNINGS" && claimType !== "REFUND")
    throw new Error("Invalid position claim type.");
  if (wallet.length === 0) throw new Error("Invalid wallet address.");
  return {
    marketId,
    hasPosition,
    category,
    selectedAsset,
    totalStake: asBigInt(data["total_stake"]),
    marketState: asContractState(data["market_state"]),
    canTopUp: asBool(data["can_top_up"]),
    positionWon: asBool(data["position_won"]),
    positionLost: asBool(data["position_lost"]),
    claimAvailable: asBool(data["claim_available"]),
    refundAvailable: asBool(data["refund_available"]),
    alreadyClaimed: asBool(data["already_claimed"]),
    refunded: asBool(data["refunded"]),
    claimableAmount: asBigInt(data["claimable_amount"]),
    claimType: claimType as PositionView["claimType"],
  };
}

function normalizeBettingState(raw: unknown): BettingState {
  const data = asMap(raw);
  const category = asCategory(data["category"]);
  const rawStakes = asMap(data["outcome_stakes"]);
  const outcomeStakes = {} as Record<keyof typeof ASSET_LABEL, bigint>;
  for (const asset of CATEGORY_ASSETS[category]) outcomeStakes[asset] = asBigInt(rawStakes[asset]);
  const bettorAssetValue = asString(data["bettor_asset"]);
  return {
    category,
    totalMarketPool: asBigInt(data["total_market_pool"]),
    outcomeStakes,
    bettorAsset: bettorAssetValue ? asAsset(bettorAssetValue, category) : null,
    bettorStake: asBigInt(data["bettor_stake"]),
    claimed: asBool(data["claimed"]),
    refunded: asBool(data["refunded"]),
    winningPool: asBigInt(data["winning_pool"]),
    claimedPool: asBigInt(data["claimed_pool"]),
    claimedWinningStake: asBigInt(data["claimed_winning_stake"]),
    refundedPool: asBigInt(data["refunded_pool"]),
  };
}

function normalizeActivity(raw: unknown, wallet: string): ActivityRecord {
  const data = asMap(raw);
  const recordWallet = asString(data["wallet"]);
  if (recordWallet.toLowerCase() !== wallet.toLowerCase())
    throw new Error("Activity wallet mismatch.");
  const type = asString(data["type"]);
  if (!["BET_PLACED", "BET_TOPPED_UP", "PAYOUT_CLAIMED", "REFUND_CLAIMED"].includes(type))
    throw new Error("Invalid activity type.");
  const timestampSeconds = asTimestampSeconds(data["timestamp"]);
  const category = asCategory(data["category"]);
  const assetValue = asString(data["asset"]);
  return {
    id: asMarketId(data["id"]),
    wallet: recordWallet,
    marketId: asMarketId(data["market_id"]),
    type: type as ActivityRecord["type"],
    category,
    asset: assetValue ? asAsset(assetValue, category) : null,
    amount: asBigInt(data["amount"]),
    timestampSeconds,
    timestampMs: timestampMsFromSeconds(timestampSeconds),
  };
}

function normalizeEvidence(
  raw: unknown,
  market: MarketView,
  expectedSource: Source,
): SourceEvidence {
  const data = asMap(raw);
  const source = asSource(data["source"]);
  if (source !== expectedSource) throw new Error("Source evidence source mismatch.");
  const category = asCategory(data["category"]);
  if (category !== market.category) throw new Error("Source evidence category mismatch.");
  const marketStart = asBigInt(data["market_start"]);
  const marketEnd = asBigInt(data["market_end"]);
  if (marketStart !== market.startSeconds || marketEnd !== market.endSeconds)
    throw new Error("Source evidence window mismatch.");
  const interval = asString(data["interval"]);
  if (interval !== "1h") throw new Error("Source evidence interval mismatch.");
  const status = asSourceStatus(data["source_status"]);
  const winnerValue = asString(data["source_winner"]);
  const winner = winnerValue ? asAsset(winnerValue, category) : null;
  const winnerId = asBigInt(data["source_winner_id"]);
  if (status === "VALID" && (!winner || winnerId !== BigInt(market.assets.indexOf(winner))))
    throw new Error("Source evidence winner ID mismatch.");
  if (status !== "VALID" && (winner || winnerId !== 3n))
    throw new Error("Non-valid source evidence has a winner.");
  const rows = asArray(data["assets"]);
  if (rows.length !== market.assets.length)
    throw new Error("Source evidence has an invalid asset count.");
  const assets: EvidenceAsset[] = rows.map((rawRow) => {
    const row = asMap(rawRow);
    const asset = asAsset(row["outcome"], category);
    const valid = asBool(row["valid"]);
    const symbol = asString(row["symbol"]);
    const expectedIndex = market.assets.indexOf(asset);
    if (expectedIndex < 0 || symbol !== market.symbolsBySource[source]?.[expectedIndex])
      throw new Error("Source evidence symbol mismatch.");
    if (asBigInt(row["outcome_id"]) !== BigInt(expectedIndex))
      throw new Error("Source evidence outcome ID mismatch.");
    if (
      asBigInt(row["market_start"]) !== marketStart ||
      asBigInt(row["market_end"]) !== marketEnd ||
      asString(row["interval"]) !== "1h"
    )
      throw new Error("Source evidence row window mismatch.");
    if (valid !== (status !== "UNAVAILABLE")) throw new Error("Source evidence validity mismatch.");
    const timestampUnit = asString(row["timestamp_unit"]);
    const timestampValue = asString(row["candle_timestamp"]);
    const candleTimestamp = timestampValue ? asBigInt(timestampValue) : 0n;
    const open = asString(row["open"]);
    const close = asString(row["close"]);
    if (valid) {
      if (timestampUnit !== "s" && timestampUnit !== "ms")
        throw new Error("Source evidence timestamp unit mismatch.");
      const expectedTimestamp = timestampUnit === "s" ? marketStart : marketStart * 1000n;
      if (candleTimestamp !== expectedTimestamp)
        throw new Error("Source evidence candle timestamp mismatch.");
      if (
        !open ||
        !close ||
        !Number.isFinite(Number(open)) ||
        !Number.isFinite(Number(close)) ||
        Number(open) <= 0 ||
        Number(close) <= 0
      )
        throw new Error("Source evidence price is invalid.");
    } else if (timestampValue || open || close || timestampUnit) {
      throw new Error("Unavailable source evidence is not empty.");
    }
    const normalizedTimestampUnit: "s" | "ms" = timestampUnit === "ms" ? "ms" : "s";
    return {
      asset,
      symbol,
      candleTimestamp,
      timestampUnit: normalizedTimestampUnit,
      open,
      close,
      returnUnits: asSignedBigInt(row["return_units"]),
      valid,
    };
  });
  if (status === "VALID" && !winner) throw new Error("Valid source evidence is missing a winner.");
  if (status !== "VALID" && winner) throw new Error("Non-valid source evidence has a winner.");
  return {
    source,
    category,
    marketStart,
    marketEnd,
    interval,
    status,
    winner,
    assets: status === "UNAVAILABLE" ? [] : assets,
  };
}

function isNotFound(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (/market(?:\s+id)?\b.*(?:not found|does not exist)/i.test(message)) return true;
  return isFinalizedHeadMiss(error);
}

function isFinalizedHeadMiss(error: unknown): boolean {
  return isMap(error) && error["code"] === -32000 && error["details"] === "execution failed";
}

function isEvidenceUnavailable(error: unknown): boolean {
  // Studio returns a generic execution-failed RPC error when the contract has
  // no evidence row yet (for example, an INCONCLUSIVE market finalized by the
  // deadline without making source calls).
  return /source evidence unavailable|execution failed/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

function clientForCaller(address?: string) {
  if (address && !isAddress(address)) throw new Error("Invalid wallet address.");
  return readClient;
}

async function readContract(
  functionName: string,
  args: unknown[] = [],
  caller?: string,
  transactionHashVariant: TransactionHashVariant = TransactionHashVariant.LATEST_FINAL,
): Promise<unknown> {
  const details = {
    method: functionName,
    args: debugTransactionValue(args),
    caller: caller ?? "0x0000000000000000000000000000000000000000",
    transactionHashVariant,
    rpc: FORGE_RPC_URL,
  };
  debugForgeTransaction("[FORGE READ START]", details);
  try {
    return await clientForCaller(caller).readContract({
      ...(caller ? { account: { address: caller as Address, type: "json-rpc" as const } } : {}),
      address: FORGE_CONTRACT_ADDRESS,
      functionName,
      args: args as CalldataEncodable[],
      jsonSafeReturn: true,
      transactionHashVariant,
    });
  } catch (error) {
    debugForgeTransaction("[FORGE READ ERROR]", {
      ...details,
      error: debugError(error),
    });
    logForgeError(error, readErrorContext(functionName));
    throw error;
  }
}

export function transactionStatusName(receipt: RawMap): string | undefined {
  const named = receipt["statusName"];
  if (typeof named === "string") return named;
  const status = receipt["status"];
  if (typeof status === "number")
    return transactionsStatusNumberToName[
      String(status) as keyof typeof transactionsStatusNumberToName
    ];
  if (typeof status === "string")
    return (
      transactionsStatusNumberToName[status as keyof typeof transactionsStatusNumberToName] ??
      status
    );
  return undefined;
}

export function executionResultName(receipt: RawMap): string | undefined {
  const named = receipt["txExecutionResultName"];
  if (typeof named === "string") return named;
  const result = receipt["txExecutionResult"];
  if (typeof result === "number")
    return executionResultNumberToName[String(result) as keyof typeof executionResultNumberToName];
  if (typeof result === "string")
    return (
      executionResultNumberToName[result as keyof typeof executionResultNumberToName] ?? result
    );
  return undefined;
}

const TERMINAL_TRANSACTION_STATUSES = new Set([
  "CANCELED",
  "CANCELLED",
  "REJECTED",
  "FAILED",
  "UNDETERMINED",
  "VALIDATORS_TIMEOUT",
  "LEADER_TIMEOUT",
]);

export async function waitForAcceptedExecution({
  client,
  hash,
  method,
  onStage,
  maxAttempts = TRANSACTION_MAX_ATTEMPTS,
  pollIntervalMs = TRANSACTION_POLL_INTERVAL_MS,
  wait = (delayMs: number) =>
    new Promise<void>((resolve) => globalThis.setTimeout(resolve, delayMs)),
}: {
  client: {
    waitForDecision(args: {
      hash: TransactionHash;
      interval?: number;
      retries?: number;
      fullTransaction?: boolean;
    }): Promise<GenLayerTransaction>;
  };
  hash: string;
  method?: string;
  onStage?: TransactionStageHandler;
  maxAttempts?: number;
  pollIntervalMs?: number;
  wait?: (delayMs: number) => Promise<void>;
}) {
  let lastStatus: string | undefined;
  const attempts = Math.max(1, Math.floor(maxAttempts));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const value = await client.waitForDecision({
        hash: hash as TransactionHash,
        // The outer loop handles transient "not found" and RPC responses so
        // every retry has the same bounded cadence.
        interval: 0,
        retries: 0,
        fullTransaction: true,
      });
      if (isMap(value)) {
        const status = transactionStatusName(value);
        const execution = executionResultName(value);
        debugForgeTransaction("[FORGE TX RECEIPT]", {
          hash,
          method: method ?? "unknown",
          attempt: attempt + 1,
          status: status ?? "UNKNOWN",
          executionResult: execution ?? "UNKNOWN",
          destination: exposedReceiptField(value, ["to", "destination", "contract", "recipient"]),
          receiptMethod: exposedReceiptField(value, ["method", "functionName", "function_name"]),
        });
        if (method === "settle_market")
          debugForgeTransaction("[FORGE SETTLE DECISION]", {
            hash,
            attempt: attempt + 1,
            status: status ?? "UNKNOWN",
            executionResult: execution ?? "UNKNOWN",
          });
        lastStatus = status ?? lastStatus;
        if (execution === ExecutionResult.FINISHED_WITH_ERROR)
          throw new Error("FINISHED_WITH_ERROR");
        if (isSuccessful(value as GenLayerTransaction)) {
          onStage?.("SUCCESS");
          return { confirmed: true, status, receipt: value };
        }
        if (TERMINAL_TRANSACTION_STATUSES.has(status ?? "")) {
          throw new Error(`TRANSACTION_${status}`);
        }
        // An accepted transaction with an unknown execution result is not
        // success. Return it as uncertain instead of spinning until finality.
        if (status === TransactionStatus.ACCEPTED || status === TransactionStatus.FINALIZED)
          return { confirmed: false, status, receipt: value };
      }
    } catch (error) {
      debugForgeTransaction("[FORGE TX RECEIPT ERROR]", {
        hash,
        method: method ?? "unknown",
        attempt: attempt + 1,
        transactionHashVariant: "transaction decision helper",
        rpc: FORGE_RPC_URL,
        error: debugError(error),
      });
      if (error instanceof Error && /FINISHED_WITH_ERROR|TRANSACTION_/.test(error.message))
        throw error;
      // A submitted Studio transaction can briefly be absent from the decision read path.
    }
    if (attempt + 1 < attempts) {
      onStage?.("PROCESSING");
      await wait(pollIntervalMs);
    }
  }
  return { confirmed: false, status: lastStatus };
}

export async function waitForFinalization(hash: string): Promise<boolean> {
  try {
    const receipt = await readClient.waitForFinalization({
      hash: hash as TransactionHash,
      interval: TRANSACTION_POLL_INTERVAL_MS,
      retries: FINALIZATION_MAX_ATTEMPTS,
      fullTransaction: true,
    });
    return isSuccessful(receipt);
  } catch (error) {
    debugForgeTransaction("[FORGE TX FINALIZATION ERROR]", {
      hash,
      rpc: FORGE_RPC_URL,
      error: debugError(error),
    });
    return false;
  }
}

async function prepareForgeWrite(
  account: string,
  functionName: string,
  args: unknown[],
  value: bigint,
): Promise<{
  client: ForgeWriteClient;
  call: ForgeWriteCall;
  feeEstimate: ForgeFeeEstimate;
}> {
  if (!isAddress(account)) throw new Error("Invalid wallet address.");
  if (value < 0n) throw new Error("Invalid transaction value.");
  const injectedProvider = await getActiveInjectedProvider();
  if (!injectedProvider)
    throw new Error("No injected wallet detected. Install or enable an EIP-1193 wallet.");
  let chainId: number;
  try {
    const chainIdValue = await injectedProvider.request({ method: "eth_chainId" });
    chainId =
      typeof chainIdValue === "string"
        ? Number.parseInt(chainIdValue, /^0x/i.test(chainIdValue) ? 16 : 10)
        : Number(chainIdValue);
  } catch (error) {
    debugForgeTransaction("[FORGE WRITE 1 PRECHECK]", {
      method: functionName,
      args: args.map(debugTransactionValue),
      contract: FORGE_CONTRACT_ADDRESS,
      wallet: account,
      walletChainId: "unavailable",
      targetChainId: FORGE_CHAIN_ID,
      value: value.toString(),
      error: debugError(error),
    });
    throw new Error(`PRECHECK_FAILED: ${errorMessage(error)}`);
  }
  debugForgeTransaction("[FORGE WRITE 1 PRECHECK]", {
    method: functionName,
    args: args.map(debugTransactionValue),
    contract: FORGE_CONTRACT_ADDRESS,
    wallet: account,
    walletChainId: chainId,
    targetChainId: FORGE_CHAIN_ID,
    value: value.toString(),
  });
  if (chainId !== FORGE_CHAIN_ID)
    throw new Error(`Switch your wallet to ${FORGE_NETWORK_NAME} before sending a transaction.`);
  const call: ForgeWriteCall = {
    address: FORGE_CONTRACT_ADDRESS,
    functionName,
    args: args as CalldataEncodable[],
    value,
  };
  debugForgeTransaction("[FORGE WRITE CALL]", {
    address: call.address,
    functionName: call.functionName,
    args: debugTransactionValue(call.args),
    value: value.toString(),
    wallet: account,
    chain: chainId,
  });
  const client = createClient({
    chain: forgeChain as never,
    account: account as Address,
    provider: debugProvider(injectedProvider as EIP1193Provider, functionName),
  });
  // The client is already constructed with the official studioDevnet chain,
  // and the provider chain was checked above. The v2 RC's connect() helper
  // additionally bootstraps MetaMask Snaps (wallet_getSnaps/requestSnaps),
  // which is not part of the EIP-1193 transaction path and caused generic
  // injected providers to fail before fee estimation. Network switching is
  // handled explicitly by walletConfig.ts, so no second SDK connect step is
  // needed here.
  debugForgeTransaction("[FORGE WRITE 2 CLIENT]", {
    sdkVersion: "2.0.0-rc.1",
    chain: forgeChain.name,
    account,
    providerPresent: true,
    connected: true,
    sdkConnect: "skipped; official chain configured and provider chain verified",
    providerType: providerType(injectedProvider),
  });
  debugForgeTransaction(
    functionName === "settle_market"
      ? "[FORGE SETTLE FEE START]"
      : "[FORGE WRITE 3 FEE_ESTIMATE_START]",
    {
      method: functionName,
      account,
    },
  );
  let feeEstimate: ForgeFeeEstimate | undefined;
  let lastFeeError: unknown;
  const maxFeeEstimateAttempts = 3;
  for (let attempt = 0; attempt < maxFeeEstimateAttempts; attempt += 1) {
    try {
      feeEstimate = await client.estimateTransactionFeesForWrite(call);
      break;
    } catch (error) {
      lastFeeError = error;
      const retrying = isTransientFeeError(error) && attempt + 1 < maxFeeEstimateAttempts;
      debugForgeTransaction(
        functionName === "settle_market"
          ? "[FORGE SETTLE FEE ERROR]"
          : "[FORGE WRITE 4 FEE_ESTIMATE_FAILED]",
        {
          method: functionName,
          account,
          contract: FORGE_CONTRACT_ADDRESS,
          attempt: attempt + 1,
          retrying,
          error: debugError(error),
        },
      );
      if (!retrying) break;
      await new Promise<void>((resolve) =>
        globalThis.setTimeout(resolve, attempt === 0 ? 3_000 : 6_000),
      );
    }
  }
  if (!feeEstimate) throw new Error(`FEE_ESTIMATE_FAILED: ${errorMessage(lastFeeError)}`);
  debugForgeTransaction(
    functionName === "settle_market" ? "[FORGE SETTLE FEE OK]" : "[FORGE WRITE 4 FEE_ESTIMATE_OK]",
    {
      method: functionName,
      account,
      distribution: debugTransactionValue(feeEstimate.distribution),
      feeValue: feeEstimate.feeValue.toString(),
      feeValueGen: formatGen(feeEstimate.feeValue, 18),
      messageAllocationCount: feeEstimate.messageAllocations?.length ?? 0,
    },
  );
  return { client, call, feeEstimate };
}

async function writeContract(
  account: string,
  functionName: string,
  args: unknown[],
  value: bigint,
  onStage?: TransactionStageHandler,
) {
  const { client, call, feeEstimate } = await prepareForgeWrite(account, functionName, args, value);
  debugForgeTransaction(
    functionName === "settle_market"
      ? "[FORGE SETTLE SUBMIT START]"
      : "[FORGE WRITE 5 SUBMIT_START]",
    {
      method: functionName,
      contract: FORGE_CONTRACT_ADDRESS,
      account,
      value: value.toString(),
      feeValue: feeEstimate.feeValue.toString(),
    },
  );
  onStage?.("AWAITING_SIGNATURE");
  let hash: unknown;
  try {
    hash = await client.writeContract({
      ...call,
      fees: {
        distribution: feeEstimate.distribution,
        feeValue: feeEstimate.feeValue,
        ...(feeEstimate.messageAllocations
          ? { messageAllocations: feeEstimate.messageAllocations }
          : {}),
      },
    });
  } catch (error) {
    debugForgeTransaction(
      isUserRejected(error) ? "[FORGE WALLET_REJECTED]" : "[FORGE WRITE_SUBMISSION_FAILED]",
      {
        method: functionName,
        contract: FORGE_CONTRACT_ADDRESS,
        error: debugError(error),
      },
    );
    throw new Error(`WRITE_SUBMISSION_FAILED: ${errorMessage(error)}`);
  }
  debugForgeTransaction(
    functionName === "settle_market" ? "[FORGE SETTLE SUBMITTED]" : "[FORGE WRITE 7 SUBMITTED]",
    {
      hash: String(hash),
      method: functionName,
      contract: FORGE_CONTRACT_ADDRESS,
      providerMethod: "eth_sendTransaction via GenLayerJS",
      protocolFeeValue: feeEstimate.feeValue.toString(),
    },
  );
  onStage?.("SUBMITTED");
  debugForgeTransaction("[FORGE TX RECEIPT]", {
    hash: String(hash),
    status: "POLLING",
    executionResult: "PENDING",
    destination: forgeChain.consensusMainContract?.address ?? "not configured",
    method: "GenLayer transaction status",
  });
  let result: Awaited<ReturnType<typeof waitForAcceptedExecution>>;
  try {
    result = await waitForAcceptedExecution({
      client: readClient as never,
      hash: String(hash),
      method: functionName,
      ...(onStage ? { onStage } : {}),
    });
  } catch (error) {
    const phase = errorMessage(error).includes("FINISHED_WITH_ERROR")
      ? "[FORGE TX_EXECUTION_FAILED]"
      : "[FORGE TX_DECISION_FAILED]";
    debugForgeTransaction(phase, { hash: String(hash), error: debugError(error) });
    throw error;
  }
  if (!result.confirmed)
    debugForgeTransaction("[FORGE TX_STATUS_UNCERTAIN]", {
      hash: String(hash),
      status: result.status ?? "UNKNOWN",
    });
  if (!result.confirmed) onStage?.("UNCERTAIN");
  return { hash: String(hash), confirmed: result.confirmed };
}

export function contractError(error: unknown, context: ForgeErrorContext = "GENERAL"): string {
  logForgeError(error, context);
  return mapForgeError(error, context).message;
}

export const contractAdapter = {
  waitForFinalization,

  async categories(): Promise<Category[]> {
    const values = asArray(await readContract("categories")).map(asCategory);
    if (
      values.length !== CATEGORIES.length ||
      values.some((value, index) => value !== CATEGORIES[index])
    )
      throw new Error("Contract response has invalid categories.");
    return values;
  },

  async categoryAssets(category: Category): Promise<string[]> {
    const values = asArray(await readContract("category_assets", [category])).map(asString);
    const expected = CATEGORY_ASSETS[category];
    if (
      values.length !== expected.length ||
      values.some((value, index) => value !== expected[index])
    )
      throw new Error("Contract response has invalid category assets.");
    return values;
  },

  async getConfig(): Promise<ProtocolConfig> {
    const data = asMap(await readContract("get_config"));
    const categories = asArray(data["categories"]).map(asCategory);
    const categoryAssets = asMap(data["category_assets"]);
    const assets = {} as ProtocolConfig["categoryAssets"];
    for (const category of CATEGORIES) {
      const values = asArray(categoryAssets[category]).map((asset) => asAsset(asset, category));
      if (values.length !== 3) throw new Error("Contract config has invalid assets.");
      assets[category] = values;
    }
    const sources = asArray(data["sources"]).map(asSource);
    return {
      protocol: asString(data["protocol"]),
      categories,
      categoryAssets: assets,
      durationSeconds: asNumber(data["duration_seconds"]),
      minimumBet: asBigInt(data["minimum_bet"]),
      maximumBetPerWalletPerMarket: asBigInt(data["maximum_bet_per_wallet_per_market"]),
      feeBps: asNumber(data["fee_bps"]),
      sources,
      consensusThreshold: asNumber(data["consensus_threshold"]),
      timezone: asString(data["timezone"]),
      settlementRetryWindowSeconds: asNumber(data["settlement_retry_window_seconds"]),
      maxPageSize: asNumber(data["max_page_size"]),
      maxMarkets: asNumber(data["max_markets"]),
      maxPositions: asNumber(data["max_positions"]),
      maxActivities: asNumber(data["max_activities"]),
    };
  },

  async getMarketCount(): Promise<bigint> {
    return asBigInt(await readContract("get_market_count"));
  },

  async getMarkets(nowMs: number, offset = 0, limit = MAX_PAGE_SIZE): Promise<MarketView[]> {
    return asArray(await readContract("get_markets", pageArgs(offset, limit))).map((value) =>
      normalizeMarket(value, nowMs),
    );
  },

  async getOpenMarkets(nowMs: number, offset = 0, limit = MAX_PAGE_SIZE): Promise<MarketView[]> {
    return asArray(await readContract("get_open_markets", pageArgs(offset, limit))).map((value) =>
      normalizeMarket(value, nowMs),
    );
  },

  async getMarket(
    marketId: string,
    nowMs: number,
    transactionHashVariant: TransactionHashVariant = TransactionHashVariant.LATEST_FINAL,
  ): Promise<MarketView | null> {
    const readMarket = async (variant: TransactionHashVariant) =>
      normalizeMarket(
        await readContract("get_market", [requestedMarketId(marketId)], undefined, variant),
        nowMs,
      );
    try {
      const market = await readMarket(transactionHashVariant);
      if (market.id !== marketId) throw new Error("Contract market ID mismatch.");
      return market;
    } catch (error) {
      if (
        transactionHashVariant === TransactionHashVariant.LATEST_FINAL &&
        isFinalizedHeadMiss(error)
      ) {
        try {
          const market = await readMarket(TransactionHashVariant.LATEST_NONFINAL);
          if (market.id !== marketId) throw new Error("Contract market ID mismatch.");
          return market;
        } catch (fallbackError) {
          if (isNotFound(fallbackError)) return null;
          throw fallbackError;
        }
      }
      if (isNotFound(error)) return null;
      throw error;
    }
  },

  async getMarketByCategoryStart(
    category: Category,
    startSeconds: bigint,
    nowMs = Date.now(),
    transactionHashVariant: TransactionHashVariant = TransactionHashVariant.LATEST_FINAL,
  ): Promise<MarketView | null> {
    const readMarket = async (variant: TransactionHashVariant) =>
      normalizeMarket(
        await readContract(
          "get_market_by_category_start",
          [category, startSeconds],
          undefined,
          variant,
        ),
        nowMs,
      );
    try {
      const market = await readMarket(transactionHashVariant);
      if (market.category !== category || market.startSeconds !== startSeconds)
        throw new Error("Contract market lookup mismatch.");
      return market;
    } catch (error) {
      if (
        transactionHashVariant === TransactionHashVariant.LATEST_FINAL &&
        isFinalizedHeadMiss(error)
      ) {
        try {
          const market = await readMarket(TransactionHashVariant.LATEST_NONFINAL);
          if (market.category !== category || market.startSeconds !== startSeconds)
            throw new Error("Contract market lookup mismatch.");
          return market;
        } catch (fallbackError) {
          if (isNotFound(fallbackError)) return null;
          throw fallbackError;
        }
      }
      if (isNotFound(error)) return null;
      throw error;
    }
  },

  async getMyPosition(
    marketId: string,
    wallet: string,
    transactionHashVariant: TransactionHashVariant = TransactionHashVariant.LATEST_FINAL,
  ): Promise<PositionView> {
    return normalizePosition(
      await readContract(
        "get_my_position",
        [requestedMarketId(marketId)],
        wallet,
        transactionHashVariant,
      ),
      wallet,
      marketId,
    );
  },

  async getMyMarketCount(
    wallet: string,
    transactionHashVariant: TransactionHashVariant = TransactionHashVariant.LATEST_FINAL,
  ): Promise<number> {
    const value = asBigInt(
      await readContract("get_my_market_count", [], wallet, transactionHashVariant),
    );
    if (value > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error("Wallet market count is outside the supported range.");
    return Number(value);
  },

  async getMyPositions(
    nowMs: number,
    wallet: string,
    offset = 0,
    limit = MAX_PAGE_SIZE,
    transactionHashVariant: TransactionHashVariant = TransactionHashVariant.LATEST_FINAL,
  ): Promise<UserPosition[]> {
    const raw = asArray(
      await readContract(
        "get_my_positions",
        pageArgs(offset, limit),
        wallet,
        transactionHashVariant,
      ),
    );
    return Promise.all(
      raw.map(async (value) => {
        const position = normalizePosition(value, wallet);
        const market = await this.getMarket(position.marketId, nowMs, transactionHashVariant);
        if (!market) throw new Error("Position references a missing market.");
        if (
          market.category !== position.category ||
          (position.selectedAsset && !market.assets.includes(position.selectedAsset))
        )
          throw new Error("Position does not match market.");
        return { position, market };
      }),
    );
  },

  async getMyClaimableMarkets(
    nowMs: number,
    wallet: string,
    offset = 0,
    limit = MAX_PAGE_SIZE,
    transactionHashVariant: TransactionHashVariant = TransactionHashVariant.LATEST_FINAL,
  ): Promise<UserPosition[]> {
    const raw = asArray(
      await readContract(
        "get_my_claimable_markets",
        pageArgs(offset, limit),
        wallet,
        transactionHashVariant,
      ),
    );
    return Promise.all(
      raw.map(async (value) => {
        const position = normalizePosition(value, wallet);
        if (!position.claimAvailable && !position.refundAvailable)
          throw new Error("Contract returned a non-claimable position.");
        const market = await this.getMarket(position.marketId, nowMs, transactionHashVariant);
        if (!market) throw new Error("Claimable position references a missing market.");
        return { position, market };
      }),
    );
  },

  async getBettingState(
    marketId: string,
    wallet: string,
    transactionHashVariant: TransactionHashVariant = TransactionHashVariant.LATEST_FINAL,
  ): Promise<BettingState> {
    return normalizeBettingState(
      await readContract(
        "get_betting_state",
        [requestedMarketId(marketId)],
        wallet,
        transactionHashVariant,
      ),
    );
  },

  async getSourceEvidence(
    marketId: string,
    source: Source,
    nowMs: number,
    transactionHashVariant: TransactionHashVariant = TransactionHashVariant.LATEST_FINAL,
    knownMarket?: MarketView,
  ): Promise<SourceEvidence> {
    const market = knownMarket ?? (await this.getMarket(marketId, nowMs, transactionHashVariant));
    if (!market) throw new Error("Market not found.");
    try {
      return normalizeEvidence(
        await readContract(
          "get_source_evidence",
          [requestedMarketId(marketId), source],
          undefined,
          transactionHashVariant,
        ),
        market,
        source,
      );
    } catch (error) {
      if (isEvidenceUnavailable(error))
        return {
          source,
          category: market.category,
          marketStart: market.startSeconds,
          marketEnd: market.endSeconds,
          interval: "1h",
          status: "UNAVAILABLE",
          winner: null,
          assets: [],
        };
      throw error;
    }
  },

  async getMyActivityCount(
    wallet: string,
    transactionHashVariant: TransactionHashVariant = TransactionHashVariant.LATEST_FINAL,
  ): Promise<number> {
    const value = asBigInt(
      await readContract("get_my_activity_count", [], wallet, transactionHashVariant),
    );
    if (value > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error("Activity count is outside the supported range.");
    return Number(value);
  },

  async getMyActivity(
    wallet: string,
    offset = 0,
    limit = MAX_PAGE_SIZE,
    transactionHashVariant: TransactionHashVariant = TransactionHashVariant.LATEST_FINAL,
  ): Promise<ActivityRecord[]> {
    const records = asArray(
      await readContract(
        "get_my_activity",
        pageArgs(offset, limit),
        wallet,
        transactionHashVariant,
      ),
    ).map((value) => normalizeActivity(value, wallet));
    await Promise.all(
      records.map(async (record) => {
        const market = await this.getMarket(record.marketId, Date.now(), transactionHashVariant);
        if (
          !market ||
          market.category !== record.category ||
          (record.asset && !market.assets.includes(record.asset))
        )
          throw new Error("Activity does not match its market.");
      }),
    );
    return records;
  },

  async createMarket(
    category: Category,
    startSeconds: bigint,
    wallet: string,
    onStage?: TransactionStageHandler,
  ): Promise<ContractWriteResult> {
    try {
      const receipt = await writeContract(
        wallet,
        "create_market",
        [category, startSeconds],
        0n,
        onStage,
      );
      return { ok: true, hash: receipt.hash, confirmed: receipt.confirmed };
    } catch (error) {
      return { ok: false, error: contractError(error, "CREATE_MARKET") };
    }
  },

  async placeBet(
    marketId: string,
    asset: string,
    amountWei: bigint,
    wallet: string,
    onStage?: TransactionStageHandler,
  ): Promise<ContractWriteResult> {
    try {
      const receipt = await writeContract(
        wallet,
        "place_bet",
        [requestedMarketId(marketId), asset],
        amountWei,
        onStage,
      );
      return { ok: true, hash: receipt.hash, confirmed: receipt.confirmed };
    } catch (error) {
      return { ok: false, error: contractError(error, "PLACE_BET") };
    }
  },

  async settleMarket(
    marketId: string,
    wallet: string,
    onStage?: TransactionStageHandler,
  ): Promise<ContractWriteResult> {
    try {
      const receipt = await writeContract(
        wallet,
        "settle_market",
        [requestedMarketId(marketId)],
        0n,
        onStage,
      );
      return { ok: true, hash: receipt.hash, confirmed: receipt.confirmed };
    } catch (error) {
      return { ok: false, error: contractError(error, "SETTLE") };
    }
  },

  async claim(
    marketId: string,
    wallet: string,
    onStage?: TransactionStageHandler,
  ): Promise<ContractWriteResult> {
    try {
      const receipt = await writeContract(
        wallet,
        "claim",
        [requestedMarketId(marketId)],
        0n,
        onStage,
      );
      return { ok: true, hash: receipt.hash, confirmed: receipt.confirmed };
    } catch (error) {
      return { ok: false, error: contractError(error, "CLAIM") };
    }
  },

  async claimRefund(
    marketId: string,
    wallet: string,
    onStage?: TransactionStageHandler,
  ): Promise<ContractWriteResult> {
    try {
      const receipt = await writeContract(
        wallet,
        "claim_refund",
        [requestedMarketId(marketId)],
        0n,
        onStage,
      );
      return { ok: true, hash: receipt.hash, confirmed: receipt.confirmed };
    } catch (error) {
      return { ok: false, error: contractError(error, "REFUND") };
    }
  },
};

export { FORGE_CHAIN_ID, FORGE_CONTRACT_ADDRESS };
