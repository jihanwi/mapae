// GET /api/chain/offerings (W-T33): v3.2-L1 fixed-price offerings from the L1 indexer.
//   (no params)                        -> {offerings: [...], indexedBlock}
//   ?offering=0x..                     -> {offering, commitments, redeemItems, indexedBlock}; 404 when unknown
//   ?offering=0x..&feed=swaps|sponsors|commits[&before=<block>] -> {rows (newest first, 50), indexedBlock}
// indexedBlock is the last block the L1 indexer covered (null before its first run): events after it
// are read by the browser. Unknown parameters are a 400; `v` is the client's cache key.
import {badRequest, chainGet, SUMMARY_CACHE} from "../_lib/chainApi.js";
import {OfferingFeed, offeringDetail, offeringFeed, offeringList, readStateL1} from "../_lib/db.js";
import {parseBefore, parseCurve} from "../_lib/indexer.js";

export const FEEDS: readonly OfferingFeed[] = ["swaps", "sponsors", "commits"];

/** feed value -> feed; undefined when absent, null when invalid. */
export function parseFeed(v: string | null): OfferingFeed | undefined | null {
    if (v === null) return undefined;
    return (FEEDS as readonly string[]).includes(v) ? (v as OfferingFeed) : null;
}

const h = chainGet("offerings", {params: ["offering", "feed", "before"], cache: SUMMARY_CACHE}, async (sql, p) => {
    const rawOffering = p.get("offering");
    const offering = rawOffering === null ? undefined : parseCurve(rawOffering);
    const feed = parseFeed(p.get("feed"));
    const before = parseBefore(p.get("before"));
    if (offering === null || feed === null || before === null) return badRequest;
    // feed and before only with an offering; before only with a feed
    if (offering === undefined && (feed !== undefined || before !== undefined)) return badRequest;
    if (feed === undefined && before !== undefined) return badRequest;

    if (offering === undefined) {
        const [state, offerings] = await Promise.all([readStateL1(sql), offeringList(sql)]);
        return {status: 200, body: {indexedBlock: state.indexedBlock, offerings}};
    }
    if (feed !== undefined) {
        const [state, rows] = await Promise.all([readStateL1(sql), offeringFeed(sql, offering, feed, before)]);
        return {status: 200, body: {indexedBlock: state.indexedBlock, offering, feed, rows}};
    }
    const [state, d] = await Promise.all([readStateL1(sql), offeringDetail(sql, offering)]);
    if (!d.row) return {status: 404, body: {error: "not_found", indexedBlock: state.indexedBlock}};
    return {status: 200, body: {indexedBlock: state.indexedBlock, offering: d.row, commitments: d.commitments, redeemItems: d.redeemItems}};
});
export const GET = h.GET;
export const OPTIONS = h.OPTIONS;
