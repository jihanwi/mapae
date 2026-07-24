// Commit-snapshot builder — replays Committed/Cancelled events for an Offering
// and cross-checks every final balance against the committed(address) view.
// Also suggests the allocation seed: the hash of the first block at/after the
// offering deadline (documented public rule → anyone can re-verify).
//
//   node snapshot.js --rpc <url> --offering <address> --out snapshot.json
//
// Output feeds allocate.js:
//   node allocate.js --snapshot snapshot.json --seed <suggestedSeed> \
//     --out allocations.json --foundry-out alloc.json

import {keccak256} from "ethereum-cryptography/keccak.js";
import {writeFileSync} from "node:fs";

const args = Object.fromEntries(
    process.argv.slice(2).reduce((acc, v, i, arr) => {
        if (v.startsWith("--")) acc.push([v.slice(2), arr[i + 1]]);
        return acc;
    }, [])
);
if (!args.rpc || !args.offering) {
    console.error("usage: node snapshot.js --rpc <url> --offering <address> [--out snapshot.json]");
    process.exit(1);
}

let rpcId = 0;
async function rpc(method, params) {
    const res = await fetch(args.rpc, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({jsonrpc: "2.0", id: ++rpcId, method, params}),
    });
    const body = await res.json();
    if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
    return body.result;
}

function selector(sig) {
    return "0x" + Buffer.from(keccak256(Buffer.from(sig))).toString("hex").slice(0, 8);
}
function topic(sig) {
    return "0x" + Buffer.from(keccak256(Buffer.from(sig))).toString("hex");
}
async function callView(to, sig, argHex = "") {
    return await rpc("eth_call", [{to, data: selector(sig) + argHex}, "latest"]);
}

const offering = args.offering.toLowerCase();

// --- offering parameters ---
const price = BigInt(await callView(offering, "price()"));
const qSale = BigInt(await callView(offering, "qSale()"));
const deadline = BigInt(await callView(offering, "deadline()"));

// --- event replay: final committed = last `cumulative` per wallet ---
// Committed(address indexed participant, uint256 amount, uint256 cumulative)
// Cancelled(address indexed participant, uint256 amount, uint256 cumulative)
// GIWA's RPC caps eth_getLogs at 100k blocks — scan in 90k-block chunks from
// --from-block (default: last 90k) up to latest, so offerings of any age work.
const latestNum = BigInt(await rpc("eth_blockNumber", []));
const startBlock = args["from-block"]
    ? BigInt(args["from-block"])
    : latestNum > 90_000n ? latestNum - 90_000n : 0n;
const topics = [topic("Committed(address,uint256,uint256)"), topic("Cancelled(address,uint256,uint256)")];
const CHUNK = 90_000n;
const logs = [];
for (let from = startBlock; from <= latestNum; from += CHUNK) {
    const to = from + CHUNK - 1n < latestNum ? from + CHUNK - 1n : latestNum;
    const chunk = await rpc("eth_getLogs", [
        {
            address: offering,
            fromBlock: "0x" + from.toString(16),
            toBlock: "0x" + to.toString(16),
            topics: [topics],
        },
    ]);
    logs.push(...chunk);
}
logs.sort((a, b) => {
    const d = Number(BigInt(a.blockNumber) - BigInt(b.blockNumber));
    return d !== 0 ? d : Number(BigInt(a.logIndex) - BigInt(b.logIndex));
});
const finalCommitted = new Map();
for (const log of logs) {
    const wallet = "0x" + log.topics[1].slice(26);
    const cumulative = BigInt("0x" + log.data.slice(2 + 64, 2 + 128)); // 2nd word
    finalCommitted.set(wallet, cumulative);
}

// --- cross-check every wallet against the committed(address) view ---
const participants = [];
for (const [wallet, cumulative] of finalCommitted) {
    const onChain = BigInt(await callView(offering, "committed(address)", wallet.slice(2).padStart(64, "0")));
    if (onChain !== cumulative) {
        throw new Error(`snapshot mismatch for ${wallet}: events say ${cumulative}, chain says ${onChain}`);
    }
    if (cumulative > 0n) participants.push({address: wallet, committed: cumulative.toString()});
}

// --- suggested seed: hash of the first block with timestamp >= deadline ---
let suggestedSeed = null;
let seedBlock = null;
const latest = await rpc("eth_getBlockByNumber", ["latest", false]);
if (BigInt(latest.timestamp) >= deadline) {
    let lo = 0n;
    let hi = BigInt(latest.number);
    while (lo < hi) {
        const mid = (lo + hi) / 2n;
        const b = await rpc("eth_getBlockByNumber", ["0x" + mid.toString(16), false]);
        if (BigInt(b.timestamp) >= deadline) hi = mid;
        else lo = mid + 1n;
    }
    const b = await rpc("eth_getBlockByNumber", ["0x" + lo.toString(16), false]);
    suggestedSeed = b.hash;
    seedBlock = Number(lo);
} else {
    console.warn("deadline not yet reached — no seed suggested (settle must wait)");
}

const out = {
    offering,
    price: price.toString(),
    qSale: qSale.toString(),
    deadline: deadline.toString(),
    participants,
    suggestedSeed,
    seedBlock,
};
const path = args.out ?? "snapshot.json";
writeFileSync(path, JSON.stringify(out, null, 2) + "\n");
console.log(`participants: ${participants.length}, total committed: ${participants.reduce((a, p) => a + BigInt(p.committed), 0n)}`);
console.log(`suggested seed: ${suggestedSeed} (block ${seedBlock})`);
console.log(`written to: ${path}`);
