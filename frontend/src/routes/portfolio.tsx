import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useAccount } from "wagmi";
import { TransactionHashVariant } from "genlayer-js/types";
import { Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Pill, StateBadge } from "@/components/forge/Bits";
import { TransactionDialog, useTransactionDialog } from "@/components/forge/TransactionDialog";
import {
  acceptClaimAction,
  beginClaimAction,
  hasFinalizedClaimAction,
  hasAcceptedClaimAction,
  isClaimActionPending,
  releaseClaimAction,
  useClaimActionLocksVersion,
} from "@/lib/forge/claimActionState";
import { reconcileClaimFinalization } from "@/lib/forge/claimLifecycle";
import { FORGE_CHAIN_ID } from "@/lib/forge/constants";
import { contractAdapter } from "@/lib/forge/contractAdapter";
import { formatAsset, formatGen, formatUtcDate, formatUtcWindow } from "@/lib/forge/format";
import { mapForgeError } from "@/lib/forge/errors";
import { reconcileAcceptedWrite } from "@/lib/forge/retry";
import {
  useForgeMyClaimable,
  useForgeMyMarketCount,
  useForgeMyPositions,
  useForgeNetworkSwitch,
  useForgeWalletAddress,
  useNow,
  useRefreshForge,
} from "@/lib/forge/useForge";
import type { UserPosition } from "@/lib/forge/types";

export const Route = createFileRoute("/portfolio")({
  head: () => ({
    meta: [
      { title: "Portfolio — Your Forge positions" },
      {
        name: "description",
        content:
          "Track active Forge positions, claimable payouts and refunds, and settled market history.",
      },
      { property: "og:title", content: "Portfolio — Your Forge positions" },
      {
        property: "og:description",
        content: "Active positions, claims and settled history for your GEN wallet.",
      },
    ],
  }),
  component: PortfolioPage,
});

function PortfolioPage() {
  const address = useForgeWalletAddress();
  const { chainId, isConnected } = useAccount();
  const { switchNetwork, isPending: switching } = useForgeNetworkSwitch();
  const now = useNow();
  const count = useForgeMyMarketCount(address);
  const [offset, setOffset] = useState(0);
  const rows = useForgeMyPositions(now, address, offset, 50);
  const claimableQuery = useForgeMyClaimable(now, address, 0, 50);
  const tx = useTransactionDialog();
  const refresh = useRefreshForge();
  useClaimActionLocksVersion();
  const wrongNetwork = isConnected && chainId !== FORGE_CHAIN_ID;
  const requestNetworkSwitch = async () => {
    try {
      return await switchNetwork("portfolio");
    } catch (error) {
      const mapped = mapForgeError(error, "NETWORK_SWITCH");
      toast.error(mapped.title, { description: mapped.message });
      return false;
    }
  };
  const all = rows.isError ? [] : (rows.data ?? []);
  const claimableRows = claimableQuery.isError ? [] : (claimableQuery.data ?? []);
  const active = all.filter(
    ({ market }) =>
      market.state === "OPEN" ||
      market.state === "UPCOMING" ||
      market.state === "SETTLEMENT_PENDING",
  );
  const history = all.filter(
    ({ market }) => market.state === "SETTLED" || market.state === "INCONCLUSIVE",
  );
  const totalStaked = all.reduce((total, row) => total + row.position.totalStake, 0n);
  const claimableAmount = (claimableQuery.data ?? []).reduce(
    (total, row) => total + row.position.claimableAmount,
    0n,
  );

  const act = async (row: UserPosition, type: "claim" | "refund") => {
    if (!address || tx.locked) return;
    if (wrongNetwork && !(await requestNetworkSwitch())) return;
    if (!beginClaimAction(address, row.position.marketId, type)) return;
    if (!tx.begin(type)) {
      releaseClaimAction(address, row.position.marketId, type);
      return;
    }
    const result =
      type === "claim"
        ? await contractAdapter.claim(row.position.marketId, address, tx.update)
        : await contractAdapter.claimRefund(row.position.marketId, address, tx.update);
    if (!result.ok) {
      releaseClaimAction(address, row.position.marketId, type);
      tx.fail(
        result.error ??
          mapForgeError(new Error("CLAIM_ACTION_FAILED"), type === "claim" ? "CLAIM" : "REFUND")
            .message,
        result.hash,
      );
      return;
    }
    if (result.confirmed !== true) {
      releaseClaimAction(address, row.position.marketId, type);
      tx.uncertain(result.hash);
      return;
    }
    if (!result.hash) {
      releaseClaimAction(address, row.position.marketId, type);
      tx.fail(
        mapForgeError(new Error("WRITE_SUBMISSION_FAILED: missing transaction hash"), "SUBMIT")
          .message,
      );
      return;
    }
    const acceptedTitle = type === "claim" ? "Claim accepted" : "Refund accepted";
    acceptClaimAction(address, row.position.marketId, type);
    tx.done(result.hash, acceptedTitle);
    void reconcileClaimFinalization({
      hash: result.hash,
      wallet: address,
      marketId: row.position.marketId,
      action: type,
      refresh,
    });
    await refresh(type === "claim" ? "claim" : "refund", row.position.marketId);
    const updatedPosition = await reconcileAcceptedWrite(
      result,
      () =>
        contractAdapter.getMyPosition(
          row.position.marketId,
          address,
          TransactionHashVariant.LATEST_NONFINAL,
        ),
      (position) => (type === "claim" ? !position.claimAvailable : !position.refundAvailable),
    );
    if (!updatedPosition) return;
    await refresh(type === "claim" ? "claim" : "refund", row.position.marketId);
    toast.success(`${type === "claim" ? "Claim" : "Refund"} accepted`);
  };

  if (!address)
    return (
      <>
        <div className="mx-auto max-w-[1400px] px-4 py-10 lg:px-6">
          <p className="forge-eyebrow">Wallet Portfolio</p>
          <h1 className="mt-3 text-4xl font-semibold text-foreground">Your Forge positions</h1>
          <div className="mt-10 flex flex-col items-center justify-center rounded-2xl border border-border bg-panel px-6 py-20 text-center">
            <Wallet className="h-8 w-8 text-ember" />
            <p className="mt-4 text-lg font-medium text-foreground">
              Connect your wallet to view your positions
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Positions, claims and history are tied to your connected GEN wallet.
            </p>
          </div>
        </div>
        <TransactionDialog state={tx.state} busy={tx.busy} onClose={tx.close} />
      </>
    );

  return (
    <>
      <div className="mx-auto max-w-[1400px] px-4 py-10 lg:px-6">
        <p className="forge-eyebrow">Wallet Portfolio</p>
        <h1 className="mt-3 text-4xl font-semibold text-foreground">Your Forge positions</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          Active positions, payouts and refunds waiting to be self-claimed, and settled market
          history.
        </p>
        {wrongNetwork && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
            <span>Switch to GenLayer StudioNext to use wallet actions.</span>
            <Button size="sm" variant="outline" onClick={requestNetworkSwitch} disabled={switching}>
              {switching ? "Switching…" : "Switch to StudioNext"}
            </Button>
          </div>
        )}
        {rows.isError && (
          <div className="mt-8 rounded-2xl border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive">
            {mapForgeError(rows.error, "READ_PORTFOLIO").message}
          </div>
        )}
        <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryCard label="Total Staked" value={`${formatGen(totalStaked)} GEN`} />
          <SummaryCard
            label="Claimable"
            value={`${formatGen(claimableAmount)} GEN`}
            accent="text-success"
          />
          <SummaryCard label="Active Positions" value={String(active.length)} />
          <SummaryCard label="Settled Positions" value={String(history.length)} />
        </div>
        <Tabs defaultValue="active" className="mt-8">
          <TabsList className="bg-panel-2">
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="claimable">Claimable</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
          <TabsContent value="active" className="mt-5">
            <PositionList
              rows={active}
              wallet={address}
              empty="No active positions right now."
              onAction={act}
            />
          </TabsContent>
          <TabsContent value="claimable" className="mt-5">
            <PositionList
              rows={claimableRows}
              wallet={address}
              empty={
                claimableQuery.isError
                  ? mapForgeError(claimableQuery.error, "READ_PORTFOLIO").message
                  : "Nothing to claim."
              }
              onAction={act}
            />
          </TabsContent>
          <TabsContent value="history" className="mt-5">
            <PositionList
              rows={history}
              wallet={address}
              empty="No settled positions yet."
              onAction={act}
            />
          </TabsContent>
        </Tabs>
        {count.data !== undefined && (
          <div className="mt-5 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Showing {all.length ? offset + 1 : 0}–{offset + all.length} of {count.data} indexed
              positions.
            </span>
            <span className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={offset === 0 || rows.isFetching}
                onClick={() => setOffset(Math.max(0, offset - 50))}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={offset + 50 >= count.data || rows.isFetching}
                onClick={() => setOffset(offset + 50)}
              >
                Next
              </Button>
            </span>
          </div>
        )}
      </div>
      <TransactionDialog state={tx.state} busy={tx.busy} onClose={tx.close} />
    </>
  );
}

function SummaryCard({
  label,
  value,
  accent = "text-foreground",
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-panel px-5 py-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`num mt-1 text-xl font-semibold ${accent}`}>{value}</p>
    </div>
  );
}

function PositionList({
  rows,
  wallet,
  empty,
  onAction,
}: {
  rows: UserPosition[];
  wallet: string;
  empty: string;
  onAction: (row: UserPosition, type: "claim" | "refund") => void;
}) {
  if (rows.length === 0)
    return <p className="py-12 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => {
        const { market, position } = row;
        const claimAccepted =
          position.alreadyClaimed || hasAcceptedClaimAction(wallet, position.marketId, "claim");
        const refundAccepted =
          position.refunded || hasAcceptedClaimAction(wallet, position.marketId, "refund");
        const claimFinalized = hasFinalizedClaimAction(wallet, position.marketId, "claim");
        const refundFinalized = hasFinalizedClaimAction(wallet, position.marketId, "refund");
        const action =
          !claimAccepted && !refundAccepted && position.claimAvailable
            ? "claim"
            : !claimAccepted && !refundAccepted && position.refundAvailable
              ? "refund"
              : null;
        const pending = action ? isClaimActionPending(wallet, position.marketId, action) : false;
        const result =
          claimFinalized || (claimAccepted && position.alreadyClaimed)
            ? "Claimed"
            : claimAccepted
              ? "Claim accepted · transfer finalizing"
              : refundFinalized || (refundAccepted && position.refunded)
                ? "Refunded"
                : refundAccepted
                  ? "Refund accepted · transfer finalizing"
                  : position.positionWon
                    ? `Won · ${formatGen(position.claimableAmount)} GEN`
                    : position.positionLost
                      ? "Lost"
                      : position.refundAvailable || position.refunded
                        ? "Refund"
                        : market.state === "SETTLEMENT_PENDING"
                          ? "Awaiting settlement"
                          : "—";
        return (
          <div
            key={position.marketId}
            className="flex flex-col gap-4 rounded-2xl border border-border bg-panel p-5 lg:flex-row lg:items-center"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Pill className="text-ember-soft">{position.category}</Pill>
                <StateBadge state={market.state} />
                <span className="num text-[11px] text-muted-foreground">#{position.marketId}</span>
              </div>
              <p className="num mt-2 text-sm text-foreground">
                {formatUtcWindow(market.startMs, market.endMs)} · {formatUtcDate(market.startMs)}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-6 text-sm lg:gap-10">
              <div>
                <p className="text-[11px] text-muted-foreground">Commodity</p>
                <p className="mt-0.5 text-foreground">{formatAsset(position.selectedAsset)}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Stake</p>
                <p className="num mt-0.5 text-foreground">{formatGen(position.totalStake)} GEN</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Result</p>
                <p
                  className={`mt-0.5 ${position.positionWon ? "text-success" : position.positionLost ? "text-muted-foreground" : "text-foreground"}`}
                >
                  {result}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              {action && (
                <Button
                  size="sm"
                  className="rounded-xl"
                  disabled={pending}
                  onClick={() => onAction(row, action)}
                >
                  {pending
                    ? action === "claim"
                      ? "Claiming…"
                      : "Refunding…"
                    : action === "claim"
                      ? "Claim winnings"
                      : "Claim refund"}
                </Button>
              )}
              <Button asChild size="sm" variant="outline" className="rounded-xl">
                <Link to="/market/$id" params={{ id: position.marketId }}>
                  View market
                </Link>
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
