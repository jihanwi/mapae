import {describe, expect, it} from "vitest";
import {commentCta, CommentView, prependComment, removeComment} from "./comments";
import {sessionUsable, StoredSession} from "./session";

const base = {connected: true, rightChain: true, verified: true as boolean | undefined, nickname: "말발굽" as string | null | undefined, hasSession: true};
const c = (id: number): CommentView => ({id, nickname: "n", body: "b", createdAt: "2026-11-14T00:00:00Z", holder: false, dev: false});

describe("commentCta follows the trade CTA order", () => {
    it("connect, switch, verify, nickname, sign, post", () => {
        expect(commentCta({...base, connected: false, rightChain: false, verified: false, nickname: null, hasSession: false})).toBe("connect");
        expect(commentCta({...base, rightChain: false, verified: false, nickname: null})).toBe("switch");
        expect(commentCta({...base, verified: false, nickname: null})).toBe("verify");
        expect(commentCta({...base, nickname: null})).toBe("nickname");
        expect(commentCta({...base, hasSession: false})).toBe("sign");
        expect(commentCta(base)).toBe("post");
    });
    it("waits while verification or nickname is loading", () => {
        expect(commentCta({...base, verified: undefined})).toBe("loading");
        expect(commentCta({...base, nickname: undefined})).toBe("loading");
    });
});

describe("optimistic cache updates", () => {
    it("puts a new comment on top of the first page, once", () => {
        const data = {pages: [{comments: [c(5), c(4)], nextBefore: 4}, {comments: [c(3)], nextBefore: null}], pageParams: [undefined, 4]};
        const next = prependComment(data, c(6));
        expect(next.pages[0].comments.map((x) => x.id)).toEqual([6, 5, 4]);
        expect(next.pages[1]).toBe(data.pages[1]);
        expect(prependComment(next, c(6))).toBe(next);
        expect(prependComment(undefined, c(1)).pages[0].comments.map((x) => x.id)).toEqual([1]);
    });
    it("removes a deleted comment from every page", () => {
        const data = {pages: [{comments: [c(5), c(4)], nextBefore: null}], pageParams: [undefined]};
        expect(removeComment(data, 5)!.pages[0].comments.map((x) => x.id)).toEqual([4]);
    });
});

describe("sessionUsable", () => {
    const s: StoredSession = {wallet: "0xab", key: "0x01", delegate: "0xcd", expires: 1000, signature: "0x02", mine: []};
    it("needs the same wallet and time left", () => {
        expect(sessionUsable(s, "0xAB", 500)).toBe(true);
        expect(sessionUsable(s, "0xef", 500)).toBe(false);
        expect(sessionUsable(s, "0xab", 950)).toBe(false); // under a minute left
        expect(sessionUsable(null, "0xab", 0)).toBe(false);
    });
});
