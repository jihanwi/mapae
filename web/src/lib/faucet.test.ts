import {describe, expect, it} from "vitest";
import {FAUCET_ROUND, faucetAmount} from "./faucet";

const E18 = 10n ** 18n;
const CAP = 10_000_000n * E18; // MockKRW.FAUCET_CAP

describe("faucetAmount", () => {
    it("rounds the shortfall up to 10,000 KRWs", () => {
        expect(faucetAmount(1n, CAP)).toBe(FAUCET_ROUND);
        expect(faucetAmount(10_000n * E18, CAP)).toBe(10_000n * E18);
        expect(faucetAmount(10_001n * E18, CAP)).toBe(20_000n * E18);
    });
    it("never exceeds FAUCET_CAP", () => {
        expect(faucetAmount(CAP * 2n, CAP)).toBe(CAP);
    });
});
