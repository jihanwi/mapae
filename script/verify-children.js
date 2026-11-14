// Verifies factory-created contracts on Blockscout. These are deployed by
// internal CREATE calls (inside createOffering / settle), so `forge script
// --verify` never sees them — this helper reconstructs each constructor's args
// from public on-chain views and calls forge verify-contract.
//
// Offering path (--factory <MapaeFactory>): OfferingDeployer + StackDeployer (factory
// constructor), Offering + MembershipToken (createOffering), RedeemManager + MapaeVesting +
// Sponsorship (StackDeployer), MapaePool (PoolFactory, created at settle — offerings not yet
// settled are reported and can be re-run after settle).
// Curve path (--curve-factory <CurveFactory>): every CurveSale found via CurveCreated, its
// MembershipToken and, once graduated, its MapaePool.
//
// v3: constructor signatures match `forge inspect <Contract> abi` (T12). Offering, OfferingDeployer
// and CurveSale link the MembershipTokenDeployer library, so their verification passes
// --libraries; the address comes from --library or deployments/giwa-sepolia-v3.json.
//
//   node script/verify-children.js --rpc $GIWA_SEPOLIA_RPC_URL --verifier-url $BLOCKSCOUT_API_URL \
//     --from-block <deployBlock> [--factory <MapaeFactory>] [--curve-factory <CurveFactory>] [--library <addr>]
//
// --from-block is required. Requires foundry (cast/forge) on PATH; run from the repo root.

import {execFileSync} from "node:child_process";
import {readFileSync, existsSync} from "node:fs";

const args = Object.fromEntries(
    process.argv.slice(2).reduce((acc, v, i, arr) => {
        if (v.startsWith("--")) acc.push([v.slice(2), arr[i + 1]]);
        return acc;
    }, [])
);
const USAGE =
    "usage: node script/verify-children.js --rpc <url> --verifier-url <url> --from-block <n> " +
    "[--factory <MapaeFactory>] [--curve-factory <CurveFactory>] [--library <MembershipTokenDeployer>]";
if (!args.rpc || !args["verifier-url"] || (!args.factory && !args["curve-factory"])) {
    console.error(USAGE);
    process.exit(1);
}
if (args["from-block"] === undefined) {
    console.error("--from-block is required (use deployBlock from deployments/giwa-sepolia-v3.json)\n" + USAGE);
    process.exit(1);
}

// MembershipTokenDeployer (linked library) address: --library, else the v3 deployment json.
const V3_JSON = "deployments/giwa-sepolia-v3.json";
const library =
    args.library ??
    (existsSync(V3_JSON) ? JSON.parse(readFileSync(V3_JSON, "utf8")).membershipTokenDeployer : undefined);
if (!library) {
    console.error(`MembershipTokenDeployer address unknown — pass --library or create ${V3_JSON}`);
    process.exit(1);
}
const LIB_FLAGS = ["--libraries", `src/MembershipTokenDeployer.sol:MembershipTokenDeployer:${library}`];

function cast(...a) {
    return execFileSync("cast", a, {encoding: "utf8"}).trim();
}
function call(to, sig, ...callArgs) {
    return cast("call", to, sig, ...callArgs, "--rpc-url", args.rpc);
}
function num(v) {
    return v.split(" ")[0]; // strip cast's scientific-notation suffix
}

// ---- event scan window ----
// GIWA's RPC caps eth_getLogs at 100k blocks — the window is [--from-block, min(--to-block|latest,
// from + 90k)]. Pass --to-block for older ranges.
const latestBlock = parseInt(cast("block-number", "--rpc-url", args.rpc), 10);
const fromBlock = parseInt(args["from-block"], 10);
const toBlock = Math.min(parseInt(args["to-block"] ?? String(latestBlock), 10), fromBlock + 90_000);

function scan(address, eventSig, label) {
    const topic0 = cast("keccak", eventSig);
    const found = JSON.parse(
        cast(
            "logs", "--rpc-url", args.rpc, "--from-block", String(fromBlock), "--to-block", String(toBlock),
            "--address", address, topic0, "--json"
        )
    );
    // Hard-fail on an empty window so a missed range can never look like a pass.
    if (found.length === 0) {
        console.error(`no ${label} events in blocks ${fromBlock}–${toBlock} — check --from-block / --to-block`);
        process.exit(1);
    }
    return found;
}
const logs = args.factory
    ? scan(args.factory, "OfferingCreated(address,address,address,address,address,address)", "OfferingCreated")
    : [];
const curveLogs = args["curve-factory"]
    ? scan(args["curve-factory"], "CurveCreated(address,address,address,address,uint256,string,string)", "CurveCreated")
    : [];

// v3 constructor signatures (checked against `forge inspect <Contract> abi`):
// OfferingParams lost platformTokenBps and recipients.reserve (decision 21) → recipients is
// (creatorVesting, platform); MapaePool gained the trailing dojang; CurveSale takes InitParams
// (quote, dojang, dev, feeRouter, poolFactory, mapaeFactory, tokenName, tokenSymbol, virtualQuote).
const OFFERING_CTOR =
    "constructor((address,address,address,address,string,string,uint256,uint256,uint256,uint256,uint256,uint256,uint16,uint16,uint16,uint16,uint16,uint8,uint256,uint16,address,address,uint8,address,(address,address)))";
const TOKEN_CTOR = "constructor(string,string,address,uint256,uint16,address[])";
const RM_CTOR = "constructor(address,address,address,address,uint8,address)";
const VESTING_CTOR = "constructor(address,uint64,uint64,uint64,uint8)";
const SPONSORSHIP_CTOR = "constructor(address,address,address,uint16,uint16,uint8,address)";
const POOL_CTOR = "constructor(address,address,address,address,uint8,address,uint16,uint16,address)";
const CURVE_CTOR = "constructor((address,address,address,address,address,address,string,string,uint256))";

function verify(addr, contractPath, ctorSig, ctorValues, extraFlags = []) {
    const argFlags =
        ctorValues.length > 0 ? ["--constructor-args", cast("abi-encode", ctorSig, ...ctorValues)] : [];
    console.log(`\nverifying ${contractPath} @ ${addr}`);
    try {
        const out = execFileSync(
            "forge",
            [
                "verify-contract", addr, contractPath,
                "--verifier", "blockscout", "--verifier-url", args["verifier-url"],
                ...argFlags, ...extraFlags, "--watch",
            ],
            {encoding: "utf8"}
        );
        // Re-runs are idempotent with no extra handling: forge short-circuits an
        // already-verified contract ("...is already verified. Skipping.") and
        // exits 0, so execFileSync doesn't throw and this counts as ok.
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

const ZERO = "0x0000000000000000000000000000000000000000";

function verifyPool(pool, token, quote, creator) {
    const poolFeeRouter = call(pool, "feeRouter()(address)");
    const poolTier = call(pool, "tier()(uint8)");
    const poolBurnerFactory = call(pool, "factory()(address)");
    const poolRoyaltyBps = call(pool, "royaltyBps()(uint16)");
    const poolBurnBps = call(pool, "burnBps()(uint16)");
    const poolDojang = call(pool, "dojang()(address)");
    return verify(pool, "src/MapaePool.sol:MapaePool", POOL_CTOR, [
        token, quote, creator, poolFeeRouter, poolTier, poolBurnerFactory, poolRoyaltyBps, poolBurnBps, poolDojang,
    ]);
}

// The factory's deployers (deployed in its constructor, no args). OfferingDeployer embeds
// Offering's creation code, which links the library.
if (args.factory) {
    const offeringDeployer = call(args.factory, "offeringDeployer()(address)");
    verify(offeringDeployer, "src/OfferingDeployer.sol:OfferingDeployer", "constructor()", [], LIB_FLAGS) ? ok++ : fail++;
    const stackDeployer = call(args.factory, "stackDeployer()(address)");
    verify(stackDeployer, "src/StackDeployer.sol:StackDeployer", "constructor()", []) ? ok++ : fail++;
}

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
    const minRaise = num(call(offering, "minRaise()(uint256)"));
    const deadline = num(call(offering, "deadline()(uint256)"));
    const walletLimit = num(call(offering, "walletLimit()(uint256)"));
    const minCommit = num(call(offering, "minCommit()(uint256)"));
    const fBps = call(offering, "fBps()(uint16)");
    const cBps = call(offering, "cBps()(uint16)");
    const creatorTokenBps = call(offering, "creatorTokenBps()(uint16)");
    const swapRoyaltyBps = call(offering, "swapRoyaltyBps()(uint16)");
    const swapBurnBps = call(offering, "swapBurnBps()(uint16)");
    const refundMode = call(offering, "refundMode()(uint8)");
    const lockDuration = num(call(token, "transferLockDuration()(uint256)"));
    const capBps = call(token, "holdingCapBps()(uint16)");
    const poolFactory = call(offering, "poolFactory()(address)");
    const feeRouter = call(offering, "feeRouter()(address)");
    const tier = call(offering, "tier()(uint8)");
    const mapaeFactory = call(offering, "mapaeFactory()(address)");
    const recips = call(offering, "recipients()(address,address)").split("\n");
    const [cv, pf] = recips;

    const paramsTuple =
        `(${paymentToken},${dojang},${creator},${platformOwner},"${name}","${symbol}",` +
        `${price},${raiseTarget},${minRaise},${deadline},${walletLimit},${minCommit},` +
        `${fBps},${cBps},${creatorTokenBps},${swapRoyaltyBps},${swapBurnBps},` +
        `${refundMode},${lockDuration},${capBps},` +
        `${poolFactory},${feeRouter},${tier},${mapaeFactory},(${cv},${pf}))`;

    verify(offering, "src/Offering.sol:Offering", OFFERING_CTOR, [paramsTuple], LIB_FLAGS) ? ok++ : fail++;
    // T11: capExempt is [creatorVesting] only (platform dropped, reserve gone).
    verify(token, "src/MembershipToken.sol:MembershipToken", TOKEN_CTOR, [
        name, symbol, offering, lockDuration, capBps, `[${cv}]`,
    ]) ? ok++ : fail++;

    // ---- RedeemManager(token, creator, krw, feeRouter, tier, buybackVault) ----
    const rmVault = call(redeemManager, "buybackVault()(address)");
    verify(redeemManager, "src/RedeemManager.sol:RedeemManager", RM_CTOR, [
        token, creator, paymentToken, feeRouter, tier, rmVault,
    ]) ? ok++ : fail++;

    // ---- MapaeVesting: cliffSeconds = cliff() − start(); tier from the offering ----
    const vStart = num(call(vesting, "start()(uint256)"));
    const vDuration = num(call(vesting, "duration()(uint256)"));
    const vCliffAbs = num(call(vesting, "cliff()(uint256)"));
    const vCliffSeconds = (BigInt(vCliffAbs) - BigInt(vStart)).toString();
    verify(vesting, "src/MapaeVesting.sol:MapaeVesting", VESTING_CTOR, [
        creator, vStart, vDuration, vCliffSeconds, tier,
    ]) ? ok++ : fail++;

    // ---- Sponsorship(token, krw, creator, burnBps, slippageBps, tier, vault) ----
    const spBurnBps = call(sponsorship, "burnShareBps()(uint16)");
    const spSlippageBps = call(sponsorship, "maxSlippageBps()(uint16)");
    const spVault = call(sponsorship, "buybackVault()(address)");
    verify(sponsorship, "src/Sponsorship.sol:Sponsorship", SPONSORSHIP_CTOR, [
        token, paymentToken, creator, spBurnBps, spSlippageBps, tier, spVault,
    ]) ? ok++ : fail++;

    // ---- MapaePool: only exists after settle. ----
    const pool = call(offering, "pool()(address)");
    if (pool === ZERO) {
        pendingPools.push(offering);
        continue;
    }
    verifyPool(pool, token, paymentToken, creator) ? ok++ : fail++;
}

// ---- Curve path: CurveCreated(dev, curve, token, quote, virtualQuote, name, symbol) ----
let curvePools = 0;
const pendingCurves = [];
for (const log of curveLogs) {
    const curve = "0x" + log.topics[2].slice(26);
    const token = "0x" + log.topics[3].slice(26);
    const quote = call(curve, "quote()(address)");
    const dojang = call(curve, "dojang()(address)");
    const dev = call(curve, "dev()(address)");
    const feeRouter = call(curve, "feeRouter()(address)");
    const poolFactory = call(curve, "poolFactory()(address)");
    const mapaeFactory = call(curve, "mapaeFactory()(address)");
    const virtualQuote = num(call(curve, "virtualQuote()(uint256)"));
    const name = JSON.parse(call(token, "name()(string)"));
    const symbol = JSON.parse(call(token, "symbol()(string)"));
    const initTuple =
        `(${quote},${dojang},${dev},${feeRouter},${poolFactory},${mapaeFactory},"${name}","${symbol}",${virtualQuote})`;
    verify(curve, "src/CurveSale.sol:CurveSale", CURVE_CTOR, [initTuple], LIB_FLAGS) ? ok++ : fail++;

    // token: MembershipToken(name, symbol, curve, CURVE_LOCK_DURATION, 0, [])
    const lockDuration = num(call(token, "transferLockDuration()(uint256)"));
    const capBps = call(token, "holdingCapBps()(uint16)");
    verify(token, "src/MembershipToken.sol:MembershipToken", TOKEN_CTOR, [
        name, symbol, curve, lockDuration, capBps, "[]",
    ]) ? ok++ : fail++;

    const pool = call(curve, "pool()(address)");
    if (pool === ZERO) {
        pendingCurves.push(curve);
        continue;
    }
    curvePools++;
    verifyPool(pool, token, quote, dev) ? ok++ : fail++;
}
if (pendingCurves.length > 0) {
    console.log(`\nNOTE: ${pendingCurves.length} curve(s) not yet graduated — no pool to verify yet:`);
    for (const c of pendingCurves) console.log(`  ${c}`);
}

if (pendingPools.length > 0) {
    console.log(`\nNOTE: ${pendingPools.length} offering(s) not yet settled — no pool to verify yet:`);
    for (const o of pendingPools) console.log(`  ${o}`);
    console.log("Re-run this script after Stage 2 (settle) to verify the MapaePool(s).");
}
// Expected verification count, computed from the events found: offering path = 2 factory
// deployers + 5 children per offering + 1 pool per settled offering; curve path = CurveSale +
// token per curve + 1 pool per graduated curve. --expect overrides only if given.
const poolsCount = logs.length - pendingPools.length;
const offeringExpected = args.factory ? 2 + logs.length * 5 + poolsCount : 0;
const curveExpected = curveLogs.length * 2 + curvePools;
const expected = args.expect !== undefined ? parseInt(args.expect, 10) : offeringExpected + curveExpected;
console.log(`\ndone: ${ok}/${expected} verified, ${fail} failed`);
process.exit(fail === 0 && ok === expected ? 0 : 1);
