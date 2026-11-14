/** ETH left in the wallet for gas when the balance is used as the max buy amount. */
export const GAS_RESERVE_WEI = 10n ** 14n; // 0.0001 ETH

/** Max input for a balance: the full ERC20 balance, or native ETH minus the gas reserve (never < 0). */
export function maxInput(balance: bigint, native: boolean): bigint {
    if (!native) return balance;
    return balance > GAS_RESERVE_WEI ? balance - GAS_RESERVE_WEI : 0n;
}
