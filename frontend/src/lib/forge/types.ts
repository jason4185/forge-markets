import type { ASSET_LABEL, Category, ContractMarketState, MarketState, Source } from "./constants";

export type Asset = keyof typeof ASSET_LABEL;

export interface MarketView {
  id: string;
  category: Category;
  assets: Asset[];
  symbols: string[];
  symbolsBySource: Record<Source, string[]>;
  startSeconds: bigint;
  endSeconds: bigint;
  settlementDeadlineSeconds: bigint;
  startMs: number;
  endMs: number;
  bettingCloseMs: number;
  durationSeconds: number;
  contractState: ContractMarketState;
  state: MarketState;
  winner: Asset | null;
  pools: Record<Asset, bigint>;
  poolShares: Record<Asset, number>;
  totalPool: bigint;
  bettingOpen: boolean;
  settlementAvailable: boolean;
  winningPool: bigint;
  claimedPool: bigint;
  refundedPool: bigint;
  remainingPool: bigint;
}

export interface PositionView {
  marketId: string;
  hasPosition: boolean;
  category: Category;
  selectedAsset: Asset | null;
  totalStake: bigint;
  marketState: ContractMarketState;
  canTopUp: boolean;
  positionWon: boolean;
  positionLost: boolean;
  claimAvailable: boolean;
  refundAvailable: boolean;
  alreadyClaimed: boolean;
  refunded: boolean;
  claimableAmount: bigint;
  claimType: "WINNINGS" | "REFUND" | "NONE";
}

export interface UserPosition {
  position: PositionView;
  market: MarketView;
}

export interface ProtocolConfig {
  protocol: string;
  categories: Category[];
  categoryAssets: Record<Category, Asset[]>;
  durationSeconds: number;
  minimumBet: bigint;
  maximumBetPerWalletPerMarket: bigint;
  feeBps: number;
  sources: Source[];
  consensusThreshold: number;
  timezone: string;
  settlementRetryWindowSeconds: number;
  maxPageSize: number;
  maxMarkets: number;
  maxPositions: number;
  maxActivities: number;
}

export type SourceStatus = "VALID" | "TIE" | "UNAVAILABLE";

export interface EvidenceAsset {
  asset: Asset;
  symbol: string;
  candleTimestamp: bigint;
  timestampUnit: "s" | "ms";
  open: string;
  close: string;
  returnUnits: bigint;
  valid: boolean;
}

export interface SourceEvidence {
  source: Source;
  category: Category;
  marketStart: bigint;
  marketEnd: bigint;
  interval: string;
  status: SourceStatus;
  winner: Asset | null;
  assets: EvidenceAsset[];
}

export interface BettingState {
  category: Category;
  totalMarketPool: bigint;
  outcomeStakes: Record<Asset, bigint>;
  bettorAsset: Asset | null;
  bettorStake: bigint;
  claimed: boolean;
  refunded: boolean;
  winningPool: bigint;
  claimedPool: bigint;
  claimedWinningStake: bigint;
  refundedPool: bigint;
}

export type ActivityType = "BET_PLACED" | "BET_TOPPED_UP" | "PAYOUT_CLAIMED" | "REFUND_CLAIMED";

export interface ActivityRecord {
  id: string;
  wallet: string;
  marketId: string;
  type: ActivityType;
  category: Category;
  asset: Asset | null;
  amount: bigint;
  timestampSeconds: bigint;
  timestampMs: number;
}

export interface ForgeNotification {
  id: string;
  kind:
    | ActivityType
    | "MARKET_SETTLED_WON"
    | "MARKET_SETTLED_LOST"
    | "REFUND_AVAILABLE"
    | "SETTLEMENT_PENDING";
  title: string;
  description: string;
  marketId: string;
  category: Category;
  asset?: Asset | null;
  amount?: bigint;
  timestampMs: number;
  action?: "claim" | "refund" | "view";
}
