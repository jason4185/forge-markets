import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Trophy } from "lucide-react";
import { formatAsset, formatGen, formatUtcDate, formatUtcTime } from "@/lib/forge/format";
import type { MarketView, PositionView } from "@/lib/forge/types";
import { PoolBar, Pill, StateBadge, SERIES_COLORS } from "./Bits";

export function MarketCard({ market, position }: { market: MarketView; position?: PositionView }) {
  const assets = market.assets;
  const resolutionRequired =
    market.settlementAvailable &&
    market.contractState !== "SETTLED" &&
    market.contractState !== "INCONCLUSIVE" &&
    BigInt(Math.floor(Date.now() / 1000)) >= market.settlementDeadlineSeconds;

  return (
    <Link
      to="/market/$id"
      params={{ id: market.id }}
      className="group flex flex-col gap-4 rounded-2xl border border-border bg-panel p-5 transition-colors hover:border-ember/40"
    >
      <div className="flex items-center justify-between gap-2">
        <Pill className="text-ember-soft">{market.category}</Pill>
        {resolutionRequired ? (
          <Pill className="border-warning/40 bg-warning/10 text-warning">Resolution required</Pill>
        ) : (
          <StateBadge state={market.state} />
        )}
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-2">
          <p className="num text-sm font-medium text-foreground">
            {formatUtcTime(market.startMs)} → {formatUtcTime(market.endMs)}
          </p>
          <p className="num text-[11px] text-muted-foreground">{market.id}</p>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{formatUtcDate(market.startMs)}</p>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Total pool</span>
          <span className="num font-medium text-foreground">{formatGen(market.totalPool)} GEN</span>
        </div>
        <PoolBar values={assets.map((a) => market.poolShares[a] ?? 0)} colors={SERIES_COLORS} />
      </div>

      <div className="flex flex-col gap-2">
        {assets.map((a, i) => {
          const isWinner = market.state === "SETTLED" && market.winner === a;
          return (
            <div
              key={a}
              className={`flex items-center justify-between rounded-xl border px-3 py-2 text-sm ${
                isWinner ? "border-ember/40 bg-ember/10" : "border-border/70 bg-panel-2"
              }`}
            >
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: SERIES_COLORS[i] }} />
                <span className="text-foreground">{formatAsset(a)}</span>
                {isWinner && <Trophy className="h-3.5 w-3.5 text-ember" />}
              </span>
              <span className="num text-xs text-muted-foreground">
                {formatGen(market.pools[a] ?? 0n)} GEN ·{" "}
                <span className="text-foreground">{(market.poolShares[a] ?? 0).toFixed(1)}%</span>
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-border pt-3 text-xs">
        {position?.hasPosition ? (
          <span className="text-muted-foreground">
            Your position:{" "}
            <span className="text-foreground">{formatAsset(position.selectedAsset)}</span> ·{" "}
            <span className="num text-foreground">{formatGen(position.totalStake)} GEN</span>
          </span>
        ) : market.state === "INCONCLUSIVE" ? (
          <span className="text-destructive">Original stake refundable</span>
        ) : resolutionRequired ? (
          <span className="text-warning">Resolution required</span>
        ) : (
          <span className="text-muted-foreground">Connect wallet to see your position</span>
        )}
        <span className="flex items-center gap-1 text-ember-soft group-hover:underline">
          View market <ArrowUpRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </Link>
  );
}
