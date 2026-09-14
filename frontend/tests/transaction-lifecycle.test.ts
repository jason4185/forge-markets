import { describe, expect, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { createClient } from "genlayer-js";
import {
  contractAdapter,
  estimateForgeWriteFees,
  usesConcreteWriteSimulation,
  waitForAcceptedExecution,
} from "../src/lib/forge/contractAdapter";
import { mapForgeError } from "../src/lib/forge/errors";
import { reconcileAcceptedWrite } from "../src/lib/forge/retry";
import { transactionStageCopy } from "../src/lib/forge/transactionState";
import { forgeChain } from "../src/lib/forge/constants";
import { MARKET_DETAIL_QUERY_OPTIONS } from "../src/lib/forge/useForge";

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

  test("uses one policy fee request for ordinary writes", async () => {
    let policyCalls = 0;
    let simulationCalls = 0;
    const estimate = { feeValue: 1n, distribution: {} } as never;
    const client = {
      estimateTransactionFees: async () => {
        policyCalls += 1;
        return estimate;
      },
      estimateTransactionFeesForWrite: async () => {
        simulationCalls += 1;
        return estimate;
      },
    } as never;

    await estimateForgeWriteFees(client, "settle_market", {} as never);

    expect(policyCalls).toBe(1);
    expect(simulationCalls).toBe(0);
    expect(usesConcreteWriteSimulation("settle_market")).toBe(false);
  });

  test("keeps one concrete fee request for transfer-message writes", async () => {
    let policyCalls = 0;
    let simulationCalls = 0;
    const estimate = { feeValue: 1n, distribution: {} } as never;
    const activeAccount = "0x0000000000000000000000000000000000000001";
    const client = {
      estimateTransactionFees: async () => {
        policyCalls += 1;
        return estimate;
      },
      estimateTransactionFeesForWrite: async (call: { account?: unknown }) => {
        simulationCalls += 1;
        expect(call.account).toEqual({ address: activeAccount, type: "json-rpc" });
        return estimate;
      },
    } as never;

    await estimateForgeWriteFees(client, "claim_refund", {
      account: activeAccount,
      address: activeAccount,
      functionName: "claim_refund",
      args: [],
      value: 0n,
    } as never);

    expect(policyCalls).toBe(0);
    expect(simulationCalls).toBe(1);
    expect(usesConcreteWriteSimulation("claim_refund")).toBe(true);
  });

  test("routes eth_sendTransaction to the wallet provider, not Studio RPC", async () => {
    const activeAccount = "0x0000000000000000000000000000000000000001" as const;
    const walletMethods: string[] = [];
    const rpcMethods: string[] = [];
    const walletProvider = {
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        walletMethods.push(method);
        expect((params?.[0] as { from?: string }).from?.toLowerCase()).toBe(activeAccount);
        return "0xwallet-hash";
      },
    };
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method?: string };
      rpcMethods.push(body.method ?? "unknown");
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const client = createClient({
        chain: forgeChain as never,
        account: activeAccount,
        provider: walletProvider as never,
      });
      const request = client.request as unknown as (request: {
        method: string;
        params?: unknown[];
      }) => Promise<unknown>;

      await expect(
        request({
          method: "eth_sendTransaction",
          params: [{ from: activeAccount, to: activeAccount, data: "0x" }],
        }),
      ).resolves.toBe("0xwallet-hash");

      expect(walletMethods).toEqual(["eth_sendTransaction"]);
      expect(rpcMethods).not.toContain("eth_sendTransaction");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("keeps the client transport address string while giving SDK writes an account object", async () => {
    const activeAccount = "0x0000000000000000000000000000000000000001" as const;
    const walletMethods: string[] = [];
    const rpcMethods: string[] = [];
    const walletProvider = {
      request: async ({ method }: { method: string }) => {
        walletMethods.push(method);
        if (method === "eth_sendTransaction") throw new Error("wallet boundary reached");
        throw new Error(`unexpected wallet method: ${method}`);
      },
    };
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method?: string };
      rpcMethods.push(body.method ?? "unknown");
      const result =
        body.method === "eth_getTransactionCount"
          ? "0x0"
          : body.method === "eth_estimateGas"
            ? "0x5208"
            : body.method === "eth_gasPrice"
              ? "0x1"
              : null;
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const client = createClient({
        chain: forgeChain as never,
        account: activeAccount,
        provider: walletProvider as never,
      });

      await expect(
        client.writeContract({
          account: { address: activeAccount, type: "json-rpc" },
          address: activeAccount,
          functionName: "create_market",
          args: ["METALS", 1n],
          value: 0n,
          fees: { distribution: {}, feeValue: 0n },
        } as never),
      ).rejects.toThrow("wallet boundary reached");

      expect(walletMethods).toEqual(["eth_sendTransaction"]);
      expect(rpcMethods).not.toContain("eth_sendTransaction");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("rejects a missing wallet account before provider submission", async () => {
    const providerMethods: string[] = [];
    const previousWindow = globalThis.window;
    globalThis.window = {
      ethereum: {
        request: async ({ method }: { method: string }) => {
          providerMethods.push(method);
          return method === "eth_chainId" ? "0xf22d" : undefined;
        },
      },
    } as never;

    try {
      const result = await contractAdapter.createMarket("METALS", 1n, undefined as never);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("Wallet account unavailable");
      expect(result.errorDetail).toContain("WALLET_ACCOUNT_UNAVAILABLE");
      expect(providerMethods).toEqual([]);
    } finally {
      if (previousWindow === undefined) Reflect.deleteProperty(globalThis, "window");
      else globalThis.window = previousWindow;
    }
  });

  test("refetches cached market detail on mount and replaces stale state", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const queryKey = ["forge", "market", "1", "LATEST_FINAL"] as const;
    queryClient.setQueryData(queryKey, { contractState: "OPEN", winner: null });
    let reads = 0;
    const observer = new QueryObserver(queryClient, {
      queryKey,
      queryFn: async () => {
        reads += 1;
        return { contractState: "SETTLED", winner: "SILVER" };
      },
      ...MARKET_DETAIL_QUERY_OPTIONS,
    });
    const states: unknown[] = [];
    const settled = new Promise<void>((resolve) => {
      const unsubscribe = observer.subscribe((result) => {
        states.push(result.data?.contractState);
        if (result.data?.contractState === "SETTLED") {
          unsubscribe();
          resolve();
        }
      });
    });

    await settled;
    expect(reads).toBe(1);
    expect(states).toContain("OPEN");
    expect(states).toContain("SETTLED");
    expect(observer.options.refetchOnMount).toBe("always");
    expect(observer.options.refetchOnWindowFocus).toBe(true);
    queryClient.clear();
  });
});
