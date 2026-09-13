import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarketCard } from "@/components/forge/MarketCard";
import { mapForgeError } from "@/lib/forge/errors";
import { formatGen } from "@/lib/forge/format";
import {
  useForgeCategories,
  useForgeMarketCount,
  useForgeMarkets,
  useForgeMyPositions,
  useForgeWalletAddress,
  useNow,
} from "@/lib/forge/useForge";
import type { Category, MarketState } from "@/lib/forge/constants";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Forge Markets — 1-hour commodity dominance" },
      {
        name: "description",
        content:
          "Back the commodity that leads its category over an exact 1-hour UTC window. 0% protocol fee, 2-of-3 exchange consensus.",
      },
      { property: "og:title", content: "Forge Markets — 1-hour commodity dominance" },
      {
        property: "og:description",
        content: "Commodity dominance prediction markets on GenLayer. 0% protocol fee.",
      },
    ],
  }),
  component: MarketsPage,
});

const STATUSES: Array<"ALL" | MarketState> = [
  "ALL",
  "OPEN",
  "UPCOMING",
  "SETTLEMENT_PENDING",
  "SETTLED",
  "INCONCLUSIVE",
];
const STATUS_LABEL: Record<string, string> = {
  ALL: "All status",
  OPEN: "Open",
  UPCOMING: "Upcoming",
  SETTLEMENT_PENDING: "Awaiting settlement",
  SETTLED: "Settled",
  INCONCLUSIVE: "Inconclusive",
};

export function MarketsPage() {
  const now = useNow();
  const walletAddress = useForgeWalletAddress();
  const categories = useForgeCategories();
  const count = useForgeMarketCount();
  const markets = useForgeMarkets(now);
  const positions = useForgeMyPositions(now, walletAddress, 0, 50);
  const [cat, setCat] = useState<"ALL" | Category>("ALL");
  const [status, setStatus] = useState<"ALL" | MarketState>("ALL");
  const [query, setQuery] = useState("");
  const loadedMarkets = useMemo(
    () => (markets.isError ? [] : (markets.data ?? [])),
    [markets.data, markets.isError],
  );
  const list = useMemo(
    () =>
      loadedMarkets.filter((market) => {
        if (cat !== "ALL" && market.category !== cat) return false;
        if (status !== "ALL" && market.state !== status) return false;
        if (query.trim()) {
          const text =
            `${market.id} ${market.category} ${market.assets.join(" ")} ${market.symbols.join(" ")}`.toLowerCase();
          if (!text.includes(query.trim().toLowerCase())) return false;
        }
        return true;
      }),
    [cat, loadedMarkets, query, status],
  );
  const liquidity = loadedMarkets.reduce((total, market) => total + market.totalPool, 0n);
  const openNow = loadedMarkets.filter((market) => market.bettingOpen).length;
  const categoryOptions = categories.data ?? [];
  const marketError = mapForgeError(markets.error, "READ_MARKETS");

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 lg:px-6">
      <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <p className="forge-eyebrow">Commodity Dominance</p>
          <h1 className="mt-3 text-4xl font-semibold text-foreground lg:text-5xl">
            Commodities compete. One hour decides.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            Back the commodity that leads its category over an exact 1-hour UTC window. 0% protocol
            fee, settled by 2-of-3 exchange consensus.
          </p>
        </div>
        <div className="grid w-full grid-cols-2 gap-3 lg:w-auto">
          <div className="rounded-2xl border border-border bg-panel px-5 py-4">
            <p className="text-xs text-muted-foreground">
              Total Liquidity
              {!markets.isError &&
              count.data !== undefined &&
              count.data > BigInt(markets.data?.length ?? 0)
                ? " · loaded page"
                : ""}
            </p>
            <p className="num mt-1 text-2xl font-semibold text-foreground">
              {formatGen(liquidity)} <span className="text-sm text-muted-foreground">GEN</span>
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-panel px-5 py-4">
            <p className="text-xs text-muted-foreground">Open Now</p>
            <p className="num mt-1 text-2xl font-semibold text-success">{openNow}</p>
          </div>
        </div>
      </div>
      <div className="mt-8 flex flex-col gap-3 rounded-2xl border border-border bg-panel p-3 lg:flex-row lg:items-center">
        <div className="flex gap-1 rounded-xl bg-panel-2 p-1">
          <button
            onClick={() => setCat("ALL")}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${cat === "ALL" ? "bg-ember/15 text-ember-soft" : "text-muted-foreground hover:text-foreground"}`}
          >
            All
          </button>
          {categoryOptions.map((category) => (
            <button
              key={category}
              onClick={() => setCat(category)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${cat === category ? "bg-ember/15 text-ember-soft" : "text-muted-foreground hover:text-foreground"}`}
            >
              {category.charAt(0) + category.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1 rounded-xl bg-panel-2 p-1">
          {STATUSES.map((value) => (
            <button
              key={value}
              onClick={() => setStatus(value)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${status === value ? "bg-ember/15 text-ember-soft" : "text-muted-foreground hover:text-foreground"}`}
            >
              {STATUS_LABEL[value]}
            </button>
          ))}
        </div>
        <div className="relative lg:ml-auto lg:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-9 w-full rounded-xl border border-border bg-panel-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Search category, commodity or market ID"
          />
        </div>
      </div>
      {markets.isLoading && (
        <p className="mt-16 text-center text-sm text-muted-foreground">Loading Forge markets…</p>
      )}
      {markets.isError && (
        <div className="mt-8 rounded-2xl border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive">
          <p className="font-medium">{marketError.title}</p>
          <p className="mt-1 text-xs text-destructive/80">{marketError.message}</p>
          <Button
            size="sm"
            variant="outline"
            className="mt-4 border-destructive/30"
            onClick={() => void markets.refetch()}
          >
            Try again
          </Button>
        </div>
      )}
      {!markets.isLoading && !markets.isError && (
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((market) => {
            const position = positions.data?.find((row) => row.market.id === market.id)?.position;
            return (
              <MarketCard key={market.id} market={market} {...(position ? { position } : {})} />
            );
          })}
        </div>
      )}
      {!markets.isLoading && !markets.isError && list.length === 0 && (
        <p className="mt-16 text-center text-sm text-muted-foreground">
          No real Forge markets match these filters.
        </p>
      )}
      {!markets.isError &&
        markets.data &&
        count.data !== undefined &&
        count.data > BigInt(markets.data.length) && (
          <p className="mt-5 text-center text-xs text-muted-foreground">
            Showing the newest {markets.data.length} of {count.data.toString()} indexed markets.
          </p>
        )}
    </div>
  );
}
