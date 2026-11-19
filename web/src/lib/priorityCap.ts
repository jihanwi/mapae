// W-T54: the v3.5 priority-window holding cap on the buy side. Inside a curve's priority window no
// wallet may hold more than the curve's priorityMaxHolding() after a buy (the whole buy reverts
// PriorityHoldingExceeded). The chain decides; these pure helpers only keep the screen from
// sending a buy that would revert.
import {CURVE_SUPPLY, quoteBuyWithFees} from "./curveMath";

/** Tokens the wallet may still buy inside the window (0 when at or over the cap). */
export const capLeft = (cap: bigint, held: bigint): bigint => (held >= cap ? 0n : cap - held);

/** True when a buy delivering `tokensOut` would leave the wallet over the cap. */
export const exceedsCap = (tokensOut: bigint, left: bigint): boolean => tokensOut > left;

/** "Up to limit": the largest quote amount (fee included, wei) whose buy delivers at most `left`
 *  tokens on the curve state (vq, r, s). Rounds down: the result never buys 1 wei over the cap.
 *  Uses the same fee-on-input math as CurveSale.quoteBuy. 0 when left is 0. When the rest of the
 *  curve is within the cap, it is the amount that buys the rest. */
export function maxQuoteForCap(vq: bigint, r: bigint, s: bigint, feeBps: bigint, left: bigint): bigint {
    if (left <= 0n || vq <= 0n || s >= CURVE_SUPPLY) return 0n;
    const remaining = CURVE_SUPPLY - s;
    const fits = (q: bigint) => quoteBuyWithFees(vq, r, s, q, feeBps).tokensOut <= left;
    // grow an upper bound: an amount that buys past the cap, or the rest of the curve
    let hi = 1n;
    while (fits(hi)) {
        if (quoteBuyWithFees(vq, r, s, hi, feeBps).tokensOut >= remaining) return hi;
        hi *= 2n;
    }
    let lo = 0n;
    hi -= 1n;
    while (lo < hi) {
        const mid = (lo + hi + 1n) / 2n;
        if (fits(mid)) lo = mid;
        else hi = mid - 1n;
    }
    return lo;
}

/** One whole token: below this the remaining room is treated as used up. */
const ONE_TOKEN = 10n ** 18n;

/** W-T54b: "limit reached" for the screen. True when no quote amount buys anything within the room
 *  (`maxQuote` is maxQuoteForCap's result) or less than one whole token is left; then the screen
 *  shows the countdown sentence and no "Up to limit" button. */
export const capFull = (left: bigint, maxQuote: bigint): boolean => maxQuote === 0n || left < ONE_TOKEN;

/** W-T54b: the "Up to limit" amount for the input, cut down to `decimals` places (never rounded up),
 *  so it buys at most what the exact amount buys. */
export function truncateDecimals(wei: bigint, decimals = 6): bigint {
    const step = 10n ** BigInt(18 - decimals);
    return wei - (wei % step);
}
