// Quick amount buttons under the trade input. Pure: values are 18-decimal wei (KRWs, ETH, WETH and
// tokens are all 18 decimals in this app); "max" is resolved by the panel with maxInput.
import {maxInput} from "./maxInput";

export type QuickLabel = "k10" | "k50" | "k100" | "e001" | "e005" | "e01" | "p25" | "p50" | "p75" | "max";
export type QuickAmount = {label: QuickLabel; value: bigint | "max"; disabled: boolean};

const E18 = 10n ** 18n;

/** Four buttons for the side. Buy: fixed amounts in the paid asset (KRWs, or ETH / pool WETH),
 *  never disabled (an amount above the balance is still filled in; the CTA says it is not enough).
 *  Sell: 25/50/75% of the token balance, floored, disabled while the balance is 0 or unknown.
 *  "max" is disabled when maxInput(balance, native) would be 0. */
export function quickAmounts(side: "buy" | "sell", isEth: boolean, balance: bigint | undefined, native: boolean): QuickAmount[] {
    const maxOff = balance === undefined || maxInput(balance, native) === 0n;
    const max: QuickAmount = {label: "max", value: "max", disabled: maxOff};
    if (side === "buy") {
        const fixed: [QuickLabel, bigint][] = isEth
            ? [
                  ["e001", E18 / 100n],
                  ["e005", (5n * E18) / 100n],
                  ["e01", E18 / 10n],
              ]
            : [
                  ["k10", 10_000n * E18],
                  ["k50", 50_000n * E18],
                  ["k100", 100_000n * E18],
              ];
        return [...fixed.map(([label, value]) => ({label, value, disabled: false})), max];
    }
    const bal = balance ?? 0n;
    const pct = (label: QuickLabel, p: bigint): QuickAmount => ({label, value: (bal * p) / 100n, disabled: bal === 0n});
    return [pct("p25", 25n), pct("p50", 50n), pct("p75", 75n), max];
}

/** Share of the total supply with one decimal, floored ("12.3"); exactly 0 -> "0". */
export function sharePctOneDecimal(balance: bigint, totalSupply: bigint): string {
    if (balance === 0n || totalSupply === 0n) return "0";
    const tenths = (balance * 1000n) / totalSupply;
    return `${tenths / 10n}.${tenths % 10n}`;
}
