import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TransactionHashVariant } from "genlayer-js/types";
import { createPublicClient, http, type Address } from "viem";
import { contractAdapter } from "./contractAdapter";
import { FORGE_RPC_URL, forgeChain, MAX_PAGE_SIZE } from "./constants";
import {
  getInjectedAccounts,
  getInjectedChainId,
  getActiveInjectedProvider,
  logNetworkSwitchClick,
  requestInjectedAccounts,
  switchToStudioNext,
} from "./walletConfig";
import { queryRetryDelay, shouldRetryRead } from "./retry";
import { binanceChartSymbolForAsset, fetchBinancePerformance } from "./binance";
import type { Category, Source } from "./constants";
import type { MarketView } from "./types";

export function useNow(intervalMs = 15_000) {
  const [now, setNow] = React.useState(0);
  React.useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

type ForgeWalletSnapshot = {
  address: string | undefined;
  chainId: number | undefined;
  isConnected: boolean;
  hasProvider: boolean;
};

type ForgeWalletValue = ForgeWalletSnapshot & {
  connect: () => Promise<string>;
  disconnect: () => void;
  refresh: () => Promise<void>;
};

const ForgeWalletContext = React.createContext<ForgeWalletValue | undefined>(undefined);

function walletAddress(value: unknown): string | undefined {
  if (!Array.isArray(value) || typeof value[0] !== "string" || value[0].length === 0)
    return undefined;
  return value[0];
}

function walletChainId(value: unknown): number {
  if (typeof value !== "string" && typeof value !== "number")
    throw new Error("Wallet returned an invalid chain ID.");
  const chainId =
    typeof value === "string" ? Number.parseInt(value, /^0x/i.test(value) ? 16 : 10) : value;
  if (!Number.isSafeInteger(chainId) || chainId < 0)
    throw new Error("Wallet returned an invalid chain ID.");
  return chainId;
}

export function useForgeWallet() {
  const value = React.useContext(ForgeWalletContext);
  if (!value) throw new Error("Forge wallet provider is unavailable.");
  return value;
}

export function ForgeWalletProvider({ children }: { children: React.ReactNode }) {
  const [wallet, setWallet] = React.useState<ForgeWalletSnapshot>(() => ({
    address: undefined,
    chainId: undefined,
    isConnected: false,
    hasProvider: false,
  }));
  const manualDisconnect = React.useRef(false);
  const walletSyncVersion = React.useRef(0);

  const syncFromProvider = React.useCallback(
    async (provider: Awaited<ReturnType<typeof getActiveInjectedProvider>>) => {
      if (!provider || manualDisconnect.current) return;
      const requestVersion = walletSyncVersion.current;
      const [accounts, chainId] = await Promise.all([
        getInjectedAccounts(provider),
        getInjectedChainId(provider),
      ]);
      if (manualDisconnect.current || requestVersion !== walletSyncVersion.current) return;
      const address = walletAddress(accounts);
      setWallet((current) => ({
        ...current,
        address,
        chainId,
        isConnected: Boolean(address),
        hasProvider: true,
      }));
    },
    [],
  );

  const refresh = React.useCallback(async () => {
    walletSyncVersion.current += 1;
    const provider = await getActiveInjectedProvider();
    if (!provider) {
      if (!manualDisconnect.current)
        setWallet((current) => ({
          ...current,
          address: undefined,
          chainId: undefined,
          isConnected: false,
          hasProvider: false,
        }));
      return;
    }
    await syncFromProvider(provider);
  }, [syncFromProvider]);

  const connect = React.useCallback(async () => {
    manualDisconnect.current = false;
    walletSyncVersion.current += 1;
    const provider = await getActiveInjectedProvider({ diagnostic: true });
    if (!provider) throw new Error("NO_INJECTED_PROVIDER");
    const accounts = await requestInjectedAccounts(provider);
    const address = walletAddress(accounts);
    if (!address) throw new Error("The wallet did not return an account.");
    const chainId = await getInjectedChainId(provider);
    setWallet((current) => ({
      ...current,
      address,
      chainId,
      isConnected: true,
      hasProvider: true,
    }));
    return address;
  }, []);

  const disconnect = React.useCallback(() => {
    manualDisconnect.current = true;
    walletSyncVersion.current += 1;
    setWallet((current) => ({
      ...current,
      address: undefined,
      chainId: undefined,
      isConnected: false,
    }));
  }, []);

  React.useEffect(() => {
    let disposed = false;
    let provider: Awaited<ReturnType<typeof getActiveInjectedProvider>>;
    const onAccountsChanged = (accounts: unknown) => {
      manualDisconnect.current = false;
      walletSyncVersion.current += 1;
      const address = walletAddress(accounts);
      setWallet((current) => ({
        ...current,
        address,
        isConnected: Boolean(address),
        hasProvider: true,
      }));
    };
    const onChainChanged = (chainId: unknown) => {
      manualDisconnect.current = false;
      walletSyncVersion.current += 1;
      try {
        setWallet((current) => ({
          ...current,
          chainId: walletChainId(chainId),
          hasProvider: true,
        }));
      } catch {
        // Ignore malformed intermediate wallet events; the next provider read wins.
      }
    };
    const onDisconnect = () => {
      manualDisconnect.current = false;
      walletSyncVersion.current += 1;
      setWallet((current) => ({
        ...current,
        address: undefined,
        chainId: undefined,
        isConnected: false,
        hasProvider: true,
      }));
    };
    const setup = async () => {
      provider = await getActiveInjectedProvider();
      if (disposed) return;
      provider?.on?.("accountsChanged", onAccountsChanged);
      provider?.on?.("chainChanged", onChainChanged);
      provider?.on?.("disconnect", onDisconnect);
      await syncFromProvider(provider);
    };
    void setup().catch(() => undefined);
    return () => {
      disposed = true;
      provider?.removeListener?.("accountsChanged", onAccountsChanged);
      provider?.removeListener?.("chainChanged", onChainChanged);
      provider?.removeListener?.("disconnect", onDisconnect);
    };
  }, [syncFromProvider]);

  const value = React.useMemo<ForgeWalletValue>(
    () => ({ ...wallet, connect, disconnect, refresh }),
    [wallet, connect, disconnect, refresh],
  );
  return React.createElement(ForgeWalletContext.Provider, { value }, children);
}

export function useForgeWalletAddress() {
  const { address, chainId } = useForgeWallet();
  const queryClient = useQueryClient();
  const previous = React.useRef<string | undefined>(undefined);
  const previousChain = React.useRef<number | undefined>(undefined);
  React.useEffect(() => {
    const accountChanged =
      previous.current && previous.current.toLowerCase() !== address?.toLowerCase();
    const chainChanged = previousChain.current !== undefined && previousChain.current !== chainId;
    if (accountChanged && previous.current) {
      clearWalletQueriesForAddress(queryClient, previous.current);
    }
    if (chainChanged) {
      clearWalletQueries(queryClient, true);
    }
    previous.current = address;
    previousChain.current = chainId;
  }, [address, chainId, queryClient]);
  return address;
}

export function useForgeNetworkSwitch() {
  const queryClient = useQueryClient();
  const { refresh } = useForgeWallet();
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
        await refresh();
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
    [queryClient, refresh],
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

function walletQueryAddress(address?: string) {
  return address?.toLowerCase() ?? "disconnected";
}

function clearWalletQueries(queryClient: ReturnType<typeof useQueryClient>, remove: boolean) {
  if (remove)
    walletQueryKeys.forEach((key) => {
      void queryClient.removeQueries({ queryKey: key });
    });
  void Promise.allSettled(
    walletQueryKeys.map((key) => queryClient.invalidateQueries({ queryKey: key })),
  );
}

function clearWalletQueriesForAddress(
  queryClient: ReturnType<typeof useQueryClient>,
  address: string,
) {
  const normalizedAddress = address.toLowerCase();
  void queryClient.removeQueries({
    predicate: (query) => {
      const name = query.queryKey[1];
      if (!walletQueryKeys.some((key) => key[1] === name)) return false;
      const addressIndex = name === "my-position" || name === "betting-state" ? 3 : 2;
      return query.queryKey[addressIndex] === normalizedAddress;
    },
  });
}

const queryOptions = {
  retry: shouldRetryRead,
  retryDelay: queryRetryDelay,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const;
const walletActionabilityVariant = TransactionHashVariant.LATEST_NONFINAL;
const PUBLIC_READ_STALE_TIME_MS = 15_000;
const STATIC_READ_STALE_TIME_MS = 300_000;
export const MARKET_DETAIL_QUERY_OPTIONS = {
  // A detail page must verify the current contract state when it opens. This
  // also lets window focus discover settlement performed in another tab.
  staleTime: 0,
  refetchOnMount: "always" as const,
  refetchOnWindowFocus: true,
} as const;

export function useForgeConfig() {
  return useQuery({
    queryKey: ["forge", "config"],
    queryFn: () => contractAdapter.getConfig(),
    staleTime: STATIC_READ_STALE_TIME_MS,
    ...queryOptions,
  });
}
export function useForgeCategories() {
  return useQuery({
    queryKey: ["forge", "categories"],
    queryFn: () => contractAdapter.categories(),
    staleTime: STATIC_READ_STALE_TIME_MS,
    ...queryOptions,
  });
}
export function useForgeCategoryAssets(category?: Category) {
  return useQuery({
    queryKey: ["forge", "category-assets", category],
    queryFn: () => contractAdapter.categoryAssets(category!),
    enabled: Boolean(category),
    staleTime: STATIC_READ_STALE_TIME_MS,
    ...queryOptions,
  });
}
export function useForgeMarketCount() {
  return useQuery({
    queryKey: ["forge", "market-count"],
    queryFn: () => contractAdapter.getMarketCount(),
    staleTime: PUBLIC_READ_STALE_TIME_MS,
    ...queryOptions,
  });
}
export function useForgeMarkets(nowMs: number, offset = 0, limit = MAX_PAGE_SIZE) {
  return useQuery({
    queryKey: ["forge", "markets", offset, limit],
    queryFn: () => contractAdapter.getMarkets(Date.now(), offset, limit),
    enabled: nowMs > 0,
    staleTime: PUBLIC_READ_STALE_TIME_MS,
    ...queryOptions,
  });
}
export function useForgeOpenMarkets(nowMs: number, offset = 0, limit = MAX_PAGE_SIZE) {
  return useQuery({
    queryKey: ["forge", "open-markets", offset, limit],
    queryFn: () => contractAdapter.getOpenMarkets(Date.now(), offset, limit),
    enabled: nowMs > 0,
    staleTime: PUBLIC_READ_STALE_TIME_MS,
    ...queryOptions,
  });
}

const forgePublicClient = createPublicClient({
  chain: forgeChain,
  transport: http(FORGE_RPC_URL),
});

export function useForgeBalance(address?: string) {
  return useQuery({
    queryKey: ["balance", walletQueryAddress(address)],
    queryFn: () => forgePublicClient.getBalance({ address: address as Address }),
    enabled: Boolean(address),
    staleTime: PUBLIC_READ_STALE_TIME_MS,
    ...queryOptions,
  });
}

export function useForgeBinancePerformance(market: MarketView | undefined, nowMs: number) {
  const started = Boolean(market && nowMs >= market.startMs);
  const active = Boolean(
    market && market.contractState === "OPEN" && nowMs >= market.startMs && nowMs < market.endMs,
  );
  return useQuery({
    queryKey: [
      "forge",
      "binance-performance",
      market?.id ?? "none",
      ...(market?.assets.map(binanceChartSymbolForAsset) ?? []),
      market?.startMs ?? 0,
      market?.endMs ?? 0,
    ],
    queryFn: () => {
      const currentNow = Date.now();
      const endTime =
        currentNow >= market!.endMs
          ? market!.endMs
          : Math.min(
              market!.endMs,
              Math.max(market!.startMs + 60_000, Math.floor(currentNow / 15_000) * 15_000),
            );
      return fetchBinancePerformance(market!, endTime);
    },
    enabled: Boolean(market && started),
    staleTime: active ? 10_000 : STATIC_READ_STALE_TIME_MS,
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
    queryFn: () => contractAdapter.getMarket(marketId, Date.now(), transactionHashVariant),
    enabled: Boolean(marketId) && nowMs > 0,
    ...queryOptions,
    ...MARKET_DETAIL_QUERY_OPTIONS,
  });
}
export function useForgePosition(marketId: string, address?: string) {
  return useQuery({
    queryKey: ["forge", "my-position", marketId, walletQueryAddress(address)],
    queryFn: () => contractAdapter.getMyPosition(marketId, address!, walletActionabilityVariant),
    enabled: Boolean(marketId && address),
    staleTime: PUBLIC_READ_STALE_TIME_MS,
    ...queryOptions,
  });
}
export function useForgeBettingState(marketId: string, address?: string) {
  return useQuery({
    queryKey: ["forge", "betting-state", marketId, walletQueryAddress(address)],
    queryFn: () => contractAdapter.getBettingState(marketId, address!, walletActionabilityVariant),
    enabled: Boolean(marketId && address),
    staleTime: PUBLIC_READ_STALE_TIME_MS,
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
    staleTime: STATIC_READ_STALE_TIME_MS,
    ...queryOptions,
  });
}
export function useForgeMyMarketCount(address?: string) {
  return useQuery({
    queryKey: ["forge", "my-market-count", walletQueryAddress(address)],
    queryFn: () => contractAdapter.getMyMarketCount(address!, walletActionabilityVariant),
    enabled: Boolean(address),
    staleTime: PUBLIC_READ_STALE_TIME_MS,
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
    queryKey: ["forge", "my-positions", walletQueryAddress(address), offset, limit],
    queryFn: () =>
      contractAdapter.getMyPositions(
        Date.now(),
        address!,
        offset,
        limit,
        walletActionabilityVariant,
      ),
    enabled: Boolean(address) && nowMs > 0,
    staleTime: PUBLIC_READ_STALE_TIME_MS,
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
    queryKey: ["forge", "my-claimable", walletQueryAddress(address), offset, limit],
    queryFn: () =>
      contractAdapter.getMyClaimableMarkets(
        Date.now(),
        address!,
        offset,
        limit,
        walletActionabilityVariant,
      ),
    enabled: Boolean(address) && nowMs > 0,
    staleTime: PUBLIC_READ_STALE_TIME_MS,
    ...queryOptions,
  });
}
export function useForgeMyActivity(address?: string, offset = 0, limit = MAX_PAGE_SIZE) {
  return useQuery({
    queryKey: ["forge", "my-activity", walletQueryAddress(address), offset, limit],
    queryFn: () =>
      contractAdapter.getMyActivity(address!, offset, limit, walletActionabilityVariant),
    enabled: Boolean(address),
    staleTime: PUBLIC_READ_STALE_TIME_MS,
    ...queryOptions,
  });
}
export function useForgeMyActivityCount(address?: string) {
  return useQuery({
    queryKey: ["forge", "my-activity-count", walletQueryAddress(address)],
    queryFn: () => contractAdapter.getMyActivityCount(address!, walletActionabilityVariant),
    enabled: Boolean(address),
    staleTime: PUBLIC_READ_STALE_TIME_MS,
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
