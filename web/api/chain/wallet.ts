// GET /api/chain/wallet?address=0x..: public wallet profile. Nickname (public by owner decision),
// tokens launched, tokens ever received, and trades summed per token. Current factory only.
import {badRequest, chainGet} from "../_lib/chainApi.js";
import {nicknameOf, walletLaunched, walletPositions, walletReceived} from "../_lib/db.js";
import {parseCurve} from "../_lib/indexer.js";
import {ADDR_V3} from "../../src/contracts/addressesV3.js";

/** 0x + 40 hex (any case) -> lowercase; null otherwise (same rule as the curve parameter). */
export const parseAddress = parseCurve;

const h = chainGet("wallet", async (sql, p) => {
    const address = parseAddress(p.get("address"));
    if (!address) return badRequest;
    const f = ADDR_V3.curveFactory;
    const [nick, launched, received, positions] = await Promise.all([
        nicknameOf(sql, address),
        walletLaunched(sql, address, f),
        walletReceived(sql, address, f),
        walletPositions(sql, address, f),
    ]);
    return {status: 200, body: {nickname: nick?.nickname ?? null, launched, received, positions}};
});
export const GET = h.GET;
export const OPTIONS = h.OPTIONS;
