// W-T64: shares of the launch supply bar (bonding curve sale vs pool at graduation).
import {CURVE_SUPPLY, DEX_SUPPLY} from "./curveMath";

/** Percent (two decimals at most) of `curve` and `pool` in their sum; both 0 when the sum is 0. */
export function supplyShares(curve: bigint = CURVE_SUPPLY, pool: bigint = DEX_SUPPLY): {curvePct: number; poolPct: number} {
    const total = curve + pool;
    if (total <= 0n) return {curvePct: 0, poolPct: 0};
    const curveBps = Number((curve * 10_000n) / total);
    return {curvePct: curveBps / 100, poolPct: (10_000 - curveBps) / 100};
}
