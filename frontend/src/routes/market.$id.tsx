import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Clock, MinusCircle, Trophy } from "lucide-react";
import { TransactionHashVariant } from "genlayer-js/types";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAccount, useConnect } from "wagmi";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Pill, SERIES_COLORS, StateBadge } from "@/components/forge/Bits";
import { TransactionDialog, useTransactionDialog } from "@/components/forge/TransactionDialog";
import { contractAdapter } from "@/lib/forge/contractAdapter";
import {
  acceptClaimAction,
  beginClaimAction,
  releaseClaimAction,
  useClaimActionState,
} from "@/lib/forge/claimActionState";
import { reconcileClaimFinalization } from "@/lib/forge/claimLifecycle";
import { forgeInjectedConnector } from "@/lib/forge/walletConfig";
import { mapForgeError, type ForgeErrorContext } from "@/lib/forge/errors";
import {
  FORGE_CHAIN_ID,
  MAX_BET_WEI,
  MIN_BET_WEI,
  SOURCES,
  SOURCE_LABEL,
  type Source,
} from "@/lib/forge/constants";
import {
  formatAsset,
  formatGen,
  formatUtcDate,
  formatUtcTime,
  formatUtcWindow,
  parseGen,
} from "@/lib/forge/format";
import { reconcileAcceptedWrite } from "@/lib/forge/retry";
import {
  useForgeBettingState,
  useForgeBinancePerformance,
  useForgeMarket,
  useForgeNetworkSwitch,
  useForgePosition,
  useForgeSourceEvidence,
  useForgeWalletAddress,
  useNow,
  useRefreshForge,
} from "@/lib/forge/useForge";
import type { Asset, SourceStatus } from "@/lib/forge/types";

export const Route = createFileRoute("/market/$id")({
  head: ({ params }) => ({
    meta: [
      { title: `Market ${params.id} — Forge commodity dominance` },
      {
        name: "description",
        content:
          "Which commodity leads this exact 1-hour UTC window? Settled by 2-of-3 exchange consensus with 0% protocol fee.",
      },
      { property: "og:title", content: `Market ${params.id} — Forge` },
      { property: "og:description", content: "1-hour commodity dominance market on GenLayer." },
    ],
  }),
  component: MarketDetail,
});

function MarketDetail() {
  const { id } = Route.useParams();
  const now = useNow();
  const address = useForgeWalletAddress();
  const claimAction = useClaimActionState(address, id, "claim");
  const refundAction = useClaimActionState(address, id, "refund");
  const marketQuery = useForgeMarket(
    id,
    now,
    claimAction.accepted || refundAction.accepted
      ? TransactionHashVariant.LATEST_NONFINAL
      : TransactionHashVariant.LATEST_FINAL,
  );
  const positionQuery = useForgePosition(id, address);
  const bettingState = useForgeBettingState(id, address);
  const market = marketQuery.data;
  const evidenceEnabled = Boolean(market && market.contractState === "SETTLED");
  const binanceEvidence = useForgeSourceEvidence(
    id,
    "BINANCE",
    evidenceEnabled,
    now,
    market ?? undefined,
  );
  const bitgetEvidence = useForgeSourceEvidence(
    id,
    "BITGET",
    evidenceEnabled,
    now,
    market ?? undefined,
  );
  const gateEvidence = useForgeSourceEvidence(
    id,
    "GATE",
    evidenceEnabled,
    now,
    market ?? undefined,
  );
  const evidenceQueries = [binanceEvidence, bitgetEvidence, gateEvidence];

  if (marketQuery.isLoading) return <PageState message="Loading Forge market…" />;
  if (marketQuery.isError)
    return (
      <PageState
        message="Market data temporarily unavailable"
        error
        errorValue={marketQuery.error}
        context="READ_MARKET"
        onRetry={() => void marketQuery.refetch()}
      />
    );
  if (!market) return <PageState message="Market not found." />;

  const position = positionQuery.data;
  const resolutionRequired =
    market.settlementAvailable &&
    market.contractState !== "SETTLED" &&
    market.contractState !== "INCONCLUSIVE" &&
    BigInt(Math.floor(now / 1000)) >= market.settlementDeadlineSeconds;
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 lg:px-6">
      <nav className="text-xs text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Markets
        </Link>
        <span className="px-1.5">·</span>
        {market.category} · Forge · 1 Hour
      </nav>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-semibold text-foreground lg:text-4xl">
          Which commodity leads this window?
        </h1>
        {resolutionRequired ? (
          <Pill className="border-warning/40 bg-warning/10 text-warning">Resolution required</Pill>
        ) : (
          <StateBadge state={market.state} />
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Pill>
          <Clock className="h-3 w-3" /> {formatUtcWindow(market.startMs, market.endMs)}
        </Pill>
        <Pill>{formatUtcDate(market.startMs)}</Pill>
        <Pill className="num">#{market.id}</Pill>
        <Pill className="num">Total pool {formatGen(market.totalPool)} GEN</Pill>
        <Pill>0% protocol fee</Pill>
      </div>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-6">
          <PerformanceCard market={market} nowMs={now} />
          <TimelineCard market={market} />
          <SettlementCard
            market={market}
            evidence={evidenceQueries.map((query, index) => ({
              source: SOURCES[index]!,
              evidence: query.data,
              loading: query.isLoading,
              error: query.isError,
              errorValue: query.error,
            }))}
            enabled={evidenceEnabled}
          />
          <RulesCard />
        </div>
        <div className="lg:sticky lg:top-24 lg:self-start">
          <ActionPanel
            market={market}
            position={position}
            bettingState={bettingState.data}
            positionUnavailable={Boolean(
              address &&
              (positionQuery.isError || (positionQuery.isLoading && !positionQuery.data)),
            )}
            positionError={positionQuery.error}
          />
        </div>
      </div>
    </div>
  );
}

function PageState({
  message,
  error = false,
  errorValue,
  context = "GENERAL",
  onRetry,
}: {
  message: string;
  error?: boolean;
  errorValue?: unknown;
  context?: ForgeErrorContext;
  onRetry?: () => void;
}) {
  const mapped = error ? mapForgeError(errorValue ?? new Error(message), context) : undefined;
  return (
    <div className="mx-auto max-w-3xl px-4 py-24 text-center">
      <p className={error ? "font-medium text-destructive" : "text-muted-foreground"}>
        {mapped?.title ?? message}
      </p>
      {mapped && <p className="mt-2 text-sm text-muted-foreground">{mapped.message}</p>}
      {onRetry && (
        <Button variant="outline" className="mt-5 rounded-xl" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

function PerformanceCard({
  market,
  nowMs,
}: {
  market: NonNullable<ReturnType<typeof useForgeMarket>["data"]>;
  nowMs: number;
}) {
  const performance = useForgeBinancePerformance(market, nowMs);
  const upcoming = nowMs < market.startMs;
  return (
    <section className="rounded-2xl border border-border bg-panel p-5">
      <Tabs defaultValue="live">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList className="bg-panel-2">
            <TabsTrigger value="live">Live Performance</TabsTrigger>
            <TabsTrigger value="pool">Pool Composition</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2">
            {market.state === "SETTLED" && market.winner && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-ember/40 bg-ember/10 px-3 py-1 text-xs text-ember-soft">
                <Trophy className="h-3.5 w-3.5" /> Contract winner: {formatAsset(market.winner)}
              </span>
            )}
            <span className="rounded-full border border-border bg-panel-2 px-2.5 py-1 text-[10px] tracking-[0.14em] text-muted-foreground">
              Binance · INFORMATIONAL ONLY
            </span>
          </div>
        </div>
        <TabsContent value="live" className="mt-5">
          {upcoming ? (
            <PerformanceEmpty>
              Performance begins at {formatUtcTime(market.startMs)}.
            </PerformanceEmpty>
          ) : performance.isLoading ? (
            <PerformanceEmpty>Loading Binance performance data…</PerformanceEmpty>
          ) : performance.isError || !performance.data ? (
            <PerformanceEmpty>
              {mapForgeError(performance.error, "BINANCE").message}
            </PerformanceEmpty>
          ) : (
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={performance.data.points}
                  margin={{ top: 8, right: 12, bottom: 0, left: -18 }}
                >
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="timeMs"
                    tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(value) => formatUtcTime(Number(value))}
                  />
                  <YAxis
                    tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(value) => `${Number(value).toFixed(1)}%`}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                    labelFormatter={(value) => formatUtcTime(Number(value))}
                    formatter={(value, name) => [
                      `${Number(value).toFixed(3)}%`,
                      formatAsset(String(name)),
                    ]}
                  />
                  {market.assets.map((asset, index) => (
                    <Line
                      key={asset}
                      type="monotone"
                      dataKey={asset}
                      stroke={SERIES_COLORS[index]}
                      strokeWidth={2}
                      dot={false}
                      connectNulls={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-4">
            {market.assets.map((asset, index) => (
              <span key={asset} className="flex items-center gap-2 text-xs text-muted-foreground">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: SERIES_COLORS[index] }}
                />
                {formatAsset(asset)}
              </span>
            ))}
          </div>
        </TabsContent>
        <TabsContent value="pool" className="mt-5 flex flex-col gap-3">
          {market.assets.map((asset, index) => (
            <div key={asset} className="rounded-xl border border-border bg-panel-2 p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-foreground">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: SERIES_COLORS[index] }}
                  />
                  {formatAsset(asset)}
                </span>
                <span className="num text-muted-foreground">
                  {formatGen(market.pools[asset] ?? 0n)} GEN ·{" "}
                  <span className="text-foreground">
                    {(market.poolShares[asset] ?? 0).toFixed(1)}%
                  </span>
                </span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full"
                  style={{
                    width: `${market.poolShares[asset] ?? 0}%`,
                    background: SERIES_COLORS[index],
                  }}
                />
              </div>
            </div>
          ))}
        </TabsContent>
      </Tabs>
      <p className="mt-5 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
        Settlement uses independent Binance, Gate and Bitget evidence through the Forge contract.
        This chart is informational only.
      </p>
    </section>
  );
}

function PerformanceEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[300px] items-center justify-center rounded-xl border border-dashed border-border bg-panel-2">
      <div className="text-center">
        <p className="text-sm text-muted-foreground">{children}</p>
        <p className="mt-2 text-xs text-muted-foreground">Binance · Informational only</p>
      </div>
    </div>
  );
}

function TimelineCard({
  market,
}: {
  market: NonNullable<ReturnType<typeof useForgeMarket>["data"]>;
}) {
  const rows = [
    { label: "Betting closes", at: market.bettingCloseMs },
    { label: "Performance starts", at: market.startMs },
    { label: "Performance ends", at: market.endMs },
    { label: "Settlement ready", at: market.endMs },
    { label: "Retry deadline", at: Number(market.settlementDeadlineSeconds) * 1000 },
  ];
  return (
    <section className="rounded-2xl border border-border bg-panel p-5">
      <h2 className="text-sm font-semibold text-foreground">Timeline (UTC)</h2>
      <ol className="mt-4 flex flex-col gap-0">
        {rows.map((row, index) => (
          <li key={row.label} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className="mt-1.5 h-2 w-2 rounded-full bg-ember" />
              {index < rows.length - 1 && <span className="w-px flex-1 bg-border" />}
            </div>
            <div className="flex w-full items-center justify-between pb-4 text-sm">
              <span className="text-muted-foreground">{row.label}</span>
              <span className="num text-foreground">{formatUtcTime(row.at)}</span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function SettlementCard({
  market,
  evidence,
  enabled,
}: {
  market: NonNullable<ReturnType<typeof useForgeMarket>["data"]>;
  evidence: Array<{
    source: Source;
    evidence: import("@/lib/forge/types").SourceEvidence | undefined;
    loading: boolean;
    error: boolean;
    errorValue?: unknown;
  }>;
  enabled: boolean;
}) {
  const [open, setOpen] = useState<Source | null>(null);
  const valid = evidence.filter((row) => row.evidence?.status === "VALID");
  const consensusCount = market.winner
    ? valid.filter((row) => row.evidence?.winner === market.winner).length
    : 0;
  return (
    <section className="rounded-2xl border border-border bg-panel p-5">
      <h2 className="text-sm font-semibold text-foreground">Settlement sources</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Each source independently ranks the three commodities using its own exact 1h open/close
        return. Prices and returns are never averaged across exchanges.
      </p>
      <div className="mt-4 flex flex-col gap-2">
        {evidence.map((row) => {
          const current = row.evidence;
          const status = current?.status ?? "UNAVAILABLE";
          const statusLabel = sourceStatusLabel(status);
          return (
            <div key={row.source} className="rounded-xl border border-border bg-panel-2">
              <button
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-sm"
                onClick={() => setOpen(open === row.source ? null : row.source)}
              >
                <span className="flex items-center gap-3">
                  <span className="text-foreground">{SOURCE_LABEL[row.source]}</span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] ${sourceStatusClass(status)}`}
                  >
                    {row.loading ? "LOADING" : statusLabel}
                  </span>
                </span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {current?.winner
                    ? `Source winner: ${formatAsset(current.winner)}`
                    : enabled
                      ? "No vote"
                      : "Available after settlement"}
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${open === row.source ? "rotate-180" : ""}`}
                  />
                </span>
              </button>
              {open === row.source && (
                <div className="border-t border-border px-4 py-3">
                  {row.error || !current || current.assets.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {row.error
                        ? mapForgeError(row.errorValue, "READ_SOURCE_EVIDENCE").message
                        : status === "INVALID"
                          ? "This source returned invalid evidence."
                          : "No candle evidence returned by this source yet."}
                    </p>
                  ) : (
                    <table className="w-full text-left text-xs">
                      <thead className="text-muted-foreground">
                        <tr>
                          <th className="py-1 font-normal">Symbol</th>
                          <th className="py-1 font-normal">Open</th>
                          <th className="py-1 font-normal">Close</th>
                          <th className="py-1 text-right font-normal">1h return</th>
                        </tr>
                      </thead>
                      <tbody className="num text-foreground">
                        {current.assets.map((asset) => {
                          const returnValue = Number(asset.returnUnits) / 1_000_000;
                          return (
                            <tr key={asset.asset} className="border-t border-border/60">
                              <td className="py-1.5">{asset.symbol}</td>
                              <td className="py-1.5">{asset.open}</td>
                              <td className="py-1.5">{asset.close}</td>
                              <td
                                className={`py-1.5 text-right ${returnValue >= 0 ? "text-success" : "text-destructive"}`}
                              >
                                {returnValue >= 0 ? "+" : ""}
                                {returnValue.toFixed(3)}%
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4 text-xs">
        <span className="text-muted-foreground">
          At least 2 of 3 valid sources required · {valid.length} valid now
        </span>
        <span className="text-foreground">
          {market.winner
            ? `Contract winner: ${formatAsset(market.winner)} (${consensusCount}-of-3)`
            : market.state === "INCONCLUSIVE"
              ? "Inconclusive — original stakes refundable"
              : "Consensus not reached yet"}
        </span>
      </div>
    </section>
  );
}

function sourceStatusLabel(status: SourceStatus): string {
  const labels: Record<SourceStatus, string> = {
    VALID: "Valid",
    TIE: "Tie",
    UNAVAILABLE: "Unavailable",
    INVALID: "Invalid evidence",
  };
  return labels[status];
}

function sourceStatusClass(status: SourceStatus): string {
  const classes: Record<SourceStatus, string> = {
    VALID: "border-success/40 bg-success/10 text-success",
    TIE: "border-warning/40 bg-warning/10 text-warning",
    UNAVAILABLE: "border-border bg-muted/40 text-muted-foreground",
    INVALID: "border-destructive/40 bg-destructive/10 text-destructive",
  };
  return classes[status];
}

const RULES = [
  "Exact 1-hour UTC windows, starting on exact UTC-hour boundaries.",
  "Betting closes when the performance hour begins.",
  "Minimum stake 1 GEN; maximum cumulative stake 50 GEN per wallet per market.",
  "One commodity per wallet per market. Same-side top-ups allowed before close; switching sides is not.",
  "0% protocol fee.",
  "Settlement uses Binance, Bitget and Gate — each source independently ranks the three commodities using its own exact 1h open/close return. Returns are never averaged across exchanges.",
  "2-of-3 matching VALID source winners settle the market. A TIE, UNAVAILABLE or INVALID source casts no vote.",
  "30-minute retry window after the market ends.",
  "If no 2-of-3 by the deadline: INCONCLUSIVE and users self-claim original-stake refunds.",
  "If the consensus-winning commodity has zero GEN backing while the total pool is nonzero: INCONCLUSIVE and refunds apply.",
  "Winning payouts are pari-mutuel and self-claimed.",
];
function RulesCard() {
  return (
    <section className="rounded-2xl border border-border bg-panel p-5">
      <h2 className="text-sm font-semibold text-foreground">Forge rules</h2>
      <ul className="mt-3 flex flex-col gap-2">
        {RULES.map((rule) => (
          <li key={rule} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ember" />
            {rule}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ActionPanel({
  market,
  position,
  bettingState,
  positionUnavailable,
  positionError,
}: {
  market: NonNullable<ReturnType<typeof useForgeMarket>["data"]>;
  position: import("@/lib/forge/types").PositionView | undefined;
  bettingState: import("@/lib/forge/types").BettingState | undefined;
  positionUnavailable?: boolean;
  positionError?: unknown;
}) {
  const { address, chainId, isConnected } = useAccount();
  const { connect } = useConnect();
  const { switchNetwork, isPending: switching } = useForgeNetworkSwitch();
  const tx = useTransactionDialog();
  const refresh = useRefreshForge();
  const claimAction = useClaimActionState(address, market.id, "claim");
  const refundAction = useClaimActionState(address, market.id, "refund");
  const [pick, setPick] = useState<Asset>(position?.selectedAsset ?? market.assets[0]!);
  const [amount, setAmount] = useState("1");
  const wrongNetwork = isConnected && chainId !== FORGE_CHAIN_ID;
  const settlementActionAvailable =
    market.settlementAvailable &&
    market.contractState !== "SETTLED" &&
    market.contractState !== "INCONCLUSIVE";
  const settlementDeadlinePassed =
    settlementActionAvailable &&
    BigInt(Math.floor(Date.now() / 1000)) >= market.settlementDeadlineSeconds;
  const requestNetworkSwitch = async () => {
    try {
      return await switchNetwork("market-detail");
    } catch (error) {
      const mapped = mapForgeError(error, "NETWORK_SWITCH");
      toast.error(mapped.title, { description: mapped.message });
      return false;
    }
  };
  const lockedSide = position?.hasPosition ? position.selectedAsset : null;
  const remaining = position ? MAX_BET_WEI - position.totalStake : MAX_BET_WEI;
  useEffect(() => {
    if (position?.selectedAsset) setPick(position.selectedAsset);
  }, [position?.selectedAsset]);
  const runWrite = async (kind: "bet" | "settle" | "claim" | "refund") => {
    if (!address || tx.locked) return;
    if (kind === "settle" && import.meta.env.DEV)
      console.debug("[FORGE SETTLE CLICK]", { marketId: market.id });
    if (kind === "settle" && import.meta.env.DEV)
      console.debug("[FORGE SETTLE NETWORK]", {
        wallet: address,
        chainId,
        correctNetwork: !wrongNetwork,
      });
    if (wrongNetwork && !(await requestNetworkSwitch())) return;
    if (kind === "settle") {
      try {
        const currentMarket = await contractAdapter.getMarket(
          market.id,
          Date.now(),
          TransactionHashVariant.LATEST_NONFINAL,
        );
        if (!currentMarket) {
          await refresh("settle", market.id);
          toast.error("Market not found", {
            description: "This Forge market is no longer available.",
          });
          return;
        }
        if (import.meta.env.DEV)
          console.debug("[FORGE SETTLE RECONCILE]", {
            marketId: market.id,
            phase: "preflight",
            state: currentMarket.contractState,
            settlementAvailable: currentMarket.settlementAvailable,
          });
        if (
          !currentMarket.settlementAvailable ||
          currentMarket.contractState === "SETTLED" ||
          currentMarket.contractState === "INCONCLUSIVE"
        ) {
          await refresh("settle", market.id);
          toast.error("Market resolution unavailable", {
            description: "This market has already been resolved or is no longer available.",
          });
          return;
        }
      } catch (error) {
        if (import.meta.env.DEV)
          console.debug("[FORGE SETTLE RECONCILE]", {
            marketId: market.id,
            phase: "preflight-error",
            error: error instanceof Error ? error.message : String(error),
          });
        const mapped = mapForgeError(error, "READ_MARKET");
        toast.error(mapped.title, { description: mapped.message });
        return;
      }
    }
    const action = kind === "claim" || kind === "refund" ? kind : undefined;
    if (action && !beginClaimAction(address, market.id, action)) return;
    if (!tx.begin(kind === "bet" && position?.hasPosition ? "top_up" : kind)) {
      if (action) releaseClaimAction(address, market.id, action);
      return;
    }
    let result;
    let betValue = 0n;
    if (kind === "bet") {
      const value = parseGen(amount);
      if (!value || value < MIN_BET_WEI) {
        tx.fail(mapForgeError(new Error("Minimum bet is 1 GEN."), "PLACE_BET").message);
        return;
      }
      if (value > remaining) {
        tx.fail(
          mapForgeError(new Error("Cumulative stake cannot exceed 50 GEN."), "PLACE_BET").message,
        );
        return;
      }
      betValue = value;
      result = await contractAdapter.placeBet(market.id, pick, value, address, tx.update);
    } else if (kind === "settle")
      result = await contractAdapter.settleMarket(market.id, address, tx.update);
    else if (kind === "claim") result = await contractAdapter.claim(market.id, address, tx.update);
    else result = await contractAdapter.claimRefund(market.id, address, tx.update);
    if (!result.ok) {
      if (action) releaseClaimAction(address, market.id, action);
      const context =
        kind === "bet"
          ? "PLACE_BET"
          : kind === "settle"
            ? "SETTLE"
            : kind === "claim"
              ? "CLAIM"
              : "REFUND";
      tx.fail(result.error ?? mapForgeError(new Error("WRITE_FAILED"), context).message);
      return;
    }
    if (result.confirmed !== true) {
      if (action) releaseClaimAction(address, market.id, action);
      tx.uncertain(result.hash);
      return;
    }
    if (!result.hash) {
      if (action) releaseClaimAction(address, market.id, action);
      tx.fail(
        mapForgeError(new Error("WRITE_SUBMISSION_FAILED: missing transaction hash"), "SUBMIT")
          .message,
      );
      return;
    }
    const acceptedTitle =
      kind === "claim"
        ? "Claim accepted"
        : kind === "refund"
          ? "Refund accepted"
          : kind === "bet"
            ? "Bet accepted"
            : "Settlement accepted";
    if (action) acceptClaimAction(address, market.id, action);
    tx.done(result.hash, acceptedTitle);
    if (action) {
      void reconcileClaimFinalization({
        hash: result.hash,
        wallet: address,
        marketId: market.id,
        action,
        refresh,
      });
    }
    await refresh(kind === "bet" ? "bet" : kind, market.id);
    if (kind === "bet") {
      const updatedPosition = await reconcileAcceptedWrite(
        result,
        () =>
          contractAdapter.getMyPosition(market.id, address, TransactionHashVariant.LATEST_NONFINAL),
        (next) => next.totalStake >= (position?.totalStake ?? 0n) + betValue,
      );
      if (!updatedPosition) return;
    } else if (kind === "settle") {
      const settledMarket = await reconcileAcceptedWrite(
        result,
        () =>
          contractAdapter.getMarket(market.id, Date.now(), TransactionHashVariant.LATEST_NONFINAL),
        (next) =>
          Boolean(
            next && (next.contractState === "SETTLED" || next.contractState === "INCONCLUSIVE"),
          ),
      );
      if (import.meta.env.DEV)
        console.debug("[FORGE SETTLE RECONCILE]", {
          marketId: market.id,
          phase: "post-write",
          state: settledMarket?.contractState ?? "UNAVAILABLE",
          settlementAvailable: settledMarket?.settlementAvailable ?? false,
        });
      if (!settledMarket) return;
    } else {
      const updatedPosition = await reconcileAcceptedWrite(
        result,
        () =>
          contractAdapter.getMyPosition(market.id, address, TransactionHashVariant.LATEST_NONFINAL),
        (next) => (kind === "claim" ? !next.claimAvailable : !next.refundAvailable),
      );
      if (!updatedPosition) return;
    }
    await refresh(kind === "bet" ? "bet" : kind, market.id);
    toast.success(
      kind === "claim"
        ? "Claim accepted"
        : kind === "refund"
          ? "Refund accepted"
          : "Transaction accepted",
    );
  };
  const connectWallet = () => connect({ connector: forgeInjectedConnector });
  const networkNotice = wrongNetwork ? (
    <div className="mt-4 rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
      <p className="font-medium">Wrong network</p>
      <p className="mt-1">Forge runs on GenLayer StudioNext. Switch your wallet to continue.</p>
      <Button
        variant="outline"
        className="mt-3 w-full rounded-xl"
        onClick={requestNetworkSwitch}
        disabled={switching}
      >
        {switching ? "Switching…" : "Switch to StudioNext"}
      </Button>
    </div>
  ) : null;
  if (settlementActionAvailable)
    return (
      <>
        <aside className="rounded-2xl border border-border bg-panel p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-warning">
            <Clock className="h-4 w-4" />
            {settlementDeadlinePassed ? "Settlement deadline passed" : "Ready for settlement"}
          </h2>
          {networkNotice}
          {position?.hasPosition ? (
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <Stat label="Your Pick" value={formatAsset(position.selectedAsset)} />
              <Stat label="Your Stake" value={`${formatGen(position.totalStake)} GEN`} />
            </div>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              Settlement is permissionless; you do not need a position to resolve this market.
            </p>
          )}
          <p className="mt-4 text-xs text-muted-foreground">
            {settlementDeadlinePassed
              ? "Resolve this market to finalize it as inconclusive."
              : "The performance window has ended. Settle this market using the contract's source consensus."}
          </p>
          {!address ? (
            <Button className="mt-4 w-full rounded-xl" onClick={connectWallet}>
              Connect Wallet to Settle
            </Button>
          ) : !wrongNetwork ? (
            <Button
              variant="outline"
              className="mt-4 w-full rounded-xl"
              disabled={tx.locked}
              onClick={() => runWrite("settle")}
            >
              {tx.locked
                ? "Transaction pending…"
                : settlementDeadlinePassed
                  ? "Resolve Market"
                  : "Settle Market"}
            </Button>
          ) : null}
        </aside>
        <TransactionDialog state={tx.state} busy={tx.busy} onClose={tx.close} />
      </>
    );
  if (positionUnavailable)
    return (
      <>
        <aside className="rounded-2xl border border-border bg-panel p-5">
          <h2 className="text-sm font-semibold text-foreground">Couldn’t load your position</h2>
          {networkNotice}
          <p className="mt-2 text-xs text-muted-foreground">
            {mapForgeError(positionError, "READ_PORTFOLIO").message}
          </p>
        </aside>
        <TransactionDialog state={tx.state} busy={tx.busy} onClose={tx.close} />
      </>
    );
  if (!address)
    return (
      <aside className="rounded-2xl border border-border bg-panel p-5">
        <h2 className="text-sm font-semibold text-foreground">Place a position</h2>
        <p className="mt-2 text-xs text-muted-foreground">
          Connect your wallet to stake GEN on this market.
        </p>
        <Button className="mt-4 w-full rounded-xl" onClick={connectWallet}>
          Connect wallet
        </Button>
      </aside>
    );
  if (market.bettingOpen)
    return (
      <>
        <aside className="rounded-2xl border border-border bg-panel p-5">
          <h2 className="text-sm font-semibold text-foreground">
            {lockedSide ? "Top up your position" : "Place a position"}
          </h2>
          {networkNotice}
          <div className="mt-4 flex flex-col gap-2">
            {market.assets.map((asset, index) => (
              <button
                key={asset}
                disabled={Boolean(lockedSide && asset !== lockedSide)}
                onClick={() => setPick(asset)}
                className={`flex items-center justify-between rounded-xl border px-3 py-2.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${pick === asset ? "border-ember bg-ember/10" : "border-border bg-panel-2"}`}
              >
                <span className="flex items-center gap-2 text-foreground">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: SERIES_COLORS[index] }}
                  />
                  {formatAsset(asset)}
                </span>
                <span className="num text-xs text-muted-foreground">
                  {formatGen(market.pools[asset] ?? 0n)} GEN ·{" "}
                  {(market.poolShares[asset] ?? 0).toFixed(1)}%
                </span>
              </button>
            ))}
          </div>
          <label className="mt-4 block text-xs text-muted-foreground">Amount (GEN)</label>
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            className="num mt-1.5 h-11 w-full rounded-xl border border-border bg-panel-2 px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="mt-2 grid grid-cols-4 gap-2">
            {["1", "5", "10"].map((value) => (
              <button
                key={value}
                onClick={() => setAmount(value)}
                className="rounded-lg border border-border bg-panel-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                {value}
              </button>
            ))}
            <button
              onClick={() => setAmount(formatGen(remaining, 18))}
              className="rounded-lg border border-border bg-panel-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              Max
            </button>
          </div>
          <ul className="mt-4 flex flex-col gap-1 text-[11px] leading-relaxed text-muted-foreground">
            <li>Minimum 1 GEN · maximum cumulative 50 GEN per wallet.</li>
            <li>One commodity per wallet per market.</li>
            <li>Same-side top-ups only — switching sides is not allowed.</li>
            {position?.hasPosition && (
              <li className="text-ember-soft">
                Current position: {formatAsset(position.selectedAsset)} ·{" "}
                {formatGen(position.totalStake)} GEN
              </li>
            )}
          </ul>
          <Button
            className="mt-4 w-full rounded-xl"
            disabled={tx.locked || remaining < MIN_BET_WEI}
            onClick={() => runWrite("bet")}
          >
            {tx.locked ? "Transaction pending…" : lockedSide ? "Top up position" : "Place position"}
          </Button>
        </aside>
        <TransactionDialog state={tx.state} busy={tx.busy} onClose={tx.close} />
      </>
    );
  if (market.contractState === "SETTLEMENT_PENDING")
    return (
      <>
        <aside className="rounded-2xl border border-border bg-panel p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-warning">
            <Clock className="h-4 w-4" /> Awaiting source consensus
          </h2>
          {networkNotice}
          {position?.hasPosition ? (
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <Stat label="Your Pick" value={formatAsset(position.selectedAsset)} />
              <Stat label="Your Stake" value={`${formatGen(position.totalStake)} GEN`} />
            </div>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              You had no position in this market.
            </p>
          )}
          <p className="mt-4 text-xs text-muted-foreground">
            Retry deadline{" "}
            <span className="num text-foreground">
              {formatUtcTime(Number(market.settlementDeadlineSeconds) * 1000)}
            </span>
            . Settlement is permissionless.
          </p>
          {market.settlementAvailable && (
            <Button
              variant="outline"
              className="mt-4 w-full rounded-xl"
              disabled={tx.locked}
              onClick={() => runWrite("settle")}
            >
              {tx.locked ? "Transaction pending…" : "Settle market"}
            </Button>
          )}
        </aside>
        <TransactionDialog state={tx.state} busy={tx.busy} onClose={tx.close} />
      </>
    );
  if (market.contractState === "INCONCLUSIVE")
    return (
      <>
        <aside className="rounded-2xl border border-border bg-panel p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-destructive">
            <AlertTriangle className="h-4 w-4" /> Inconclusive
          </h2>
          {networkNotice}
          <p className="mt-2 text-xs text-muted-foreground">
            No 2-of-3 consensus by the retry deadline. Original stakes are refundable.
          </p>
          {position?.hasPosition && (
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Stat label="Your Pick" value={formatAsset(position.selectedAsset)} />
              <Stat label="Refundable" value={`${formatGen(position.claimableAmount)} GEN`} />
            </div>
          )}
          {refundAction.pending ? (
            <Button className="mt-4 w-full rounded-xl" disabled>
              Refunding…
            </Button>
          ) : position?.refundAvailable && !refundAction.accepted ? (
            <Button
              className="mt-4 w-full rounded-xl"
              disabled={tx.locked}
              onClick={() => runWrite("refund")}
            >
              {tx.locked ? "Transaction pending…" : "Claim refund"}
            </Button>
          ) : position?.refunded || refundAction.finalized ? (
            <p className="mt-4 flex items-center gap-2 text-xs text-success">
              <CheckCircle2 className="h-4 w-4" /> Refunded
            </p>
          ) : refundAction.accepted ? (
            <p className="mt-4 flex items-center gap-2 text-xs text-success">
              <CheckCircle2 className="h-4 w-4" /> Refund accepted · transfer finalizing
            </p>
          ) : null}
        </aside>
        <TransactionDialog state={tx.state} busy={tx.busy} onClose={tx.close} />
      </>
    );
  if (market.contractState === "OPEN")
    return (
      <>
        <aside className="rounded-2xl border border-border bg-panel p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Clock className="h-4 w-4 text-warning" /> Performance window in progress
          </h2>
          <p className="mt-2 text-xs text-muted-foreground">
            Betting is closed while this market records its exact one-hour performance window.
          </p>
          {position?.hasPosition && (
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Stat label="Your Pick" value={formatAsset(position.selectedAsset)} />
              <Stat label="Your Stake" value={`${formatGen(position.totalStake)} GEN`} />
            </div>
          )}
        </aside>
        <TransactionDialog state={tx.state} busy={tx.busy} onClose={tx.close} />
      </>
    );
  const won = Boolean(position?.positionWon);
  return (
    <>
      <aside className="rounded-2xl border border-border bg-panel p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Trophy className="h-4 w-4 text-ember" /> Contract winner: {formatAsset(market.winner)}
        </h2>
        {networkNotice}
        <p className="mt-1 text-xs text-muted-foreground">
          Settled by the contract's matching valid source consensus.
        </p>
        {position?.hasPosition ? (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Stat label="Your Pick" value={formatAsset(position.selectedAsset)} />
              <Stat label="Your Stake" value={`${formatGen(position.totalStake)} GEN`} />
            </div>
            {won ? (
              <>
                <div className="mt-3 rounded-xl border border-success/30 bg-success/10 p-4">
                  <p className="text-xs text-success">Won</p>
                  <p className="num mt-1 text-2xl font-semibold text-foreground">
                    {formatGen(position.claimableAmount)} GEN
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Pari-mutuel share of the full pool · 0% protocol fee.
                  </p>
                </div>
                {claimAction.pending ? (
                  <Button className="mt-4 w-full rounded-xl" disabled>
                    Claiming…
                  </Button>
                ) : position.claimAvailable && !claimAction.accepted ? (
                  <Button
                    className="mt-4 w-full rounded-xl"
                    disabled={tx.locked}
                    onClick={() => runWrite("claim")}
                  >
                    {tx.locked ? "Transaction pending…" : "Claim winnings"}
                  </Button>
                ) : position.alreadyClaimed || claimAction.finalized ? (
                  <p className="mt-4 flex items-center gap-2 text-xs text-success">
                    <CheckCircle2 className="h-4 w-4" /> Claimed
                  </p>
                ) : claimAction.accepted ? (
                  <p className="mt-4 flex items-center gap-2 text-xs text-success">
                    <CheckCircle2 className="h-4 w-4" /> Claim accepted · transfer finalizing
                  </p>
                ) : (
                  <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4" /> Winnings claim unavailable.
                  </p>
                )}
              </>
            ) : (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-border bg-panel-2 p-4 text-xs text-muted-foreground">
                <MinusCircle className="mt-0.5 h-4 w-4" />
                Lost — {formatAsset(position.selectedAsset)} did not lead this window.
              </div>
            )}
          </>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">You had no position in this market.</p>
        )}
      </aside>
      <TransactionDialog state={tx.state} busy={tx.busy} onClose={tx.close} />
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-foreground">{value}</p>
    </div>
  );
}
