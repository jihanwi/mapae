import {describe, expect, it} from "vitest";
import {isUpcoming, priorityNotice, startsIn, tradeView, TradeViewInput, windowSec} from "./launchState";
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
