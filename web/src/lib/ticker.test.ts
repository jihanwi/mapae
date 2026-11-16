import {describe, expect, it} from "vitest";
import {displayTicker, isStandardTicker, normalizeTicker, sameTickerCount, tickerCharsOk, tickerKey} from "./ticker";

describe("ticker rule (decision 54)", () => {
    it.each(["BTC", "김치", "마패1", "A1", "MAPAE12345"])("standard: %s", (s) => {
        expect(isStandardTicker(s)).toBe(true);
    });
    it.each([
        ["space inside", "x y"],
        ["symbol", "X&Y"],
        ["lower case (normalizes to ABC, but not standard as is)", "abc"],
        ["Cyrillic A", "АBC"],
        ["full-width", "ＡＢＣ"],
        ["zero-width space", "AB​C"],
        ["emoji", "🐎"],
        ["Hangul jamo", "ㄱ"],
        ["11 bytes", "ABCDEFGHIJK"],
        ["4 Hangul syllables (12 bytes)", "가나다라"],
        ["empty", ""],
        ["leading space", " BTC"],
    ])("not standard: %s", (_why, s) => {
        expect(isStandardTicker(s)).toBe(false);
    });
    it("normalizes: trim, NFKC, a–z upper", () => {
        expect(normalizeTicker(" abc ")).toBe("ABC");
        expect(normalizeTicker("ＡＢＣ")).toBe("ABC");
        expect(normalizeTicker("김치")).toBe("김치");
        // Cyrillic stays Cyrillic (only a–z are upper-cased), so it still fails the rule
        expect(tickerCharsOk(normalizeTicker("аbc"))).toBe(false);
        expect(isStandardTicker(normalizeTicker("abc"))).toBe(true);
    });
    it("the typing display keeps spaces visible", () => {
        expect(displayTicker("a b")).toBe("A B");
        expect(displayTicker("ｘ")).toBe("X");
    });
    it("same ticker: case and width folded, own curve left out", () => {
        const list = [
            {curve: "0xA", symbol: "CAP"},
            {curve: "0xB", symbol: "cap"},
            {curve: "0xC", symbol: "ＣＡＰ"},
            {curve: "0xD", symbol: "CAPX"},
        ];
        expect(tickerKey("ｃａｐ")).toBe("CAP");
        expect(sameTickerCount("cap", list)).toBe(3);
        expect(sameTickerCount("CAP", list, "0xa")).toBe(2);
        expect(sameTickerCount("", list)).toBe(0);
    });
});
