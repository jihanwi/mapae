/** 등급 = balance / totalSupply 실계산 (C2 — 하드코딩 금지). 임계값은 지분율 bps. */
export const TIERS = [
    {hanja: "一馬", name: "일마", minBps: 1n},      // > 0
    {hanja: "二馬", name: "이마", minBps: 50n},     // ≥ 0.5%
    {hanja: "三馬", name: "삼마", minBps: 100n},    // ≥ 1%
    {hanja: "四馬", name: "사마", minBps: 300n},    // ≥ 3%
    {hanja: "五馬", name: "오마", minBps: 500n},    // ≥ 5%
] as const;

export function tierIndex(balance: bigint, totalSupply: bigint): number {
    if (balance === 0n || totalSupply === 0n) return -1;
    const bps = (balance * 10_000n) / totalSupply;
    let idx = 0;
    for (let i = TIERS.length - 1; i >= 0; i--) {
        if (bps >= TIERS[i].minBps) { idx = i; break; }
    }
    return idx;
}

/** 다음 등급까지 필요한 추가 보유량 (장, wei) — 바로 다음 티어 기준 (C2) */
export function toNextTier(balance: bigint, totalSupply: bigint): {next: (typeof TIERS)[number]; need: bigint} | null {
    const idx = tierIndex(balance, totalSupply);
    if (idx >= TIERS.length - 1) return null;
    const next = TIERS[idx + 1];
    const needTotal = (totalSupply * next.minBps + 9_999n) / 10_000n; // ceil
    return {next, need: needTotal > balance ? needTotal - balance : 0n};
}
