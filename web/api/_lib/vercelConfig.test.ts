// W-T73: the cron schedule and the two host-bound redirects in web/vercel.json.
import {describe, expect, it} from "vitest";
import VERCEL from "../../vercel.json";

type Redirect = {source: string; destination: string; permanent?: boolean; has?: {type: string; value: string}[]};

describe("vercel.json (W-T73)", () => {
    it("the cron runs hourly", () => {
        expect(VERCEL.crons[0].schedule).toBe("0 * * * *");
    });
    it("exactly two temporary redirects, each bound to a host", () => {
        const r = (VERCEL as unknown as {redirects: Redirect[]}).redirects;
        expect(r).toHaveLength(2);
        for (const x of r) {
            expect(x.has?.some((h) => h.type === "host")).toBe(true);
            expect(x.permanent).toBe(false);
        }
        expect(r[0].source.startsWith("/t/")).toBe(true);
        const host0 = r[0].has!.find((h) => h.type === "host")!.value;
        expect(host0).toContain("mapae");
        expect(host0).toContain("fun");
        expect(r[0].destination).toBe("/waitlist");
        expect(r[1].source).toBe("/:path((?!api/).*)");
        expect(r[1].destination).toBe("https://mapae.fun/:path*");
        expect(r[1].destination.startsWith("https://mapae.fun/")).toBe(true);
        expect(r[1].has!.find((h) => h.type === "host")!.value).toBe("mapae-snowy\\.vercel\\.app");
        expect(JSON.stringify(r)).not.toContain("$1");
    });
});
