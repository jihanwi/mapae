import {describe, expect, it} from "vitest";
import {exceedsDevFirstBuyCap} from "./devFirstBuy";
import {ADDR_V3} from "../contracts/addressesV3";
import {ko} from "../copy/ko";
import {en} from "../copy/en";
import {CURVE_SUPPLY, quoteBuyWithFees, VIRTUAL_TOKEN_RESERVE} from "./curveMath";

const MAX = ADDR_V3.devFirstBuyMaxTokens;
const E18 = 10n ** 18n;

describe("exceedsDevFirstBuyCap", () => {
    it("the cap itself is allowed, 1 wei more is not", () => {
        expect(MAX).toBe(50_000_000n * E18);
        expect(exceedsDevFirstBuyCap(MAX, MAX)).toBe(false);
        expect(exceedsDevFirstBuyCap(MAX + 1n, MAX)).toBe(true);
        expect(exceedsDevFirstBuyCap(0n, MAX)).toBe(false);
        expect(exceedsDevFirstBuyCap(CURVE_SUPPLY, MAX)).toBe(true);
    });
    it("the boundary amounts match the contract tests (KRWs about 99,354, testnet ETH about 0.0000994)", () => {
        const fee = 100n; // 1.00%
        // KRWs 2M virtual quote: 99,354.19 passes, 99,355 does not
        const vqK = 2_000_000n * E18;
        expect(exceedsDevFirstBuyCap(quoteBuyWithFees(vqK, 0n, 0n, 99_354n * E18, fee).tokensOut, MAX)).toBe(false);
        expect(exceedsDevFirstBuyCap(quoteBuyWithFees(vqK, 0n, 0n, 99_355n * E18, fee).tokensOut, MAX)).toBe(true);
        // testnet ETH 0.002: 0.00005 passes (the old default), 0.001 does not
        const vqE = 2n * 10n ** 15n;
        expect(exceedsDevFirstBuyCap(quoteBuyWithFees(vqE, 0n, 0n, 5n * 10n ** 13n, fee).tokensOut, MAX)).toBe(false);
        expect(exceedsDevFirstBuyCap(quoteBuyWithFees(vqE, 0n, 0n, 10n ** 15n, fee).tokensOut, MAX)).toBe(true);
        expect(VIRTUAL_TOKEN_RESERVE).toBeGreaterThan(MAX);
    });
    it("the revert reason maps to the same sentence as the on-screen notice", () => {
        expect(ko.errors.DevFirstBuyTooLarge).toBe(ko.create.devBuyCap);
        expect(en.errors.DevFirstBuyTooLarge).toBe(en.create.devBuyCap);
    });
});
