import {useEffect, useState} from "react";
import {Link} from "react-router-dom";
import {copy} from "../copy";
import {useOfferings, useParticipantCount, OfferingInfo} from "../hooks";
import {Badge, Card, Gauge, Medallion, Skeleton, Stat} from "../components/ui";
import {countdown, fmt} from "../lib/format";
import {creatorOf} from "../lib/creators";

function useNow() {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        const iv = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(iv);
    }, []);
    return now;
}

function OfferingCard({o}: {o: OfferingInfo}) {
    const now = useNow();
    const c = creatorOf(o);
    const participants = useParticipantCount(o.address);
    const live = !o.settled && !o.refunding && Number(o.deadline) * 1000 > now;
    const frozen = live && Number(o.deadline) * 1000 - now < 2 * 3600 * 1000;
    const pctNum = o.raiseTarget > 0n ? Number((o.totalCommitted * 1000n) / o.raiseTarget) / 10 : 0;

    const header = (
        <div className="flex items-center gap-3.5 mb-[18px]">
            <Medallion char={c.name[0]} active={live} />
            <div className="flex-1 min-w-0">
                <div className="text-[17px] font-bold">
                    {c.name} <span className="text-hanji-400 font-normal">{c.en}</span>
                </div>
                <div className="text-[12px] text-hanji-400 mt-0.5">{copy.home.verifiedCreator}</div>
            </div>
            <div className="flex flex-col gap-1.5 items-end">
                {o.settled ? (
                    <Badge kind="neutral">{copy.badge.settled}</Badge>
                ) : o.refunding ? (
                    <Badge kind="neutral">{copy.badge.refunding}</Badge>
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
                <div className="flex justify-between text-[13px] mb-[18px]">
                    <span className="text-hanji-400 tabular-nums">{fmt(o.totalCommitted, 0)} / {fmt(o.raiseTarget, 0)} KRWs</span>
                    <span className={`font-semibold ${pctNum > 100 ? "text-brass-400" : "text-hanji-400"}`}>
                        {pctNum.toFixed(0)}%{pctNum > 100 ? ` · ${copy.home.over}` : ""}
                    </span>
                </div>
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

/** 누적 소각 = 정산 시 총공급(S' = totalSold / f) − 현재 totalSupply */
export function computeBurned(o: OfferingInfo): bigint {
    if (!o.settled || o.fBps === 0) return 0n;
    const initial = (o.totalSold * 10_000n) / BigInt(o.fBps);
    return initial > o.totalSupply ? initial - o.totalSupply : 0n;
}

export default function Home() {
    const {offerings, isLoading} = useOfferings();
    return (
        <div className="max-w-page mx-auto px-4 sm:px-8 pt-12 sm:pt-16 pb-20">
            <div className="mb-14">
                <h1 className="m-0 mb-3 text-[28px] sm:text-[34px] font-bold leading-tight" style={{letterSpacing: "-0.01em"}}>
                    {copy.heroTitle}
                </h1>
                <p className="m-0 text-[16px] text-hanji-400">{copy.heroSub}</p>
            </div>
            <div className="flex items-baseline gap-3 mb-5">
                <h2 className="m-0 text-[21px] font-bold">{copy.home.section}</h2>
                <span className="text-[13px] text-hanji-400">{copy.network}</span>
            </div>
            <div className="grid gap-5" style={{gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))"}}>
                {isLoading && [1, 2, 3].map((i) => <Skeleton key={i} h={220} />)}
                {offerings.map((o) => <OfferingCard key={o.address} o={o} />)}
            </div>
            <p className="mt-12 mb-0 text-[12px] text-hanji-400 text-center">{copy.home.footnote}</p>
        </div>
    );
}
