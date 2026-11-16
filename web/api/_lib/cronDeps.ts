// The real indexer dependencies (Neon + GIWA RPC), shared by the cron and the catch-up POST.
import {ADDR_V3} from "../../src/contracts/addressesV3.js";
import * as db from "./db.js";
import type {CronDeps} from "./indexer.js";
import type {L1Deps} from "./indexerL1.js";
import {L1_FACTORIES} from "../../src/contracts/addressesV3L1.js";
import {giwaRpc, giwaRpcL1} from "./rpc.js";

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

/** W-T33 / W-T40: the L1 offering indexer over every L1 factory (own cursor row; schema is ensured by
 *  the L0 run before it). */
export function l1Deps(sql: db.Sql): L1Deps {
    return {
        db: {
            readNextBlock: () => db.readNextBlockL1(sql),
            loadOfferings: () => db.loadOfferings(sql),
            writeRange: (w) => db.writeRangeL1(sql, w),
        },
        rpc: giwaRpcL1(),
        nowMs: () => Date.now(),
        factories: L1_FACTORIES.map((f) => f.mapaeFactory),
        deployBlock: db.l1IndexStart(),
    };
}
