import {describe, expect, it} from "vitest";
import {isMobileBrowser, shareLink, xIntentUrl} from "./share";

const C = "0x00000000000000000000000000000000000000C1";

describe("share helpers", () => {
    it("share link: the API deployment when absolute, else this origin; lowercase curve", () => {
        expect(shareLink(C, "", "https://mapae-snowy.vercel.app")).toBe("https://mapae-snowy.vercel.app/t/0x00000000000000000000000000000000000000c1");
        expect(shareLink(C, "https://mapae-snowy.vercel.app", "https://jihanwi.github.io")).toBe("https://mapae-snowy.vercel.app/t/0x00000000000000000000000000000000000000c1");
    });
    it("X intent: x.com/intent/tweet with encoded text and url", () => {
        const u = new URL(xIntentUrl("말 (HRN) | MAPAE & co", "https://a.b/t/0x1"));
        expect(u.origin + u.pathname).toBe("https://x.com/intent/tweet");
        expect(u.searchParams.get("text")).toBe("말 (HRN) | MAPAE & co");
        expect(u.searchParams.get("url")).toBe("https://a.b/t/0x1");
    });
    it("mobile check", () => {
        expect(isMobileBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148")).toBe(true);
        expect(isMobileBrowser("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36")).toBe(true);
        expect(isMobileBrowser("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15", 5)).toBe(true); // iPadOS
        expect(isMobileBrowser("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15", 0)).toBe(false);
        expect(isMobileBrowser("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36")).toBe(false);
    });
});
