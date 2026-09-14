import { describe, expect, test } from "bun:test";
import { BINANCE_CHART_SYMBOLS } from "../src/lib/forge/binance";
import { FORGE_CONTRACT_ADDRESS, SOURCE_LABEL, SOURCES } from "../src/lib/forge/constants";

const OLD_CONTRACT = "0xcfA2625BC9bC6d1D34D4865e2f790087AE00fD15";
const INTERMEDIATE_CONTRACT = "0x373993849dD5A1CC4aa234658fCbAb7b164c31f6";

describe("Forge verified Hyperliquid deployment wiring", () => {
  test("uses only the verified deployment and settlement source order", () => {
    expect(FORGE_CONTRACT_ADDRESS).toBe("0x5e293d83E1340C4be1D513F4B9a6905e3439cA09");
    expect(FORGE_CONTRACT_ADDRESS).not.toBe(OLD_CONTRACT);
    expect(FORGE_CONTRACT_ADDRESS).not.toBe(INTERMEDIATE_CONTRACT);
    expect(SOURCES).toEqual(["HYPERLIQUID", "GATE", "BITGET"]);
    expect(SOURCE_LABEL).toEqual({
      HYPERLIQUID: "Hyperliquid",
      GATE: "Gate",
      BITGET: "Bitget",
    });
  });

  test("keeps Binance symbols isolated to the informational chart", () => {
    expect(BINANCE_CHART_SYMBOLS).toEqual({
      GOLD: "XAUUSDT",
      SILVER: "XAGUSDT",
      COPPER: "COPPERUSDT",
      WTI_CRUDE: "CLUSDT",
      BRENT_CRUDE: "BZUSDT",
      NATURAL_GAS: "NATGASUSDT",
    });
  });
});
