import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useAccount, useConnect } from "wagmi";
import { TransactionHashVariant } from "genlayer-js/types";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { TransactionDialog, useTransactionDialog } from "@/components/forge/TransactionDialog";
import { forgeInjectedConnector } from "@/lib/forge/walletConfig";
import { logForgeWriteDebug, mapForgeError } from "@/lib/forge/errors";
import { FORGE_CHAIN_ID, CATEGORY_ASSETS, type Category } from "@/lib/forge/constants";
import { formatAsset, formatUtcDate, formatUtcTime } from "@/lib/forge/format";
import { contractAdapter } from "@/lib/forge/contractAdapter";
import { reconcileAcceptedWrite } from "@/lib/forge/retry";
import {
  useForgeCategories,
  useForgeCategoryAssets,
  useForgeNetworkSwitch,
  useRefreshForge,
  useNow,
} from "@/lib/forge/useForge";

export const Route = createFileRoute("/create")({
  head: () => ({
    meta: [
      { title: "Create a Forge market — permissionless" },
      {
        name: "description",
        content: "Open a new commodity dominance market on an upcoming exact 1-hour UTC window.",
      },
      { property: "og:title", content: "Create a Forge market" },
      {
        property: "og:description",
        content: "Permissionless 1-hour commodity dominance market on GenLayer.",
      },
    ],
  }),
  component: CreatePage,
});

function utcDate() {
  return new Date().toISOString().slice(0, 10);
}

function CreatePage() {
  const navigate = useNavigate();
  const now = useNow();
  const { address, chainId } = useAccount();
  const { connect } = useConnect();
  const { switchNetwork, isPending: switching } = useForgeNetworkSwitch();
  const categories = useForgeCategories();
  const [category, setCategory] = useState<Category>("METALS");
  const assets = useForgeCategoryAssets(category);
  const [date, setDate] = useState(utcDate());
  const [hour, setHour] = useState<number | null>(null);
  const tx = useTransactionDialog();
  const refresh = useRefreshForge();
  const supportedCategories = categories.data ?? [];
  const windows = useMemo(
    () =>
      Array.from({ length: 24 }, (_, h) => {
        const start = new Date(`${date}T${String(h).padStart(2, "0")}:00:00Z`);
        const end = new Date(start.getTime() + 3_600_000);
        return { h, start, end, disabled: start.getTime() <= now };
      }),
    [date, now],
  );
  const selected = hour === null ? null : (windows.find((item) => item.h === hour) ?? null);
  const shortTime = (value: Date) => `${String(value.getUTCHours()).padStart(2, "0")}:00 UTC`;
  const connectWallet = () => connect({ connector: forgeInjectedConnector });
  const requestNetworkSwitch = async () => {
    try {
      return await switchNetwork("create-market");
    } catch (error) {
      const mapped = mapForgeError(error, "NETWORK_SWITCH");
      toast.error(mapped.title, { description: mapped.message });
      return false;
    }
  };
  const wrongNetwork = Boolean(address) && chainId !== FORGE_CHAIN_ID;

  const create = async () => {
    logForgeWriteDebug("create_market click started", {
      activeAddress: address ?? "none",
      chainId: chainId ?? "none",
    });
    if (!address) {
      toast.error("Wallet not connected", { description: "Connect your wallet to continue." });
      return;
    }
    if (!selected) {
      toast.error("Choose a valid start time", {
        description: "Markets must start on an exact future UTC hour.",
      });
      return;
    }
    if (wrongNetwork && !(await requestNetworkSwitch())) return;
    if (!tx.begin("create")) return;
    const startSeconds = BigInt(Math.floor(selected.start.getTime() / 1000));
    const result = await contractAdapter.createMarket(category, startSeconds, address, tx.update);
    if (!result.ok) {
      tx.fail(
        result.error ?? mapForgeError(new Error("CREATE_MARKET_FAILED"), "CREATE_MARKET").message,
        result.hash,
        result.errorDetail,
      );
      return;
    }
    if (result.confirmed !== true) {
      tx.uncertain(result.hash);
      return;
    }
    tx.done(result.hash, "Market created");
    const created = await reconcileAcceptedWrite(
      result,
      () =>
        contractAdapter.getMarketByCategoryStart(
          category,
          startSeconds,
          Date.now(),
          TransactionHashVariant.LATEST_NONFINAL,
        ),
      (market) => market !== null,
    );
    if (!created) {
      await refresh("create");
      return;
    }
    await refresh("create");
    navigate({ to: "/market/$id", params: { id: created.id } });
  };

  return (
    <>
      <div className="mx-auto max-w-[1400px] px-4 py-10 lg:px-6">
        <p className="forge-eyebrow">Permissionless Creation</p>
        <h1 className="mt-3 text-4xl font-semibold text-foreground">Create a Forge market</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          Choose a category and upcoming exact 1-hour UTC window. Anyone can open a market; no admin
          approval is required.
        </p>
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
          <div className="flex flex-col gap-6">
            <section className="rounded-2xl border border-border bg-panel p-5">
              <h2 className="text-sm font-semibold text-foreground">1. Category</h2>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {(supportedCategories.length
                  ? supportedCategories
                  : (Object.keys(CATEGORY_ASSETS) as Category[])
                ).map((value) => (
                  <button
                    key={value}
                    onClick={() => setCategory(value)}
                    className={`rounded-2xl border p-4 text-left transition-colors ${category === value ? "border-ember bg-ember/10" : "border-border bg-panel-2"}`}
                  >
                    <p className="text-sm font-semibold text-foreground">{value}</p>
                    <p className="num mt-1 text-xs text-muted-foreground">
                      {assets.data && category === value
                        ? assets.data.map(formatAsset).join(" · ")
                        : CATEGORY_ASSETS[value].map(formatAsset).join(" · ")}
                    </p>
                  </button>
                ))}
              </div>
              {categories.isLoading && (
                <p className="mt-3 text-xs text-muted-foreground">Loading supported categories…</p>
              )}
              {categories.isError && (
                <p className="mt-3 text-xs text-destructive">
                  {mapForgeError(categories.error, "READ_CATEGORIES").message}
                </p>
              )}
            </section>
            <section className="rounded-2xl border border-border bg-panel p-5">
              <h2 className="text-sm font-semibold text-foreground">2. Date (UTC)</h2>
              <input
                type="date"
                min={utcDate()}
                value={date}
                onChange={(event) => {
                  setDate(event.target.value);
                  setHour(null);
                }}
                className="num mt-3 h-10 rounded-xl border border-border bg-panel-2 px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </section>
            <section className="rounded-2xl border border-border bg-panel p-5">
              <h2 className="text-sm font-semibold text-foreground">3. Exact 1-hour UTC window</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Past and currently running windows cannot be created.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {windows.map((item) => (
                  <button
                    key={item.h}
                    disabled={item.disabled}
                    onClick={() => setHour(item.h)}
                    className={`num rounded-xl border px-3 py-2.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${hour === item.h ? "border-ember bg-ember/10 text-ember-soft" : "border-border bg-panel-2 text-muted-foreground hover:text-foreground"}`}
                  >
                    {shortTime(item.start)} → {shortTime(item.end)}
                  </button>
                ))}
              </div>
            </section>
          </div>
          <aside className="rounded-2xl border border-border bg-panel p-5 lg:sticky lg:top-24 lg:self-start">
            <h2 className="text-sm font-semibold text-foreground">Window preview</h2>
            <dl className="mt-4 flex flex-col gap-3 text-sm">
              <Row label="Category" value={category} />
              <Row
                label="Assets"
                value={(assets.data ?? CATEGORY_ASSETS[category]).map(formatAsset).join(", ")}
              />
              <Row
                label="UTC start"
                value={
                  selected
                    ? `${formatUtcDate(selected.start.getTime())} · ${formatUtcTime(selected.start.getTime())}`
                    : "—"
                }
              />
              <Row label="UTC end" value={selected ? formatUtcTime(selected.end.getTime()) : "—"} />
              <Row
                label="Betting closes"
                value={selected ? formatUtcTime(selected.start.getTime()) : "—"}
              />
              <Row
                label="Settlement retry deadline"
                value={
                  selected ? `${formatUtcTime(selected.end.getTime() + 1_800_000)} (+30 min)` : "—"
                }
              />
              <Row label="Protocol fee" value="0%" />
              <Row label="Minimum stake" value="1 GEN" />
            </dl>
            {wrongNetwork && (
              <button
                onClick={requestNetworkSwitch}
                disabled={switching}
                className="mt-4 w-full rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning disabled:opacity-60"
              >
                {switching ? "Switching…" : "Switch to StudioNext"}
              </button>
            )}
            {!address && (
              <Button variant="outline" className="mt-4 w-full rounded-xl" onClick={connectWallet}>
                Connect wallet to create
              </Button>
            )}
            <Button
              className="mt-3 w-full rounded-xl"
              disabled={!selected || !address || tx.locked || categories.isError || switching}
              onClick={create}
            >
              {tx.locked ? "Transaction pending…" : "Create Market"}
            </Button>
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              A duplicate category + start window is rejected by the contract.
            </p>
          </aside>
        </div>
      </div>
      <TransactionDialog state={tx.state} busy={tx.busy} onClose={tx.close} />
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/60 pb-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="num text-right text-xs text-foreground">{value}</dd>
    </div>
  );
}
