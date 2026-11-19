import {describe, expect, it} from "vitest";
import {pnlFigure, walletInitial} from "./walletView";
import {signedPnl} from "./wallet";

describe("walletInitial", () => {
    it("uses the nickname's first character", () => {
        expect(walletInitial("마패", "0xAbCd000000000000000000000000000000000000")).toBe("마");
        expect(walletInitial("  bob ", "0xAbCd000000000000000000000000000000000000")).toBe("b");
    });
    it("keeps a character outside the BMP whole", () => {
        expect(walletInitial("😀x", "0x12")).toBe("😀");
    });
    it("without a nickname uses the two characters after 0x, lowercase", () => {
        expect(walletInitial(null, "0xAbCd000000000000000000000000000000000000")).toBe("ab");
        expect(walletInitial(undefined, "0x1f00")).toBe("1f");
        expect(walletInitial("   ", "0X9E00")).toBe("9e");
    });
});

describe("pnlFigure", () => {
    const WAD = 10n ** 18n;
    it("matches signedPnl without the unit", () => {
        for (const [v, unit] of [
            [1234n * WAD, "KRWs"],
            [-1234n * WAD, "KRWs"],
            [0n, "KRWs"],
            [WAD / 3n, "ETH"],
            [-(WAD / 7n), "ETH"],
        ] as const) {
            const full = signedPnl(v, unit, "ko-KR");
            const fig = pnlFigure(v, unit, "ko-KR");
            expect(fig.tone).toBe(full.tone);
            expect(`${fig.text} ${unit}`).toBe(full.text);
        }
    });
    it("a value that displays as 0 has no sign", () => {
        const fig = pnlFigure(-(WAD / 10n), "KRWs", "ko-KR");
        expect(fig.tone).toBe("flat");
        expect(fig.text).toBe("0");
    });
});
