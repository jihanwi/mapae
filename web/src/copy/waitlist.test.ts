// W-T43: waitlist and privacy copy, exactly as the ticket wrote it, with the promise guardrails.
import {describe, expect, it} from "vitest";
import {ko} from "./ko";
import {en} from "./en";
import {waitlistShareHtml} from "../../api/_lib/waitlist";
import indexHtml from "../../index.html?raw";

/** W-T70: the promise wording still forbidden in the waitlist and privacy copy ("포인트" / "points" are allowed). */
const KO_PROMISE = [/에어드랍/, /에어드롭/, /보상/, /얼리 혜택/, /혜택/, /수익/, /투자/];
const EN_PROMISE = [/airdrop/i, /reward/i, /early (access|perk|bonus)/i, /profit/i, /invest/i, /—/];
const promiseHits = (s: string, lang: "ko" | "en") => (lang === "ko" ? KO_PROMISE : EN_PROMISE).filter((w) => w.test(s)).map(String);

const texts = (o: Record<string, unknown>): string[] =>
    Object.entries(o).flatMap(([, v]) => (typeof v === "string" ? [v] : typeof v === "function" ? [String((v as (a: unknown) => unknown)("3"))] : []));

describe("waitlist copy (W-T43)", () => {
    it("W-T49: the teaser keys are gone", () => {
        for (const k of ["title", "sub", "point1", "point2", "point3", "myLink"]) {
            expect(k in ko.waitlist, k).toBe(false);
            expect(k in en.waitlist, k).toBe(false);
        }
    });
    it("the ticket's sentences", () => {
        expect(ko.waitlist.eyebrow).toBe("WAITLIST");
        expect(en.waitlist.eyebrow).toBe("WAITLIST");
        expect(ko.waitlist.cta).toBe("X로 줄 서기");
        expect(en.waitlist.cta).toBe("Join with X");
        expect(ko.waitlist.position("12")).toBe("12번째로 줄 섰어요");
        expect(en.waitlist.position("12")).toBe("You're #12 in line");
        expect(ko.waitlist.referrals(2)).toBe("내 링크로 줄 선 사람 2명");
        expect(en.waitlist.referrals(2)).toBe("2 joined through your link");
        expect(ko.waitlist.emailSaved("j***@gmail.com")).toBe("j***@gmail.com 로 알려 드릴게요");
        expect(en.waitlist.emailSaved("j***@gmail.com")).toBe("We'll notify j***@gmail.com");
        // W-T49: one English post whatever the screen language
        expect(ko.waitlist.shareText).toBe("Everyone starts from the same line. I'm in. @MapaeGiwa");
        expect(en.waitlist.shareText).toBe(ko.waitlist.shareText);
        expect(ko.waitlist.shareText).not.toMatch(/[\u3131-\u318E\uAC00-\uD7A3]/);
        expect(ko.privacy.contact("a@b.co")).toBe("문의: a@b.co");
        expect(en.privacy.contact("a@b.co")).toBe("Contact: a@b.co");
    });
    // W-T70: "포인트" / "points" are allowed in the waitlist and privacy copy (the joined screen shows
    // them); airdrop, reward, perk, profit and investment wording stays forbidden.
    it("no airdrop, rewards, early perks, profit or investment wording (note1 is a negation and is the only exception)", () => {
        const koAll = [...texts(ko.waitlist), ...texts(ko.privacy)].filter((s) => s !== ko.waitlist.note1);
        const enAll = [...texts(en.waitlist), ...texts(en.privacy)].filter((s) => s !== en.waitlist.note1);
        for (const s of koAll) expect(promiseHits(s, "ko"), s).toEqual([]);
        for (const s of enAll) expect(promiseHits(s, "en"), s).toEqual([]);
        expect(ko.waitlist.note1).toContain("약속하지 않아요");
        expect(en.waitlist.note1).toContain("not a promise");
        for (const s of [...koAll, ...enAll, ko.waitlist.note1, en.waitlist.note1]) expect(s).not.toMatch(/vercel\.app/);
    });
});

describe("W-T70: points copy", () => {
    it("the ticket's sentences", () => {
        expect(ko.waitlist.points("15")).toBe("15 포인트");
        expect(en.waitlist.points("15")).toBe("15 points");
        expect(ko.waitlist.pointsPlus(5)).toBe("+5");
        // W-T69: the invite line replaces "1명당 +N"
        expect("referralEach" in ko.waitlist || "referralEach" in en.waitlist).toBe(false);
        expect(ko.waitlist.rankNote).toBe("포인트가 많을수록 앞 순번이에요");
        expect(en.waitlist.rankNote).toBe("More points, earlier in line.");
        expect(ko.waitlist.inviteTitle).toBe("친구 초대");
        expect(en.waitlist.inviteTitle).toBe("Invite friends");
        expect(ko.waitlist.inviteHint).toBe("내 링크로 가입한 사람 1명마다");
        expect(en.waitlist.inviteHint).toBe("For each person who joins with your link");
        expect(ko.waitlist.inviteCount(3)).toBe("3명");
        expect(en.waitlist.inviteCount(3)).toBe("3 joined");
        expect(ko.waitlist.missionsTitle).toBe("순번 올리기");
        expect(en.waitlist.missionsTitle).toBe("Move up the line");
        expect(ko.waitlist.missionFollow).toBe("@MapaeGiwa 팔로우");
        expect(en.waitlist.missionRepost).toBe("Repost the opening post");
        expect(ko.waitlist.missionNote).toBe("메인넷이 열리기 전에 실제 팔로우와 리포스트를 확인하고 포인트를 다시 계산해요");
        expect(en.waitlist.missionNote).toBe("We check follows and reposts before mainnet opens and recount points.");
        expect(ko.privacy.what).toContain("팔로우, 리포스트 버튼을 누른 기록");
        expect(en.privacy.what).toContain("and whether you pressed the follow and repost buttons");
        // note1 is unchanged
        expect(ko.waitlist.note1).toBe("순번은 오픈 알림을 보내는 순서예요. 토큰이나 보상을 약속하지 않아요");
    });
    it("the checker still catches reward wording (and lets points through)", () => {
        expect(promiseHits("포인트로 보상을 받아요", "ko")).toEqual([String(/보상/)]);
        expect(promiseHits("에어드랍 혜택", "ko").length).toBe(2);
        expect(promiseHits("Earn rewards with points", "en")).toEqual([String(/reward/i)]);
        expect(promiseHits("15 포인트", "ko")).toEqual([]);
        expect(promiseHits("15 points", "en")).toEqual([]);
    });
});

describe("W-T49: nothing on the waitlist host describes the product", () => {
    const FORBIDDEN = [/런치패드/, /launchpad/i, /실명/, /bonding/i, /공모/];
    const check = (label: string, s: string) => {
        for (const w of FORBIDDEN) expect(s, `${w} in ${label}`).not.toMatch(w);
    };
    it("waitlist, privacy and not-found copy in both languages", () => {
        for (const c of [ko, en]) {
            for (const s of [...texts(c.waitlist), ...texts(c.privacy), ...texts(c.route404)]) check("copy", s);
        }
    });
    it("the share page HTML", () => {
        check("share html", waitlistShareHtml("https://mapae.fun", "ABCDEFGH"));
        check("share html", waitlistShareHtml("https://mapae.fun", null));
    });
    it("index.html", () => {
        check("index.html", indexHtml);
        expect(indexHtml).not.toContain("mapae-snowy");
        expect(indexHtml).toContain('<meta property="og:image" content="https://mapae.fun/og-waitlist.png" />');
        expect(indexHtml).toContain('<meta name="twitter:image" content="https://mapae.fun/og-waitlist.png" />');
        expect(indexHtml).toContain('<meta name="twitter:card" content="summary_large_image" />');
        expect(indexHtml).toContain('<meta property="og:url" content="https://mapae.fun/" />');
        expect(indexHtml).toContain('<meta property="og:image:width" content="1200" />');
        expect(indexHtml).toContain('<meta property="og:image:height" content="630" />');
        expect(indexHtml).toContain("<title>MAPAE</title>");
        expect(indexHtml).toContain('<meta name="description" content="Waitlist" />');
        expect(indexHtml).toContain('<meta property="og:title" content="MAPAE Waitlist" />');
        expect(indexHtml).not.toContain("og:locale");
    });
});
