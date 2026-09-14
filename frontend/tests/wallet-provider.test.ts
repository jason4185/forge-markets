import { afterEach, describe, expect, test } from "bun:test";
import { getActiveInjectedProvider, wagmiConfig } from "../src/lib/forge/walletConfig";

const initialState = wagmiConfig.state;
const initialWindow = globalThis.window;

afterEach(() => {
  wagmiConfig.setState(initialState);
  if (initialWindow === undefined) Reflect.deleteProperty(globalThis, "window");
  else globalThis.window = initialWindow;
});

describe("Forge injected provider resolution", () => {
  test("uses the live connector provider when the connection is active", async () => {
    const provider = {
      request: async ({ method }: { method: string }) => (method === "eth_chainId" ? "0xf22d" : []),
    };
    globalThis.window = {} as never;
    const configuredConnector = wagmiConfig.connectors[0]!;
    const liveConnector = {
      ...configuredConnector,
      getProvider: async () => provider,
    };
    wagmiConfig.setState({
      ...initialState,
      current: "live-connector",
      connections: new Map([
        [
          "live-connector",
          {
            accounts: ["0x0000000000000000000000000000000000000001"],
            chainId: 61997,
            connector: liveConnector,
          },
        ],
      ]),
      status: "connected",
    } as never);

    expect(await getActiveInjectedProvider()).toBe(provider);
  });

  test("resolves the live configured connector after Wagmi rehydration", async () => {
    const provider = {
      request: async ({ method }: { method: string }) => (method === "eth_chainId" ? "0xf22d" : []),
    };
    globalThis.window = { ethereum: provider } as never;

    const configuredConnector = wagmiConfig.connectors[0]!;
    const persistedConnector = {
      id: configuredConnector.id,
      name: configuredConnector.name,
      type: configuredConnector.type,
      uid: configuredConnector.uid,
    };
    wagmiConfig.setState({
      ...initialState,
      current: configuredConnector.uid,
      connections: new Map([
        [
          configuredConnector.uid,
          {
            accounts: ["0x0000000000000000000000000000000000000001"],
            chainId: 61997,
            connector: persistedConnector,
          },
        ],
      ]),
      status: "connected",
    } as never);

    expect(await getActiveInjectedProvider()).toBe(provider);
  });
});
