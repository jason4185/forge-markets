import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TransactionHashVariant } from "genlayer-js/types";
import { useAccount } from "wagmi";
import { contractAdapter } from "./contractAdapter";
import { MAX_PAGE_SIZE } from "./constants";
import {
  getActiveInjectedProvider,
  logNetworkSwitchClick,
  switchToStudioNext,
} from "./walletConfig";
import { queryRetryDelay, shouldRetryRead } from "./retry";
import { fetchBinancePerformance } from "./binance";
import type { Category, Source } from "./constants";
import type { MarketView } from "./types";

export function useNow(intervalMs = 1000) {
  const [now, setNow] = React.useState(0);
  React.useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function useForgeWalletAddress() {
  const { address, chainId } = useAccount();
  const queryClient = useQueryClient();
  const previous = React.useRef<string | undefined>(undefined);
  const previousChain = React.useRef<number | undefined>(undefined);
  React.useEffect(() => {
    const accountChanged =
      previous.current && previous.current.toLowerCase() !== address?.toLowerCase();
    const chainChanged = previousChain.current !== undefined && previousChain.current !== chainId;
    if (accountChanged || chainChanged) {
      clearWalletQueries(queryClient, true);
    }
    previous.current = address;
    previousChain.current = chainId;
  }, [address, chainId, queryClient]);
  return address;
}

export function useForgeNetworkSync() {
  const queryClient = useQueryClient();
  const { address, isConnected } = useAccount();
  React.useEffect(() => {
    let disposed = false;
    let provider: Awaited<ReturnType<typeof getActiveInjectedProvider>>;
    const onChainChanged = (chainId: unknown) => {
      if (import.meta.env.DEV) console.debug("[FORGE CHAIN CHANGED]", { chainId });
      clearWalletQueries(queryClient, true);
      void queryClient.invalidateQueries({ queryKey: ["balance"] });
    };
    void getActiveInjectedProvider().then((currentProvider) => {
      if (disposed || typeof currentProvider?.on !== "function") return;
      provider = currentProvider;
      void currentProvider
        .request({ method: "eth_chainId" })
        .then((chainId) => {
          if (import.meta.env.DEV) console.debug("[FORGE WALLET CHAIN]", { chainId });
        })
        .catch(() => undefined);
      currentProvider.on("chainChanged", onChainChanged);
    });
    return () => {
      disposed = true;
      provider?.removeListener?.("chainChanged", onChainChanged);
    };
  }, [address, isConnected, queryClient]);
}

export function useForgeNetworkSwitch() {
  const queryClient = useQueryClient();
  const pending = React.useRef(false);
  const [isPending, setIsPending] = React.useState(false);
  const switchNetwork = React.useCallback(
    async (source = "unknown") => {
      logNetworkSwitchClick(source);
      if (pending.current) return false;
      pending.current = true;
      setIsPending(true);
      try {
        await switchToStudioNext(source);
        await Promise.allSettled([
          ...walletQueryKeys.map((key) => queryClient.invalidateQueries({ queryKey: key })),
          queryClient.invalidateQueries({ queryKey: ["balance"] }),
        ]);
        return true;
      } finally {
        pending.current = false;
        setIsPending(false);
      }
    },
    [queryClient],
  );
  return { switchNetwork, isPending };
}

const walletQueryKeys: readonly (readonly unknown[])[] = [
  ["forge", "my-position"],
  ["forge", "my-market-count"],
  ["forge", "my-positions"],
  ["forge", "my-claimable"],
  ["forge", "my-activity-count"],
  ["forge", "my-activity"],
  ["forge", "betting-state"],
];

function clearWalletQueries(queryClient: ReturnType<typeof useQueryClient>, remove: boolean) {
  if (remove)
    walletQueryKeys.forEach((key) => {
      void queryClient.removeQueries({ queryKey: key });
    });
  void Promise.allSettled(
    walletQueryKeys.map((key) => queryClient.invalidateQueries({ queryKey: key })),
  );
}

const queryOptions = {
  retry: shouldRetryRead,
  retryDelay: queryRetryDelay,
  refetchOnWindowFocus: false,
} as const;
const walletActionabilityVariant = TransactionHashVariant.LATEST_NONFINAL;

export function useForgeConfig() {
  return useQuery({
    queryKey: ["forge", "config"],
    queryFn: () => contractAdapter.getConfig(),
    staleTime: 300_000,
    ...queryOptions,
  });
}
export function useForgeCategories() {
  return useQuery({
    queryKey: ["forge", "categories"],
    queryFn: () => contractAdapter.categories(),
    staleTime: 300_000,
    ...queryOptions,
  });
}
export function useForgeCategoryAssets(category?: Category) {
  return useQuery({
    queryKey: ["forge", "category-assets", category],
    queryFn: () => contractAdapter.categoryAssets(category!),
    enabled: Boolean(category),
    staleTime: 300_000,
    ...queryOptions,
  });
}
export function useForgeMarketCount() {
  return useQuery({
    queryKey: ["forge", "market-count"],
    queryFn: () => contractAdapter.getMarketCount(),
    refetchInterval: 20_000,
    ...queryOptions,
  });
}
export function useForgeMarkets(nowMs: number, offset = 0, limit = MAX_PAGE_SIZE) {
  return useQuery({
    queryKey: ["forge", "markets", offset, limit],
    queryFn: () => contractAdapter.getMarkets(nowMs, offset, limit),
    enabled: nowMs > 0,
    refetchInterval: 20_000,
    ...queryOptions,
  });
}
export function useForgeOpenMarkets(nowMs: number, offset = 0, limit = MAX_PAGE_SIZE) {
  return useQuery({
    queryKey: ["forge", "open-markets", offset, limit],
    queryFn: () => contractAdapter.getOpenMarkets(nowMs, offset, limit),
    enabled: nowMs > 0,
    refetchInterval: 20_000,
    ...queryOptions,
  });
}

export function useForgeBinancePerformance(market: MarketView | undefined, nowMs: number) {
  const started = Boolean(market && nowMs >= market.startMs);
  const active = Boolean(
    market && market.contractState === "OPEN" && nowMs >= market.startMs && nowMs < market.endMs,
  );
  const endTime = market
    ? nowMs >= market.endMs
      ? market.endMs
      : Math.min(
          market.endMs,
          Math.max(market.startMs + 60_000, Math.floor(nowMs / 15_000) * 15_000),
        )
    : 0;
  return useQuery({
    queryKey: [
      "forge",
      "binance-performance",
      market?.id ?? "none",
      ...(market?.symbolsBySource.BINANCE ?? []),
      endTime,
    ],
    queryFn: () => fetchBinancePerformance(market!, endTime),
    enabled: Boolean(market && started && endTime > market.startMs),
    staleTime: active ? 10_000 : 300_000,
    refetchInterval: active ? 15_000 : false,
    refetchIntervalInBackground: false,
    ...queryOptions,
  });
}

export function useForgeMarket(
  marketId: string,
  nowMs: number,
  transactionHashVariant: TransactionHashVariant = TransactionHashVariant.LATEST_FINAL,
) {
  return useQuery({
    queryKey: ["forge", "market", marketId, transactionHashVariant],
    queryFn: () => contractAdapter.getMarket(marketId, nowMs, transactionHashVariant),
    enabled: Boolean(marketId) && nowMs > 0,
    refetchInterval: 20_000,
    placeholderData: (previousData) => previousData,
    ...queryOptions,
  });
}
export function useForgePosition(marketId: string, address?: string) {
  return useQuery({
    queryKey: ["forge", "my-position", marketId, address ?? "disconnected"],
    queryFn: () => contractAdapter.getMyPosition(marketId, address!, walletActionabilityVariant),
    enabled: Boolean(marketId && address),
    refetchInterval: 20_000,
    ...queryOptions,
  });
}
export function useForgeBettingState(marketId: string, address?: string) {
  return useQuery({
    queryKey: ["forge", "betting-state", marketId, address ?? "disconnected"],
    queryFn: () => contractAdapter.getBettingState(marketId, address!, walletActionabilityVariant),
    enabled: Boolean(marketId && address),
    refetchInterval: 20_000,
    ...queryOptions,
  });
}
export function useForgeSourceEvidence(
  marketId: string,
  source: Source,
  enabled: boolean,
  nowMs: number,
  market?: MarketView,
) {
  return useQuery({
    queryKey: [
      "forge",
      "evidence",
      marketId,
      source,
      market?.contractState ?? "unknown",
      market?.winner ?? "none",
    ],
    queryFn: () =>
      contractAdapter.getSourceEvidence(
        marketId,
        source,
        nowMs,
        TransactionHashVariant.LATEST_FINAL,
        market,
      ),
    enabled: Boolean(marketId && source) && enabled && nowMs > 0,
    staleTime: 300_000,
    ...queryOptions,
  });
}
export function useForgeMyMarketCount(address?: string) {
  return useQuery({
    queryKey: ["forge", "my-market-count", address ?? "disconnected"],
    queryFn: () => contractAdapter.getMyMarketCount(address!, walletActionabilityVariant),
    enabled: Boolean(address),
    refetchInterval: 30_000,
    ...queryOptions,
  });
}
export function useForgeMyPositions(
  nowMs: number,
  address?: string,
  offset = 0,
  limit = MAX_PAGE_SIZE,
) {
  return useQuery({
    queryKey: ["forge", "my-positions", address ?? "disconnected", offset, limit],
    queryFn: () =>
      contractAdapter.getMyPositions(nowMs, address!, offset, limit, walletActionabilityVariant),
    enabled: Boolean(address) && nowMs > 0,
    refetchInterval: 20_000,
    ...queryOptions,
  });
}
export function useForgeMyClaimable(
  nowMs: number,
  address?: string,
  offset = 0,
  limit = MAX_PAGE_SIZE,
) {
  return useQuery({
    queryKey: ["forge", "my-claimable", address ?? "disconnected", offset, limit],
    queryFn: () =>
      contractAdapter.getMyClaimableMarkets(
        nowMs,
        address!,
        offset,
        limit,
        walletActionabilityVariant,
      ),
    enabled: Boolean(address) && nowMs > 0,
    refetchInterval: 20_000,
    ...queryOptions,
  });
}
export function useForgeMyActivity(address?: string, offset = 0, limit = MAX_PAGE_SIZE) {
  return useQuery({
    queryKey: ["forge", "my-activity", address ?? "disconnected", offset, limit],
    queryFn: () =>
      contractAdapter.getMyActivity(address!, offset, limit, walletActionabilityVariant),
    enabled: Boolean(address),
    refetchInterval: 30_000,
    ...queryOptions,
  });
}
export function useForgeMyActivityCount(address?: string) {
  return useQuery({
    queryKey: ["forge", "my-activity-count", address ?? "disconnected"],
    queryFn: () => contractAdapter.getMyActivityCount(address!, walletActionabilityVariant),
    enabled: Boolean(address),
    refetchInterval: 30_000,
    ...queryOptions,
  });
}

export type ForgeWriteKind = "create" | "bet" | "settle" | "claim" | "refund";
export function useRefreshForge() {
  const queryClient = useQueryClient();
  return async (kind: ForgeWriteKind, marketId?: string) => {
    const keys: readonly unknown[][] =
      kind === "create"
        ? [
            ["forge", "markets"],
            ["forge", "market-count"],
            ["forge", "open-markets"],
          ]
        : kind === "bet"
          ? [
              ["forge", "market", marketId],
              ["forge", "betting-state", marketId],
              ["forge", "my-position", marketId],
              ["forge", "my-positions"],
              ["forge", "my-claimable"],
              ["forge", "my-activity"],
              ["forge", "my-activity-count"],
              ["balance"],
            ]
          : kind === "settle"
            ? [
                ["forge", "market", marketId],
                ["forge", "evidence", marketId],
                ["forge", "betting-state", marketId],
                ["forge", "my-position", marketId],
                ["forge", "my-claimable"],
                ["forge", "my-positions"],
              ]
            : [
                ["forge", "market", marketId],
                ["forge", "my-position", marketId],
                ["forge", "betting-state", marketId],
                ["forge", "my-positions"],
                ["forge", "my-claimable"],
                ["forge", "my-activity"],
                ["forge", "my-activity-count"],
                ["balance"],
              ];
    await Promise.allSettled(keys.map((key) => queryClient.invalidateQueries({ queryKey: key })));
  };
}
