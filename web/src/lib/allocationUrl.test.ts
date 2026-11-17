// W-T44: allocation files are found by the lowercase offering address, and every committed file has
// the shape the offering page reads (one proof array per participant).
import {describe, expect, it} from "vitest";
import {allocationUrl} from "./allocationUrl";

const FILES = import.meta.glob("../../public/allocations/*.json", {eager: true, import: "default"}) as Record<string, Record<string, unknown>>;

describe("allocationUrl", () => {
    it("checksummed and lowercase addresses give the same file", () => {
        const a = allocationUrl("0xA1AA8da4Fe05fe0bF51d3d8a464ea0269f39bB9f", "/");
        expect(a).toBe("/allocations/0xa1aa8da4fe05fe0bf51d3d8a464ea0269f39bb9f.json");
        expect(allocationUrl("0xa1aa8da4fe05fe0bf51d3d8a464ea0269f39bb9f", "/")).toBe(a);
        expect(allocationUrl("0x06802967421F8f96Bb58BeEF13D2F6a99248E4EE", "/mapae/")).toBe("/mapae/allocations/0x06802967421f8f96bb58beef13d2f6a99248e4ee.json");
    });
});

describe("public/allocations files", () => {
    const entries = Object.entries(FILES);
    it("the NODL and HNGL files are there", () => {
        const names = entries.map(([p]) => p.split("/").pop());
        expect(names).toContain("0xa1aa8da4fe05fe0bf51d3d8a464ea0269f39bb9f.json");
        expect(names).toContain("0x06802967421f8f96bb58beef13d2f6a99248e4ee.json");
    });
    it.each(entries)("%s: lowercase address name, matching arrays, a proof per participant, root/seed/totals", (path, d) => {
        expect(path.split("/").pop()).toMatch(/^0x[0-9a-f]{40}\.json$/);
        const participants = d.participants as string[];
        expect(Array.isArray(participants)).toBe(true);
        expect((d.allocations as string[]).length).toBe(participants.length);
        expect((d.refunds as string[]).length).toBe(participants.length);
        participants.forEach((_, i) => expect(Array.isArray(d[`proofs_${i}`]), `proofs_${i}`).toBe(true));
        for (const k of ["root", "seed", "totalSold", "totalRaised"]) expect(typeof d[k], k).toBe("string");
        expect(d.root).toMatch(/^0x[0-9a-f]{64}$/);
        expect(d.seed).toMatch(/^0x[0-9a-f]{64}$/);
    });
});
