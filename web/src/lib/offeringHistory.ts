// Offering history from the L1 indexer API plus the browser's live tail (W-T33). Pure.
// The API covers blocks up to indexedBlock; the browser reads indexedBlock + 1 .. latest and the
// two are merged by (tx, logIndex), so an event seen by both is counted once.

export type Keyed = {tx: string; logIndex: number; block: bigint};

const key = (x: {tx: string; logIndex: number}) => `${x.tx.toLowerCase()}:${x.logIndex}`;

/** API rows and live rows, deduplicated by (tx, logIndex), newest first. */
export function mergeHistory<T extends Keyed>(api: readonly T[], live: readonly T[]): T[] {
    const m = new Map<string, T>();
    for (const x of api) m.set(key(x), x);
    for (const x of live) if (!m.has(key(x))) m.set(key(x), x);
    return [...m.values()].sort((a, b) => (a.block !== b.block ? (a.block > b.block ? -1 : 1) : b.logIndex - a.logIndex));
}

/** First block the browser reads: after the indexer, or the deployment when the API has no
 *  position (indexer not run yet) or failed. */
export function liveStart(indexedBlock: string | null | undefined, deployBlock: bigint): bigint {
    if (indexedBlock === null || indexedBlock === undefined) return deployBlock;
    const next = BigInt(indexedBlock) + 1n;
    return next > deployBlock ? next : deployBlock;
}

export type Commit = Keyed & {wallet: string; cumulative: bigint};

/** Wallets whose last cumulative is > 0: the API's last commitment per wallet, then the live
 *  Committed / Cancelled events in chain order (later events replace earlier ones). */
export function participantCount(apiLast: readonly Commit[], live: readonly Commit[]): number {
    const last = new Map<string, Commit>();
    const apply = (c: Commit) => {
        const w = c.wallet.toLowerCase();
        const prev = last.get(w);
        if (!prev || prev.block < c.block || (prev.block === c.block && prev.logIndex < c.logIndex)) last.set(w, c);
    };
    for (const c of apiLast) apply(c);
    for (const c of live) apply(c);
    let n = 0;
    for (const c of last.values()) if (c.cumulative > 0n) n++;
    return n;
}
