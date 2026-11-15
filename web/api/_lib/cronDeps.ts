// The real indexer dependencies (Neon + GIWA RPC), shared by the cron and the catch-up POST.
import {ADDR_V3} from "../../src/contracts/addressesV3.js";
import * as db from "./db.js";
import type {CronDeps} from "./indexer.js";
import {giwaRpc} from "./rpc.js";

export function cronDeps(sql: db.Sql): CronDeps {
    return {
        db: {
            ensureSchema: () => db.ensureSchema(sql),
            readNextBlock: () => db.readNextBlock(sql),
            loadCurves: () => db.loadCurves(sql, ADDR_V3.curveFactory),
            writeRange: (w) => db.writeRange(sql, w),
        },
        rpc: giwaRpc(),
        nowMs: () => Date.now(),
        factory: ADDR_V3.curveFactory,
        deployBlock: ADDR_V3.deployBlock,
    };
}
