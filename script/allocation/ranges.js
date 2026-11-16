// Block ranges for eth_getLogs. GIWA's RPC refuses a range over 10,000 blocks
// ("block range greater than 10000 max"), so scans go in 9,000-block windows
// (the same span as script/verify-children.js and the web indexer).

export const CHUNK = 9_000n;

/** Inclusive [from, to] windows of at most `chunk` blocks covering from..to.
 *  from > to gives no window. */
export function splitRange(from, to, chunk = CHUNK) {
    if (typeof from !== "bigint" || typeof to !== "bigint" || typeof chunk !== "bigint") throw new TypeError("bigint expected");
    if (chunk <= 0n) throw new RangeError("chunk must be positive");
    const out = [];
    for (let a = from; a <= to; a += chunk) {
        const b = a + chunk - 1n < to ? a + chunk - 1n : to;
        out.push([a, b]);
    }
    return out;
}
