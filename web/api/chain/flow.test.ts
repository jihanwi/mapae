import {describe, expect, it} from "vitest";
import {parseCurve} from "../_lib/indexer";
import {FLOW_WINDOW} from "./flow";

describe("flow curve parameter", () => {
    it("rejects a missing or malformed curve and lowercases a valid one", () => {
        expect(parseCurve(null)).toBeNull();
        expect(parseCurve("")).toBeNull();
        expect(parseCurve("0x123")).toBeNull();
        expect(parseCurve("0xZZ" + "0".repeat(38))).toBeNull();
        expect(parseCurve("0xCB8dE4Caac1aCBa352F1D8c659d4578115E8f781")).toBe("0xcb8de4caac1acba352f1d8c659d4578115e8f781");
        expect(parseCurve("0x0000000000000000000000000000000000000001")).toBe("0x0000000000000000000000000000000000000001");
    });
    it("uses a 24 h window", () => {
        expect(FLOW_WINDOW).toBe(86_400);
    });
});
