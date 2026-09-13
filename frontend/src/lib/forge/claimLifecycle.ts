import { TransactionHashVariant } from "genlayer-js/types";
import { contractAdapter } from "./contractAdapter";
import { finalizeClaimAction, type ClaimAction } from "./claimActionState";
import { retryRead } from "./retry";

export async function reconcileClaimFinalization({
  hash,
  wallet,
  marketId,
  action,
  refresh,
}: {
  hash: string;
  wallet: string;
  marketId: string;
  action: ClaimAction;
  refresh: (kind: "claim" | "refund", marketId: string) => Promise<void>;
}) {
  try {
    const finalized = await contractAdapter.waitForFinalization(hash);
    if (!finalized) return;
    const finalPosition = await retryRead(
      () => contractAdapter.getMyPosition(marketId, wallet, TransactionHashVariant.LATEST_FINAL),
      (position) => (action === "claim" ? position.alreadyClaimed : position.refunded),
      { attempts: 5, delayMs: 2_000 },
    );
    if (!finalPosition) return;
    finalizeClaimAction(wallet, marketId, action);
    await refresh(action, marketId);
  } catch {
    // Accepted action state remains locked if finalization or a durable read is delayed.
  }
}
