import {describe, expect, it} from "vitest";
import {en} from "./en";

describe("English plurals", () => {
    it("verifiedTraders uses singular only for 1", () => {
        expect(en.curve.verifiedTraders(0)).toBe("0 verified traders");
        expect(en.curve.verifiedTraders(1)).toBe("1 verified trader");
        expect(en.curve.verifiedTraders(12)).toBe("12 verified traders");
    });
});

describe("English v3 copy guardrails", () => {
    const v3 = JSON.stringify([en.common, en.nav, en.curve, en.create, en.onboardingV3, en.tx, en.errorsV3, en.route404]);
    it("has no return-expectation or safety-claim words and no em dash", () => {
        for (const w of [/profit/i, /returns/i, /invest/i, /pump/i, /\bmoon/i, /\bgem\b/i, /\balpha\b/i, /\bsafe\b/i, /guarantee/i, /rug-proof/i, /—/, /!/]) {
            expect(v3, String(w)).not.toMatch(w);
        }
    });
    it("uses the fixed panel wording", () => {
        expect(en.curve.fixedPanel).toBe("No Dev allocation · No further minting · Liquidity locked forever");
    });
});
