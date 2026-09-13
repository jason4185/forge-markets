import { AlertCircle, CheckCircle2, LoaderCircle, RefreshCw, WalletCards } from "lucide-react";
import { useCallback, useRef, useState, type ReactNode } from "react";
import type { TransactionStage } from "@/lib/forge/contractAdapter";
import {
  isTransactionBusy,
  isTransactionLocked,
  transactionStageCopy,
  type TransactionAction,
  type TransactionDialogStage,
  type TransactionDialogState,
} from "@/lib/forge/transactionState";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

function StageIcon({ stage }: { stage: TransactionDialogStage }) {
  if (stage === "SUCCESS" || stage === "DONE")
    return <CheckCircle2 className="size-6 text-success" />;
  if (stage === "ERROR" || stage === "UNCERTAIN")
    return <AlertCircle className="size-6 text-destructive" />;
  if (stage === "RECONCILING") return <RefreshCw className="size-6 text-ember" />;
  if (stage === "AWAITING_SIGNATURE") return <WalletCards className="size-6 text-ember" />;
  return <LoaderCircle className="size-6 animate-spin text-ember" />;
}

export function useTransactionDialog() {
  const [state, setState] = useState<TransactionDialogState>({
    open: false,
    stage: "IDLE",
    action: "bet",
  });
  const activeWrite = useRef(false);
  const begin = useCallback((action: TransactionAction) => {
    if (activeWrite.current) return false;
    activeWrite.current = true;
    setState({ open: true, stage: "AWAITING_SIGNATURE", action });
    return true;
  }, []);
  const update = useCallback(
    (stage: TransactionStage) =>
      setState((current) => ({ ...current, open: true, stage, error: undefined })),
    [],
  );
  const success = useCallback((hash?: string, message?: string) => {
    setState((current) => ({
      ...current,
      open: true,
      stage: "SUCCESS",
      hash: hash ?? current.hash,
      message,
      error: undefined,
    }));
  }, []);
  const done = useCallback((hash?: string, message?: string) => {
    activeWrite.current = false;
    setState((current) => ({
      ...current,
      open: true,
      stage: "DONE",
      hash: hash ?? current.hash,
      message,
      error: undefined,
    }));
  }, []);
  const reconcile = useCallback(
    (message: string) =>
      setState((current) => ({
        ...current,
        open: true,
        stage: "RECONCILING",
        message,
        error: undefined,
      })),
    [],
  );
  const uncertain = useCallback((hash?: string) => {
    activeWrite.current = false;
    setState((current) => ({
      ...current,
      open: true,
      stage: "UNCERTAIN",
      hash: hash ?? current.hash,
      error: undefined,
      message: undefined,
    }));
  }, []);
  const fail = useCallback((error: string) => {
    activeWrite.current = false;
    setState((current) => ({ ...current, open: true, stage: "ERROR", error, message: undefined }));
  }, []);
  const close = useCallback(
    () =>
      setState((current) =>
        current.stage === "DONE"
          ? { open: false, stage: "IDLE", action: current.action }
          : { ...current, open: false },
      ),
    [],
  );
  return {
    state,
    busy: isTransactionBusy(state.stage),
    locked: isTransactionLocked(state.stage),
    begin,
    update,
    success,
    done,
    reconcile,
    uncertain,
    fail,
    close,
  };
}

export function TransactionDialog({
  state,
  busy,
  onClose,
  footer,
}: {
  state: TransactionDialogState;
  busy: boolean;
  onClose: () => void;
  footer?: ReactNode;
}) {
  const copy = transactionStageCopy(state);
  const processing = state.stage === "SUBMITTED" || state.stage === "PROCESSING";
  return (
    <Dialog
      open={state.open}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="w-[calc(100%-2rem)] max-w-md border-border bg-popover shadow-2xl sm:rounded-xl">
        <DialogHeader>
          <div
            className={cn(
              "mx-auto grid size-12 place-items-center rounded-xl",
              state.stage === "SUCCESS" || state.stage === "DONE"
                ? "bg-success/10"
                : state.stage === "ERROR" || state.stage === "UNCERTAIN"
                  ? "bg-destructive/10"
                  : "bg-ember/10",
            )}
          >
            <StageIcon stage={state.stage} />
          </div>
          <DialogTitle className="pt-1 text-center text-lg text-foreground">
            {copy.title}
          </DialogTitle>
          <DialogDescription className="text-center text-sm leading-relaxed">
            {copy.message}
          </DialogDescription>
        </DialogHeader>
        {processing && (
          <div className="rounded-lg border border-border bg-panel-2 px-3 py-2.5 text-center text-[11px] text-muted-foreground">
            Waiting for ACCEPTED with a finished GenLayer execution result.
          </div>
        )}
        {state.stage === "RECONCILING" && (
          <div className="rounded-lg border border-ember/25 bg-ember/10 px-3 py-2.5 text-center text-[11px] text-ember-soft">
            {state.message ?? "Updating state..."}
          </div>
        )}
        {state.hash && (
          <div className="rounded-lg border border-border bg-panel-2 px-3 py-2.5 text-center text-[11px] text-muted-foreground">
            Transaction hash: <span className="break-all font-mono">{state.hash}</span>
          </div>
        )}
        {state.stage === "ERROR" && (
          <p className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">
            {copy.message}
          </p>
        )}
        {footer ?? (
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-10 w-full rounded-lg border border-border bg-panel-2 text-xs font-semibold text-foreground transition-colors hover:border-ember/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {state.stage === "ERROR" ? "Close and try again" : "Close"}
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
}
