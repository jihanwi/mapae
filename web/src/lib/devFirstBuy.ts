// v3.2 Dev first-buy cap: the buy inside the creation tx may deliver at most
// ADDR_V3.devFirstBuyMaxTokens (5% of supply); more reverts the whole creation (DevFirstBuyTooLarge).

/** True when the previewed first buy would deliver more than the cap (exactly the cap is allowed). */
export const exceedsDevFirstBuyCap = (tokensOut: bigint, max: bigint): boolean => tokensOut > max;
