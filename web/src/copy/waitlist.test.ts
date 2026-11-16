// W-T43: waitlist and privacy copy, exactly as the ticket wrote it, with the promise guardrails.
import {describe, expect, it} from "vitest";
import {ko} from "./ko";
import {en} from "./en";

const texts = (o: Record<string, unknown>): string[] =>
    Object.entries(o).flatMap(([, v]) => (typeof v === "string" ? [v] : typeof v === "function" ? [String((v as (a: unknown) => unknown)("3"))] : []));

describe("waitlist copy (W-T43)", () => {
    it("the ticket's sentences", () => {
        expect(ko.waitlist.title).toBe("모두가 같은 출발선에서 시작하는 런치패드");
        expect(en.waitlist.title).toBe("Everyone starts from the same line.");
        expect(ko.waitlist.cta).toBe("X로 줄 서기");
        expect(en.waitlist.cta).toBe("Join with X");
        expect(ko.waitlist.position("12")).toBe("12번째로 줄 섰어요");
        expect(en.waitlist.position("12")).toBe("You're #12 in line");
        expect(ko.waitlist.referrals(2)).toBe("내 링크로 줄 선 사람 2명");
        expect(en.waitlist.referrals(2)).toBe("2 joined through your link");
        expect(ko.waitlist.emailSaved("j***@gmail.com")).toBe("j***@gmail.com 로 알려 드릴게요");
        expect(en.waitlist.emailSaved("j***@gmail.com")).toBe("We'll notify j***@gmail.com");
        expect(en.waitlist.shareText).toBe("I'm in line for @MapaeGiwa, the launchpad where everyone starts from the same line.");
        expect(ko.privacy.contact("a@b.co")).toBe("문의: a@b.co");
        expect(en.privacy.contact("a@b.co")).toBe("Contact: a@b.co");
    });
    it("no airdrop, points, rewards, early perks, profit or investment wording (note1 is a negation and is the only exception)", () => {
        const koAll = [...texts(ko.waitlist), ...texts(ko.privacy)].filter((s) => s !== ko.waitlist.note1);
        const enAll = [...texts(en.waitlist), ...texts(en.privacy)].filter((s) => s !== en.waitlist.note1);
        for (const s of koAll) for (const w of [/에어드랍/, /에어드롭/, /포인트/, /보상/, /얼리 혜택/, /혜택/, /수익/, /투자/]) expect(s, `${w} in ${s}`).not.toMatch(w);
        for (const s of enAll) for (const w of [/airdrop/i, /\bpoints?\b/i, /reward/i, /early (access|perk|bonus)/i, /profit/i, /invest/i, /—/]) expect(s, `${w} in ${s}`).not.toMatch(w);
        expect(ko.waitlist.note1).toContain("약속하지 않아요");
        expect(en.waitlist.note1).toContain("not a promise");
        for (const s of [...koAll, ...enAll, ko.waitlist.note1, en.waitlist.note1]) expect(s).not.toMatch(/vercel\.app/);
    });
});
