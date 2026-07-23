// Verifies factory-created contracts on Blockscout. These are deployed by
// internal CREATE calls (inside createOffering / settle), so `forge script
// --verify` never sees them — this helper reconstructs each constructor's args
// from public on-chain views and calls forge verify-contract.
//
// Covers (M5): OfferingDeployer + StackDeployer (factory constructor),
// Offering + MembershipToken (createOffering), RedeemManager + MapaeVesting +
// Sponsorship (StackDeployer), MapaePool (PoolFactory, created at settle —
// offerings not yet settled are reported and can be re-run after Stage 2).
//
//   node script/verify-children.js --rpc $GIWA_SEPOLIA_RPC_URL \
//     --verifier-url $BLOCKSCOUT_API_URL --factory <factory-address>
//
// Requires foundry (cast/forge) on PATH; run from the repo root.

import {execFileSync} from "node:child_process";

const args = Object.fromEntries(
    process.argv.slice(2).reduce((acc, v, i, arr) => {
        if (v.startsWith("--")) acc.push([v.slice(2), arr[i + 1]]);
        return acc;
    }, [])
);
if (!args.rpc || !args["verifier-url"] || !args.factory) {
    console.error("usage: node script/verify-children.js --rpc <url> --verifier-url <url> --factory <address>");
    process.exit(1);
}

function cast(...a) {
    return execFileSync("cast", a, {encoding: "utf8"}).trim();
}
function call(to, sig, ...callArgs) {
    return cast("call", to, sig, ...callArgs, "--rpc-url", args.rpc);
}
function num(v) {
    return v.split(" ")[0]; // strip cast's scientific-notation suffix
}

// ---- collect children from OfferingCreated(creator, offering, token, rm, vesting, sponsorship) ----
// GIWA's RPC caps eth_getLogs at 100k blocks — default to the last 90k,
// overridable with --from-block for older factories.
const latestBlock = parseInt(cast("block-number", "--rpc-url", args.rpc), 10);
const fromBlock = args["from-block"] ?? String(Math.max(0, latestBlock - 90_000));
const topic0 = cast("keccak", "OfferingCreated(address,address,address,address,address,address)");
const raw = cast(
    "logs", "--rpc-url", args.rpc, "--from-block", fromBlock, "--to-block", "latest",
    "--address", args.factory, topic0, "--json"
);
const logs = JSON.parse(raw);

const OFFERING_CTOR =
    "constructor((address,address,address,address,string,string,uint256,uint256,uint256,uint256,uint256,uint16,uint16,uint16,uint8,uint256,uint16,address,uint16,uint16,(address,address,address)))";
const TOKEN_CTOR = "constructor(string,string,address,uint256,uint16,address[])";
const RM_CTOR = "constructor(address,address)";
const VESTING_CTOR = "constructor(address,uint64,uint64,uint64)";
const SPONSORSHIP_CTOR = "constructor(address,address,address,uint16,uint16)";
const POOL_CTOR = "constructor(address,address,address,uint16,uint16)";

function verify(addr, contractPath, ctorSig, ctorValues) {
    const argFlags =
        ctorValues.length > 0 ? ["--constructor-args", cast("abi-encode", ctorSig, ...ctorValues)] : [];
    console.log(`\nverifying ${contractPath} @ ${addr}`);
    try {
        const out = execFileSync(
            "forge",
            [
                "verify-contract", addr, contractPath,
                "--verifier", "blockscout", "--verifier-url", args["verifier-url"],
                ...argFlags, "--watch",
            ],
            {encoding: "utf8"}
        );
        console.log(out.trim().split("\n").slice(-3).join("\n"));
        return true;
    } catch (e) {
        console.error(`FAILED: ${e.message?.split("\n")[0]}`);
        return false;
    }
}

let ok = 0;
let fail = 0;
const pendingPools = [];

// The factory's deployers (deployed in its constructor, no args).
const offeringDeployer = call(args.factory, "offeringDeployer()(address)");
verify(offeringDeployer, "src/OfferingDeployer.sol:OfferingDeployer", "constructor()", []) ? ok++ : fail++;
const stackDeployer = call(args.factory, "stackDeployer()(address)");
verify(stackDeployer, "src/StackDeployer.sol:StackDeployer", "constructor()", []) ? ok++ : fail++;

for (const log of logs) {
    const offering = "0x" + log.topics[2].slice(26);
    const token = "0x" + log.topics[3].slice(26);
    // data: redeemManager, vesting, sponsorship (3 words)
    const redeemManager = "0x" + log.data.slice(26, 66);
    const vesting = "0x" + log.data.slice(90, 130);
    const sponsorship = "0x" + log.data.slice(154, 194);

    // ---- Offering: reconstruct OfferingParams from public views ----
    const paymentToken = call(offering, "paymentToken()(address)");
    const dojang = call(offering, "dojang()(address)");
    const creator = call(offering, "creator()(address)");
    const platformOwner = call(offering, "owner()(address)");
    const name = JSON.parse(call(token, "name()(string)"));
    const symbol = JSON.parse(call(token, "symbol()(string)"));
    const price = num(call(offering, "price()(uint256)"));
    const raiseTarget = num(call(offering, "raiseTarget()(uint256)"));
    const deadline = num(call(offering, "deadline()(uint256)"));
    const walletLimit = num(call(offering, "walletLimit()(uint256)"));
    const minCommit = num(call(offering, "minCommit()(uint256)"));
    const fBps = call(offering, "fBps()(uint16)");
    const cBps = call(offering, "cBps()(uint16)");
    const creatorTokenBps = call(offering, "creatorTokenBps()(uint16)");
    const refundMode = call(offering, "refundMode()(uint8)");
    const lockDuration = num(call(token, "transferLockDuration()(uint256)"));
    const capBps = call(token, "holdingCapBps()(uint16)");
    const poolFactory = call(offering, "poolFactory()(address)");
    const swapRoyaltyBps = call(offering, "swapRoyaltyBps()(uint16)");
    const swapBurnBps = call(offering, "swapBurnBps()(uint16)");
    const recips = call(offering, "recipients()(address,address,address)").split("\n");
    const [cv, pf, rs] = recips;

    const paramsTuple =
        `(${paymentToken},${dojang},${creator},${platformOwner},"${name}","${symbol}",` +
        `${price},${raiseTarget},${deadline},${walletLimit},${minCommit},` +
        `${fBps},${cBps},${creatorTokenBps},${refundMode},${lockDuration},${capBps},` +
        `${poolFactory},${swapRoyaltyBps},${swapBurnBps},(${cv},${pf},${rs}))`;

    verify(offering, "src/Offering.sol:Offering", OFFERING_CTOR, [paramsTuple]) ? ok++ : fail++;
    verify(token, "src/MembershipToken.sol:MembershipToken", TOKEN_CTOR, [
        name, symbol, offering, lockDuration, capBps, `[${cv},${pf},${rs}]`,
    ]) ? ok++ : fail++;
    verify(redeemManager, "src/RedeemManager.sol:RedeemManager", RM_CTOR, [token, creator]) ? ok++ : fail++;

    // ---- MapaeVesting: cliffSeconds = cliff() − start() ----
    const vStart = num(call(vesting, "start()(uint256)"));
    const vDuration = num(call(vesting, "duration()(uint256)"));
    const vCliffAbs = num(call(vesting, "cliff()(uint256)"));
    const vCliffSeconds = (BigInt(vCliffAbs) - BigInt(vStart)).toString();
    verify(vesting, "src/MapaeVesting.sol:MapaeVesting", VESTING_CTOR, [creator, vStart, vDuration, vCliffSeconds])
        ? ok++
        : fail++;

    // ---- Sponsorship ----
    const spBurnBps = call(sponsorship, "burnShareBps()(uint16)");
    const spSlippageBps = call(sponsorship, "maxSlippageBps()(uint16)");
    verify(sponsorship, "src/Sponsorship.sol:Sponsorship", SPONSORSHIP_CTOR, [
        token, paymentToken, creator, spBurnBps, spSlippageBps,
    ]) ? ok++ : fail++;

    // ---- MapaePool: only exists after settle (Stage 2) ----
    const pool = call(offering, "pool()(address)");
    if (pool === "0x0000000000000000000000000000000000000000") {
        pendingPools.push(offering);
        continue;
    }
    const royaltyBps = call(pool, "royaltyBps()(uint16)");
    const burnBps = call(pool, "burnBps()(uint16)");
    verify(pool, "src/MapaePool.sol:MapaePool", POOL_CTOR, [token, paymentToken, creator, royaltyBps, burnBps])
        ? ok++
        : fail++;
}

if (pendingPools.length > 0) {
    console.log(`\nNOTE: ${pendingPools.length} offering(s) not yet settled — no pool to verify yet:`);
    for (const o of pendingPools) console.log(`  ${o}`);
    console.log("Re-run this script after Stage 2 (settle) to verify the MapaePool(s).");
}
console.log(`\ndone: ${ok} verified, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
