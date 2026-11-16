// Snapshot + property tests for the allocation script.
//   node test.js
//
// The EXPECTED_ROOTS below are frozen regression values: any change to the
// algorithm, ordering, PRNG, or leaf encoding will change them and fail here.

import assert from "node:assert/strict";
import {computeAllocations, verifyResult} from "./allocate.js";
import {CHUNK, splitRange} from "./ranges.js";
import {spawnSync} from "node:child_process";

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

check("ranges: 9,000-block windows (GIWA RPC refuses > 10,000)", () => {
    assert.equal(CHUNK, 9_000n);
    // start == end: one window of one block
    assert.deepEqual(splitRange(100n, 100n), [[100n, 100n]]);
    // exactly 9,000 blocks: one window; 18,000: two, no overlap, no gap
    assert.deepEqual(splitRange(0n, 8_999n), [[0n, 8_999n]]);
    assert.deepEqual(splitRange(0n, 17_999n), [[0n, 8_999n], [9_000n, 17_999n]]);
    // one block over a multiple: a last window of one block
    assert.deepEqual(splitRange(0n, 9_000n), [[0n, 8_999n], [9_000n, 9_000n]]);
    assert.deepEqual(splitRange(41_491_893n, 41_500_893n), [[41_491_893n, 41_500_892n], [41_500_893n, 41_500_893n]]);
    // from > to: nothing to read
    assert.deepEqual(splitRange(10n, 9n), []);
    // every window within the RPC limit and contiguous
    const w = splitRange(41_491_893n, 41_560_000n);
    for (const [a, b] of w) assert.ok(b - a + 1n <= 9_000n && b - a + 1n <= 10_000n);
    for (let i = 1; i < w.length; i++) assert.equal(w[i][0], w[i - 1][1] + 1n);
    assert.equal(w[0][0], 41_491_893n);
    assert.equal(w[w.length - 1][1], 41_560_000n);
});

check("snapshot.js: --from-block is required (usage, exit 1, no RPC call)", () => {
    const run = (...a) => spawnSync(process.execPath, ["snapshot.js", ...a], {cwd: new URL(".", import.meta.url).pathname, encoding: "utf8"});
    for (const r of [
        run("--rpc", "http://127.0.0.1:9", "--offering", "0xA1AA8da4Fe05fe0bF51d3d8a464ea0269f39bB9f"),
        run("--rpc", "http://127.0.0.1:9", "--offering", "0xA1AA8da4Fe05fe0bF51d3d8a464ea0269f39bB9f", "--from-block", "latest"),
    ]) {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /usage: node snapshot\.js .*--from-block <block>/);
        assert.doesNotMatch(r.stderr, /fetch failed|ECONNREFUSED/);
    }
});

process.exit(failures === 0 ? 0 : 1);
