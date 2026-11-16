// Event-log scan ranges for the offering section (W-T32). GIWA's RPC rejects eth_getLogs ranges over
// 10,000 blocks, so one request covers at most LOG_CHUNK (9,000) blocks.
//
// First read: only the newest MAX_CHUNKS windows (12 x 9,000 = 108,000 blocks, about 30 hours at
// ~1 s per block), never before the deployment block. When that reaches the deployment block the
// scan is complete; otherwise it is partial and says from which block it actually read.
// Later reads: from the block after the last one read up to the latest block. When that gap is
// larger than one first read (a tab asleep for more than ~30 h), the scan starts over as a first
// read, so the window [fromBlock, toBlock] stays contiguous and the complete flag stays true to it.

export const LOG_CHUNK = 9_000n;
export const MAX_CHUNKS = 12;
/** Blocks one first read covers. */
export const FIRST_READ_BLOCKS = LOG_CHUNK * BigInt(MAX_CHUNKS);

export type ScanWindow = {
    /** first block actually read */
    fromBlock: bigint;
    /** last block read */
    toBlock: bigint;
    /** fromBlock reached the deployment block: no older event can exist */
    complete: boolean;
};

export type ScanPlan = {
    /** [from, to] request ranges, each at most `chunk` blocks, oldest first */
    ranges: [bigint, bigint][];
    /** the window after these ranges are read */
    window: ScanWindow;
    /** true when earlier logs must be dropped (first read or restart) */
    reset: boolean;
};

/** [from, to] split into ranges of at most `chunk` blocks. */
export function splitRange(from: bigint, to: bigint, chunk: bigint = LOG_CHUNK): [bigint, bigint][] {
    const out: [bigint, bigint][] = [];
    for (let a = from; a <= to; a += chunk) out.push([a, a + chunk - 1n < to ? a + chunk - 1n : to]);
    return out;
}

/** What to read next. `prev` is the window read so far (undefined on the first read). */
export function planScan(p: {deployBlock: bigint; latest: bigint; prev?: ScanWindow; chunk?: bigint; maxChunks?: number}): ScanPlan {
    const chunk = p.chunk ?? LOG_CHUNK;
    const span = chunk * BigInt(p.maxChunks ?? MAX_CHUNKS);
    const first = (): ScanPlan => {
        if (p.latest < p.deployBlock) {
            // the chain is behind the deployment (wrong RPC): nothing to read, nothing exists yet
            return {ranges: [], window: {fromBlock: p.deployBlock, toBlock: p.latest, complete: true}, reset: true};
        }
        const oldest = p.latest - span + 1n;
        const from = oldest > p.deployBlock ? oldest : p.deployBlock;
        return {ranges: splitRange(from, p.latest, chunk), window: {fromBlock: from, toBlock: p.latest, complete: from === p.deployBlock}, reset: true};
    };
    if (!p.prev) return first();
    const start = p.prev.toBlock + 1n;
    if (start > p.latest) return {ranges: [], window: p.prev, reset: false};
    if (p.latest - start + 1n > span) return first();
    return {ranges: splitRange(start, p.latest, chunk), window: {...p.prev, toBlock: p.latest}, reset: false};
}

/** Screen state of a log read: failed, read part of the history, or read all of it. */
export type LogState = "loading" | "error" | "partial" | "complete";

export function logState(q: {isError: boolean; hasData: boolean; complete: boolean | undefined}): LogState {
    if (!q.hasData) return q.isError ? "error" : "loading";
    return q.complete ? "complete" : "partial";
}
