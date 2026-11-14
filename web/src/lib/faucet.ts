// Faucet sizing for the v3 onboarding modal (MockKRW.faucet reverts above FAUCET_CAP).
const WHOLE = 10n ** 18n;
export const FAUCET_ROUND = 10_000n * WHOLE;

/** Shortfall rounded up to 10,000 KRWs (at least 10,000), capped at FAUCET_CAP. */
export function faucetAmount(shortfall: bigint, cap: bigint): bigint {
    const want = shortfall <= 0n ? FAUCET_ROUND : ((shortfall + FAUCET_ROUND - 1n) / FAUCET_ROUND) * FAUCET_ROUND;
    return want > cap ? cap : want;
}
