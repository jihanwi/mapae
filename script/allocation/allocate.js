// MAPAE offering allocation — deterministic: same snapshot + seed → same output.
//
// Algorithm (docs/SPEC.md §3, docs/TRUST.md):
//   1. requested_i = floor(committed_i * 1e18 / P)  (tokens the commit affords)
//   2. If Σ requested <= qSale: everyone receives requested in full.
//   3. Else:
//      a. equal = floor(qSale / n); base_i = min(requested_i, equal)
//      b. remaining = qSale - Σ base is raffled among unmet demand:
//         repeat: draw r = keccak256(seed ‖ round) mod Σ deficit, walk the
//         address-sorted list to find the winner, grant them
//         min(deficit_winner, remaining), zero their deficit.
//   4. cost_i = floor(allocation_i * P / 1e18); refund_i = committed_i - cost_i
//      → all division dust refunds to the fan (D1), never to the platform.
//
// Merkle leaf: keccak256(bytes.concat(keccak256(abi.encode(address, allocation,
// refund)))) — the @openzeppelin/merkle-tree StandardMerkleTree encoding, matching
// Offering.claim() exactly.

import {StandardMerkleTree} from "@openzeppelin/merkle-tree";
import {keccak256} from "ethereum-cryptography/keccak.js";
import {hexToBytes, bytesToHex} from "ethereum-cryptography/utils.js";
import {readFileSync, writeFileSync} from "node:fs";

const WAD = 10n ** 18n;

function sum(arr) {
    return arr.reduce((a, b) => a + b, 0n);
}

/** keccak256(seed(bytes32) ‖ round(uint256 BE)) as BigInt. */
function prng(seedHex, round) {
    const seedBytes = hexToBytes(seedHex.replace(/^0x/, "").padStart(64, "0"));
    const roundBytes = hexToBytes(round.toString(16).padStart(64, "0"));
    const buf = new Uint8Array(64);
    buf.set(seedBytes, 0);
    buf.set(roundBytes, 32);
    return BigInt("0x" + bytesToHex(keccak256(buf)));
}

/**
 * @param {Array<{address: string, committed: bigint|string}>} snapshot final commit snapshot
 * @param {string} seed bytes32 hex (delayed blockhash on production)
 * @param {bigint} qSale tokens for sale (wei)
 * @param {bigint} price P: payment wei per 1e18 token wei
 */
export function computeAllocations(snapshot, seed, qSale, price) {
    // Canonical order: lowercase address ascending — required for determinism.
    const parts = snapshot
        .map((s) => ({address: s.address.toLowerCase(), committed: BigInt(s.committed)}))
        .sort((a, b) => (a.address < b.address ? -1 : 1));
    const seen = new Set();
    for (const p of parts) {
        if (seen.has(p.address)) throw new Error(`duplicate address ${p.address}`);
        if (p.committed <= 0n) throw new Error(`non-positive commit for ${p.address}`);
        seen.add(p.address);
    }

    const requested = parts.map((p) => (p.committed * WAD) / price);
    let allocation;

    if (sum(requested) <= qSale) {
        allocation = [...requested];
    } else {
        const equal = qSale / BigInt(parts.length);
        allocation = requested.map((r) => (r < equal ? r : equal));
        const deficit = requested.map((r, i) => r - allocation[i]);
        let remaining = qSale - sum(allocation);
        let round = 0;
        while (remaining > 0n) {
            const totalDeficit = sum(deficit);
            if (totalDeficit === 0n) break;
            const r = prng(seed, round) % totalDeficit;
            let acc = 0n;
            let winner = -1;
            for (let i = 0; i < deficit.length; i++) {
                if (deficit[i] === 0n) continue;
                acc += deficit[i];
                if (r < acc) {
                    winner = i;
                    break;
                }
            }
            const grant = deficit[winner] < remaining ? deficit[winner] : remaining;
            allocation[winner] += grant;
            deficit[winner] = 0n;
            remaining -= grant;
            round++;
        }
    }

    const rows = parts.map((p, i) => {
        const cost = (allocation[i] * price) / WAD;
        return {
            address: p.address,
            committed: p.committed,
            allocation: allocation[i],
            cost,
            refund: p.committed - cost, // D1: dust always refunds to the fan
        };
    });

    const totalSold = sum(rows.map((r) => r.allocation));
    const totalRaised = sum(rows.map((r) => r.cost));

    const tree = StandardMerkleTree.of(
        rows.map((r) => [r.address, r.allocation, r.refund]),
        ["address", "uint256", "uint256"]
    );
    const proofs = rows.map((r) => tree.getProof([r.address, r.allocation, r.refund]));

    return {seed, price, qSale, totalSold, totalRaised, root: tree.root, rows, proofs};
}

/** Self-check: anyone re-running this must land on identical aggregates. */
export function verifyResult(result) {
    const {rows, totalSold, totalRaised, qSale, price} = result;
    if (sum(rows.map((r) => r.allocation)) !== totalSold) throw new Error("Σ allocation != totalSold");
    if (sum(rows.map((r) => r.cost)) !== totalRaised) throw new Error("Σ cost != totalRaised");
    if (totalSold > qSale) throw new Error("totalSold > qSale");
    for (const r of rows) {
        if (r.allocation > (r.committed * WAD) / price) throw new Error(`over-allocation for ${r.address}`);
        if (r.cost !== (r.allocation * price) / WAD) throw new Error(`cost mismatch for ${r.address}`);
        if (r.refund !== r.committed - r.cost) throw new Error(`refund mismatch for ${r.address}`);
    }
    return true;
}

/** Serialize to allocations.json (all bigints as decimal strings). */
export function toOutputJson(result) {
    return {
        seed: result.seed,
        price: result.price.toString(),
        qSale: result.qSale.toString(),
        totalSold: result.totalSold.toString(),
        totalRaised: result.totalRaised.toString(),
        root: result.root,
        allocations: result.rows.map((r, i) => ({
            address: r.address,
            committed: r.committed.toString(),
            allocation: r.allocation.toString(),
            cost: r.cost.toString(),
            refund: r.refund.toString(),
            proof: result.proofs[i],
        })),
    };
}

// ---------------------------------------------------------------------------
// CLI: node allocate.js --snapshot snapshot.json --seed 0x.. --out allocations.json
// snapshot.json: {"price": "...", "raiseTarget": "..."|"qSale": "...",
//                 "participants": [{"address": "0x..", "committed": "..."}]}
// ---------------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
    const args = Object.fromEntries(
        process.argv.slice(2).reduce((acc, v, i, arr) => {
            if (v.startsWith("--")) acc.push([v.slice(2), arr[i + 1]]);
            return acc;
        }, [])
    );
    if (!args.snapshot || !args.seed) {
        console.error("usage: node allocate.js --snapshot snapshot.json --seed 0x<bytes32> [--out allocations.json]");
        process.exit(1);
    }
    const snap = JSON.parse(readFileSync(args.snapshot, "utf8"));
    const price = BigInt(snap.price);
    const qSale = snap.qSale !== undefined ? BigInt(snap.qSale) : (BigInt(snap.raiseTarget) * WAD) / price;
    const result = computeAllocations(snap.participants, args.seed, qSale, price);
    verifyResult(result);
    const out = toOutputJson(result);
    const path = args.out ?? "allocations.json";
    writeFileSync(path, JSON.stringify(out, null, 2) + "\n");
    // Optional flat fixture for forge scripts/tests (vm.parseJson-friendly).
    if (args["foundry-out"]) {
        const fixture = {
            price: price.toString(),
            qSale: qSale.toString(),
            seed: result.seed,
            root: result.root,
            totalSold: result.totalSold.toString(),
            totalRaised: result.totalRaised.toString(),
            participants: result.rows.map((r) => r.address),
            commits: result.rows.map((r) => r.committed.toString()),
            allocations: result.rows.map((r) => r.allocation.toString()),
            refunds: result.rows.map((r) => r.refund.toString()),
        };
        result.rows.forEach((_, i) => (fixture[`proofs_${i}`] = result.proofs[i]));
        writeFileSync(args["foundry-out"], JSON.stringify(fixture, null, 2) + "\n");
        console.log(`foundry fmt: ${args["foundry-out"]}`);
    }
    console.log(`root:        ${out.root}`);
    console.log(`totalSold:   ${out.totalSold}`);
    console.log(`totalRaised: ${out.totalRaised}`);
    console.log(`written to:  ${path}`);
}
