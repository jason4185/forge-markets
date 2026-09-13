import { FORGE_NETWORK_NAME } from "./constants";

export type ForgeErrorContext =
  | "GENERAL"
  | "WALLET_CONNECT"
  | "NETWORK_SWITCH"
  | "READ_MARKET"
  | "READ_MARKETS"
  | "READ_CATEGORIES"
  | "READ_PORTFOLIO"
  | "READ_ACTIVITY"
  | "READ_SOURCE_EVIDENCE"
  | "BINANCE"
  | "FEE_ESTIMATE"
  | "SUBMIT"
  | "CREATE_MARKET"
  | "PLACE_BET"
  | "SETTLE"
  | "CLAIM"
  | "REFUND";

export type ForgeErrorAction = "retry" | "connect" | "switch-network";

export interface ForgeUserError {
  title: string;
  message: string;
  action?: ForgeErrorAction;
  severity: "error" | "warning" | "info";
  retryable: boolean;
}

type ErrorRecord = Record<string, unknown>;

function isRecord(value: unknown): value is ErrorRecord {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (isRecord(error) && typeof error["message"] === "string") return error["message"];
  return String(error);
}

function errorCode(error: unknown): number | string | undefined {
  if (!isRecord(error)) return undefined;
  const code = error["code"];
  if (typeof code === "number" || typeof code === "string") return code;
  return undefined;
}

function errorStatus(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  const status = error["status"] ?? error["statusCode"];
  return typeof status === "number" && Number.isSafeInteger(status) ? status : undefined;
}

function normalizedText(error: unknown): string {
  const parts: string[] = [errorMessage(error)];
  if (isRecord(error)) {
    for (const key of ["details", "shortMessage", "reason"]) {
      if (typeof error[key] === "string") parts.push(error[key] as string);
    }
    if (error["cause"] && error["cause"] !== error) parts.push(errorMessage(error["cause"]));
  }
  return parts.join(" ").toLowerCase();
}

function result(
  title: string,
  message: string,
  options: Partial<Pick<ForgeUserError, "action" | "severity" | "retryable">> = {},
): ForgeUserError {
  return { title, message, severity: "error", retryable: false, ...options };
}

export function transactionErrorContext(
  action: "create" | "bet" | "top_up" | "settle" | "claim" | "refund",
): ForgeErrorContext {
  switch (action) {
    case "create":
      return "CREATE_MARKET";
    case "bet":
    case "top_up":
      return "PLACE_BET";
    case "settle":
      return "SETTLE";
    case "claim":
      return "CLAIM";
    case "refund":
      return "REFUND";
  }
}

export function mapForgeError(
  error: unknown,
  context: ForgeErrorContext = "GENERAL",
): ForgeUserError {
  const text = normalizedText(error);
  const code = errorCode(error);
  const status = errorStatus(error);
  const isRejected =
    code === 4001 ||
    /user rejected|user denied|request rejected|denied|cancelled|canceled/.test(text);

  if (context === "BINANCE")
    return result(
      "Live performance data unavailable",
      "Live performance data is temporarily unavailable. Market and betting data are still available.",
      { action: "retry", severity: "warning", retryable: true },
    );

  if (context === "NETWORK_SWITCH") {
    if (isRejected)
      return result(
        "Network switch cancelled",
        "Your wallet stayed on the current network. Switch to StudioNext when you’re ready to continue.",
      );
    if (
      /no injected wallet|no_injected_provider|install or enable an injected wallet|no wallet detected/.test(
        text,
      )
    )
      return result(
        "No wallet detected",
        "Install or enable an injected wallet extension, then refresh Forge.",
        { action: "connect" },
      );
    if (/timed out|timeout/.test(text))
      return result(
        "Network switch timed out",
        "Your wallet did not finish switching networks. Please try again.",
        { action: "switch-network", retryable: true },
      );
  }

  if (context === "FEE_ESTIMATE")
    return result(
      "Couldn’t prepare transaction",
      "Forge couldn’t prepare this transaction right now. Please try again in a moment.",
      { action: "retry", retryable: true },
    );
  if (context === "SUBMIT")
    return result(
      "Couldn’t submit transaction",
      "Your transaction wasn’t submitted. Check your wallet connection and try again.",
      { action: "retry", retryable: true },
    );
  if (
    /no injected wallet|no_injected_provider|install or enable an injected wallet|no wallet detected/.test(
      text,
    )
  )
    return result(
      "No wallet detected",
      "Install or enable an injected wallet extension, then refresh Forge.",
      { action: "connect" },
    );

  if (isRejected) {
    if (context === "WALLET_CONNECT")
      return result(
        "Request cancelled",
        "You cancelled the request in your wallet. Nothing was submitted.",
      );
    return result(
      "Transaction cancelled",
      "You cancelled the transaction in your wallet. No transaction was submitted.",
    );
  }

  if (context === "WALLET_CONNECT")
    return result(
      "Couldn’t connect wallet",
      "Your wallet could not connect to Forge. Please try again.",
      { action: "connect", retryable: true },
    );

  if (
    /wrong network|switch.*studionext|forge runs on .*studionext|switch your wallet to continue|unsupported chain|chain id/.test(
      text,
    )
  )
    return result(
      "Wrong network",
      `Forge runs on ${FORGE_NETWORK_NAME}. Switch your wallet to continue.`,
      { action: "switch-network" },
    );

  if (
    status === 429 ||
    code === 429 ||
    code === "429" ||
    /rate limit|too many requests|http 429/.test(text)
  )
    return result(
      "Forge is temporarily busy",
      "Market data is refreshing too quickly right now. Please wait a moment and try again.",
      { action: "retry", severity: "warning", retryable: true },
    );

  if (
    status === 502 ||
    /bad gateway|502|unexpected token <|not valid json|malformed json|failed to fetch|network service/.test(
      text,
    )
  )
    return result(
      "Forge is temporarily unavailable",
      "The network service is having trouble responding. Please try again shortly.",
      { action: "retry", severity: "warning", retryable: true },
    );

  if (/invalid market id|invalid market link/.test(text))
    return result("Invalid market", "The market link is not valid.");

  if (
    /precheck_failed|wallet_connect_failed|fee_estimate_failed|estimate.*fee|fee estimation/.test(
      text,
    )
  )
    return result(
      "Couldn’t prepare transaction",
      "Forge couldn’t prepare this transaction right now. Please try again in a moment.",
      { action: "retry", retryable: true },
    );
  if (/couldn.t prepare transaction|preparation failed/.test(text))
    return result(
      "Couldn’t prepare transaction",
      "Forge couldn’t prepare this transaction right now. Please try again in a moment.",
      { action: "retry", retryable: true },
    );

  if (/write_submission_failed|submission failed|could not submit/.test(text))
    return result(
      "Couldn’t submit transaction",
      "Your transaction wasn’t submitted. Check your wallet connection and try again.",
      { action: "retry", retryable: true },
    );
  if (/couldn.t submit transaction|your transaction wasn.t submitted/.test(text))
    return result(
      "Couldn’t submit transaction",
      "Your transaction wasn’t submitted. Check your wallet connection and try again.",
      { action: "retry", retryable: true },
    );

  if (/minimum bet|minimum stake|at least 1 gen/.test(text))
    return result("Minimum stake is 1 GEN", "Enter at least 1 GEN to place a position.");
  if (/insufficient funds|insufficient balance|not enough gen/.test(text))
    return result("Not enough GEN", "Your wallet does not have enough GEN for this transaction.");
  if (/cumulative|maximum position|exceed.*50 gen|50 gen/.test(text))
    return result("Maximum position reached", "You can stake up to 50 GEN total in this market.");
  if (
    /different outcome|side switch|another commodity|one side|only add to your existing position/.test(
      text,
    )
  )
    return result(
      "You already chose another commodity",
      "You can only add to your existing position in this market.",
    );
  if (
    /betting closed|betting is closed|no longer accepting positions|this market is no longer accepting positions|market.*not open/.test(
      text,
    )
  )
    return result("Betting is closed", "This market is no longer accepting positions.");
  if (
    /invalid market asset|invalid asset|invalid outcome|unknown asset|that commodity isn.t available/.test(
      text,
    )
  )
    return result("Commodity unavailable", "That commodity isn’t available in this market.");
  if (
    /market already exists|duplicate market|a market for this category and start time already exists/.test(
      text,
    )
  )
    return result(
      "Market already exists",
      "A market for this category and start time already exists.",
    );
  if (/invalid category|unsupported category/.test(text))
    return result("Category unavailable", "Choose one of the supported Forge market categories.");
  if (
    /market start|utc hour|future.*start|invalid.*time|markets must start on an exact future utc hour/.test(
      text,
    ) &&
    context === "CREATE_MARKET"
  )
    return result("Choose a valid start time", "Markets must start on an exact future UTC hour.");
  if (/refund already claimed|already refunded|this stake has already been refunded/.test(text))
    return result("Already refunded", "This stake has already been refunded.");
  if (/payout already claimed|already claimed|this payout has already been claimed/.test(text))
    return result("Already claimed", "This payout has already been claimed.");
  if (
    /not a winning bettor|not winning|this position is not eligible for a winnings claim/.test(text)
  )
    return result("Position did not win", "This position is not eligible for a winnings claim.");
  if (/not refundable|not inconclusive|this market is not refundable/.test(text))
    return result("Refund unavailable", "This market is not refundable.");
  if (
    /market has not expired|not expired|before.*market.*end|settlement.*not.*available|this market can be settled after the 1-hour performance window ends/.test(
      text,
    )
  )
    return result(
      "Settlement isn’t available yet",
      "This market can be settled after the 1-hour performance window ends.",
    );
  if (/market(?:\s+id)?\b.*(?:not found|does not exist)|no such market/.test(text))
    return result("Market not found", "This Forge market doesn’t exist or is no longer available.");

  if (
    /finished_with_error|transaction_execution_failed|execution failed|transaction was submitted, but forge could not complete the action/.test(
      text,
    ) &&
    !context.startsWith("READ_")
  )
    return result(
      "Transaction unsuccessful",
      "The transaction was submitted, but Forge could not complete the action.",
    );

  if (context === "READ_MARKET" || context === "READ_MARKETS")
    return result(
      "Market data temporarily unavailable",
      "Forge couldn’t load the latest market data. Please try again in a moment.",
      { action: "retry", severity: "warning", retryable: true },
    );
  if (context === "READ_PORTFOLIO")
    return result(
      "Couldn’t load positions",
      "We couldn’t load your positions right now. Please try again.",
      { action: "retry", retryable: true },
    );
  if (context === "READ_ACTIVITY")
    return result("Activity unavailable", "Activity is temporarily unavailable.", {
      action: "retry",
      severity: "warning",
      retryable: true,
    });
  if (context === "READ_SOURCE_EVIDENCE")
    return result(
      "Settlement data temporarily unavailable",
      "Forge couldn’t load the latest settlement evidence. Please try again shortly.",
      { action: "retry", severity: "warning", retryable: true },
    );
  if (context === "READ_CATEGORIES")
    return result(
      "Categories temporarily unavailable",
      "Forge couldn’t load the supported categories. Please try again.",
      { action: "retry", severity: "warning", retryable: true },
    );

  if (context === "CREATE_MARKET")
    return result(
      "Couldn’t create market",
      "Forge couldn’t create this market. Please try again.",
      {
        action: "retry",
        retryable: true,
      },
    );
  if (context === "PLACE_BET")
    return result(
      "Couldn’t place position",
      "Forge couldn’t place this position. Please try again.",
      {
        action: "retry",
        retryable: true,
      },
    );
  if (context === "SETTLE")
    return result(
      "Couldn’t settle market",
      "Forge couldn’t complete settlement. Please try again.",
      {
        action: "retry",
        retryable: true,
      },
    );
  if (context === "CLAIM")
    return result(
      "Couldn’t claim winnings",
      "Forge couldn’t complete your claim. Please try again.",
      {
        action: "retry",
        retryable: true,
      },
    );
  if (context === "REFUND")
    return result(
      "Couldn’t claim refund",
      "Forge couldn’t complete your refund. Please try again.",
      {
        action: "retry",
        retryable: true,
      },
    );

  return result("Forge couldn’t load this page", "Refresh the page and try again.", {
    action: "retry",
    retryable: true,
  });
}

export function logForgeError(
  error: unknown,
  context: ForgeErrorContext,
  transactionHash?: string,
) {
  if (!import.meta.env.DEV) return;
  const details: Record<string, unknown> = {
    context,
    stage: context,
    name: error instanceof Error ? error.name : undefined,
    message: errorMessage(error),
    code: isRecord(error) ? error["code"] : undefined,
    details: isRecord(error) ? error["details"] : undefined,
    cause: isRecord(error) ? error["cause"] : undefined,
    transactionHash,
  };
  console.error("[FORGE ERROR]", details);
}
