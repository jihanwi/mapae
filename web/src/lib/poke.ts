// When the browser asks the server to catch up (POST /api/chain/summary). Pure.

/** Browser trades must be more than this many blocks past the indexer before a visible tab asks. */
export const POKE_LAG_BLOCKS = 60n;
/** A tab asks at most once per minute on its own (a sent transaction asks right away regardless). */
export const POKE_MIN_GAP_MS = 60_000;

/** indexedBlock: the summary's position (null = the server has none yet, e.g. right after a
 *  version switch; undefined = summary not loaded or down, so no basis to ask). newestLiveBlock:
 *  the newest block among the browser's trades (undefined = none). */
export function shouldPoke(p: {visible: boolean; indexedBlock: string | null | undefined; newestLiveBlock: bigint | undefined; lastPokeMs: number; nowMs: number}): boolean {
    if (!p.visible || p.indexedBlock === undefined || p.newestLiveBlock === undefined) return false;
    if (p.nowMs - p.lastPokeMs < POKE_MIN_GAP_MS) return false;
    if (p.indexedBlock === null) return true;
    return p.newestLiveBlock - BigInt(p.indexedBlock) > POKE_LAG_BLOCKS;
}
