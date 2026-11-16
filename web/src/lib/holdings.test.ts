import {describe, expect, it} from "vitest";
import {commitStatus} from "./holdings";
import {offeringViewKey} from "../pages/Offering";
import OFFERING from "../pages/Offering.tsx?raw";

const E = 10n ** 18n;
const base = {settled: false, refunding: false, deadlineSec: 2_000_000_000n, nowMs: 1_900_000_000_000, committed: 300_000n * E, claimed: false, allocated: undefined as boolean | undefined};

describe("holdings rows for committed offerings (W-T39)", () => {
    it("before the deadline: committed amount", () => {
        expect(commitStatus(base)).toEqual({kind: "committed", amount: 300_000n * E});
    });
    it("after the deadline, not settled: waiting for settle", () => {
        expect(commitStatus({...base, nowMs: 2_000_000_000_000})).toEqual({kind: "awaitSettle", amount: 300_000n * E});
    });
    it("refunding: refund to take back", () => {
        expect(commitStatus({...base, refunding: true})).toEqual({kind: "refund", amount: 300_000n * E});
    });
    it("settled: 'claim' only when unclaimed AND the published allocation lists the wallet", () => {
        expect(commitStatus({...base, settled: true, allocated: true})).toEqual({kind: "claim"});
        expect(commitStatus({...base, settled: true, allocated: undefined})).toBeNull();
        expect(commitStatus({...base, settled: true, allocated: false})).toBeNull();
        expect(commitStatus({...base, settled: true, claimed: true, allocated: true})).toBeNull();
        expect(commitStatus({...base, settled: true, claimed: undefined, allocated: true})).toBeNull();
    });
    it("no commitment or unread: no row", () => {
        expect(commitStatus({...base, committed: 0n})).toBeNull();
        expect(commitStatus({...base, committed: undefined})).toBeNull();
    });
});

describe("offering page state is per offering and wallet (W-T39)", () => {
    it("the key changes with the offering or the wallet (case-insensitive)", () => {
        const A = "0xA1AA8da4Fe05fe0bF51d3d8a464ea0269f39bB9f";
        const B = "0xa090331E8DC8E9bcd0dA81D990c07Bcf71D9CB86";
        const W = "0x2D6E234037Da0180be8e4B905f3baA6C544b391d";
        expect(offeringViewKey(A, W)).not.toBe(offeringViewKey(B, W));
        expect(offeringViewKey(A, W)).not.toBe(offeringViewKey(A, undefined));
        expect(offeringViewKey(A, W)).toBe(offeringViewKey(A.toLowerCase(), W.toUpperCase().replace("0X", "0x")));
    });
    it("the whole detail view (refund panel, disclosure editor, commit input) is mounted under that key", () => {
        expect(OFFERING).toMatch(/<OfferingView key=\{offeringViewKey\(addr, account\)\} \/>/);
        expect(OFFERING).toMatch(/<RefundPanel key=\{offeringViewKey\(o\.address, account\)\}/);
    });
});
