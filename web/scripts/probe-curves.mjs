// One-shot probe: reads every curve from ADDR_V3.curveFactory and prints one line per curve,
// then exits. Read-only (eth_call only), no transactions.
//
// Run from web/ (imports the app's own TypeScript modules so the math is identical to the UI):
//   node scripts/probe-curves.mjs
// Node >= 22.18 strips TypeScript types natively. On older Node 22 / 23 use:
//   node --experimental-strip-types scripts/probe-curves.mjs
// The RPC is giwaSepolia.rpcUrls.default from src/config/chain.ts.
import {createPublicClient, formatUnits, http} from "viem";
import {giwaSepolia} from "../src/config/chain.ts";
import {ADDR_V3} from "../src/contracts/addressesV3.ts";
import {CurveFactoryAbi, CurveSaleAbi, MembershipTokenV3Abi} from "../src/contracts/abisV3.ts";
import {progressBps, spotPrice} from "../src/lib/curveMath.ts";

const client = createPublicClient({chain: giwaSepolia, transport: http(undefined, {timeout: 15_000, retryCount: 1})});

const FIELDS = ["token", "quote", "r", "s", "graduated", "verifiedBuyerCount", "virtualQuote"];

async function main() {
    const curves = await client.readContract({address: ADDR_V3.curveFactory, abi: CurveFactoryAbi, functionName: "allCurves"});
    console.log(`curveFactory ${ADDR_V3.curveFactory} · ${curves.length} curve(s)`);
    if (curves.length === 0) return;

    const fieldRes = await client.multicall({
        allowFailure: false,
        contracts: curves.flatMap((c) => FIELDS.map((fn) => ({address: c, abi: CurveSaleAbi, functionName: fn}))),
    });
    const rows = curves.map((c, i) => {
        const [token, quote, r, s, graduated, verifiedBuyerCount, vq] = fieldRes.slice(i * FIELDS.length, (i + 1) * FIELDS.length);
        return {curve: c, token, quote, r, s, graduated, verifiedBuyerCount, vq};
    });
    const names = await client.multicall({
        allowFailure: false,
        contracts: rows.flatMap((x) => [
            {address: x.token, abi: MembershipTokenV3Abi, functionName: "name"},
            {address: x.token, abi: MembershipTokenV3Abi, functionName: "symbol"},
        ]),
    });
    rows.forEach((x, i) => {
        const unit = x.quote.toLowerCase() === ADDR_V3.weth.toLowerCase() ? "ETH" : "KRWs";
        const bps = x.graduated ? 10_000n : progressBps(x.vq, x.r);
        const spot = spotPrice(x.vq, x.r, x.s);
        console.log(
            [
                x.curve,
                `name=${names[i * 2]}`,
                `symbol=${names[i * 2 + 1]}`,
                `quote=${unit}(${x.quote})`,
                `r=${formatUnits(x.r, 18)}`,
                `s=${formatUnits(x.s, 18)}`,
                `graduated=${x.graduated}`,
                `verifiedBuyerCount=${x.verifiedBuyerCount}`,
                `progressBps=${bps}`,
                // after graduation the curve reserve is 0, so this is the curve formula, not the pool price
                `spot=${formatUnits(spot, 18)}${x.graduated ? "(curve formula)" : ""}`,
            ].join(" ")
        );
    });
}

main().then(
    () => process.exit(0),
    (e) => {
        console.error(`probe failed: ${e?.shortMessage ?? e?.message ?? e}`);
        process.exit(1);
    }
);
