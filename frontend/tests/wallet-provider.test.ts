import { afterEach, describe, expect, test } from "bun:test";
import {
  getActiveInjectedProvider,
  getInjectedAccounts,
  getInjectedChainId,
  requestInjectedAccounts,
  switchToStudioNext,
} from "../src/lib/forge/walletConfig";

type Listener = (...args: unknown[]) => void;

function makeProvider({
  account = "0x0000000000000000000000000000000000000001",
  chainId = "0xf22d",
  switchErrorCode,
}: {
  account?: string;
  chainId?: string;
  switchErrorCode?: number;
} = {}) {
  const listeners = new Map<string, Set<Listener>>();
  let currentChainId = chainId;
  const calls: string[] = [];
  const provider = {
    calls,
    request: async ({ method }: { method: string }) => {
      calls.push(method);
      if (method === "eth_accounts") return account ? [account] : [];
      if (method === "eth_requestAccounts") return account ? [account] : [];
      if (method === "eth_chainId") return currentChainId;
      if (method === "wallet_switchEthereumChain") {
        if (switchErrorCode) {
          const code = switchErrorCode;
          switchErrorCode = undefined;
          throw Object.assign(new Error("chain not added"), { code });
        }
        currentChainId = "0xf22d";
        listeners.get("chainChanged")?.forEach((listener) => listener(currentChainId));
        return null;
      }
      if (method === "wallet_addEthereumChain") return null;
      throw new Error(`Unexpected method: ${method}`);
    },
    on: (event: string, listener: Listener) => {
      const eventListeners = listeners.get(event) ?? new Set<Listener>();
      eventListeners.add(listener);
      listeners.set(event, eventListeners);
    },
    removeListener: (event: string, listener: Listener) => {
      listeners.get(event)?.delete(listener);
    },
  };
  return provider;
}

const initialWindow = globalThis.window;

afterEach(() => {
  if (initialWindow === undefined) Reflect.deleteProperty(globalThis, "window");
  else globalThis.window = initialWindow;
});

describe("Forge direct injected wallet", () => {
  test("uses the injected EIP-1193 provider directly", async () => {
    const provider = makeProvider();
    globalThis.window = { ethereum: provider } as never;

    expect(await getActiveInjectedProvider()).toBe(provider);
    expect(await getInjectedAccounts(provider)).toEqual([
      "0x0000000000000000000000000000000000000001",
    ]);
    expect(await getInjectedChainId(provider)).toBe(61997);
    expect("getProvider" in provider).toBe(false);
  });

  test("requests authorization only on explicit connect", async () => {
    const provider = makeProvider();
    globalThis.window = { ethereum: provider } as never;

    expect(await getInjectedAccounts(provider)).toEqual([
      "0x0000000000000000000000000000000000000001",
    ]);
    expect(await requestInjectedAccounts(provider)).toEqual([
      "0x0000000000000000000000000000000000000001",
    ]);
    expect(provider.calls).toEqual(["eth_accounts", "eth_requestAccounts"]);
  });

  test("switches to StudioNext and supports the 4902 add-chain fallback", async () => {
    const provider = makeProvider({ chainId: "0x1", switchErrorCode: 4902 });
    globalThis.window = { ethereum: provider } as never;

    await switchToStudioNext("test");

    expect(provider.calls).toEqual([
      "eth_chainId",
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
      "wallet_switchEthereumChain",
      "eth_chainId",
      "eth_chainId",
    ]);
  });
});
