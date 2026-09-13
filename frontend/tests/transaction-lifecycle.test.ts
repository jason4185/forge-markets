import { describe, expect, test } from "bun:test";
import { waitForAcceptedExecution } from "../src/lib/forge/contractAdapter";
import { mapForgeError } from "../src/lib/forge/errors";
import { reconcileAcceptedWrite } from "../src/lib/forge/retry";
import { transactionStageCopy } from "../src/lib/forge/transactionState";

function receipt(statusName: string, txExecutionResultName = "FINISHED_WITH_RETURN") {
  return { statusName, txExecutionResultName } as never;
}

function clientReturning(value: unknown) {
  return { waitForDecision: async () => value };
}

describe("Forge transaction lifecycle", () => {
  test.each(["ACCEPTED", "FINALIZED"])(
    "%s with FINISHED_WITH_RETURN is successful",
    async (statusName) => {
      const stages: string[] = [];
      const result = await waitForAcceptedExecution({
        client: clientReturning(receipt(statusName)),
        hash: "0xhash",
        onStage: (stage) => stages.push(stage),
        maxAttempts: 1,
      });

      expect(result.confirmed).toBe(true);
      expect(result.status).toBe(statusName);
      expect(stages).toEqual(["SUCCESS"]);
    },
  );

  test.each(["UNDETERMINED", "VALIDATORS_TIMEOUT", "LEADER_TIMEOUT"])(
    "%s preserves the submitted transaction as uncertain",
    async (statusName) => {
      const result = await waitForAcceptedExecution({
        client: clientReturning(receipt(statusName, "NOT_VOTED")),
        hash: "0xhash",
        maxAttempts: 1,
      });

      expect(result.confirmed).toBe(false);
      expect(result.status).toBe(statusName);
      expect(mapForgeError(new Error(`TRANSACTION_${statusName}`), "SETTLE").title).toBe(
        "Still confirming transaction",
      );
    },
  );

  test("decision timeout is bounded and remains uncertain", async () => {
    let calls = 0;
    const waits: number[] = [];
    const result = await waitForAcceptedExecution({
      client: {
        waitForDecision: async () => {
          calls += 1;
          throw new Error("transaction not found yet");
        },
      },
      hash: "0xhash",
      maxAttempts: 3,
      pollIntervalMs: 2_000,
      wait: async (delayMs) => waits.push(delayMs),
    });

    expect(result.confirmed).toBe(false);
    expect(calls).toBe(3);
    expect(waits).toEqual([2_000, 2_000]);
  });

  test("accepted write stays successful when reconciliation cannot read yet", async () => {
    const result = await reconcileAcceptedWrite(
      { ok: true, confirmed: true },
      async () => {
        throw Object.assign(new Error("HTTP 429"), { status: 429 });
      },
      () => true,
      { attempts: 2, delayMs: 0 },
    );

    expect(result).toBeUndefined();
  });

  test("keeps stage-specific user error categories", () => {
    expect(mapForgeError(new Error("WRITE_SUBMISSION_FAILED: rejected"), "SETTLE").title).toBe(
      "Couldn’t submit transaction",
    );
    expect(mapForgeError(new Error("FEE_ESTIMATE_FAILED: HTTP 429"), "SETTLE").title).toBe(
      "Forge is temporarily busy",
    );
    expect(
      mapForgeError(Object.assign(new Error("User rejected"), { code: 4001 }), "SETTLE").title,
    ).toBe("Transaction cancelled");
    expect(mapForgeError(new Error("TRANSACTION_CANCELED"), "SETTLE").title).toBe(
      "Market resolution failed",
    );
    expect(mapForgeError(new Error("wrong network"), "SETTLE").title).toBe("Wrong network");
    expect(mapForgeError(new Error("FINISHED_WITH_ERROR"), "SETTLE").title).toBe(
      "Market resolution failed",
    );
    expect(mapForgeError(new Error("provider unavailable"), "SETTLE").title).toBe(
      "Couldn’t prepare transaction",
    );
    expect(
      mapForgeError(
        Object.assign(new Error("unexpected decision read error"), {
          transactionHash: "0xhash",
        }),
        "SETTLE",
      ).title,
    ).toBe("Still confirming transaction");
  });

  test("treats a successful pending settlement as a completed attempt", () => {
    const copy = transactionStageCopy({
      open: true,
      stage: "DONE",
      action: "settle",
      message: "Settlement attempt completed",
    });

    expect(copy.title).toBe("Settlement attempt completed");
    expect(copy.message).toContain("No 2-of-3 source consensus yet");
  });
});
