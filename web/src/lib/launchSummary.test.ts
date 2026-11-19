import {describe, expect, it} from "vitest";
import {CURVE_SUPPLY, DEX_SUPPLY, TOTAL_SUPPLY} from "./curveMath";
import {supplyShares} from "./launchSummary";
import {en} from "../copy/en";
import {ko} from "../copy/ko";

describe("supplyShares (W-T64 supply bar)", () => {
    it("splits the launch supply 80 / 20 from CURVE_SUPPLY and DEX_SUPPLY", () => {
        expect(CURVE_SUPPLY + DEX_SUPPLY).toBe(TOTAL_SUPPLY);
        expect(supplyShares()).toEqual({curvePct: 80, poolPct: 20});
    });
    it("always sums to 100 and handles uneven splits", () => {
        const s = supplyShares(1n, 2n);
        expect(s.curvePct).toBe(33.33);
        expect(s.curvePct + s.poolPct).toBeCloseTo(100, 10);
    });
    it("returns zeros for an empty supply", () => {
        expect(supplyShares(0n, 0n)).toEqual({curvePct: 0, poolPct: 0});
    });
});

describe("W-T64 launch copy", () => {
    it("has the spec wording", () => {
        expect(ko.create.heading).toBe("발행");
        expect(en.create.heading).toBe("Launch");
        expect(ko.create.wayCurve.points).toHaveLength(3);
        expect(en.create.wayOffering.points).toHaveLength(3);
        expect(ko.create.supplyBar("80", "20")).toBe("본딩커브 판매 물량 80%, 졸업 시 풀 공급 물량 20%");
    });
    it("avoids return wording and em dashes", () => {
        const all = JSON.stringify([ko.create, en.create]);
        for (const w of [/수익/, /투자/, /오른다/, /—/, /profit/i, /invest/i]) expect(all, String(w)).not.toMatch(w);
    });
});
