import { studioDevnet } from "genlayer-js/chains";
import type { Address } from "viem";

export const FORGE_CONTRACT_ADDRESS = "0xc93d27132e62467183bB22DF335368C378379C09" as Address;
export const FORGE_CHAIN_ID = studioDevnet.id;
export const FORGE_CHAIN_ID_HEX = `0x${FORGE_CHAIN_ID.toString(16)}`;
export const FORGE_RPC_URL = studioDevnet.rpcUrls.default.http[0];
export const FORGE_NETWORK_NAME = "GenLayer StudioNext";

// Use the complete official Studio-dev chain definition so its RPC, chain
// identity, consensus deployments, and fee-aware SDK behavior remain aligned.
export const forgeChain = studioDevnet;

export const FORGE_NATIVE_CURRENCY = forgeChain.nativeCurrency;

export const GEN_SCALE = 1_000_000_000_000_000_000n;
export const MIN_BET_WEI = GEN_SCALE;
export const MAX_BET_WEI = 50n * GEN_SCALE;
export const MAX_PAGE_SIZE = 50;

export const CATEGORIES = ["METALS", "ENERGY"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_ASSETS: Record<Category, readonly string[]> = {
  METALS: ["GOLD", "SILVER", "COPPER"],
  ENERGY: ["WTI_CRUDE", "BRENT_CRUDE", "NATURAL_GAS"],
};

export const ASSET_LABEL: Record<string, string> = {
  GOLD: "Gold",
  SILVER: "Silver",
  COPPER: "Copper",
  WTI_CRUDE: "WTI Crude",
  BRENT_CRUDE: "Brent Crude",
  NATURAL_GAS: "Natural Gas",
};

export const SOURCES = ["BINANCE", "BITGET", "GATE"] as const;
export type Source = (typeof SOURCES)[number];

export const SOURCE_LABEL: Record<Source, string> = {
  BINANCE: "Binance",
  BITGET: "Bitget",
  GATE: "Gate",
};

export const MARKET_STATES = ["OPEN", "SETTLEMENT_PENDING", "SETTLED", "INCONCLUSIVE"] as const;
export type ContractMarketState = (typeof MARKET_STATES)[number];
export type MarketState = ContractMarketState | "UPCOMING";

export const STATE_LABEL: Record<MarketState, string> = {
  OPEN: "Open",
  UPCOMING: "Upcoming",
  SETTLEMENT_PENDING: "Awaiting settlement",
  SETTLED: "Settled",
  INCONCLUSIVE: "Inconclusive",
};
