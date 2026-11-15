// 24 h flow card helpers (pure).

/** Buy share of buy + sell volume as a whole percent (rounded half up, bigint); null when both are 0. */
export function flowShare(buyVolume: bigint, sellVolume: bigint): number | null {
    const total = buyVolume + sellVolume;
    if (total <= 0n) return null;
    return Number((buyVolume * 200n + total) / (2n * total));
}
