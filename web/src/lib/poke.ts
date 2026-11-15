// When the browser asks the server to catch up (POST /api/chain/summary). Pure.
//
// The indexer only reads up to HEAD_LAG (10) blocks behind the chain head, so asking right after a
// transaction lands cannot include it. A sent transaction therefore asks POKE_DELAY_MS after the
// LAST successful tx (an approval followed by a buy asks once, for the buy), and retries once
// RETRY_DELAY_MS later when the answer did not cover it.

/** Ask this long after the last successful transaction (12 blocks at about 1 s). */
export const POKE_DELAY_MS = 12_000;
/** One retry this long after an answer that did not cover the transaction (the 20 s server gap). */
export const RETRY_DELAY_MS = 20_000;
/** A tab asks on its own at most this often. */
export const POKE_MIN_GAP_MS = 30_000;
/** A browser trade must be at least this old before the tab asks for it. */
export const TRADE_SETTLE_MS = 12_000;
/** Without a block time, a trade at least this many blocks past the indexer counts as settled. */
export const TRADE_SETTLE_BLOCKS = 12n;

/** Tab watcher. indexedBlock: the summary's position (null = the server has none yet; undefined =
 *  summary not loaded, so no basis to ask). newestLiveBlock / newestLiveTs: the browser's newest
 *  trade and its block time in seconds (undefined = unknown). */
export function shouldPoke(p: {
    visible: boolean;
    indexedBlock: string | null | undefined;
    newestLiveBlock: bigint | undefined;
    newestLiveTs?: number;
    lastPokeMs: number;
    nowMs: number;
}): boolean {
    if (!p.visible || p.indexedBlock === undefined || p.newestLiveBlock === undefined) return false;
    if (p.nowMs - p.lastPokeMs < POKE_MIN_GAP_MS) return false;
    if (p.indexedBlock === null) return true;
    const behind = p.newestLiveBlock - BigInt(p.indexedBlock);
    if (behind <= 0n) return false;
    if (p.newestLiveTs !== undefined) return p.nowMs - p.newestLiveTs * 1000 >= TRADE_SETTLE_MS;
    return behind >= TRADE_SETTLE_BLOCKS;
}

/** After-transaction schedule: when to ask (dueAt, ms), the newest tx block seen since the last
 *  answer, and whether the one retry was used. */
export type PokeSchedule = {dueAt: number | null; txBlock: bigint | null; retried: boolean};
export const IDLE: PokeSchedule = {dueAt: null, txBlock: null, retried: false};

/** A transaction succeeded: (re)arm POKE_DELAY_MS from now, remember its block (if known). */
export function onTxSuccess(s: PokeSchedule, nowMs: number, block?: bigint): PokeSchedule {
    const txBlock = block === undefined ? s.txBlock : s.txBlock === null || block > s.txBlock ? block : s.txBlock;
    return {dueAt: nowMs + POKE_DELAY_MS, txBlock, retried: false};
}

/** When the next scheduled ask is due (null = none). */
export const nextPokeAt = (s: PokeSchedule): number | null => s.dueAt;

/** The answer does not cover the transaction: the run was skipped (ran false), or the indexer is
 *  still before the tx block. With no known tx block only ran false counts. */
export function needsRetry(answer: {ran: boolean; indexedBlock: string | null}, txBlock: bigint | null): boolean {
    if (!answer.ran) return true;
    if (txBlock === null) return false;
    return answer.indexedBlock === null || BigInt(answer.indexedBlock) < txBlock;
}

/** After an answer (null = the request failed, treated like ran false): one retry RETRY_DELAY_MS
 *  later when needed, then idle. */
export function afterAnswer(s: PokeSchedule, answer: {ran: boolean; indexedBlock: string | null} | null, nowMs: number): PokeSchedule {
    const retry = answer === null || needsRetry(answer, s.txBlock);
    if (retry && !s.retried) return {dueAt: nowMs + RETRY_DELAY_MS, txBlock: s.txBlock, retried: true};
    return IDLE;
}
