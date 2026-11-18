// Dev first-buy cap. v3.5 (W-T54): the buy inside the creation tx may deliver at most the new curve's
// priority holding cap, TOTAL_SUPPLY x CurveFactory.priorityMaxHoldingBps / 10000 (2% at deploy);
// more reverts the whole creation (DevFirstBuyTooLarge). The Dev has the same cap as everyone for
// the rest of the priority window.
import {TOTAL_SUPPLY} from "./curveMath";

/** The cap in tokens from the factory's bps. */
export const devFirstBuyCap = (priorityMaxHoldingBps: number): bigint => (TOTAL_SUPPLY * BigInt(priorityMaxHoldingBps)) / 10_000n;

/** True when the previewed first buy would deliver more than the cap (exactly the cap is allowed). */
export const exceedsDevFirstBuyCap = (tokensOut: bigint, max: bigint): boolean => tokensOut > max;
