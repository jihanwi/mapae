// Verifies factory-created contracts (Offering / MembershipToken / RedeemManager)
// on Blockscout. These are deployed by internal CREATE inside createOffering(),
// so `forge script --verify` never sees them — this helper reconstructs each
// constructor's args from public on-chain views and calls forge verify-contract.
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

// ---- collect children from OfferingCreated(creator, offering, token, redeemManager) ----
// GIWA's RPC caps eth_getLogs at 100k blocks — default to the last 90k,
// overridable with --from-block for older factories.
const latestBlock = parseInt(cast("block-number", "--rpc-url", args.rpc), 10);
const fromBlock = args["from-block"] ?? String(Math.max(0, latestBlock - 90_000));
const topic0 = cast("keccak", "OfferingCreated(address,address,address,address)");
const raw = cast(
    "logs", "--rpc-url", args.rpc, "--from-block", fromBlock, "--to-block", "latest",
    "--address", args.factory, topic0, "--json"
);
const logs = JSON.parse(raw);
if (logs.length === 0) {
    console.log("no OfferingCreated events — nothing to verify");
    process.exit(0);
}

const OFFERING_CTOR =
    "constructor((address,address,address,address,string,string,uint256,uint256,uint256,uint256,uint256,uint16,uint16,uint16,uint8,uint256,uint16,(address,address,address,address)))";
const TOKEN_CTOR = "constructor(string,string,address,uint256,uint16,address[])";
const RM_CTOR = "constructor(address,address)";

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

// The factory's OfferingDeployer (deployed in its constructor, no args).
const offeringDeployer = call(args.factory, "offeringDeployer()(address)");
verify(offeringDeployer, "src/OfferingDeployer.sol:OfferingDeployer", "constructor()", []) ? ok++ : fail++;

for (const log of logs) {
    const offering = "0x" + log.topics[2].slice(26);
    const token = "0x" + log.topics[3].slice(26);
    const redeemManager = "0x" + log.data.slice(26, 66);

    // ---- reconstruct OfferingParams from public views ----
    const paymentToken = call(offering, "paymentToken()(address)");
    const dojang = call(offering, "dojang()(address)");
    const creator = call(offering, "creator()(address)");
    const platformOwner = call(offering, "owner()(address)");
    const name = JSON.parse(call(token, "name()(string)"));
    const symbol = JSON.parse(call(token, "symbol()(string)"));
    const price = call(offering, "price()(uint256)").split(" ")[0];
    const raiseTarget = call(offering, "raiseTarget()(uint256)").split(" ")[0];
    const deadline = call(offering, "deadline()(uint256)").split(" ")[0];
    const walletLimit = call(offering, "walletLimit()(uint256)").split(" ")[0];
    const minCommit = call(offering, "minCommit()(uint256)").split(" ")[0];
    const fBps = call(offering, "fBps()(uint16)");
    const cBps = call(offering, "cBps()(uint16)");
    const creatorTokenBps = call(offering, "creatorTokenBps()(uint16)");
    const refundMode = call(offering, "refundMode()(uint8)");
    const lockDuration = call(token, "transferLockDuration()(uint256)").split(" ")[0];
    const capBps = call(token, "holdingCapBps()(uint16)");
    const recips = call(offering, "recipients()(address,address,address,address)").split("\n");
    const [cv, lp, pf, rs] = recips;

    const paramsTuple =
        `(${paymentToken},${dojang},${creator},${platformOwner},"${name}","${symbol}",` +
        `${price},${raiseTarget},${deadline},${walletLimit},${minCommit},` +
        `${fBps},${cBps},${creatorTokenBps},${refundMode},${lockDuration},${capBps},` +
        `(${cv},${lp},${pf},${rs}))`;

    verify(offering, "src/Offering.sol:Offering", OFFERING_CTOR, [paramsTuple]) ? ok++ : fail++;
    verify(token, "src/MembershipToken.sol:MembershipToken", TOKEN_CTOR, [
        name, symbol, offering, lockDuration, capBps, `[${cv},${lp},${pf},${rs}]`,
    ]) ? ok++ : fail++;
    verify(redeemManager, "src/RedeemManager.sol:RedeemManager", RM_CTOR, [token, creator]) ? ok++ : fail++;
}
console.log(`\ndone: ${ok} verified, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
