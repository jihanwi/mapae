// GET /api/chain/wallet-trades?address=0x..&before=<ts>&limit=<=50: this wallet's trades, newest
// first, with curve and symbol. Same paging as /api/chain/trades. Current factory only.
import {badRequest, chainGet} from "../_lib/chainApi.js";
import {walletTrades} from "../_lib/db.js";
import {parseBefore, parseCurve, parseLimit} from "../_lib/indexer.js";
import {ADDR_V3} from "../../src/contracts/addressesV3.js";

export function parseWalletTradesParams(p: URLSearchParams): {address: string; before: bigint | undefined; limit: number} | null {
    const address = parseCurve(p.get("address"));
    const before = parseBefore(p.get("before"));
    const limit = parseLimit(p.get("limit"));
    if (!address || before === null || limit === null) return null;
    return {address, before, limit};
}

const h = chainGet("wallet-trades", async (sql, p) => {
    const q = parseWalletTradesParams(p);
    if (!q) return badRequest;
    return {status: 200, body: {trades: await walletTrades(sql, q.address, ADDR_V3.curveFactory, q.before, q.limit)}};
});
export const GET = h.GET;
export const OPTIONS = h.OPTIONS;
