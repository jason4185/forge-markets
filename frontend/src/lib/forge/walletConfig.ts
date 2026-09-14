import {
  FORGE_CHAIN_ID,
  FORGE_CHAIN_ID_HEX,
  FORGE_NATIVE_CURRENCY,
  FORGE_NETWORK_NAME,
  FORGE_RPC_URL,
} from "./constants";
import { logForgeWriteDebug } from "./errors";

type ProviderError = { code?: unknown; message?: unknown };

type ForgeInjectedProvider = NonNullable<Window["ethereum"]>;

type ProviderCandidate = ForgeInjectedProvider & {
  isRabby?: boolean;
  isMetaMask?: boolean;
  providers?: readonly ForgeInjectedProvider[];
};

function isInjectedProvider(value: unknown): value is ForgeInjectedProvider {
  return Boolean(
    value &&
    typeof value === "object" &&
    "request" in value &&
    typeof (value as { request?: unknown }).request === "function",
  );
}

function injectedProvider(): ForgeInjectedProvider | undefined {
  if (typeof window === "undefined") return undefined;
  const candidate = window.ethereum as ProviderCandidate | undefined;
  if (!candidate) return undefined;
  if (Array.isArray(candidate.providers)) {
    const providers = candidate.providers.filter(isInjectedProvider);
    return providers.find((provider) => (provider as ProviderCandidate).isRabby) ?? providers[0];
  }
  return isInjectedProvider(candidate) ? candidate : undefined;
}

function devNetworkLog(message: string, details?: Record<string, unknown>) {
  if (import.meta.env.DEV) console.debug(message, details ?? "");
}

function errorDetails(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== "object") return { message: String(error) };
  const candidate = error as ProviderError & {
    name?: unknown;
    details?: unknown;
    cause?: unknown;
  };
  const cause = candidate.cause;
  return {
    name: typeof candidate.name === "string" ? candidate.name : undefined,
    message: typeof candidate.message === "string" ? candidate.message : String(error),
    code: candidate.code,
    details: candidate.details,
    cause:
      cause && typeof cause === "object" && "message" in cause
        ? (cause as { message?: unknown }).message
        : cause,
  };
}

function providerErrorCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as ProviderError).code;
  if (typeof code === "number" && Number.isSafeInteger(code)) return code;
  if (typeof code === "string" && /^\d+$/.test(code)) return Number(code);
  return undefined;
}

function parseProviderChainId(value: unknown): number {
  if (typeof value !== "string" && typeof value !== "number")
    throw new Error("Wallet returned an invalid chain ID.");
  const parsed =
    typeof value === "string" ? Number.parseInt(value, /^0x/i.test(value) ? 16 : 10) : value;
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new Error("Wallet returned an invalid chain ID.");
  return parsed;
}

export async function getActiveInjectedProvider(
  options: { diagnostic?: boolean } = {},
): Promise<ForgeInjectedProvider | undefined> {
  const activeProvider = injectedProvider();
  if (options.diagnostic) {
    const providerRecord = activeProvider as ProviderCandidate | undefined;
    logForgeWriteDebug("provider acquisition result", {
      providerPresent: Boolean(activeProvider),
      hasRequest: Boolean(activeProvider && typeof activeProvider.request === "function"),
      providerType:
        activeProvider && typeof activeProvider === "object"
          ? ((activeProvider as { constructor?: { name?: unknown } }).constructor?.name ?? "object")
          : typeof activeProvider,
      providerName: providerRecord?.isRabby
        ? "Rabby"
        : providerRecord?.isMetaMask
          ? "MetaMask"
          : "Injected",
    });
  }
  return activeProvider;
}

export async function requestInjectedAccounts(provider = injectedProvider()): Promise<unknown> {
  if (!provider) throw new Error("NO_INJECTED_PROVIDER");
  return provider.request({ method: "eth_requestAccounts" });
}

export async function getInjectedAccounts(provider = injectedProvider()): Promise<unknown> {
  if (!provider) return [];
  return provider.request({ method: "eth_accounts" });
}

export async function getInjectedChainId(provider = injectedProvider()): Promise<number> {
  if (!provider) throw new Error("NO_INJECTED_PROVIDER");
  return providerChainId(provider);
}

export const getCurrentConnectedInjectedProvider = getActiveInjectedProvider;

async function providerChainId(provider: ForgeInjectedProvider): Promise<number> {
  return parseProviderChainId(await provider.request({ method: "eth_chainId" }));
}

async function waitForStudioNext(provider: ForgeInjectedProvider): Promise<void> {
  if ((await providerChainId(provider)) === FORGE_CHAIN_ID) return;
  await new Promise<void>((resolve, reject) => {
    let finished = false;
    const timers: {
      interval?: ReturnType<typeof globalThis.setInterval>;
      timeout?: ReturnType<typeof globalThis.setTimeout>;
    } = {};
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      if (timers.interval !== undefined) globalThis.clearInterval(timers.interval);
      if (timers.timeout !== undefined) globalThis.clearTimeout(timers.timeout);
      provider.removeListener?.("chainChanged", onChainChanged);
      if (error) reject(error);
      else resolve();
    };
    const check = async () => {
      try {
        if ((await providerChainId(provider)) === FORGE_CHAIN_ID) finish();
      } catch {
        // Keep waiting for the wallet/provider to finish the switch.
      }
    };
    const onChainChanged = (...args: unknown[]) => {
      devNetworkLog("[FORGE CHAIN CHANGED]", { chainId: args[0] });
      try {
        if (parseProviderChainId(args[0]) === FORGE_CHAIN_ID) finish();
      } catch {
        // Ignore malformed intermediate provider events and keep the timeout guard.
      }
    };
    provider.on?.("chainChanged", onChainChanged);
    timers.interval = globalThis.setInterval(() => void check(), 200);
    timers.timeout = globalThis.setTimeout(
      () => finish(new Error("Timed out waiting for the wallet to switch networks.")),
      10_000,
    );
    void check();
  });
}

export async function switchToStudioNext(source = "unknown"): Promise<void> {
  devNetworkLog("[FORGE SWITCH START]", {
    source,
    targetChainId: FORGE_CHAIN_ID_HEX,
    rpc: FORGE_RPC_URL,
  });
  const provider = await getActiveInjectedProvider();
  const providerRecord = provider as unknown as Record<string, unknown> | undefined;
  const providerFlags = providerRecord
    ? Object.keys(providerRecord).filter(
        (key) => /^is[A-Z]/.test(key) && providerRecord[key] === true,
      )
    : [];
  devNetworkLog("[FORGE SWITCH PROVIDER]", {
    windowEthereum: typeof window !== "undefined" && Boolean(window.ethereum),
    providerObjectPresent: Boolean(provider),
    providerRequestPresent: Boolean(provider && typeof provider.request === "function"),
    providerType: provider?.constructor?.name ?? typeof provider,
    providerFlags,
    sameAsWindowEthereum:
      typeof window !== "undefined" && Boolean(provider) && provider === window.ethereum,
  });
  if (!provider) throw new Error("NO_INJECTED_PROVIDER");

  let currentChainId: number;
  try {
    currentChainId = await providerChainId(provider);
    devNetworkLog("[FORGE SWITCH CURRENT CHAIN]", {
      chainId: `0x${currentChainId.toString(16)}`,
      chainIdDecimal: currentChainId,
    });
  } catch (error) {
    devNetworkLog("[FORGE SWITCH ERROR]", errorDetails(error));
    throw error;
  }
  if (currentChainId === FORGE_CHAIN_ID) {
    devNetworkLog("[FORGE SWITCH SUCCESS]", {
      chainId: FORGE_CHAIN_ID_HEX,
      alreadyOnTarget: true,
    });
    return;
  }

  try {
    devNetworkLog("[FORGE SWITCH REQUEST]", {
      method: "wallet_switchEthereumChain",
      chainId: FORGE_CHAIN_ID_HEX,
    });
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: FORGE_CHAIN_ID_HEX }],
    });
  } catch (error) {
    if (providerErrorCode(error) !== 4902) {
      devNetworkLog("[FORGE SWITCH ERROR]", errorDetails(error));
      throw error;
    }
    devNetworkLog("[FORGE SWITCH ADD CHAIN]", {
      method: "wallet_addEthereumChain",
      chainId: FORGE_CHAIN_ID_HEX,
      chainName: FORGE_NETWORK_NAME,
      rpc: FORGE_RPC_URL,
    });
    try {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: FORGE_CHAIN_ID_HEX,
            chainName: FORGE_NETWORK_NAME,
            nativeCurrency: FORGE_NATIVE_CURRENCY,
            rpcUrls: [FORGE_RPC_URL],
          },
        ],
      });
      devNetworkLog("[FORGE SWITCH REQUEST]", {
        method: "wallet_switchEthereumChain",
        chainId: FORGE_CHAIN_ID_HEX,
        afterAdd: true,
      });
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: FORGE_CHAIN_ID_HEX }],
      });
    } catch (addOrSwitchError) {
      devNetworkLog("[FORGE SWITCH ERROR]", errorDetails(addOrSwitchError));
      throw addOrSwitchError;
    }
  }
  try {
    await waitForStudioNext(provider);
    const confirmedChainId = await providerChainId(provider);
    devNetworkLog("[FORGE SWITCH SUCCESS]", {
      chainId: `0x${confirmedChainId.toString(16)}`,
      chainIdDecimal: confirmedChainId,
    });
  } catch (error) {
    devNetworkLog("[FORGE SWITCH ERROR]", errorDetails(error));
    throw error;
  }
}

export function logNetworkSwitchClick(source: string) {
  devNetworkLog("[FORGE NETWORK SWITCH CLICK]", { source });
}
