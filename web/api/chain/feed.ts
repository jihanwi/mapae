// GET /api/chain/feed?wallet=0x..&before=<ts>: trades of the wallets `wallet` follows, newest first,
// 50 per page (decision 53). Rows as /api/chain/wallet-trades plus the token name and the trader's
// nickname. Current factory only. The usual chain rules: unknown parameters 400, schema retry, 503.
import {badRequest, chainGet} from "../_lib/chainApi.js";
import {feed} from "../_lib/db.js";
import {parseBefore, parseCurve} from "../_lib/indexer.js";
import {ADDR_V3} from "../../src/contracts/addressesV3.js";

export function parseFeedParams(p: URLSearchParams): {wallet: string; before: bigint | undefined} | null {
    const wallet = parseCurve(p.get("wallet"));
    const before = parseBefore(p.get("before"));
    if (!wallet || before === null) return null;
    return {wallet, before};
}

const h = chainGet("feed", {params: ["wallet", "before"], cache: "s-maxage=15"}, async (sql, p) => {
    const q = parseFeedParams(p);
    if (!q) return badRequest;
    return {status: 200, body: {trades: await feed(sql, q.wallet, ADDR_V3.curveFactory, q.before)}};
});
export const GET = h.GET;
export const OPTIONS = h.OPTIONS;
