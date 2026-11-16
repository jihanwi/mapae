import {useEffect, useState} from "react";
import {Link} from "react-router-dom";
import {useReadContracts} from "wagmi";
import {Abi} from "viem";
import {ProceedsLockAbi} from "../contracts/abisV3L1";
import {giwaSepolia} from "../config/chain";
import {copy} from "../copy";
import {labelOf, useOfferings, useParticipantCounts, OfferingInfo} from "../hooks";
import {Badge, Card, CardSkeleton, Gauge, Medallion, NetError, Stat, TextSkeleton} from "../components/ui";
import {countdown, fmt} from "../lib/format";
import {bpsPct, spanText} from "../lib/proceedsText";
import {DEFAULT_TITLE, useTitle} from "../lib/title";

function useNow() {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        const iv = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(iv);
    }, []);
    return now;
}

/** Proceeds terms line for the list card (W-T32): upfront share and the lock length. */
function ProceedsLine({o, lockDuration}: {o: OfferingInfo; lockDuration: bigint | undefined}) {
    if (!o.proceedsLock) return <div className="text-[12px] text-hanji-400 mb-[18px]">{copy.home.proceedsAllUpfront}</div>;
    if (lockDuration === undefined) return <div className="mb-[18px]" />;
    return <div className="text-[12px] text-hanji-400 mb-[18px]">{copy.home.proceedsShort(bpsPct(o.proceedsUpfrontBps), spanText(lockDuration))}</div>;
}

function OfferingCard({o, participants, lockDuration}: {o: OfferingInfo; participants: number | undefined; lockDuration: bigint | undefined}) {
    const now = useNow();
    const c = labelOf(o);
    const live = !o.settled && !o.refunding && Number(o.deadline) * 1000 > now;
    const frozen = live && Number(o.deadline) * 1000 - now < 2 * 3600 * 1000;
    const ended = !o.settled && !o.refunding && !live; // P0 2-a: 마감 후 정산 전
    const pctNum = o.raiseTarget > 0n ? Number((o.totalCommitted * 1000n) / o.raiseTarget) / 10 : 0;

    const header = (
        <div className="flex items-center gap-3.5 mb-[18px]">
            <Medallion char={c ? [...c.name][0] : "…"} active={live} />
            <div className="flex-1 min-w-0">
                <div className="text-[17px] font-bold break-words">
                    {c ? <>{c.name} <span className="text-hanji-400 font-normal">{c.symbol}</span></> : <TextSkeleton w={120} h={17} />}
                </div>
                <div className="text-[12px] text-hanji-400 mt-0.5">{copy.home.verifiedCreator}</div>
            </div>
            <div className="flex flex-col gap-1.5 items-end">
                {o.settled ? (
                    <Badge kind="neutral">{copy.badge.settled}</Badge>
                ) : o.refunding ? (
                    <Badge kind="neutral">{copy.badge.refunding}</Badge>
                ) : ended ? (
                    <Badge kind="neutral">{copy.badge.ended}</Badge>
                ) : frozen ? (
                    <Badge kind="frozen">{copy.badge.frozen}</Badge>
                ) : (
                    <Badge kind="open">{copy.badge.open}</Badge>
                )}
                {live && o.refundMode === 1 && <Badge kind="partial">{copy.badge.partialMode}</Badge>}
            </div>
        </div>
    );

    if (o.settled) {
        return (
            <Card>
                {header}
                <div className="grid grid-cols-2 gap-3 mb-[18px]">
                    <Stat label={copy.home.offerPrice} value={fmt(o.price, 0)} unit="KRWs" />
                    <Stat label={copy.home.spotPrice} value={o.spotPrice > 0n ? fmt(o.spotPrice, 0) : "—"} unit="KRWs" />
                </div>
                <div className="flex justify-between items-center pt-4 border-t border-ink-700 text-[13px]">
                    <span className="text-hanji-400">
                        {copy.home.burned(fmt(computeBurned(o)))}
                    </span>
                    <Link to={`/trade?o=${o.address}`} className="font-semibold">{copy.home.goTrade}</Link>
                </div>
            </Card>
        );
    }

    return (
        <Link to={`/offering/${o.address}`} className="block text-hanji-100">
            <Card className="hover:border-brass-600">
                {header}
                <div className="mb-2"><Gauge committed={o.totalCommitted} target={o.raiseTarget} /></div>
                <div className="flex justify-between text-[13px] mb-2">
                    <span className="text-hanji-400 tabular-nums">{fmt(o.totalCommitted, 0)} / {fmt(o.raiseTarget, 0)} KRWs</span>
                    <span className={`font-semibold ${pctNum > 100 ? "text-brass-400" : "text-hanji-400"}`}>
                        {pctNum.toFixed(0)}%{pctNum > 100 ? ` · ${copy.home.over}` : ""}
                    </span>
                </div>
                <ProceedsLine o={o} lockDuration={lockDuration} />
                <div className="flex justify-between items-center pt-4 border-t border-ink-700 text-[13px] flex-wrap gap-2">
                    <span className="text-hanji-400">
                        {copy.home.price} <span className="text-hanji-100 font-semibold">{fmt(o.price, 0)} KRWs</span>{copy.home.perUnit}
                        {participants !== undefined && <> · <span className="whitespace-nowrap">{copy.home.participants(participants)}</span></>}
                    </span>
                    <span className={`font-semibold tabular-nums ${frozen || countdown(o.deadline, now).startsWith("D-0") ? "text-brass-400" : "text-hanji-400"}`}>
                        {countdown(o.deadline, now)}
                    </span>
                </div>
            </Card>
        </Link>
    );
}

/** 누적 소각 = 정산 시 초기 발행량 − 현재 totalSupply.
 *  초기 발행량 = 판매분 총공급(totalSold / f) + 정산 시 소각된 미판매분(qSale − totalSold, 모드 B). */
export function computeBurned(o: OfferingInfo): bigint {
    if (!o.settled || o.fBps === 0) return 0n;
    const initial = (o.totalSold * 10_000n) / BigInt(o.fBps) + (o.qSale - o.totalSold);
    return initial > o.totalSupply ? initial - o.totalSupply : 0n;
}

export default function Home() {
    useTitle(DEFAULT_TITLE);
    const {offerings, empty, isLoading, isError, refetch} = useOfferings();
    const participants = useParticipantCounts(offerings.map((o) => o.address));
    // lock length per offering: one multicall over every ProceedsLock in the list
    const locks = offerings.map((o) => o.proceedsLock).filter((l): l is `0x${string}` => !!l);
    const lockReads = useReadContracts({
        contracts: locks.map((l) => ({address: l, abi: ProceedsLockAbi as Abi, functionName: "duration", chainId: giwaSepolia.id})),
        query: {enabled: locks.length > 0},
    });
    const durationOf = (o: OfferingInfo) => {
        const i = o.proceedsLock ? locks.indexOf(o.proceedsLock) : -1;
        return i >= 0 ? (lockReads.data?.[i]?.result as bigint | undefined) : undefined;
    };
    return (
        <div className="max-w-page mx-auto px-4 sm:px-8 pt-10 sm:pt-16 pb-16 sm:pb-20">
            <div className="mb-10 sm:mb-14">
                <h1 className="m-0 mb-3 text-[24px] sm:text-[34px] font-bold leading-tight" style={{letterSpacing: "-0.01em"}}>
                    {copy.heroTitle}
                </h1>
                <p className="m-0 text-[15px] sm:text-[16px] text-hanji-400">{copy.heroSub}</p>
            </div>
            <div className="flex items-baseline gap-3 mb-5 flex-wrap">
                <h2 className="m-0 text-[21px] font-bold">{copy.home.section}</h2>
                {isLoading ? (
                    <span className="flex items-center gap-2 text-[13px] text-hanji-400">
                        <span className="w-3 h-3 rounded-full border-2 border-brass-400 border-t-transparent animate-spin flex-none" />
                        {copy.home.loading}
                    </span>
                ) : (
                    <span className="text-[13px] text-hanji-400">{copy.network}</span>
                )}
            </div>
            {isError && offerings.length === 0 ? (
                <NetError onRetry={refetch} />
            ) : empty ? (
                <div className="flex flex-wrap items-center gap-6 bg-ink-800 border border-ink-700 rounded-card p-5 sm:p-8">
                    <Medallion char="馬" size={88} dashed />
                    <div className="flex-1" style={{minWidth: 200}}>
                        <div className="text-[17px] font-bold mb-1">{copy.home.emptyTitle}</div>
                        <div className="text-[13px] text-hanji-400">{copy.home.emptyNote}</div>
                    </div>
                </div>
            ) : (
                <div className="grid gap-4 sm:gap-5" style={{gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))"}}>
                    {isLoading && [1, 2, 3].map((i) => <CardSkeleton key={i} />)}
                    {offerings.map((o) => <OfferingCard key={o.address} o={o} participants={participants.countOf(o.address)} lockDuration={durationOf(o)} />)}
                </div>
            )}
            <p className="mt-12 mb-0 text-[12px] text-hanji-400 text-center">{copy.home.footnote}</p>
        </div>
    );
}
