import {describe, expect, it} from "vitest";
import {allocationOf, lpTokenBpsOf, proceedsOf, qSaleOf, WAD} from "./offeringMath";

const P = {price: 1000n * WAD, fBps: 6000, creatorTokenBps: 2000, cBps: 2500, offeringFeeBps: 750, proceedsUpfrontBps: 3000, hasLock: true};

describe("offering math (same as Offering.sol)", () => {
    it("sale quantity and LP token share", () => {
        expect(qSaleOf(50_000_000n * WAD, 1000n * WAD)).toBe(50_000n * WAD);
        expect(lpTokenBpsOf(2500, 6000)).toBe(1500n);
        expect(qSaleOf(1n, 0n)).toBe(0n);
    });
    it("allocation when fully sold: supply = sold / f, shares of supply, remainder burned", () => {
        const a = allocationOf(50_000n * WAD, P);
        expect(a.supply).toBe((50_000n * WAD * 10_000n) / 6000n);
        expect(a.creator).toBe((a.supply * 2000n) / 10_000n);
        expect(a.lp).toBe((a.supply * 1500n) / 10_000n);
        expect(a.sold + a.creator + a.lp + a.remainder).toBe(a.supply);
    });
    it("proceeds: platform fee, LP seed at par, issuer split upfront / locked", () => {
        const r = proceedsOf(50_000_000n * WAD, P, 50_000n * WAD);
        expect(r.platform).toBe(3_750_000n * WAD);
        // c x raised = 12,500,000, capped by the minted LP share (bps double floor, "a hair smaller")
        const lp = allocationOf(50_000n * WAD, P).lp;
        expect(r.krwSeed).toBe((lp * 1000n * WAD) / WAD);
        expect(r.krwSeed).toBeLessThanOrEqual(12_500_000n * WAD);
        expect(12_500_000n * WAD - r.krwSeed).toBeLessThan(WAD / 10n ** 12n);
        expect(r.issuer).toBe(50_000_000n * WAD - r.krwSeed - r.platform);
        expect(r.upfront).toBe((r.issuer * 3000n) / 10_000n);
        expect(r.locked).toBe(r.issuer - r.upfront);
        expect(r.krwSeed + r.platform + r.upfront + r.locked).toBe(r.raised);
    });
    it("the LP seed is capped by the minted LP share; no lock pays everything upfront", () => {
        const tiny = proceedsOf(50_000_000n * WAD, {...P, fBps: 6000, cBps: 1500}, 1n);
        expect(tiny.krwSeed).toBe(0n);
        expect(proceedsOf(10n * WAD, {...P, hasLock: false}, 1n).locked).toBe(0n);
    });
});
