import {describe, expect, it} from "vitest";
import {FEED_PAGE, nextFeedBefore} from "./follow";

describe("feed paging", () => {
    const page = (n: number) => Array.from({length: n}, (_, i) => ({ts: String(1_000 - i)}));
    it("a full page continues before its oldest ts; a short page ends", () => {
        expect(FEED_PAGE).toBe(50);
        expect(nextFeedBefore(page(50))).toBe("951");
        expect(nextFeedBefore(page(49))).toBeUndefined();
        expect(nextFeedBefore([])).toBeUndefined();
    });
});

import {FOLLOW_PROTECT_MS, followProtected, nextCounts} from "./follow";

describe("follow answer -> cached counts", () => {
    const ME = "0x00000000000000000000000000000000000000A1";
    const T = "0x00000000000000000000000000000000000000b2";
    const ans = {following: true, isFollowing: true, targetFollowers: 4, myFollowing: 9};
    it("target seen by me: followers from the answer, isFollowing flips; its following stays", () => {
        expect(nextCounts({followers: 3, following: 5, isFollowing: false}, {wallet: T, viewer: ME.toLowerCase()}, ME, T, ans)).toEqual({followers: 4, following: 5, isFollowing: true});
    });
    it("target without a viewer: only followers", () => {
        expect(nextCounts({followers: 3, following: 5}, {wallet: T, viewer: null}, ME, T, ans)).toEqual({followers: 4, following: 5});
    });
    it("my own profile: following from the answer, nothing else", () => {
        expect(nextCounts({followers: 2, following: 8, isFollowing: false}, {wallet: ME, viewer: ME}, ME, T, ans)).toEqual({followers: 2, following: 9, isFollowing: false});
    });
    it("unfollow answer, and nothing cached yet", () => {
        const un = {following: false, isFollowing: false, targetFollowers: 3, myFollowing: 8};
        expect(nextCounts({followers: 4, following: 5, isFollowing: true}, {wallet: T, viewer: ME}, ME, T, un)).toEqual({followers: 3, following: 5, isFollowing: false});
        expect(nextCounts(undefined, {wallet: T, viewer: ME}, ME, T, un)).toBeUndefined();
    });
    it("re-reads are held for the protection window only", () => {
        const until = new Map([[T.toLowerCase(), 1_000 + FOLLOW_PROTECT_MS]]);
        expect(followProtected(until, T, 1_000)).toBe(true);
        expect(followProtected(until, T.toUpperCase().replace("0X", "0x"), 1_000 + FOLLOW_PROTECT_MS - 1)).toBe(true);
        expect(followProtected(until, T, 1_000 + FOLLOW_PROTECT_MS)).toBe(false);
        expect(followProtected(until, ME, 1_000)).toBe(false);
        expect(FOLLOW_PROTECT_MS).toBe(20_000);
    });
});
