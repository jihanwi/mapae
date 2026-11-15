import {describe, expect, it} from "vitest";
import {afterAnswer, IDLE, needsRetry, nextPokeAt, onTxSuccess, POKE_DELAY_MS, POKE_MIN_GAP_MS, RETRY_DELAY_MS, shouldPoke, TRADE_SETTLE_BLOCKS, TRADE_SETTLE_MS} from "./poke";

describe("after-transaction schedule", () => {
    it("approval then buy 5 s later: one ask, 12 s after the buy", () => {
        let s = onTxSuccess(IDLE, 0, 100n); // approval
        expect(nextPokeAt(s)).toBe(POKE_DELAY_MS);
        s = onTxSuccess(s, 5_000, 105n); // buy re-arms the timer
        expect(nextPokeAt(s)).toBe(5_000 + POKE_DELAY_MS);
        expect(s.txBlock).toBe(105n);
    });
    it("ran false: one retry 20 s later, then nothing more", () => {
        let s = onTxSuccess(IDLE, 0, 105n);
        s = afterAnswer(s, {ran: false, indexedBlock: "90"}, 12_000);
        expect(nextPokeAt(s)).toBe(12_000 + RETRY_DELAY_MS);
        expect(s.retried).toBe(true);
        s = afterAnswer(s, {ran: false, indexedBlock: "90"}, 32_000);
        expect(s).toEqual(IDLE);
    });
    it("ran true but still before the tx block: retry once; covering it: done", () => {
        const s = onTxSuccess(IDLE, 0, 105n);
        expect(nextPokeAt(afterAnswer(s, {ran: true, indexedBlock: "104"}, 12_000))).toBe(32_000);
        expect(afterAnswer(s, {ran: true, indexedBlock: "105"}, 12_000)).toEqual(IDLE);
    });
    it("a failed request retries once like ran false", () => {
        const s = onTxSuccess(IDLE, 0, 105n);
        expect(nextPokeAt(afterAnswer(s, null, 12_000))).toBe(32_000);
    });
    it("no tx block known: retry only on ran false", () => {
        expect(needsRetry({ran: true, indexedBlock: "1"}, null)).toBe(false);
        expect(needsRetry({ran: false, indexedBlock: "1"}, null)).toBe(true);
        expect(needsRetry({ran: true, indexedBlock: null}, 5n)).toBe(true);
    });
});

describe("shouldPoke (tab watcher)", () => {
    const nowMs = 1_000_000_000;
    const base = {visible: true, indexedBlock: "1000", newestLiveBlock: 1001n, newestLiveTs: (nowMs - TRADE_SETTLE_MS) / 1000, lastPokeMs: nowMs - POKE_MIN_GAP_MS, nowMs};
    it("asks for any trade past the indexer once it is 12 s old, at most every 30 s", () => {
        expect(shouldPoke(base)).toBe(true);
        expect(shouldPoke({...base, newestLiveTs: (nowMs - TRADE_SETTLE_MS + 1000) / 1000})).toBe(false);
        expect(shouldPoke({...base, lastPokeMs: nowMs - POKE_MIN_GAP_MS + 1})).toBe(false);
    });
    it("nothing past the indexer, hidden, or no summary: no", () => {
        expect(shouldPoke({...base, newestLiveBlock: 1000n})).toBe(false);
        expect(shouldPoke({...base, visible: false})).toBe(false);
        expect(shouldPoke({...base, indexedBlock: undefined})).toBe(false);
        expect(shouldPoke({...base, newestLiveBlock: undefined})).toBe(false);
    });
    it("no block time: 12 blocks past the indexer stands in for 12 s", () => {
        const noTs = {...base, newestLiveTs: undefined};
        expect(shouldPoke({...noTs, newestLiveBlock: 1000n + TRADE_SETTLE_BLOCKS})).toBe(true);
        expect(shouldPoke({...noTs, newestLiveBlock: 1000n + TRADE_SETTLE_BLOCKS - 1n})).toBe(false);
    });
    it("server without a position yet: ask", () => {
        expect(shouldPoke({...base, indexedBlock: null})).toBe(true);
    });
});
