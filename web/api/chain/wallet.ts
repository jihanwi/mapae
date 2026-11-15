// GET /api/chain/wallet?address=0x..: public wallet profile. Nickname (public by owner decision),
// tokens launched, tokens ever received, and per-token moving-average positions folded from this
// wallet's trades in chain order (more than WALLET_FOLD_LIMIT trades: positions [] and
// positionsTruncated true). Current factory only.
import {badRequest, chainGet} from "../_lib/chainApi.js";
import {nicknameOf, readState, WALLET_FOLD_LIMIT, walletLaunched, walletReceived, walletTradeRows} from "../_lib/db.js";
import {foldTrades, positionOut} from "../_lib/positions.js";
import {parseCurve} from "../_lib/indexer.js";
import {ADDR_V3} from "../../src/contracts/addressesV3.js";

/** 0x + 40 hex (any case) -> lowercase; null otherwise (same rule as the curve parameter). */
export const parseAddress = parseCurve;

const h = chainGet("wallet", {params: ["address"]}, async (sql, p) => {
    const address = parseAddress(p.get("address"));
    if (!address) return badRequest;
    const f = ADDR_V3.curveFactory;
    // indexedBlock is read in the same request as the positions, so the browser adds exactly the
    // trades after what was folded here.
    const [nick, launched, received, rows, state] = await Promise.all([
        nicknameOf(sql, address),
        walletLaunched(sql, address, f),
        walletReceived(sql, address, f),
        walletTradeRows(sql, address, f),
        readState(sql),
    ]);
    const positionsTruncated = rows.length > WALLET_FOLD_LIMIT;
    const positions = positionsTruncated ? [] : foldTrades(rows).map(positionOut);
    return {status: 200, body: {nickname: nick?.nickname ?? null, indexedBlock: state.indexedBlock, launched, received, positions, positionsTruncated}};
});
export const GET = h.GET;
export const OPTIONS = h.OPTIONS;
