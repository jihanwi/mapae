// Dev fee claim helpers (pure). The Dev share of curve fees accrues in CurveSale.devAccrued and is
// paid in the curve's quote token by claimDevFees(): KRWs on a KRWs curve, WETH on an ETH curve.

export type DevFeeUnit = "KRWs" | "WETH";
export type DevFeeState = "hidden" | "empty" | "ready";

export const devFeeUnit = (isEth: boolean): DevFeeUnit => (isEth ? "WETH" : "KRWs");

/** hidden: not the Dev (or unknown); empty: nothing accrued; ready: something to claim. */
export function devFeeState(p: {isDev: boolean; accrued: bigint | undefined}): DevFeeState {
    if (!p.isDev || p.accrued === undefined) return "hidden";
    return p.accrued > 0n ? "ready" : "empty";
}
