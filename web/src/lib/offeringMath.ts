// Offering arithmetic, written exactly as Offering.sol computes it (W-T34). Pure, bigint wei.
//   qSale        = raiseTarget * 1e18 / price
//   supply       = sold * BPS / fBps                    (settle; "if fully sold" uses qSale)
//   creator      = supply * creatorTokenBps / BPS
//   lpTokenBps   = cBps * fBps / BPS
//   lp           = supply * lpTokenBps / BPS
//   remainder    = supply - sold - creator - lp         (burned)
//   krwSeed      = min(raised * cBps / BPS * 1e18 / price, lp) * price / 1e18
//   platform     = raised * offeringFeeBps / BPS
//   issuer       = raised - krwSeed - platform
//   upfront      = issuer * proceedsUpfrontBps / BPS (no lock: all of it)
//   locked       = issuer - upfront

export const BPS = 10_000n;
export const WAD = 10n ** 18n;

export const qSaleOf = (raiseTarget: bigint, price: bigint) => (price > 0n ? (raiseTarget * WAD) / price : 0n);
export const lpTokenBpsOf = (cBps: number, fBps: number) => (BigInt(cBps) * BigInt(fBps)) / BPS;

export type Allocation = {supply: bigint; sold: bigint; creator: bigint; lp: bigint; remainder: bigint};

/** Token allocation for `sold` tokens (qSale when fully sold). */
export function allocationOf(sold: bigint, p: {fBps: number; creatorTokenBps: number; cBps: number}): Allocation {
    if (p.fBps <= 0) return {supply: 0n, sold, creator: 0n, lp: 0n, remainder: 0n};
    const supply = (sold * BPS) / BigInt(p.fBps);
    const creator = (supply * BigInt(p.creatorTokenBps)) / BPS;
    const lp = (supply * lpTokenBpsOf(p.cBps, p.fBps)) / BPS;
    const used = sold + creator + lp;
    return {supply, sold, creator, lp, remainder: supply > used ? supply - used : 0n};
}

export type Proceeds = {raised: bigint; krwSeed: bigint; platform: bigint; issuer: bigint; upfront: bigint; locked: bigint};

/** Proceeds split for `raised` (raiseTarget when fully sold). */
export function proceedsOf(
    raised: bigint,
    p: {price: bigint; fBps: number; creatorTokenBps: number; cBps: number; offeringFeeBps: number; proceedsUpfrontBps: number; hasLock: boolean},
    sold: bigint
): Proceeds {
    const lp = allocationOf(sold, p).lp;
    let tokenSeed = p.price > 0n ? (((raised * BigInt(p.cBps)) / BPS) * WAD) / p.price : 0n;
    if (tokenSeed > lp) tokenSeed = lp;
    const krwSeed = (tokenSeed * p.price) / WAD;
    const platform = (raised * BigInt(p.offeringFeeBps)) / BPS;
    const issuer = raised - krwSeed - platform;
    const upfront = p.hasLock ? (issuer * BigInt(p.proceedsUpfrontBps)) / BPS : issuer;
    return {raised, krwSeed, platform, issuer, upfront, locked: issuer - upfront};
}

/** Shares of the total supply in bps, as Offering.sol splits it: sale f, issuer, LP = c x f (floor),
 *  and the remainder burned at settle (supply - sold - issuer - LP). The four add up to 10,000. */
export function allocationBps(p: {fBps: number; creatorTokenBps: number; cBps: number}): {sale: number; issuer: number; lp: number; burn: number} {
    const lp = Number(lpTokenBpsOf(p.cBps, p.fBps));
    const burn = Math.max(0, Number(BPS) - p.fBps - p.creatorTokenBps - lp);
    return {sale: p.fBps, issuer: p.creatorTokenBps, lp, burn};
}
