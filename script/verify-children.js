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
// --libraries; the address comes from --library or the deployment json (--deployment, default
// deployments/giwa-sepolia-v3_1.json when present, else deployments/giwa-sepolia-v3.json).
//
// v3.1: MapaePool lost its trailing dojang argument, CurveSale.InitParams gained a trailing
// uint32 priorityWindow (recovered as priorityUntil - creation block timestamp) and CurveCreated
// gained a trailing uint64 priorityUntil.
//
// v3.2: event logs are read in windows of LOG_CHUNK (9,000) blocks from --from-block to --to-block
// (default latest): the RPC rejects ranges over 10,000 blocks ("block range greater than 10000
// max"). The deployment json defaults to giwa-sepolia-v3_2.json when present (same library).
//
//   node script/verify-children.js --rpc $GIWA_SEPOLIA_RPC_URL --verifier-url $BLOCKSCOUT_API_URL \
//     --from-block <deployBlock> [--factory <MapaeFactory>] [--curve-factory <CurveFactory>] [--library <addr>]
//
// --from-block is required. Requires foundry (cast/forge) on PATH; run from the repo root.
//
// Scheduled runs (.github/workflows/verify-children.yml):
// - each target is first looked up on the explorer (GET <explorer>/api/v2/smart-contracts/<addr>,
//   is_verified); verified ones are skipped. --explorer defaults to the verifier URL's origin.
// - calls are paced ~0.3 s apart; one failure does not stop the rest; the run ends with
//   "verified N, skipped N, failed N" and exits 1 only when failed > 0.
// - --allow-empty: a window without CurveCreated / OfferingCreated events is not an error (a
//   rolling window often has no new launches). Without it an empty window still fails.
// - curve path: besides the curves created in the window, every curve of the factory
//   (allCurves) that has graduated gets its pool checked, so a pool created after the window that
//   saw its curve launch is still verified.

import {execFileSync} from "node:child_process";
import {setTimeout as sleep} from "node:timers/promises";
import {readFileSync, existsSync} from "node:fs";

const args = Object.fromEntries(
    process.argv.slice(2).reduce((acc, v, i, arr) => {
        if (v.startsWith("--")) acc.push([v.slice(2), arr[i + 1]]);
        return acc;
    }, [])
);
const USAGE =
    "usage: node script/verify-children.js --rpc <url> --verifier-url <url> --from-block <n> " +
    "[--factory <MapaeFactory>] [--curve-factory <CurveFactory>] [--library <MembershipTokenDeployer>] " +
    "[--deployment <json>]";
if (!args.rpc || !args["verifier-url"] || (!args.factory && !args["curve-factory"])) {
    console.error(USAGE);
    process.exit(1);
}
if (args["from-block"] === undefined) {
    console.error("--from-block is required (use deployBlock from the deployment json)\n" + USAGE);
    process.exit(1);
}

// MembershipTokenDeployer (linked library) address: --library, else the deployment json.
const V3_JSON =
    args.deployment ??
    ["deployments/giwa-sepolia-v3_2.json", "deployments/giwa-sepolia-v3_1.json", "deployments/giwa-sepolia-v3.json"].find((f) =>
        existsSync(f)
    );
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
// [--from-block, --to-block|latest], read in LOG_CHUNK-block windows (the RPC caps one eth_getLogs
// range at 10,000 blocks).
const LOG_CHUNK = 9_000;
const latestBlock = parseInt(cast("block-number", "--rpc-url", args.rpc), 10);
const fromBlock = parseInt(args["from-block"], 10);
const toBlock = parseInt(args["to-block"] ?? String(latestBlock), 10);

/** [start, end] block windows of at most `size` blocks covering [from, to]. */
export function chunks(from, to, size = LOG_CHUNK) {
    const out = [];
    for (let a = from; a <= to; a += size) out.push([a, Math.min(to, a + size - 1)]);
    return out;
}

function scan(address, eventSig, label) {
    const topic0 = cast("keccak", eventSig);
    const found = [];
    for (const [a, b] of chunks(fromBlock, toBlock)) {
        found.push(
            ...JSON.parse(
                cast("logs", "--rpc-url", args.rpc, "--from-block", String(a), "--to-block", String(b), "--address", address, topic0, "--json")
            )
        );
    }
    // Hard-fail on an empty window so a missed range can never look like a pass (unless the caller
    // runs a rolling window, --allow-empty).
    if (found.length === 0 && args["allow-empty"] === undefined) {
        console.error(`no ${label} events in blocks ${fromBlock}–${toBlock} — check --from-block / --to-block`);
        process.exit(1);
    }
    return found;
}
const logs = args.factory
    ? scan(args.factory, "OfferingCreated(address,address,address,address,address,address)", "OfferingCreated")
    : [];
const curveLogs = args["curve-factory"]
    ? scan(args["curve-factory"], "CurveCreated(address,address,address,address,uint256,string,string,uint64)", "CurveCreated")
    : [];

// v3 constructor signatures (checked against `forge inspect <Contract> abi`):
// OfferingParams lost platformTokenBps and recipients.reserve (decision 21) → recipients is
// (creatorVesting, platform); MapaePool had a trailing dojang (removed in v3.1); CurveSale takes InitParams
// (quote, dojang, dev, feeRouter, poolFactory, mapaeFactory, tokenName, tokenSymbol, virtualQuote, priorityWindow).
const OFFERING_CTOR =
    "constructor((address,address,address,address,string,string,uint256,uint256,uint256,uint256,uint256,uint256,uint16,uint16,uint16,uint16,uint16,uint8,uint256,uint16,address,address,uint8,address,(address,address)))";
const TOKEN_CTOR = "constructor(string,string,address,uint256,uint16,address[])";
const RM_CTOR = "constructor(address,address,address,address,uint8,address)";
const VESTING_CTOR = "constructor(address,uint64,uint64,uint64,uint8)";
const SPONSORSHIP_CTOR = "constructor(address,address,address,uint16,uint16,uint8,address)";
const POOL_CTOR = "constructor(address,address,address,address,uint8,address,uint16,uint16)";
const CURVE_CTOR = "constructor((address,address,address,address,address,address,string,string,uint256,uint32))";

const EXPLORER = (args.explorer ?? new URL(args["verifier-url"]).origin).replace(/\/+$/, "");
const PAUSE_MS = 300;

/** True when the explorer already lists `addr` as verified; false on "no" and on any lookup error
 *  (the verify call then decides). */
async function isVerified(addr) {
    await sleep(PAUSE_MS);
    try {
        const r = await fetch(`${EXPLORER}/api/v2/smart-contracts/${addr}`);
        if (!r.ok) return false;
        const j = await r.json();
        return j?.is_verified === true;
    } catch (e) {
        console.warn(`explorer lookup failed for ${addr}: ${e.message}`);
        return false;
    }
}

let ok = 0;
let skipped = 0;
let fail = 0;
const seen = new Set();

/** Verifies one contract unless it is verified already (or was handled in this run). Counts the
 *  outcome; a failure is logged and the run goes on. */
async function verify(addr, contractPath, ctorSig, ctorValues, extraFlags = []) {
    const key = addr.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    if (await isVerified(addr)) {
        console.log(`skip ${contractPath} @ ${addr} (already verified)`);
        skipped++;
        return;
    }
    console.log(`\nverifying ${contractPath} @ ${addr}`);
    try {
        const argFlags = ctorValues.length > 0 ? ["--constructor-args", cast("abi-encode", ctorSig, ...ctorValues)] : [];
        const out = execFileSync(
            "forge",
            [
                "verify-contract", addr, contractPath,
                "--verifier", "blockscout", "--verifier-url", args["verifier-url"],
                ...argFlags, ...extraFlags, "--watch",
            ],
            {encoding: "utf8"}
        );
        // forge also short-circuits an already-verified contract ("...is already verified.
        // Skipping.") and exits 0, so a lookup miss above still ends as ok.
        console.log(out.trim().split("\n").slice(-3).join("\n"));
        ok++;
    } catch (e) {
        console.error(`FAILED ${contractPath} @ ${addr}: ${e.message?.split("\n")[0]}`);
        fail++;
    }
    await sleep(PAUSE_MS);
}

const pendingPools = [];

const ZERO = "0x0000000000000000000000000000000000000000";

async function verifyPool(pool, token, quote, creator) {
    const poolFeeRouter = call(pool, "feeRouter()(address)");
    const poolTier = call(pool, "tier()(uint8)");
    const poolBurnerFactory = call(pool, "factory()(address)");
    const poolRoyaltyBps = call(pool, "royaltyBps()(uint16)");
    const poolBurnBps = call(pool, "burnBps()(uint16)");
    return await verify(pool, "src/MapaePool.sol:MapaePool", POOL_CTOR, [
        token, quote, creator, poolFeeRouter, poolTier, poolBurnerFactory, poolRoyaltyBps, poolBurnBps,
    ]);
}

// The factory's deployers (deployed in its constructor, no args). OfferingDeployer embeds
// Offering's creation code, which links the library.
if (args.factory) {
    const offeringDeployer = call(args.factory, "offeringDeployer()(address)");
    await verify(offeringDeployer, "src/OfferingDeployer.sol:OfferingDeployer", "constructor()", [], LIB_FLAGS);
    const stackDeployer = call(args.factory, "stackDeployer()(address)");
    await verify(stackDeployer, "src/StackDeployer.sol:StackDeployer", "constructor()", []);
}

for (const log of logs) {
  try {
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

    await verify(offering, "src/Offering.sol:Offering", OFFERING_CTOR, [paramsTuple], LIB_FLAGS);
    // T11: capExempt is [creatorVesting] only (platform dropped, reserve gone).
    await verify(token, "src/MembershipToken.sol:MembershipToken", TOKEN_CTOR, [
        name, symbol, offering, lockDuration, capBps, `[${cv}]`,
    ]);

    // ---- RedeemManager(token, creator, krw, feeRouter, tier, buybackVault) ----
    const rmVault = call(redeemManager, "buybackVault()(address)");
    await verify(redeemManager, "src/RedeemManager.sol:RedeemManager", RM_CTOR, [
        token, creator, paymentToken, feeRouter, tier, rmVault,
    ]);

    // ---- MapaeVesting: cliffSeconds = cliff() − start(); tier from the offering ----
    const vStart = num(call(vesting, "start()(uint256)"));
    const vDuration = num(call(vesting, "duration()(uint256)"));
    const vCliffAbs = num(call(vesting, "cliff()(uint256)"));
    const vCliffSeconds = (BigInt(vCliffAbs) - BigInt(vStart)).toString();
    await verify(vesting, "src/MapaeVesting.sol:MapaeVesting", VESTING_CTOR, [
        creator, vStart, vDuration, vCliffSeconds, tier,
    ]);

    // ---- Sponsorship(token, krw, creator, burnBps, slippageBps, tier, vault) ----
    const spBurnBps = call(sponsorship, "burnShareBps()(uint16)");
    const spSlippageBps = call(sponsorship, "maxSlippageBps()(uint16)");
    const spVault = call(sponsorship, "buybackVault()(address)");
    await verify(sponsorship, "src/Sponsorship.sol:Sponsorship", SPONSORSHIP_CTOR, [
        token, paymentToken, creator, spBurnBps, spSlippageBps, tier, spVault,
    ]);

    // ---- MapaePool: only exists after settle. ----
    const pool = call(offering, "pool()(address)");
    if (pool === ZERO) {
        pendingPools.push(offering);
        continue;
    }
    await verifyPool(pool, token, paymentToken, creator);
  } catch (e) {
    console.error(`FAILED offering log ${log.transactionHash}: ${e.message?.split("\n")[0]}`);
    fail++;
  }
}

// ---- Curve path: CurveCreated(dev, curve, token, quote, virtualQuote, name, symbol, priorityUntil) ----
const pendingCurves = [];
const curvesInWindow = new Set();
for (const log of curveLogs) {
    const curve = "0x" + log.topics[2].slice(26);
    curvesInWindow.add(curve.toLowerCase());
    // one curve's RPC or verify trouble must not stop the others
    try {
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
        // priorityWindow is not stored: priorityUntil = creation block timestamp + priorityWindow.
        const priorityUntil = BigInt(num(call(curve, "priorityUntil()(uint64)")));
        const createdAt = BigInt(cast("block", String(parseInt(log.blockNumber, 16)), "--field", "timestamp", "--rpc-url", args.rpc));
        const priorityWindow = (priorityUntil - createdAt).toString();
        const initTuple =
            `(${quote},${dojang},${dev},${feeRouter},${poolFactory},${mapaeFactory},"${name}","${symbol}",${virtualQuote},${priorityWindow})`;
        await verify(curve, "src/CurveSale.sol:CurveSale", CURVE_CTOR, [initTuple], LIB_FLAGS);

        // token: MembershipToken(name, symbol, curve, CURVE_LOCK_DURATION, 0, [])
        const lockDuration = num(call(token, "transferLockDuration()(uint256)"));
        const capBps = call(token, "holdingCapBps()(uint16)");
        await verify(token, "src/MembershipToken.sol:MembershipToken", TOKEN_CTOR, [name, symbol, curve, lockDuration, capBps, "[]"]);

        const pool = call(curve, "pool()(address)");
        if (pool === ZERO) {
            pendingCurves.push(curve);
            continue;
        }
        await verifyPool(pool, token, quote, dev);
    } catch (e) {
        console.error(`FAILED curve ${curve}: ${e.message?.split("\n")[0]}`);
        fail++;
    }
}

// Pools of every graduated curve of the factory, including curves launched before the window
// (a curve can graduate long after its CurveCreated). Pool constructor args come from views only.
if (args["curve-factory"]) {
    let all = [];
    try {
        const raw = call(args["curve-factory"], "allCurves()(address[])");
        all = raw.replace(/^\[|\]$/g, "").split(",").map((x) => x.trim()).filter(Boolean);
    } catch (e) {
        console.error(`FAILED allCurves(): ${e.message?.split("\n")[0]}`);
        fail++;
    }
    for (const curve of all) {
        if (curvesInWindow.has(curve.toLowerCase())) continue;
        try {
            const pool = call(curve, "pool()(address)");
            if (pool === ZERO) continue;
            await verifyPool(pool, call(curve, "token()(address)"), call(curve, "quote()(address)"), call(curve, "dev()(address)"));
        } catch (e) {
            console.error(`FAILED pool of curve ${curve}: ${e.message?.split("\n")[0]}`);
            fail++;
        }
    }
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
console.log(`\nverified ${ok}, skipped ${skipped}, failed ${fail}`);
process.exit(fail > 0 ? 1 : 0);
