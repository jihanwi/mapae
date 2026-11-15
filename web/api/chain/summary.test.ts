import {describe, expect, it} from "vitest";
import {parseWindow} from "./summary";

describe("summary window parameter", () => {
    it("defaults to 86400 and accepts 3600 and 86400 only", () => {
        expect(parseWindow(null)).toBe(86_400);
        expect(parseWindow("86400")).toBe(86_400);
        expect(parseWindow("3600")).toBe(3600);
        for (const bad of ["60", "", "3600.0", "abc", "-3600", " 3600"]) expect(parseWindow(bad), bad).toBeNull();
    });
});
