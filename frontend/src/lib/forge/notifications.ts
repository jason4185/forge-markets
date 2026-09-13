import { useMemo } from "react";
import { useForgeMyActivity, useForgeMyPositions } from "./useForge";
import { hasAcceptedClaimAction, useClaimActionLocksVersion } from "./claimActionState";
import { formatAsset, formatGen } from "./format";
import type { ForgeNotification } from "./types";

export function useForgeNotifications(wallet?: string) {
  const positions = useForgeMyPositions(Date.now(), wallet, 0, 50);
  const activity = useForgeMyActivity(wallet, 0, 50);
  useClaimActionLocksVersion();

  const items = useMemo<ForgeNotification[]>(() => {
    if (!wallet) return [];
    const activityItems: ForgeNotification[] = (activity.data ?? []).map((record) => ({
      id: `activity:${record.id}`,
      kind: record.type,
      title:
        record.type === "BET_PLACED"
          ? `Position opened — ${formatAsset(record.asset)}`
          : record.type === "BET_TOPPED_UP"
            ? `Position topped up — ${formatAsset(record.asset)}`
            : record.type === "PAYOUT_CLAIMED"
              ? "Payout claim accepted"
              : "Refund claim accepted",
      description: `${record.type === "PAYOUT_CLAIMED" ? "Claim accepted" : record.type === "REFUND_CLAIMED" ? "Refund accepted" : record.type === "BET_TOPPED_UP" ? "Added" : "Staked"} ${formatGen(record.amount)} GEN on market ${record.marketId}.`,
      marketId: record.marketId,
      category: record.category,
      asset: record.asset,
      amount: record.amount,
      timestampMs: record.timestampMs,
      action: "view",
    }));
    const derived: ForgeNotification[] = [];
    for (const entry of positions.isError ? [] : (positions.data ?? [])) {
      const { position, market } = entry;
      const timestampMs = market.endMs;
      if (position.marketState === "SETTLED" && position.positionWon) {
        const accepted = hasAcceptedClaimAction(wallet, market.id, "claim");
        derived.push({
          id: `won:${market.id}`,
          kind: "MARKET_SETTLED_WON",
          title: "Market settled — you won",
          description: accepted
            ? "Your claim was accepted. The GEN transfer completes with GenLayer finalization."
            : `${formatAsset(market.winner)} led ${market.category}.${position.claimAvailable ? ` ${formatGen(position.claimableAmount)} GEN ready to claim.` : " Claim already accepted."}`,
          marketId: market.id,
          category: market.category,
          asset: market.winner,
          amount: position.claimableAmount,
          timestampMs,
          action: position.claimAvailable && !accepted ? "claim" : "view",
        });
      } else if (position.marketState === "SETTLED" && position.positionLost) {
        derived.push({
          id: `lost:${market.id}`,
          kind: "MARKET_SETTLED_LOST",
          title: "Market settled — position lost",
          description: `${formatAsset(market.winner)} led this ${market.category} market.`,
          marketId: market.id,
          category: market.category,
          asset: position.selectedAsset,
          timestampMs,
          action: "view",
        });
      } else if (position.marketState === "INCONCLUSIVE" && position.refundAvailable) {
        const accepted = hasAcceptedClaimAction(wallet, market.id, "refund");
        derived.push({
          id: `refund:${market.id}`,
          kind: "REFUND_AVAILABLE",
          title: "Refund available",
          description: accepted
            ? "Your refund was accepted. The GEN transfer completes with GenLayer finalization."
            : `${formatGen(position.claimableAmount)} GEN is available to reclaim from this inconclusive market.`,
          marketId: market.id,
          category: market.category,
          asset: position.selectedAsset,
          amount: position.claimableAmount,
          timestampMs,
          action: accepted ? "view" : "refund",
        });
      } else if (market.state === "SETTLEMENT_PENDING") {
        derived.push({
          id: `pending:${market.id}`,
          kind: "SETTLEMENT_PENDING",
          title: "Settlement pending",
          description: `Forge can retry source consensus until ${new Date(Number(market.settlementDeadlineSeconds) * 1000).toISOString().slice(11, 16)} UTC.`,
          marketId: market.id,
          category: market.category,
          asset: position.selectedAsset,
          timestampMs,
          action: "view",
        });
      }
    }
    return [...activityItems, ...derived]
      .sort((a, b) => b.timestampMs - a.timestampMs)
      .slice(0, 50);
  }, [activity.data, positions.data, positions.isError, wallet]);

  const actionableCount = items.filter(
    (item) => item.action === "claim" || item.action === "refund",
  ).length;
  return {
    items,
    actionableCount,
    isLoading: Boolean(wallet) && (activity.isLoading || positions.isLoading),
    isError: Boolean(wallet) && (activity.isError || positions.isError),
  };
}
