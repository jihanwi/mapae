// Dev fee claim: the amount accrued in CurveSale.devAccrued and a claimDevFees() button.
// Layout note (390px): the band wraps (flex-wrap), the button never forces a horizontal scroll.
import {useWriteContract} from "wagmi";
import {useCopy} from "../copy";
import {CurveSaleAbi} from "../contracts/abisV3";
import {giwaSepolia} from "../config/chain";
import {fmt, fmtSig} from "../lib/format";
import {DevFeeUnit, devFeeState, devFeeUnit} from "../lib/devFees";
import {TxButton, useToast} from "./tx";

type Address = `0x${string}`;

/** KRWs up to 2 decimals, WETH with 4 significant digits. */
export function fmtDevFee(amount: bigint, unit: DevFeeUnit, locale: string): string {
    return unit === "WETH" ? fmtSig(amount, 4, locale) : fmt(amount, 2, locale);
}

/** [Claim]: claimDevFees() on the curve. On success the tx runner refetches every query (devAccrued
 *  and balances drop to the new values) and a toast states what was received. */
export function ClaimDevFeesButton({curve, amount, unit, className = ""}: {curve: Address; amount: bigint; unit: DevFeeUnit; className?: string}) {
    const tr = useCopy();
    const push = useToast();
    const {writeContractAsync} = useWriteContract();
    return (
        <TxButton
            variant="secondary"
            className={`!py-2 !px-4 min-h-[40px] ${className}`}
            disabled={amount === 0n}
            action={async (run) => {
                const ok = await run(
                    tr.devFees.title,
                    () => writeContractAsync({address: curve, abi: CurveSaleAbi, functionName: "claimDevFees", chainId: giwaSepolia.id}),
                    {scope: "v3"}
                );
                if (ok) push({kind: "success", text: tr.devFees.claimed(fmtDevFee(amount, unit, tr.locale), unit)});
            }}
        >
            {tr.devFees.claim}
        </TxButton>
    );
}

/** Token page band for the Dev: unclaimed amount + [Claim] (disabled at 0), with the WETH note
 *  for ETH curves and the pool-royalty note after graduation. Nothing for anyone else. */
export function DevFeeBand({curve, isDev, accrued, isEth, graduated}: {curve: Address; isDev: boolean; accrued: bigint | undefined; isEth: boolean; graduated: boolean}) {
    const tr = useCopy();
    const state = devFeeState({isDev, accrued});
    if (state === "hidden" || accrued === undefined) return null;
    const unit = devFeeUnit(isEth);
    return (
        <section aria-label={tr.devFees.title} className="bg-ink-800 border border-ink-700 rounded-card px-4 py-3 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 min-w-0">
                <span className="text-[14px] tabular-nums min-w-0 break-words">
                    {state === "ready" ? tr.devFees.unclaimed(fmtDevFee(accrued, unit, tr.locale), unit) : <span className="text-hanji-400">{tr.devFees.none}</span>}
                </span>
                <ClaimDevFeesButton curve={curve} amount={accrued} unit={unit} />
            </div>
            {isEth && <p className="m-0 mt-2 text-[12px] text-hanji-400">{tr.devFees.wethNote}</p>}
            {graduated && <p className="m-0 mt-1 text-[12px] text-hanji-400">{tr.devFees.poolNote}</p>}
        </section>
    );
}
