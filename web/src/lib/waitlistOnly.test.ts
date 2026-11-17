import {describe, expect, it} from "vitest";
import {isWaitlistOnlyHost, parseHosts, waitlistTarget} from "./waitlistOnly";

describe("waitlist-only hosts (W-T45)", () => {
    it("parses the list: spaces, case, empty entries", () => {
        expect(parseHosts(" Mapae-Snowy.vercel.app , mapae.fun,,WWW.mapae.fun ,")).toEqual(["mapae-snowy.vercel.app", "mapae.fun", "www.mapae.fun"]);
        expect(parseHosts("")).toEqual([]);
        expect(parseHosts(undefined)).toEqual([]);
        expect(parseHosts(" , ")).toEqual([]);
    });
    it("matches listed hosts only; an empty list hides nothing", () => {
        const list = "mapae-snowy.vercel.app, mapae.fun, www.mapae.fun";
        expect(isWaitlistOnlyHost("mapae-snowy.vercel.app", list)).toBe(true);
        expect(isWaitlistOnlyHost("MAPAE.FUN", list)).toBe(true);
        expect(isWaitlistOnlyHost("mapae-wiji.vercel.app", list)).toBe(false);
        expect(isWaitlistOnlyHost("mapae-git-main-wiji.vercel.app", list)).toBe(false);
        expect(isWaitlistOnlyHost("evil-mapae.fun", list)).toBe(false);
        expect(isWaitlistOnlyHost("mapae.fun.evil.com", list)).toBe(false);
        expect(isWaitlistOnlyHost("mapae.fun", "")).toBe(false);
        expect(isWaitlistOnlyHost("mapae.fun", undefined)).toBe(false);
        expect(isWaitlistOnlyHost("", list)).toBe(false);
    });
    it("ports: an entry without a port matches any port; an entry with a port matches that port only", () => {
        expect(isWaitlistOnlyHost("mapae.fun:8443", "mapae.fun")).toBe(true);
        expect(isWaitlistOnlyHost("localhost:4173", "localhost:4173")).toBe(true);
        expect(isWaitlistOnlyHost("localhost:5173", "localhost:4173")).toBe(false);
        expect(isWaitlistOnlyHost("localhost", "localhost:4173")).toBe(false);
    });
    it("redirect target keeps ref and lang only", () => {
        expect(waitlistTarget("")).toBe("/waitlist");
        expect(waitlistTarget("?ref=ABCDEFGH")).toBe("/waitlist?ref=ABCDEFGH");
        expect(waitlistTarget("?lang=en&ref=ABCDEFGH&x=1")).toBe("/waitlist?ref=ABCDEFGH&lang=en");
        expect(waitlistTarget("?x=1")).toBe("/waitlist");
    });
});
