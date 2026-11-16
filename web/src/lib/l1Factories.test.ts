import {describe, expect, it} from "vitest";
import {activeOfferingOf, pairOfferings, scanStartFor, type L1Factory} from "./l1Factories";
import {ADDR_L1, L1_FACTORIES} from "../contracts/addressesV3L1";
import {proceedsOf} from "./offeringMath";

const NEW: L1Factory = {version: "v3.3-L1", mapaeFactory: "0x3b1D679d6CFA5f2e92832aFfBf516319204D767f", feeRouter: "0xC8EF125aa945aF92144ECadc39CeE1a0b7415a70", deployBlock: 41_506_506n};
const OLD: L1Factory = {version: "v3.2-L1", mapaeFactory: "0xa9CA0C10Cd6B6398679B578DCE192cb4cAA5bc71", feeRouter: "0xAB665B7867080cd62Aa316717400f3Cc094E7bd6", deployBlock: 41_489_012n};
const NODL = "0xA1AA8da4Fe05fe0bF51d3d8a464ea0269f39bB9f";
const SOLB = "0xa090331E8DC8E9bcd0dA81D990c07Bcf71D9CB86";
const FRESH = "0x00000000000000000000000000000000000000f1";

describe("L1 factories from codegen (W-T40)", () => {
    it("current first, both deployments, ADDR_L1 is the current one", () => {
        expect(L1_FACTORIES.map((f) => f.version)).toEqual(["v3.3-L1", "v3.2-L1"]);
        expect(L1_FACTORIES.map((f) => [f.mapaeFactory, f.feeRouter, f.deployBlock])).toEqual([[NEW.mapaeFactory, NEW.feeRouter, NEW.deployBlock], [OLD.mapaeFactory, OLD.feeRouter, OLD.deployBlock]]);
        expect(ADDR_L1.mapaeFactory).toBe(NEW.mapaeFactory);
        expect(ADDR_L1.feeRouter).toBe(NEW.feeRouter);
        expect(ADDR_L1.deployBlock).toBe(41_506_506n);
        expect(ADDR_L1.firstBlock).toBe(41_489_012n);
    });
});

describe("pairOfferings", () => {
    const fs = [NEW, OLD];
    it("old factory's offerings first in their order, then the new one's; each knows its factory", () => {
        expect(pairOfferings(fs, [[FRESH], [NODL, SOLB]])).toEqual([
            {address: NODL, factory: OLD.mapaeFactory},
            {address: SOLB, factory: OLD.mapaeFactory},
            {address: FRESH, factory: NEW.mapaeFactory},
        ]);
    });
    it("the new factory empty: the two old offerings stay as before", () => {
        expect(pairOfferings(fs, [[], [NODL, SOLB]]).map((x) => x.address)).toEqual([NODL, SOLB]);
    });
    it("an address listed twice keeps its first (older) factory; a missing list adds nothing", () => {
        expect(pairOfferings(fs, [[NODL.toLowerCase()], [NODL]])).toEqual([{address: NODL, factory: OLD.mapaeFactory}]);
        expect(pairOfferings(fs, [undefined, [NODL]])).toEqual([{address: NODL, factory: OLD.mapaeFactory}]);
    });
});

describe("scanStartFor", () => {
    const fs = [NEW, OLD];
    it("an offering scans from its own factory's deployment block", () => {
        expect(scanStartFor([NEW.mapaeFactory], fs)).toBe(41_506_506n);
        expect(scanStartFor([OLD.mapaeFactory.toLowerCase()], fs)).toBe(41_489_012n);
    });
    it("several offerings: the oldest of their factories, so an old offering's history is never cut", () => {
        expect(scanStartFor([NEW.mapaeFactory, OLD.mapaeFactory], fs)).toBe(41_489_012n);
        expect(scanStartFor([NEW.mapaeFactory, NEW.mapaeFactory], fs)).toBe(41_506_506n);
    });
    it("unknown, missing or none: the oldest L1 deployment", () => {
        expect(scanStartFor([undefined], fs)).toBe(41_489_012n);
        expect(scanStartFor(["0x0000000000000000000000000000000000000bad"], fs)).toBe(41_489_012n);
        expect(scanStartFor([], fs)).toBe(41_489_012n);
        // default list is the codegen one
        expect(scanStartFor([NEW.mapaeFactory])).toBe(41_506_506n);
    });
});

describe("create cap: current factory only (activeOfferingOf)", () => {
    const e = (address: string, phase: number | undefined, totalSupply: bigint | undefined, tier: number | undefined) => ({address: address as `0x${string}`, phase, totalSupply, tier});
    it("no offering on the current factory: nothing blocks (an older factory's live offering is never passed in)", () => {
        expect(activeOfferingOf([])).toBeNull();
    });
    it("a live L1 offering on the current factory blocks", () => {
        expect(activeOfferingOf([e(FRESH, 0, 1n, 1)])).toBe(FRESH);
    });
    it("a failed one (refunding, zero supply) does not; an L0-tier one does not", () => {
        expect(activeOfferingOf([e(FRESH, 4, 0n, 1)])).toBeNull();
        expect(activeOfferingOf([e(FRESH, 0, 1n, 0)])).toBeNull();
        expect(activeOfferingOf([e(NODL, 0, 1n, 1), e(FRESH, 4, 0n, 1)])).toBe(NODL);
    });
    it("a missing read is unknown, not 'free'", () => {
        expect(activeOfferingOf([e(FRESH, undefined, 1n, 1)])).toBeUndefined();
    });
});

describe("offering fee 0 (v3.3-L1 preset)", () => {
    it("platform share is 0 and the rest goes to the issuer", () => {
        const p = proceedsOf(1_000_000n * 10n ** 18n, {price: 10_000n * 10n ** 18n, fBps: 7000, creatorTokenBps: 2000, cBps: 2500, offeringFeeBps: 0, proceedsUpfrontBps: 3000, hasLock: true}, 100n * 10n ** 18n);
        expect(p.platform).toBe(0n);
        expect(p.upfront + p.locked + p.krwSeed).toBe(1_000_000n * 10n ** 18n);
    });
});
