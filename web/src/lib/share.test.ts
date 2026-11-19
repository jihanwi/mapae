import {describe, expect, it} from "vitest";
import {isMobileBrowser, metamaskDappUrl, shareLink, xIntentUrl, opensShareText} from "./share";

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

describe("MetaMask dapp deep link", () => {
    const V = "https://mapae-snowy.vercel.app";
    it("token page: link.metamask.io/dapp/<host>/t/<curve>, no scheme, no hash", () => {
        expect(metamaskDappUrl(`/t/${C}`, "", V)).toBe("https://link.metamask.io/dapp/mapae-snowy.vercel.app/t/0x00000000000000000000000000000000000000c1");
        expect(metamaskDappUrl(`/t/${C}/`, "", V)).toBe("https://link.metamask.io/dapp/mapae-snowy.vercel.app/t/0x00000000000000000000000000000000000000c1");
    });
    it("other screens (and a malformed token path): the site root", () => {
        expect(metamaskDappUrl("/", "", V)).toBe("https://link.metamask.io/dapp/mapae-snowy.vercel.app/");
        expect(metamaskDappUrl("/w/0xabc", "", V)).toBe("https://link.metamask.io/dapp/mapae-snowy.vercel.app/");
        expect(metamaskDappUrl("/t/0x123", "", V)).toBe("https://link.metamask.io/dapp/mapae-snowy.vercel.app/");
    });
    it("the Pages build links to the API deployment", () => {
        expect(metamaskDappUrl(`/t/${C}`, V, "https://jihanwi.github.io")).toBe("https://link.metamask.io/dapp/mapae-snowy.vercel.app/t/0x00000000000000000000000000000000000000c1");
        expect(metamaskDappUrl("/create", V, "https://jihanwi.github.io")).not.toContain("#");
    });
});

describe("opensShareText (W-T61)", () => {
    // 2026-11-21 12:00 UTC = 21:00 in Seoul
    const START = Date.UTC(2026, 10, 21, 12, 0) / 1000;
    it("Seoul time is written KST", () => {
        expect(opensShareText("HRN", START, "Asia/Seoul")).toBe("$HRN opens Nov 21, 21:00 KST on MAPAE. Everyone starts from the same line.");
    });
    it("other zones keep their short name", () => {
        expect(opensShareText("HRN", BigInt(START), "UTC")).toBe("$HRN opens Nov 21, 12:00 UTC on MAPAE. Everyone starts from the same line.");
    });
});
