// After the deadline of an unsettled offering (W-T38): start refunds (enableRefunds / emergencyRefund,
// anyone with a wallet), take a refund back (refund, the committing wallet), or wait for settle.
// States from lib/offeringPhase with the chain's block time; every send is simulated first (a
// revert shows its Korean reason, no wallet prompt) and the time is checked again at the click.
// The screen moves on right after success without waiting for the indexer.
import {useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {useAccount, usePublicClient, useWriteContract} from "wagmi";
import {useCopy, type Copy} from "../copy";
import {ko} from "../copy/ko";
import {fmtWhen} from "../lib/format";
import {OfferingL1Abi} from "../contracts/abisV3L1";
import {giwaSepolia} from "../config/chain";
import {OfferingInfo, useOfferingDetailApi} from "../hooks";
import {afterDeadline, AfterDeadline, allowsZeroCommitClose} from "../lib/offeringPhase";
import {revertName} from "../lib/errors";
import {fmt} from "../lib/format";
import {RunFn, TxButton} from "./tx";


/** Latest block time (seconds), re-read every 15 s. */
export function useChainTime() {
    const client = usePublicClient({chainId: giwaSepolia.id});
    return useQuery({
        queryKey: ["chainTime"],
        enabled: !!client,
        refetchInterval: 15_000,
        queryFn: async () => (await client!.getBlock()).timestamp,
    });
}

/** Revert name -> Korean (ko.ts refund.errors); unknown names get the generic sentence. */
export function refundErrorText(e: unknown, copy: Copy = ko): string {
    const t = copy.refund;
    const name = revertName(e);
    return (name && t.errors[name]) || t.errors.unknown;
}

const date = (sec: bigint, locale: string) => fmtWhen(Number(sec) * 1000, locale, true);

export function RefundPanel({o, myCommitted, onChanged}: {o: OfferingInfo; myCommitted: bigint | undefined; onChanged: () => void}) {
    const copy = useCopy();
    const t = copy.refund;
    const {address} = useAccount();
    const client = usePublicClient({chainId: giwaSepolia.id});
    const {writeContractAsync} = useWriteContract();
    const chainTime = useChainTime();
    const detail = useOfferingDetailApi(o.address);
    // shown at once after a success (before the reads catch up)
    const [startedHere, setStartedHere] = useState(false);
    const [refundedHere, setRefundedHere] = useState<bigint | null>(null);
    const [error, setError] = useState<string | null>(null);

    // c: a wallet whose indexed last commitment is > 0 but holds nothing now (cancel is impossible
    // while refunding) was refunded; a wallet absent from a loaded list never committed
    const lastIndexed = detail.data?.commitments.find((c) => address && c.wallet.toLowerCase() === address.toLowerCase());
    const indexedAmount = lastIndexed ? BigInt(lastIndexed.cumulative) : 0n;
    const myRefunded = !address || !detail.data ? undefined : indexedAmount > 0n && myCommitted === 0n;

    const zeroCommitClose = allowsZeroCommitClose(o.factory);
    if (chainTime.data === undefined) return null;
    const state: AfterDeadline = refundedHere !== null
        ? {kind: "refunding", refunded: true}
        : afterDeadline({
              settled: o.settled,
              refunding: o.refunding || startedHere,
              refundMode: o.refundMode,
              deadline: o.deadline,
              totalCommitted: o.totalCommitted,
              raiseTarget: o.raiseTarget,
              chainTs: chainTime.data,
              myCommitted,
              myRefunded,
              zeroCommitClose,
          });

    /** Simulate, then send; the state is re-read from the chain time at the click. */
    const send = (fn: "enableRefunds" | "emergencyRefund" | "refund", label: string, then: () => void) => async (run: RunFn) => {
        setError(null);
        if (!client || !address) return;
        try {
            const now = (await client.getBlock()).timestamp;
            const s = afterDeadline({settled: o.settled, refunding: o.refunding || startedHere, refundMode: o.refundMode, deadline: o.deadline, totalCommitted: o.totalCommitted, raiseTarget: o.raiseTarget, chainTs: now, myCommitted, myRefunded, zeroCommitClose});
            const allowed = fn === "enableRefunds" ? s.kind === "canStartRefund" || s.kind === "canClose" : fn === "emergencyRefund" ? s.kind === "canEmergencyRefund" : s.kind === "claim";
            if (!allowed) {
                setError(t.errors.stateChanged);
                onChanged();
                return;
            }
            await client.simulateContract({address: o.address, abi: OfferingL1Abi, functionName: fn, account: address});
        } catch (e) {
            console.warn(`${fn} simulation reverted`, e);
            setError(refundErrorText(e, copy));
            return;
        }
        const ok = await run(label, () => writeContractAsync({address: o.address, abi: OfferingL1Abi, functionName: fn, chainId: giwaSepolia.id}));
        if (ok) {
            then();
            onChanged();
        }
    };

    const note = (text: string) => <p className="m-0 text-[13px] text-hanji-400 leading-relaxed">{text}</p>;
    let body: React.ReactNode = null;
    switch (state.kind) {
        case "open":
        case "settled":
            return null;
        case "canStartRefund":
            body = (
                <>
                    {note(t.targetMissed)}
                    {address ? (
                        <TxButton className="w-full mt-4" action={send("enableRefunds", t.startCta, () => setStartedHere(true))}>{t.startCta}</TxButton>
                    ) : (
                        <p className="m-0 mt-3 text-[13px] text-brass-400">{copy.hints.connectWallet}</p>
                    )}
                </>
            );
            break;
        case "canClose":
            body = (
                <>
                    {note(t.closeNote)}
                    {address ? (
                        <TxButton className="w-full mt-4" action={send("enableRefunds", t.closeCta, () => setStartedHere(true))}>{t.closeCta}</TxButton>
                    ) : (
                        <p className="m-0 mt-3 text-[13px] text-brass-400">{copy.hints.connectWallet}</p>
                    )}
                </>
            );
            break;
        case "closedEmpty":
            body = note(t.closedEmpty);
            break;
        case "claim":
            body = (
                <>
                    {note(t.refundingNote)}
                    <TxButton className="w-full mt-4" action={send("refund", t.claimLabel, () => setRefundedHere(state.amount))}>
                        {t.claimCta(fmt(state.amount, 0))}
                    </TxButton>
                </>
            );
            break;
        case "refunding":
            body = state.refunded
                ? <p className="m-0 text-[14px] text-hanji-100 font-semibold">{t.refunded(fmt(refundedHere ?? indexedAmount, 0))}</p>
                : note(t.refundingOther);
            break;
        case "awaitSettle":
            body = note(t.awaitSettle(date(state.emergencyAt, copy.locale)));
            break;
        case "canEmergencyRefund":
            body = (
                <>
                    {note(t.timeoutPassed)}
                    {address ? (
                        <TxButton className="w-full mt-4" action={send("emergencyRefund", t.startCta, () => setStartedHere(true))}>{t.startCta}</TxButton>
                    ) : (
                        <p className="m-0 mt-3 text-[13px] text-brass-400">{copy.hints.connectWallet}</p>
                    )}
                </>
            );
            break;
    }
    return (
        <div>
            {body}
            {error && <p className="m-0 mt-3 text-[13px] text-brass-400">{error}</p>}
            {myCommitted !== undefined && myCommitted > 0n && state.kind !== "claim" && (
                <div className="flex justify-between text-[13px] mt-4 pt-4 border-t border-ink-700">
                    <span className="text-hanji-400">{copy.offering.myCommit}</span>
                    <span className="text-hanji-100 font-semibold tabular-nums">{fmt(myCommitted, 0)} KRWs</span>
                </div>
            )}
        </div>
    );
}
