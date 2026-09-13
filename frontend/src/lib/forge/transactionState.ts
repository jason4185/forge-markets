import type { TransactionStage } from "./contractAdapter";
import { mapForgeError, transactionErrorContext } from "./errors";

export type TransactionAction = "create" | "bet" | "top_up" | "settle" | "claim" | "refund";
export type TransactionDialogStage = "IDLE" | TransactionStage | "RECONCILING" | "DONE" | "ERROR";

export interface TransactionDialogState {
  open: boolean;
  stage: TransactionDialogStage;
  action: TransactionAction;
  hash?: string | undefined;
  error?: string | undefined;
  message?: string | undefined;
}

const ACTION_LABEL: Record<TransactionAction, string> = {
  create: "market creation",
  bet: "your bet",
  top_up: "your top-up",
  settle: "market settlement",
  claim: "your winnings claim",
  refund: "your refund claim",
};

export function transactionStageCopy(state: TransactionDialogState) {
  if (state.stage === "AWAITING_SIGNATURE")
    return { title: "Awaiting wallet", message: "Confirm this transaction in your wallet." };
  if (state.stage === "SUBMITTED")
    return { title: "Transaction submitted", message: "Transaction submitted to GenLayer." };
  if (state.stage === "PROCESSING")
    return { title: "Waiting for ACCEPTED", message: "Waiting for GenLayer acceptance..." };
  if (state.stage === "RECONCILING")
    return { title: "Transaction accepted", message: state.message ?? "Updating Forge state..." };
  if (state.stage === "SUCCESS" || state.stage === "DONE")
    return {
      title: state.message ?? "Transaction accepted",
      message:
        state.action === "refund"
          ? "Your refund was accepted. The GEN transfer completes with GenLayer finalization."
          : state.action === "claim"
            ? "Your claim was accepted. The GEN transfer completes with GenLayer finalization."
            : "The contract execution finished successfully.",
    };
  if (state.stage === "UNCERTAIN")
    return {
      title: "Still confirming transaction",
      message:
        "Forge couldn’t confirm the final transaction status yet. Your transaction may still be processing.",
    };
  if (state.stage === "ERROR") {
    return mapForgeError(
      state.error ?? new Error("Forge transaction could not be completed."),
      transactionErrorContext(state.action),
    );
  }
  return { title: ACTION_LABEL[state.action], message: "" };
}

export function isTransactionBusy(stage: TransactionDialogStage) {
  return stage === "AWAITING_SIGNATURE" || stage === "SUBMITTED" || stage === "PROCESSING";
}

export function isTransactionLocked(stage: TransactionDialogStage) {
  return (
    isTransactionBusy(stage) ||
    stage === "RECONCILING" ||
    stage === "SUCCESS" ||
    stage === "DONE" ||
    stage === "UNCERTAIN"
  );
}
