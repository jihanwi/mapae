import {describe, expect, it} from "vitest";
import {chainUrl} from "./chainUrl";
import {keepSameBase} from "../hooks/chainData";

describe("chainUrl", () => {
    it("adds the data version last and leaves out undefined params", () => {
        expect(chainUrl("holders", {curve: "0xabc"}, "41419458")).toBe("/api/chain/holders?curve=0xabc&v=41419458");
        expect(chainUrl("trades", {curve: "0xabc", limit: 50, before: undefined}, "7")).toBe("/api/chain/trades?curve=0xabc&limit=50&v=7");
    });
    it("no version (null or unknown): no v", () => {
        expect(chainUrl("flow", {curve: "0xabc"}, null)).toBe("/api/chain/flow?curve=0xabc");
        expect(chainUrl("flow", {curve: "0xabc"}, undefined)).toBe("/api/chain/flow?curve=0xabc");
        expect(chainUrl("summary", {}, null)).toBe("/api/chain/summary");
    });
});


describe("keepSameBase (placeholder while the next data version loads)", () => {
    const q = (key: readonly unknown[]) => ({queryKey: key}) as never;
    it("keeps the previous data when only the version changed", () => {
        expect(keepSameBase<number>(["chain", "holders", "0xa"])(5, q(["chain", "holders", "0xa", "100"]))).toBe(5);
    });
    it("starts empty for another token or interval", () => {
        expect(keepSameBase<number>(["chain", "holders", "0xb"])(5, q(["chain", "holders", "0xa", "100"]))).toBeUndefined();
        expect(keepSameBase<number>(["chain", "candles", "0xa", 300])(5, q(["chain", "candles", "0xa", 3600, "100"]))).toBeUndefined();
        expect(keepSameBase<number>(["chain", "flow", "0xa"])(5, undefined)).toBeUndefined();
    });
});
