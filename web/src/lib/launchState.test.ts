import {describe, expect, it} from "vitest";
import {daysHours, dayScale, isUpcoming, listStartKey, nextTickMs, priorityNotice, startsIn, tradeView, TradeViewInput, windowSec} from "./launchState";
import {hms} from "./offeringStrip";
import {ko} from "../copy/ko";
import {en} from "../copy/en";

const START = 2_000_000n;
const base: TradeViewInput = {graduated: false, started: true, priorityUntil: START + 600n, nowSec: Number(START), verifiedOnly: false, verified: true};

describe("tradeView", () => {
    it("before the start: preStart, even though the priority window already reads as open", () => {
        expect(tradeView({...base, started: false, nowSec: Number(START) - 60})).toEqual({kind: "preStart"});
        // the chain decides: the device clock past the start does not open the panel
        expect(tradeView({...base, started: false, nowSec: Number(START) + 5})).toEqual({kind: "preStart"});
    });
    it("priority window from the start, open after it", () => {
        expect(tradeView({...base, nowSec: Number(START) + 599})).toEqual({kind: "priority"});
        expect(tradeView({...base, nowSec: Number(START) + 600})).toEqual({kind: "open"});
    });
    it("verified-only + unverified wallet: blocked in and after the window; verified or unknown: as usual", () => {
        const vo = {...base, verifiedOnly: true, verified: false};
        expect(tradeView({...vo, nowSec: Number(START) + 10})).toEqual({kind: "verifiedOnlyBlocked"});
        expect(tradeView({...vo, nowSec: Number(START) + 9_999})).toEqual({kind: "verifiedOnlyBlocked"});
        expect(tradeView({...vo, verified: true, nowSec: Number(START) + 9_999})).toEqual({kind: "open"});
        expect(tradeView({...vo, verified: undefined, nowSec: Number(START) + 9_999})).toEqual({kind: "open"});
    });
    it("graduated wins over everything (no verified-only gate on the pool)", () => {
        expect(tradeView({...base, graduated: true, verifiedOnly: true, verified: false})).toEqual({kind: "graduated"});
    });
});

describe("list helpers", () => {
    it("upcoming only before the start and never once graduated", () => {
        expect(isUpcoming({graduated: false, startTime: START}, Number(START) - 1)).toBe(true);
        expect(isUpcoming({graduated: false, startTime: START}, Number(START))).toBe(false);
        expect(isUpcoming({graduated: true, startTime: START}, 0)).toBe(false);
        expect(startsIn(START, Number(START) - 90)).toBe(90);
        expect(startsIn(START, Number(START) + 90)).toBe(0);
        expect(windowSec({startTime: START, priorityUntil: START + 600n})).toBe(600);
    });
});

describe("priority-window notice (W-T61 fix)", () => {
    it("verified-only + inside the window: the verified-only rule, not 'anyone after {t}'", () => {
        const inWindow = tradeView({...base, verifiedOnly: true, verified: true, nowSec: Number(START) + 30});
        expect(inWindow).toEqual({kind: "priority"});
        expect(priorityNotice(true)).toBe("verifiedOnly");
        expect(ko.launch.verifiedOnlyBlocked).toBe("이 토큰은 졸업 전까지 실명 지갑만 살 수 있어요");
        expect(en.launch.verifiedOnlyBlocked).toBe("Only verified wallets can buy this token until it graduates.");
    });
    it("other tokens keep the window line", () => {
        expect(priorityNotice(false)).toBe("window");
        expect(ko.priority.banner("06:52")).toBe("지금은 실명 지갑만 살 수 있어요. 06:52 뒤에는 누구나 살 수 있어요");
    });
});

describe("start display a day or more ahead (W-T62)", () => {
    /** What the trade panel's big line shows, as LaunchStatus renders it. */
    const panel = (left: number, c: typeof ko | typeof en) => (dayScale(left) ? c.launch.daysHours(daysHours(left).d, daysHours(left).h) : hms(left));
    const D = 86_400;
    it("86,399 s: still the HH:MM:SS countdown, list says 'opens soon'", () => {
        expect(panel(D - 1, ko)).toBe("23:59:59");
        expect(panel(D - 1, en)).toBe("23:59:59");
        expect(listStartKey(D - 1)).toBe("soon");
        expect(ko.launch[listStartKey(D - 1)]).toBe("곧 시작");
        expect(en.launch[listStartKey(D - 1)]).toBe("Opens soon");
    });
    it("86,400 s exactly: days and hours, list says 'upcoming'", () => {
        expect(panel(D, ko)).toBe("1일 0시간");
        expect(panel(D, en)).toBe("1d 0h");
        expect(listStartKey(D)).toBe("upcoming");
        expect(ko.launch[listStartKey(D)]).toBe("예정");
        expect(en.launch[listStartKey(D)]).toBe("Upcoming");
    });
    it("6 d 22 h 59 m: minutes are dropped", () => {
        const left = 6 * D + 22 * 3600 + 59 * 60;
        expect(panel(left, ko)).toBe("6일 22시간");
        expect(panel(left, en)).toBe("6d 22h");
        expect(listStartKey(left)).toBe("upcoming");
    });
    it("7 days exactly", () => {
        expect(panel(7 * D, ko)).toBe("7일 0시간");
        expect(panel(7 * D, en)).toBe("7d 0h");
    });
    it("redraws once a minute above a day, but lands exactly on the switch to seconds", () => {
        expect(nextTickMs(7 * D)).toBe(60_000);
        expect(nextTickMs(D + 30)).toBe(31_000); // the next draw is at 86,399 s
        expect(nextTickMs(D)).toBe(1_000);
        expect(nextTickMs(D - 1)).toBe(1_000);
    });
});
