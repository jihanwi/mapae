// Generates the Foundry E2E fixtures in test/fixtures/ from canonical inputs.
// Deterministic: re-running always produces identical files (same seed/inputs).
//
//   node genfixtures.js
//
// Fixture shape is flat-keyed for vm.parseJson* (proofs under "proofs_<i>").

import {computeAllocations, verifyResult} from "./allocate.js";
import {writeFileSync} from "node:fs";

const WAD = 10n ** 18n;
const PRICE = 10_000n * WAD; // P: 10,000 KRWs per membership token
const RAISE = 1_000_000n * WAD; // R: 1,000,000 KRWs
const QSALE = (RAISE * WAD) / PRICE; // 100 tokens
const SEED = "0x" + Buffer.from("mapae allocation fixture seed v1").toString("hex"); // 32 bytes exactly

const SCENARIOS = {
    // Oversubscribed, mode A: Σ commits 1.1M > R. requested = 30/30/30/15/5 (Σ110 > 100).
    // equal = 20 → base 20/20/20/15/5 (Σ80), remaining 20 raffled among a01/a02/a03.
    oversub: [
        {address: "0x0000000000000000000000000000000000000a01", committed: 300_000n * WAD},
        {address: "0x0000000000000000000000000000000000000a02", committed: 300_000n * WAD},
        {address: "0x0000000000000000000000000000000000000a03", committed: 300_000n * WAD},
        {address: "0x0000000000000000000000000000000000000a04", committed: 150_000n * WAD},
        {address: "0x0000000000000000000000000000000000000a05", committed: 50_000n * WAD},
    ],
    // Undersubscribed, mode B: Σ commits 600k < R → all fully allocated,
    // totalSold 60, unsold 40 burned at settle.
    undersub: [
        {address: "0x0000000000000000000000000000000000000a01", committed: 300_000n * WAD},
        {address: "0x0000000000000000000000000000000000000a02", committed: 200_000n * WAD},
        {address: "0x0000000000000000000000000000000000000a03", committed: 100_000n * WAD},
    ],
};

for (const [name, snapshot] of Object.entries(SCENARIOS)) {
    const result = computeAllocations(snapshot, SEED, QSALE, PRICE);
    verifyResult(result);
    const fixture = {
        price: PRICE.toString(),
        raiseTarget: RAISE.toString(),
        qSale: QSALE.toString(),
        seed: SEED,
        root: result.root,
        totalSold: result.totalSold.toString(),
        totalRaised: result.totalRaised.toString(),
        participants: result.rows.map((r) => r.address),
        commits: result.rows.map((r) => r.committed.toString()),
        allocations: result.rows.map((r) => r.allocation.toString()),
        refunds: result.rows.map((r) => r.refund.toString()),
    };
    result.rows.forEach((_, i) => (fixture[`proofs_${i}`] = result.proofs[i]));
    const path = `../../test/fixtures/${name}.json`;
    writeFileSync(new URL(path, import.meta.url), JSON.stringify(fixture, null, 2) + "\n");
    console.log(`${name}: root=${result.root} totalSold=${result.totalSold} totalRaised=${result.totalRaised}`);
}
