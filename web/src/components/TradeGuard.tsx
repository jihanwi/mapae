// Slippage picker, price impact rows and the re-quote guard used by CurveTradePanel.
// Layout note (390px): the picker wraps (flex-wrap); the custom input is a small fixed-size field.
import {ReactNode, useCallback, useReducer, useState} from "react";
import {useCopy} from "../copy";
import {humanError, revertName} from "../lib/errors";
import {fmt} from "../lib/format";
import {
    effectiveBps,
    guardReducer,
    HIGH_WARN_BPS,
    IMPACT_WARN_BPS,
    loadPref,
    parseCustomSlippage,
    pctOneDecimal,
    pctTwoDecimals,
    PRESETS,
    requoteDecision,
    savePref,
    SlippagePref,
} from "../lib/slippage";
import {RunFn, RunOpts, TxButton, useToast} from "./tx";
import {simulateWithApprovalRetry} from "../lib/allowance";

// ---------------------------------------------------------------------------------------------
// Preference
// ---------------------------------------------------------------------------------------------

export function useSlippagePref(autoBps: number) {
    const [pref, setPrefState] = useState<SlippagePref>(loadPref);
    const setPref = useCallback((p: SlippagePref) => {
        savePref(p);
        setPrefState(p);
    }, []);
    return {pref, setPref, bps: effectiveBps(pref, autoBps)};
}

export function SlippagePicker({pref, setPref, autoBps}: {pref: SlippagePref; setPref: (p: SlippagePref) => void; autoBps: number}) {
    const tr = useCopy();
    const [custom, setCustom] = useState(pref.mode === "custom" ? pctOneDecimal(pref.bps) : "");
    const [editing, setEditing] = useState(pref.mode === "custom");
    const parsed = parseCustomSlippage(custom);
    const chip = (active: boolean) =>
        `px-3 min-h-[32px] rounded-full border ${active ? "border-brass-400 text-brass-400" : "border-ink-700 text-hanji-400 hover:border-brass-600"}`;
    return (
        <div className="mb-4 text-[12px]">
            <div className="flex items-center gap-2 flex-wrap">
                <span className="text-hanji-400">{tr.curve.slippage}</span>
                <button onClick={() => (setEditing(false), setPref({mode: "auto"}))} className={chip(pref.mode === "auto" && !editing)}>
                    {pref.mode === "auto" ? tr.tradeGuard.slipAutoValue(pctOneDecimal(autoBps)) : tr.tradeGuard.slipAuto}
                </button>
                {PRESETS.map((b) => (
                    <button key={b} onClick={() => (setEditing(false), setPref({mode: "preset", bps: b}))} className={chip(pref.mode === "preset" && pref.bps === b && !editing)}>
                        {b / 100}%
                    </button>
                ))}
                <button onClick={() => setEditing(true)} className={chip(editing || pref.mode === "custom")}>
                    {tr.tradeGuard.slipCustom}
                </button>
                {editing && (
                    <span className="inline-flex items-center gap-1">
                        <input
                            value={custom}
                            inputMode="decimal"
                            aria-label={tr.tradeGuard.slipCustom}
                            placeholder={tr.tradeGuard.slipCustomPlaceholder}
                            onChange={(e) => {
                                const v = e.target.value.replace(/[^0-9.]/g, "");
                                setCustom(v);
                                const p = parseCustomSlippage(v);
                                if (p.ok) setPref({mode: "custom", bps: p.bps});
                            }}
                            className="w-[72px] bg-ink-900 border border-ink-700 rounded-input px-2 min-h-[32px] text-hanji-100 outline-none focus:border-brass-400 tabular-nums"
                        />
                        <span className="text-hanji-400">%</span>
                    </span>
                )}
            </div>
            {editing && custom !== "" && !parsed.ok && <p className="m-0 mt-1 text-error">{tr.tradeGuard.slipCustomInvalid}</p>}
            {pref.mode !== "auto" && pref.bps > HIGH_WARN_BPS && <p className="m-0 mt-1 text-brass-400">{tr.tradeGuard.slipHigh}</p>}
        </div>
    );
}

// ---------------------------------------------------------------------------------------------
// Impact and minimum output
// ---------------------------------------------------------------------------------------------

function Line({label, value, warn}: {label: string; value: ReactNode; warn?: boolean}) {
    return (
        <div className="flex justify-between gap-3 text-[13px] mb-1 flex-wrap">
            <span className="text-hanji-400">{label}</span>
            <span className={`tabular-nums text-right ${warn ? "text-brass-400 font-semibold" : "text-hanji-100"}`}>{value}</span>
        </div>
    );
}

/** "Price impact x.xx%" (warning at 10%+) and "Minimum received n unit" (rounded down). */
export function ImpactRows({impactBps, minOut, dp, unit}: {impactBps: bigint | undefined; minOut: bigint; dp: number; unit: string}) {
    const tr = useCopy();
    const high = impactBps !== undefined && impactBps >= IMPACT_WARN_BPS;
    return (
        <>
            {impactBps !== undefined && <Line label={tr.tradeGuard.impact} value={`${pctTwoDecimals(impactBps)}%`} warn={high} />}
            {high && <p className="m-0 mb-1 text-[12px] text-brass-400">{tr.tradeGuard.impactHigh}</p>}
            <Line label={tr.tradeGuard.minReceive} value={`${fmt(minOut, dp, tr.locale)} ${unit}`} />
        </>
    );
}

// ---------------------------------------------------------------------------------------------
// Re-quote before sending
// ---------------------------------------------------------------------------------------------

export type SendPlan = {
    /** The quote the user saw when pressing the button. */
    seen: bigint;
    bps: number;
    /** Fresh on-chain quote (same view as the displayed one). */
    requote: () => Promise<bigint>;
    /** simulateContract with this minimum (throws on revert). */
    simulate: (min: bigint) => Promise<unknown>;
    write: (min: bigint) => Promise<`0x${string}`>;
    label: string;
    opts: RunOpts;
    /** An approval was sent right before this trade: a simulation that fails for another reason
     *  (likely the node not seeing the approval yet) is retried once after RESIMULATE_DELAY_MS. */
    justApproved?: boolean;
    sleep?: (ms: number) => Promise<void>;
};

/** Re-quote, compare with what the user saw, simulate, then send. InsufficientOutput before
 *  sending opens the "price moved" panel; after sending, the "gas spent" panel. Other failures use
 *  the existing error handling. */
export function useGuardedSend() {
    const tr = useCopy();
    const push = useToast();
    const [guard, dispatch] = useReducer(guardReducer, {kind: "idle"});

    const send = useCallback(
        async (run: RunFn, p: SendPlan): Promise<boolean> => {
            let fresh: bigint;
            try {
                fresh = await p.requote();
            } catch (e) {
                console.error("re-quote failed", e);
                push({kind: "error", text: humanError(e, tr, "v3")});
                return false;
            }
            dispatch({type: "requoted", seen: p.seen, fresh, bps: p.bps});
            const d = requoteDecision(p.seen, fresh, p.bps);
            if (d.kind === "confirm") return false;
            try {
                await simulateWithApprovalRetry(() => p.simulate(d.min), !!p.justApproved, revertName, p.sleep);
            } catch (e) {
                const name = revertName(e);
                if (name === "InsufficientOutput") {
                    dispatch({type: "simulateFailed", reason: "InsufficientOutput", fresh});
                } else if (name === "NotVerified") {
                    // v3.1: the device clock says the priority window is over but the chain does not yet.
                    push({kind: "error", text: tr.priority.stillWindow});
                } else {
                    push({kind: "error", text: humanError(e, tr, "v3")});
                    p.opts.onRevert?.(name);
                }
                return false;
            }
            let sent = false;
            return run(
                p.label,
                async () => {
                    const h = await p.write(d.min);
                    sent = true;
                    return h;
                },
                {
                    ...p.opts,
                    onRevert: (name) => {
                        p.opts.onRevert?.(name);
                        if (!sent) return;
                        // The receipt only says "reverted": replay the same call to see why.
                        p.simulate(d.min).then(
                            () => undefined,
                            (e) => dispatch({type: "sentFailed", reason: revertName(e) === "InsufficientOutput" ? "InsufficientOutput" : "other"})
                        );
                    },
                }
            );
        },
        [push, tr]
    );
    return {guard, send, reset: () => dispatch({type: "reset"})};
}

/** Panels for the two guard states. `retry(run, seen?)` runs the trade again (seen = new quote). */
export function GuardPanel({
    guard,
    dp,
    unit,
    retry,
    autoAvailable,
    switchToAuto,
    autoBps,
}: {
    guard: ReturnType<typeof useGuardedSend>["guard"];
    dp: number;
    unit: string;
    retry: (run: RunFn, seen?: bigint, bps?: number) => Promise<unknown>;
    autoAvailable: boolean;
    switchToAuto: () => void;
    autoBps: number;
}) {
    const tr = useCopy();
    if (guard.kind === "idle") return null;
    const box = "mt-3 rounded-input px-4 py-3 text-[13px] border";
    const style = {background: "rgba(195,154,59,.08)", borderColor: "rgba(195,154,59,.3)"};
    if (guard.kind === "moved") {
        return (
            <div className={box} style={style}>
                <p className="m-0 mb-2 text-brass-400">{tr.tradeGuard.moved}</p>
                <Line label={tr.tradeGuard.movedQuote} value={`${fmt(guard.fresh, dp, tr.locale)} ${unit}`} />
                <TxButton className="w-full mt-2" variant="secondary" action={(run) => retry(run, guard.fresh)}>
                    {tr.tradeGuard.continueAtPrice}
                </TxButton>
            </div>
        );
    }
    return (
        <div className={box} style={style}>
            <p className="m-0 mb-2 text-brass-400">{tr.tradeGuard.sentFailed}</p>
            <TxButton
                className="w-full"
                variant="secondary"
                action={(run) => {
                    if (!autoAvailable) return retry(run);
                    switchToAuto();
                    return retry(run, undefined, autoBps); // state update lands after this click
                }}
            >
                {autoAvailable ? tr.tradeGuard.retryAuto : tr.tradeGuard.retry}
            </TxButton>
        </div>
    );
}
