import { useSyncExternalStore } from "react";

export type ClaimAction = "claim" | "refund";

const pendingActions = new Set<string>();
const acceptedActions = new Set<string>();
const finalizedActions = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function actionKey(wallet: string, marketId: string, action: ClaimAction) {
  return `${wallet.toLowerCase()}:${marketId}:${action}`;
}

function notify() {
  version += 1;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function beginClaimAction(wallet: string, marketId: string, action: ClaimAction): boolean {
  const key = actionKey(wallet, marketId, action);
  if (acceptedActions.has(key) || pendingActions.has(key)) return false;
  pendingActions.add(key);
  notify();
  return true;
}

export function releaseClaimAction(wallet: string, marketId: string, action: ClaimAction) {
  if (pendingActions.delete(actionKey(wallet, marketId, action))) notify();
}

export function acceptClaimAction(wallet: string, marketId: string, action: ClaimAction) {
  const key = actionKey(wallet, marketId, action);
  pendingActions.delete(key);
  acceptedActions.add(key);
  notify();
}

export function finalizeClaimAction(wallet: string, marketId: string, action: ClaimAction) {
  const key = actionKey(wallet, marketId, action);
  acceptedActions.add(key);
  finalizedActions.add(key);
  notify();
}

export function hasAcceptedClaimAction(
  wallet: string | undefined,
  marketId: string,
  action: ClaimAction,
) {
  return Boolean(wallet && acceptedActions.has(actionKey(wallet, marketId, action)));
}

export function isClaimActionPending(
  wallet: string | undefined,
  marketId: string,
  action: ClaimAction,
) {
  return Boolean(wallet && pendingActions.has(actionKey(wallet, marketId, action)));
}

export function hasFinalizedClaimAction(
  wallet: string | undefined,
  marketId: string,
  action: ClaimAction,
) {
  return Boolean(wallet && finalizedActions.has(actionKey(wallet, marketId, action)));
}

export function useClaimActionState(
  wallet: string | undefined,
  marketId: string,
  action: ClaimAction,
) {
  const key = wallet ? actionKey(wallet, marketId, action) : undefined;
  useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );
  return {
    pending: Boolean(key && pendingActions.has(key)),
    accepted: Boolean(key && acceptedActions.has(key)),
    finalized: Boolean(key && finalizedActions.has(key)),
  };
}

export function useClaimActionLocksVersion() {
  return useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );
}
