// "체인에 고정된 조건" (decision 58, W-T34): every row is read from the offering and its children
// (one multicall for the offering, its MapaeVesting and ProceedsLock, then the FeeRouter tier). A
// value that could not be read is left out, never filled in.
import {useReadContract, useReadContracts} from "wagmi";
import {Abi} from "viem";
import {copy} from "../copy";
import {MapaeVestingL1Abi, OfferingL1Abi, ProceedsLockAbi} from "../contracts/abisV3L1";
import {FeeRouterAbi} from "../contracts/abisV3";
import {giwaSepolia} from "../config/chain";
import {OfferingInfo, useOfferingDetailApi} from "../hooks";
import {fmt} from "../lib/format";
import {allocationOf} from "../lib/offeringMath";
import {bpsPct, spanText} from "../lib/proceedsText";

const OFFERING_FNS = ["minCommit", "walletLimit", "cBps", "creatorTokenBps", "lpTokenBps", "swapRoyaltyBps", "swapBurnBps", "offeringFeeBps", "feeRouter"] as const;

function Row({k, v}: {k: string; v: React.ReactNode}) {
    return (
        <>
            <span className="text-hanji-400">{k}</span>
            <span className="text-hanji-100 text-right tabular-nums break-words">{v}</span>
        </>
    );
}

export function ChainTerms({o}: {o: OfferingInfo}) {
    const reads = useReadContracts({
        contracts: [
            ...OFFERING_FNS.map((fn) => ({address: o.address, abi: OfferingL1Abi as Abi, functionName: fn, chainId: giwaSepolia.id})),
            ...(o.vesting ? (["start", "duration", "cliff"] as const).map((fn) => ({address: o.vesting!, abi: MapaeVestingL1Abi as Abi, functionName: fn, chainId: giwaSepolia.id})) : []),
            ...(o.proceedsLock ? (["start", "duration", "cliff"] as const).map((fn) => ({address: o.proceedsLock!, abi: ProceedsLockAbi as Abi, functionName: fn, chainId: giwaSepolia.id})) : []),
        ],
    });
    const r = reads.data?.map((x) => (x.status === "success" ? x.result : undefined)) ?? [];
    const v = Object.fromEntries(OFFERING_FNS.map((fn, i) => [fn, r[i]])) as Record<(typeof OFFERING_FNS)[number], unknown>;
    let i = OFFERING_FNS.length;
    const vest = o.vesting ? (r.slice(i, (i += 3)) as (bigint | undefined)[]) : [];
    const lock = o.proceedsLock ? (r.slice(i, (i += 3)) as (bigint | undefined)[]) : [];
    const fees = useReadContract({
        address: v.feeRouter as `0x${string}` | undefined, abi: FeeRouterAbi, functionName: "getFees", args: [o.tier], chainId: giwaSepolia.id,
        query: {enabled: v.feeRouter !== undefined},
    }).data as {swapPlatformBps: number; swapLpBps: number} | undefined;
    const detail = useOfferingDetailApi(o.address);
    const createdTs = (detail.data?.offering as {createdTs?: string} | undefined)?.createdTs;

    const n = (x: unknown) => (x === undefined ? undefined : Number(x));
    const cBps = n(v.cBps), creatorBps = n(v.creatorTokenBps), lpBps = n(v.lpTokenBps);
    const alloc = cBps !== undefined && creatorBps !== undefined ? allocationOf(o.qSale, {fBps: o.fBps, creatorTokenBps: creatorBps, cBps}) : undefined;
    const end = new Date(Number(o.deadline) * 1000).toLocaleString("ko-KR", {month: "long", day: "numeric", hour: "2-digit", minute: "2-digit"});
    const t = copy.terms;
    const royalty = n(v.swapRoyaltyBps), burn = n(v.swapBurnBps);

    const rows: [string, React.ReactNode][] = [
        [t.price, `${fmt(o.price, 0)} KRWs`],
        [t.raiseTarget, `${fmt(o.raiseTarget, 0)} KRWs`],
        [t.saleQty, `${fmt(o.qSale, 2)}개`],
        ...(v.walletLimit !== undefined ? [[t.walletLimit, `${fmt(v.walletLimit as bigint, 0)} KRWs`] as [string, string]] : []),
        ...(v.minCommit !== undefined ? [[t.minCommit, `${fmt(v.minCommit as bigint, 0)} KRWs`] as [string, string]] : []),
        [createdTs ? t.period : t.deadline, createdTs ? t.periodValue(String(Math.round((Number(o.deadline) - Number(createdTs)) / 3600)), end) : end],
        ...(o.settled
            ? [[t.supply, t.supplySettled(fmt(o.totalSupply, 2))] as [string, string]]
            : alloc ? [[t.supply, t.supplyIfFull(fmt(alloc.supply, 2))] as [string, string]] : []),
        ...(creatorBps !== undefined && lpBps !== undefined ? [[t.allocation, t.allocationValue(bpsPct(o.fBps), bpsPct(creatorBps), bpsPct(lpBps))] as [string, string]] : []),
        ...(vest.length === 3 && vest.every((x) => x !== undefined)
            ? [[t.vesting, t.vestingValue(spanText(vest[1]!), vest[2]! > vest[0]! ? spanText(vest[2]! - vest[0]!) : null)] as [string, string]]
            : []),
        ...(o.proceedsLock
            ? lock.every((x) => x !== undefined)
                ? [[t.proceeds, copy.offering.proceedsTerms(bpsPct(o.proceedsUpfrontBps), spanText(lock[1]!)) + (lock[2]! > lock[0]! ? ` · ${copy.offering.proceedsCliff(spanText(lock[2]! - lock[0]!))}` : "")] as [string, string]]
                : []
            : [[t.proceeds, copy.offering.proceedsAllUpfront] as [string, string]]),
        [t.refundMode, o.refundMode === 0 ? t.refundAll : t.refundPartial],
        ...(v.offeringFeeBps !== undefined ? [[t.offeringFee, `${bpsPct(n(v.offeringFeeBps)!)}%`] as [string, string]] : []),
        ...(royalty !== undefined && burn !== undefined && fees
            ? [[t.swapFee, t.swapFeeValue(bpsPct(royalty + burn + fees.swapLpBps + fees.swapPlatformBps), bpsPct(royalty), bpsPct(burn), bpsPct(fees.swapLpBps), bpsPct(fees.swapPlatformBps))] as [string, string]]
            : []),
        [t.sponsorship, o.sponsorship ? t.sponsorshipOn : t.sponsorshipOff],
        [t.lpLock, t.lpLockValue],
        [t.mint, t.mintValue],
    ];
    return (
        <section className="mt-7 bg-ink-800 border border-ink-700 rounded-card p-4 sm:p-6">
            <h2 className="m-0 text-[17px] font-bold">{t.title}</h2>
            <p className="m-0 mt-1 mb-4 text-[12px] text-hanji-400">{t.note}</p>
            <div className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-[13px]">
                {rows.map(([k, val]) => <Row key={k} k={k} v={val} />)}
            </div>
            {reads.isError && <p className="m-0 mt-3 text-[12px] text-brass-400">{t.readError}</p>}
        </section>
    );
}
