// Issuer proceeds (W-T32, decision 56): the offering's proceedsUpfrontBps and its ProceedsLock
// (MapaeFactory.proceedsLockOf, VestingWalletCliff). Before settle: the terms. After settle: chain
// amounts only (ProceedsDistributed for the upfront part, the lock's balance, released(token) and
// releasable(token) for the locked part). The issuer wallet gets a release button.
import {useEffect, useState} from "react";
import {useAccount, useReadContracts, useWriteContract} from "wagmi";
import {Abi} from "viem";
import {copy} from "../copy";
import {ADDR_L1} from "../contracts/addressesV3L1";
import {ProceedsLockAbi} from "../contracts/abisV3L1";
import {MockKRWV3Abi} from "../contracts/abisV3";
import {giwaSepolia} from "../config/chain";
import {OfferingInfo, useEventLogs} from "../hooks";
import {proceedsStatus} from "../lib/proceeds";
import {fmt} from "../lib/format";
import {bpsPct, spanText} from "../lib/proceedsText";
import {RunFn, TxButton} from "./tx";
import {TextSkeleton} from "./ui";

export const PROCEEDS_DISTRIBUTED = "event ProceedsDistributed(uint256 platformProceeds, uint256 upfront, uint256 locked, address proceedsLock)";

function useNowSec() {
    const [now, setNow] = useState(() => BigInt(Math.floor(Date.now() / 1000)));
    useEffect(() => {
        const iv = setInterval(() => setNow(BigInt(Math.floor(Date.now() / 1000))), 15_000);
        return () => clearInterval(iv);
    }, []);
    return now;
}

function Row({k, v}: {k: string; v: React.ReactNode}) {
    return (
        <>
            <span className="text-hanji-400">{k}</span>
            <span className="text-hanji-100 text-right tabular-nums">{v}</span>
        </>
    );
}

export function ProceedsPanel({o}: {o: OfferingInfo}) {
    const {address: account} = useAccount();
    const {writeContractAsync} = useWriteContract();
    const now = useNowSec();
    const lock = o.proceedsLock;
    const token = ADDR_L1.mockKRW;
    const reads = useReadContracts({
        contracts: lock
            ? [
                  {address: lock, abi: ProceedsLockAbi as Abi, functionName: "start", chainId: giwaSepolia.id},
                  {address: lock, abi: ProceedsLockAbi as Abi, functionName: "duration", chainId: giwaSepolia.id},
                  {address: lock, abi: ProceedsLockAbi as Abi, functionName: "cliff", chainId: giwaSepolia.id},
                  {address: lock, abi: ProceedsLockAbi as Abi, functionName: "owner", chainId: giwaSepolia.id},
                  {address: lock, abi: ProceedsLockAbi as Abi, functionName: "released", args: [token], chainId: giwaSepolia.id},
                  {address: lock, abi: ProceedsLockAbi as Abi, functionName: "releasable", args: [token], chainId: giwaSepolia.id},
                  {address: token, abi: MockKRWV3Abi as Abi, functionName: "balanceOf", args: [lock], chainId: giwaSepolia.id},
              ]
            : [],
        query: {enabled: !!lock, refetchInterval: o.settled ? 15_000 : false},
    });
    // the upfront amount is only in the settle transaction's event
    const dist = useEventLogs(o.settled ? o.address : undefined, PROCEEDS_DISTRIBUTED);
    if (o.refunding) return null;

    const r = reads.data?.map((x) => (x.status === "success" ? x.result : undefined));
    const [start, duration, cliffAt, beneficiary, released, releasable, balance] = (r ?? []) as [
        bigint?, bigint?, bigint?, `0x${string}`?, bigint?, bigint?, bigint?,
    ];
    const termsKnown = start !== undefined && duration !== undefined && cliffAt !== undefined;
    const readFailed = !!lock && (reads.isError || (reads.data?.some((x) => x.status !== "success") ?? false));
    const upfrontLog = dist.logs?.[0]?.args as {upfront: bigint} | undefined;

    const terms = !lock ? (
        <p className="m-0 text-[13px] text-hanji-100">{copy.offering.proceedsAllUpfront}</p>
    ) : termsKnown ? (
        <>
            <p className="m-0 text-[13px] text-hanji-100">{copy.offering.proceedsTerms(bpsPct(o.proceedsUpfrontBps), spanText(duration!))}</p>
            {cliffAt! > start! && <p className="m-0 mt-1 text-[13px] text-hanji-400">{copy.offering.proceedsCliff(spanText(cliffAt! - start!))}</p>}
        </>
    ) : readFailed ? (
        <p className="m-0 text-[13px] text-hanji-400">{copy.offering.proceedsReadError}</p>
    ) : (
        <TextSkeleton w={220} h={13} />
    );

    let settledBlock: React.ReactNode = null;
    if (o.settled) {
        const amountsKnown = termsKnown && released !== undefined && releasable !== undefined && balance !== undefined;
        const s = amountsKnown ? proceedsStatus({start: start!, duration: duration!, cliff: cliffAt!}, {balance: balance!, released: released!, releasable: releasable!}, now) : undefined;
        const isIssuer = !!account && !!beneficiary && account.toLowerCase() === beneficiary.toLowerCase();
        const phaseLine = !s ? null
            : s.phase === "beforeCliff" ? copy.offering.proceedsUntilStart(spanText(s.nextAt! - now))
            : s.phase === "vesting" ? copy.offering.proceedsUntilEnd(spanText(s.endAt - now))
            : copy.offering.proceedsDone;
        settledBlock = (
            <>
                <div className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-[13px] mt-4">
                    {upfrontLog && <Row k={copy.offering.proceedsUpfront} v={`${fmt(upfrontLog.upfront, 0)} KRWs`} />}
                    {lock && s && (
                        <>
                            <Row k={copy.offering.proceedsLocked} v={`${fmt(s.total, 0)} KRWs`} />
                            <Row k={copy.offering.proceedsUnlocked} v={`${fmt(s.unlocked, 0)} KRWs`} />
                            <Row k={copy.offering.proceedsRemaining} v={`${fmt(s.remaining, 0)} KRWs`} />
                        </>
                    )}
                </div>
                {phaseLine && <p className="m-0 mt-3 text-[12px] text-hanji-400">{phaseLine}</p>}
                {lock && s && isIssuer && (
                    <div className="mt-4">
                        <div className="flex justify-between text-[13px] mb-2">
                            <span className="text-hanji-400">{copy.offering.proceedsReleasable}</span>
                            <span className="text-hanji-100 font-semibold tabular-nums">{fmt(s.releasable, 0)} KRWs</span>
                        </div>
                        <TxButton className="w-full" disabled={s.releasable === 0n} action={(run: RunFn) =>
                            run(copy.offering.releaseLabel, () =>
                                writeContractAsync({address: lock, abi: ProceedsLockAbi as Abi, functionName: "release", args: [token], chainId: giwaSepolia.id}))
                        }>{copy.offering.releaseCta}</TxButton>
                    </div>
                )}
            </>
        );
    }

    return (
        <div className="mt-7 bg-ink-800 border border-ink-700 rounded-card p-4 sm:p-6">
            <h2 className="m-0 mb-3 text-[17px] font-bold">{copy.offering.proceedsTitle}</h2>
            {terms}
            {settledBlock}
            {lock && <p className="m-0 mt-4 text-[12px] text-hanji-400">{copy.offering.proceedsNote}</p>}
        </div>
    );
}
