// Pure bigint port of src/lib/CurveMath.sol + the derived figures the UI shows. No RPC.
// Rounding matches the contract: amounts paid to the user round down, costs round up.
// Constants are copied from src/CurvePresets.sol.

export const TOTAL_SUPPLY = 1_000_000_000n * 10n ** 18n; // 1e27
export const CURVE_SUPPLY = 800_000_000n * 10n ** 18n; // 8e26
export const DEX_SUPPLY = 200_000_000n * 10n ** 18n; // 2e26
export const VIRTUAL_TOKEN_RESERVE = 1_066_666_666_666_666_666_666_666_667n; // ceil(3.2e27 / 3)
export const BPS = 10_000n;
export const WAD = 10n ** 18n;

/** Curve shape (vToken / saleSupply default to the CurvePresets geometry). */
export type Geometry = {vToken: bigint; saleSupply: bigint};
export const PRESET: Geometry = {vToken: VIRTUAL_TOKEN_RESERVE, saleSupply: CURVE_SUPPLY};

const ceilDiv = (a: bigint, b: bigint) => (a === 0n ? 0n : (a - 1n) / b + 1n);
/** Math.mulDiv(x, y, d, Rounding.Ceil) */
const mulDivUp = (x: bigint, y: bigint, d: bigint) => ceilDiv(x * y, d);

/** Spot price as a ratio (num, den) = (Vq + r) / (Vt − s), raw quote per raw token. */
export function spotPriceRatio(vq: bigint, r: bigint, s: bigint, g: Geometry = PRESET): [bigint, bigint] {
    return [vq + r, g.vToken - s];
}

/** Spot price in quote units per 1 whole token, 18-decimal fixed point (both assets are 18 decimals). */
export function spotPrice(vq: bigint, r: bigint, s: bigint, g: Geometry = PRESET): bigint {
    const [num, den] = spotPriceRatio(vq, r, s, g);
    return (num * WAD) / den;
}

/** Quote (fees excluded) needed to buy every remaining token: ceil(k / (Vt − S)) − (Vq + r), floored at 0. */
export function costToSellOut(vq: bigint, r: bigint, s: bigint, g: Geometry = PRESET): bigint {
    if (s >= g.saleSupply) return 0n;
    const xEnd = mulDivUp(vq, g.vToken, g.vToken - g.saleSupply);
    const x = vq + r;
    return xEnd > x ? xEnd - x : 0n;
}

/** Net quote the curve absorbs to sell out from genesis: 3 × Vq for the preset geometry. */
export function graduationThreshold(vq: bigint): bigint {
    return 3n * vq;
}

/** Graduation progress in bps of the threshold, from the real reserve r. Capped at 10000. */
export function progressBps(vq: bigint, r: bigint): bigint {
    const t = graduationThreshold(vq);
    if (t === 0n) return 0n;
    const p = (r * BPS) / t;
    return p > BPS ? BPS : p;
}

/** Fee-inclusive gross amount whose net (after feeBps) covers `net`: ceil(net × 1e4 / (1e4 − fee)). */
export function grossForNet(net: bigint, feeBps: bigint): bigint {
    return mulDivUp(net, BPS, BPS - feeBps);
}

/** Market cap in raw quote units = spot × TOTAL_SUPPLY (1e9 whole tokens). */
export function marketCapQuote(vq: bigint, r: bigint, s: bigint, g: Geometry = PRESET): bigint {
    const [num, den] = spotPriceRatio(vq, r, s, g);
    return (num * TOTAL_SUPPLY) / den;
}

// ---- CurveMath.buyExactQuoteIn / sellExactTokenIn (used by tests and the probe, never for quotes) ----

export function buyExactQuoteIn(
    vq: bigint,
    r: bigint,
    s: bigint,
    quoteIn: bigint,
    g: Geometry = PRESET
): {tokensOut: bigint; quoteUsed: bigint} {
    if (s > g.saleSupply) throw new Error("SoldExceedsSupply");
    if (s === g.saleSupply) return {tokensOut: 0n, quoteUsed: 0n};
    const x = vq + r;
    const y = g.vToken - s;
    let yNew = mulDivUp(vq, g.vToken, x + quoteIn);
    let tokensOut = y > yNew ? y - yNew : 0n;
    const remaining = g.saleSupply - s;
    const closes = tokensOut >= remaining;
    if (closes) {
        tokensOut = remaining;
        yNew = g.vToken - g.saleSupply;
    }
    const xEnd = mulDivUp(vq, g.vToken, yNew);
    const quoteUsed = xEnd > x ? xEnd - x : 0n;
    if (quoteUsed === 0n && !closes) return {tokensOut: 0n, quoteUsed: 0n};
    return {tokensOut, quoteUsed};
}

export function sellExactTokenIn(vq: bigint, r: bigint, s: bigint, tokenIn: bigint, g: Geometry = PRESET): bigint {
    if (s > g.saleSupply) throw new Error("SoldExceedsSupply");
    if (tokenIn > s) throw new Error("SellExceedsSold");
    if (tokenIn === 0n) return 0n;
    const x = vq + r;
    const xNew = mulDivUp(vq, g.vToken, g.vToken - s + tokenIn);
    return x > xNew ? x - xNew : 0n;
}
