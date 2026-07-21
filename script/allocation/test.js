// Snapshot + property tests for the allocation script.
//   node test.js
//
// The EXPECTED_ROOTS below are frozen regression values: any change to the
// algorithm, ordering, PRNG, or leaf encoding will change them and fail here.

import assert from "node:assert/strict";
import {computeAllocations, verifyResult} from "./allocate.js";

const WAD = 10n ** 18n;
const PRICE = 10_000n * WAD;
const RAISE = 1_000_000n * WAD;
const QSALE = (RAISE * WAD) / PRICE;
const SEED = "0x" + Buffer.from("mapae allocation fixture seed v1").toString("hex");

const EXPECTED_ROOTS = {
    oversub: "0x7c9cea9cc66925da645e0e08191d58880565728c4226a337c7a8096f10b9d773",
    undersub: "0x221f89fb1f2b5324607b037a60f299bd8ae2de6d589445903a66abe5d978a205",
};

const oversub = [
    {address: "0x0000000000000000000000000000000000000a01", committed: 300_000n * WAD},
    {address: "0x0000000000000000000000000000000000000a02", committed: 300_000n * WAD},
    {address: "0x0000000000000000000000000000000000000a03", committed: 300_000n * WAD},
    {address: "0x0000000000000000000000000000000000000a04", committed: 150_000n * WAD},
    {address: "0x0000000000000000000000000000000000000a05", committed: 50_000n * WAD},
];
const undersub = [
    {address: "0x0000000000000000000000000000000000000a01", committed: 300_000n * WAD},
    {address: "0x0000000000000000000000000000000000000a02", committed: 200_000n * WAD},
    {address: "0x0000000000000000000000000000000000000a03", committed: 100_000n * WAD},
];

let failures = 0;
function check(name, fn) {
    try {
        fn();
        console.log(`ok   ${name}`);
    } catch (e) {
        failures++;
        console.error(`FAIL ${name}: ${e.message}`);
    }
}

check("oversub: snapshot root matches frozen value", () => {
    const r = computeAllocations(oversub, SEED, QSALE, PRICE);
    verifyResult(r);
    assert.equal(r.root, EXPECTED_ROOTS.oversub);
    assert.equal(r.totalSold, QSALE); // fully sold
    assert.equal(r.totalRaised, RAISE); // exactly R at these round numbers
});

check("undersub: snapshot root matches frozen value", () => {
    const r = computeAllocations(undersub, SEED, QSALE, PRICE);
    verifyResult(r);
    assert.equal(r.root, EXPECTED_ROOTS.undersub);
    assert.equal(r.totalSold, 60n * WAD); // everyone fully allocated
    assert.equal(r.totalRaised, 600_000n * WAD);
    for (const row of r.rows) assert.equal(row.refund, 0n);
});

check("determinism: same input + seed → identical root across runs", () => {
    const a = computeAllocations(oversub, SEED, QSALE, PRICE);
    const b = computeAllocations([...oversub].reverse(), SEED, QSALE, PRICE); // input order irrelevant
    assert.equal(a.root, b.root);
});

check("different seed → different lottery outcome", () => {
    const altSeed = "0x" + "11".repeat(32);
    const a = computeAllocations(oversub, SEED, QSALE, PRICE);
    const b = computeAllocations(oversub, altSeed, QSALE, PRICE);
    assert.equal(a.totalSold, b.totalSold); // aggregates identical
    assert.notEqual(a.root, b.root); // winners differ (true for these fixtures)
});

check("oversub: equal share honored, lottery only tops up unmet demand", () => {
    const r = computeAllocations(oversub, SEED, QSALE, PRICE);
    const equal = QSALE / 5n;
    for (const row of r.rows) {
        const req = (row.committed * WAD) / PRICE;
        const base = req < equal ? req : equal;
        assert.ok(row.allocation >= base, `allocation below equal share for ${row.address}`);
        assert.ok(row.allocation <= req, `allocation above request for ${row.address}`);
    }
});

check("dust: cost floor rounds in favor of the fan (D1)", () => {
    // Odd price forces flooring: requested = floor(commit/P) leaves dust refunded.
    const price = 3n * WAD; // 3 KRWs per token
    const snapshot = [{address: "0x0000000000000000000000000000000000000a01", committed: 10n * WAD}];
    const r = computeAllocations(snapshot, SEED, 100n * WAD, price);
    verifyResult(r);
    const row = r.rows[0];
    assert.equal(row.allocation, (10n * WAD) / 3n); // 3.333... tokens
    assert.ok(row.cost <= 10n * WAD);
    assert.equal(row.refund, row.committed - row.cost);
    assert.ok(row.refund > 0n); // dust went back to the fan
});

process.exit(failures === 0 ? 0 : 1);
