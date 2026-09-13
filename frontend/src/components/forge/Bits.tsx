import type { MarketState } from "@/lib/forge/constants";
import { STATE_LABEL } from "@/lib/forge/constants";

export function StateBadge({ state }: { state: MarketState }) {
  const map: Record<MarketState, string> = {
    OPEN: "border-success/40 text-success bg-success/10",
    UPCOMING: "border-border text-muted-foreground bg-muted/40",
    SETTLEMENT_PENDING: "border-warning/40 text-warning bg-warning/10",
    SETTLED: "border-ember/40 text-ember-soft bg-ember/10",
    INCONCLUSIVE: "border-destructive/40 text-destructive bg-destructive/10",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${map[state]}`}
    >
      {STATE_LABEL[state]}
    </span>
  );
}

export function Pill({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-panel-2 px-2.5 py-0.5 text-[11px] text-muted-foreground ${className}`}
    >
      {children}
    </span>
  );
}

export function PoolBar({ values, colors }: { values: number[]; colors: string[] }) {
  const total = values.reduce((a, b) => a + b, 0) || 1;
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
      {values.map((v, i) => (
        <div key={i} style={{ width: `${(v / total) * 100}%`, background: colors[i] }} />
      ))}
    </div>
  );
}

export const SERIES_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)"];
