import { describe, expect, test } from "bun:test";
import { forgeTechnicalDetail, mapForgeError } from "../src/lib/forge/errors";

describe("create_market pre-submit diagnostics", () => {
  test.each([
    [
      "provider acquisition",
      "PRECHECK_FAILED: t.getProvider is not a function",
      "Couldn’t prepare transaction",
    ],
    ["fee preparation", "FEE_ESTIMATE_FAILED: execution failed", "Couldn’t prepare transaction"],
    [
      "writeContract",
      "WRITE_SUBMISSION_FAILED: wallet rejected the request",
      "Couldn’t submit transaction",
    ],
  ])("keeps %s distinct from the generic stage", (_stage, message, title) => {
    expect(mapForgeError(new Error(message), "CREATE_MARKET").title).toBe(title);
  });

  test("keeps the original exception available as technical detail", () => {
    const original = Object.assign(new TypeError("t.getProvider is not a function"), { code: -1 });
    const wrapped = new Error("WRITE_SUBMISSION_FAILED: t.getProvider is not a function", {
      cause: original,
    });

    expect(forgeTechnicalDetail(wrapped)).toContain("t.getProvider is not a function");
    expect(forgeTechnicalDetail(wrapped)).toContain("cause:");
    expect(mapForgeError(wrapped, "CREATE_MARKET").message).toBe(
      "Your transaction wasn’t submitted. Check your wallet connection and try again.",
    );
  });
});
