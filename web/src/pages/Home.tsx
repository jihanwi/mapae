import {useEffect, useState} from "react";
import {isRefundState} from "../lib/offeringPhase";
import {Link} from "react-router-dom";
import {useReadContracts} from "wagmi";
import {Abi} from "viem";
import {ProceedsLockAbi} from "../contracts/abisV3L1";
import {giwaSepolia} from "../config/chain";
import {useCopy} from "../copy";
import {labelOf, useOfferings, useParticipantCounts, OfferingInfo} from "../hooks";
import {Badge, CardSkeleton, Eyebrow, Gauge, Medallion, NetError, PRIMARY_CLS, TextSkeleton} from "../components/ui";
import {NumText} from "../components/NumText";
import {ALLOC_README} from "../lib/allocationUrl";
import {offeringSections} from "../lib/offeringList";
import {changeLabel} from "../lib/homeList";
import {countdown, fmt} from "../lib/format";
import {bpsPct, spanText} from "../lib/proceedsText";
import {DEFAULT_TITLE, useTitle} from "../lib/title";
import {readGuideCollapsed, writeGuideCollapsed} from "../lib/guideCollapse";

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
    const copy = useCopy();
    if (!o.proceedsLock) return <span className="text-[12px] text-hanji-400">{copy.home.proceedsAllUpfront}</span>;
    if (lockDuration === undefined) return null;
    return <span className="text-[12px] text-hanji-400">{copy.home.proceedsShort(bpsPct(o.proceedsUpfrontBps), spanText(lockDuration, copy))}</span>;
}

/** The status badge(s) the list used on every card (unchanged rules). */
function StatusBadges({o, now}: {o: OfferingInfo; now: number}) {
    const copy = useCopy();
    const live = !o.settled && !o.refunding && Number(o.deadline) * 1000 > now;
    const frozen = live && Number(o.deadline) * 1000 - now < 2 * 3600 * 1000;
    const ended = !o.settled && !o.refunding && !live; // P0 2-a: 마감 후 정산 전
    return (
        <>
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
        </>
    );
}

const initialOf = (o: OfferingInfo) => {
    const c = labelOf(o);
    return c ? [...c.name][0] : "…";
};

/** W-T63: one open offering, the full row wide; the whole card links to the detail page. */
function OpenCard({o, participants, lockDuration, now}: {o: OfferingInfo; participants: number | undefined; lockDuration: bigint | undefined; now: number}) {
    const copy = useCopy();
    const c = labelOf(o);
    const frozen = Number(o.deadline) * 1000 - now < 2 * 3600 * 1000;
    const pctNum = o.raiseTarget > 0n ? Number((o.totalCommitted * 1000n) / o.raiseTarget) / 10 : 0;
    return (
        <Link
            to={`/offering/${o.address}`}
            className="block min-w-0 no-underline text-hanji-100 hover:text-hanji-100 bg-ink-800 border border-[rgba(195,154,59,.55)] rounded-[14px] p-5 sm:p-7 hover:border-brass-400 transition-colors"
        >
            <div className="flex flex-col lg:flex-row gap-6 lg:gap-10 min-w-0">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-4 min-w-0">
                        <Medallion char={initialOf(o)} size={60} />
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 min-w-0">
                                <span className="font-serif text-[26px] font-bold leading-tight [overflow-wrap:anywhere]">{c ? c.name : <TextSkeleton w={140} h={24} />}</span>
                                {c && <span className="text-[14px] text-hanji-400">{c.symbol}</span>}
                            </div>
                            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-hanji-400">
                                <StatusBadges o={o} now={now} />
                                <span>{copy.home.verifiedCreator}</span>
                            </div>
                        </div>
                    </div>
                    <div className="mt-5 flex items-baseline justify-between gap-3 flex-wrap">
                        <span>
                            <span className="num text-[26px] font-medium">{fmt(o.totalCommitted, 0)}</span>
                            <span className="text-[12px] text-hanji-400"> {copy.offering.targetOf} <span className="num">{fmt(o.raiseTarget, 0)}</span> KRWs</span>
                        </span>
                        <span className="num text-[15px] text-brass-400">
                            {pctNum.toFixed(0)}%{pctNum > 100 ? ` · ${copy.home.over}` : ""}
                        </span>
                    </div>
                    <div className="mt-2">
                        <Gauge committed={o.totalCommitted} target={o.raiseTarget} height={8} />
                    </div>
                    <div className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-[13px] text-hanji-400">
                        {participants !== undefined && <NumText text={copy.home.committedWallets(participants)} />}
                        <ProceedsLine o={o} lockDuration={lockDuration} />
                    </div>
                </div>
                <div className="lg:w-[380px] lg:flex-none min-w-0 flex flex-col justify-between gap-5">
                    <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-3">
                        <div className="min-w-0">
                            <dt className="text-[12px] text-hanji-400">{copy.home.offerPrice}</dt>
                            <dd className="m-0 mt-1 text-[15px]">
                                <span className="num">{fmt(o.price, 0)}</span> <span className="text-[12px] text-hanji-400">KRWs{copy.home.perUnit}</span>
                            </dd>
                        </div>
                        <div className="min-w-0">
                            <dt className="text-[12px] text-hanji-400">{copy.home.closesIn}</dt>
                            <dd className={`m-0 mt-1 text-[15px] num ${frozen ? "text-brass-400" : "text-brass-400"}`}>{countdown(o.deadline, now, copy.offering.deadline)}</dd>
                        </div>
                        <div className="min-w-0 col-span-2">
                            <dt className="text-[12px] text-hanji-400">{copy.offering.ifMissed}</dt>
                            <dd className="m-0 mt-1 text-[14px]">{o.refundMode === 0 ? copy.terms.refundAll : copy.terms.refundPartial}</dd>
                        </div>
                    </dl>
                    {/* the card is the link: a button-looking span, not a button inside a link */}
                    <span className={`${PRIMARY_CLS} w-full inline-flex items-center justify-center min-h-[48px]`}>{copy.offering.commitCta}</span>
                </div>
            </div>
        </Link>
    );
}

/** W-T63: the action of a closed row, to where the former card went. */
function rowAction(o: OfferingInfo, copy: ReturnType<typeof useCopy>): {to: string; text: string} {
    if (o.settled) return {to: `/trade?o=${o.address}`, text: copy.home.actTrade};
    if (isRefundState(o)) return {to: `/offering/${o.address}`, text: copy.home.actRefund};
    return {to: `/offering/${o.address}`, text: copy.home.actView};
}

/** Under the name: burned so far (settled) or the participants at close (refunds), as the cards showed. */
function rowNote(o: OfferingInfo, participants: number | undefined, copy: ReturnType<typeof useCopy>): string | null {
    if (o.settled) return copy.home.burned(fmt(computeBurned(o)));
    if (participants === undefined) return null;
    return isRefundState(o) ? copy.home.participantsAtClose(participants) : copy.home.participants(participants);
}

/** Price now vs the offering price ("+20.0%"), only for a settled offering with a pool price. */
function SpotCell({o}: {o: OfferingInfo}) {
    const copy = useCopy();
    if (!o.settled || o.spotPrice === 0n || o.price === 0n) return <span className="text-hanji-400">—</span>;
    const {text, tone} = changeLabel(((o.spotPrice - o.price) * 10_000n) / o.price, copy.locale);
    return (
        <span className="whitespace-nowrap">
            <span className="num">{fmt(o.spotPrice, 0)}</span>{" "}
            <span className={`num text-[12.5px] ${tone === "up" ? "text-success" : tone === "down" ? "text-error" : "text-hanji-400"}`}>{text}</span>
        </span>
    );
}

const COLS = "lg:grid lg:grid-cols-[minmax(0,2.4fr)_minmax(0,1.3fr)_minmax(max-content,1fr)_minmax(max-content,1.2fr)_minmax(max-content,1.2fr)_88px] lg:gap-4 lg:items-center";

/** W-T63: settled, refunding and ended offerings: a table from lg, two-line rows below. */
function ClosedTable({rows, participantsOf, now}: {rows: OfferingInfo[]; participantsOf: (a: `0x${string}`) => number | undefined; now: number}) {
    const copy = useCopy();
    const h = copy.home;
    return (
        <div className="min-w-0">
            <div className={`hidden ${COLS} px-1 pb-2 border-b border-ink-700 text-[12px] text-hanji-400`}>
                <span>{h.colOffering}</span>
                <span>{h.colStatus}</span>
                <span className="text-right">{h.offerPrice}</span>
                <span className="text-right">{h.spotPrice}</span>
                <span className="text-right">{h.colRaised}</span>
                <span />
            </div>
            <ul className="m-0 p-0 list-none divide-y divide-ink-800 border-b border-ink-800 lg:border-b-0">
                {rows.map((o) => {
                    const c = labelOf(o);
                    const act = rowAction(o, copy);
                    const note = rowNote(o, participantsOf(o.address), copy);
                    return (
                        <li key={o.address} className="py-3 px-1 min-w-0">
                            <div className={`${COLS} flex flex-col gap-2 min-w-0`}>
                                <div className="flex items-center gap-3 min-w-0">
                                    <Medallion char={initialOf(o)} size={40} />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-baseline gap-2 min-w-0">
                                            <span className="text-[15px] font-semibold truncate">{c ? c.name : "…"}</span>
                                            {c && <span className="text-[12px] text-hanji-400 flex-none">{c.symbol}</span>}
                                        </div>
                                        {note && <NumText text={note} className="block text-[12px] text-hanji-400 truncate" />}
                                    </div>
                                    {/* below lg the action sits on the first line */}
                                    <Link to={act.to} className="lg:hidden flex-none inline-flex items-center min-h-[44px] text-[13px]">
                                        {act.text}
                                    </Link>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 lg:block">
                                    <StatusBadges o={o} now={now} />
                                </div>
                                {/* below lg: price, price now and committed on one wrapping line */}
                                <div className="lg:contents flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                                    <span className="lg:text-right whitespace-nowrap">
                                        <span className="lg:hidden text-[12px] text-hanji-400">{h.offerPrice} </span>
                                        <span className="num">{fmt(o.price, 0)}</span>
                                    </span>
                                    <span className="lg:text-right">
                                        <span className="lg:hidden text-[12px] text-hanji-400">{h.spotPrice} </span>
                                        <SpotCell o={o} />
                                    </span>
                                    <span className="lg:text-right whitespace-nowrap">
                                        <span className="lg:hidden text-[12px] text-hanji-400">{h.colRaised} </span>
                                        <span className="num">{fmt(o.totalCommitted, 0)}</span> <span className="text-[12px] text-hanji-400">KRWs</span>
                                    </span>
                                </div>
                                <Link to={act.to} className="hidden lg:inline-flex justify-end items-center min-h-[44px] text-[13px] whitespace-nowrap">
                                    {act.text}
                                </Link>
                            </div>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

/** 누적 소각 = 정산 시 초기 발행량 − 현재 totalSupply.
 *  초기 발행량 = 판매분 총공급(totalSold / f) + 정산 시 소각된 미판매분(qSale − totalSold, 모드 B). */
export function computeBurned(o: OfferingInfo): bigint {
    if (!o.settled || o.fBps === 0) return 0n;
    const initial = (o.totalSold * 10_000n) / BigInt(o.fBps) + (o.qSale - o.totalSold);
    return initial > o.totalSupply ? initial - o.totalSupply : 0n;
}

/** W-T75: "how an offering works", four numbered steps and the shortfall rule, above the list
 *  (also with no offering). Hidden on request; that choice is remembered (guideCollapse.ts). */
function GuideBand() {
    const copy = useCopy();
    const [collapsed, setCollapsed] = useState(() => readGuideCollapsed());
    const toggle = () => {
        const next = !collapsed;
        setCollapsed(next);
        writeGuideCollapsed(next);
    };
    return (
        <section aria-labelledby="offering-guide-title" className="mb-10 sm:mb-12 bg-ink-800 border border-ink-700 rounded-card p-4 sm:p-6 min-w-0">
            <div className="flex items-center justify-between gap-3">
                <h2 id="offering-guide-title" className="m-0 text-[15px] font-semibold">{copy.home.guideTitle}</h2>
                <button type="button" onClick={toggle} aria-expanded={!collapsed} aria-controls="offering-guide-body" className="flex-none min-h-[44px] px-2 -mr-2 text-[13px] text-hanji-400 hover:text-brass-400">
                    {collapsed ? copy.home.guideShow : copy.home.guideHide}
                </button>
            </div>
            {!collapsed && (
                <div id="offering-guide-body">
                    <ol className="m-0 mt-3 p-0 list-none grid gap-4 sm:gap-5 lg:grid-cols-4">
                        {copy.home.guideSteps.map((step, i) => (
                            <li key={step.title} className="min-w-0 border-t border-ink-700 pt-3">
                                <div className="flex items-baseline gap-2">
                                    <span className="num text-[13px] text-brass-400">{String(i + 1).padStart(2, "0")}</span>
                                    <span className="text-[14px] font-semibold text-hanji-100">{step.title}</span>
                                </div>
                                <p className="m-0 mt-1.5 text-[13px] leading-relaxed text-hanji-400">{step.body}</p>
                            </li>
                        ))}
                    </ol>
                    <p className="m-0 mt-4 text-[12px] leading-relaxed text-hanji-400">{copy.home.guideNote}</p>
                </div>
            )}
        </section>
    );
}

export default function Home() {
    const copy = useCopy();
    useTitle(DEFAULT_TITLE);
    const {offerings, empty, isLoading, isError, refetch} = useOfferings();
    const participants = useParticipantCounts(offerings);
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
    const now = useNow();
    const {open, closed} = offeringSections(offerings, now);
    const at = copy.heroTitle.indexOf(copy.heroAccent);
    return (
        <div className="max-w-page mx-auto px-4 sm:px-8 pt-10 sm:pt-16 pb-16 sm:pb-20">
            {/* W-T63: eyebrow, serif title with its accent, the points, the open-an-offering button */}
            <div className="mb-10 sm:mb-14">
                <Eyebrow locale={copy.locale}>{copy.home.eyebrow}</Eyebrow>
                <h1 className="m-0 mt-3 font-serif text-[30px] sm:text-[46px] font-bold leading-[1.18]">
                    {at < 0 ? (
                        copy.heroTitle
                    ) : (
                        <>
                            {copy.heroTitle.slice(0, at)}
                            <span className="text-brass-400">{copy.heroAccent}</span>
                            {copy.heroTitle.slice(at + copy.heroAccent.length)}
                        </>
                    )}
                </h1>
                <ul className="m-0 mt-5 p-0 list-none flex flex-wrap gap-x-6 gap-y-2">
                    {copy.heroSub.map((point) => (
                        <li key={point} className="flex items-center gap-3 text-[14.5px] text-hanji-100">
                            <span aria-hidden="true" className="flex-none w-[14px] h-px bg-brass-400" />
                            {point}
                        </li>
                    ))}
                </ul>
                <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3">
                    <Link to="/offerings/new" className={`${PRIMARY_CLS} hover:text-ink-950 inline-flex items-center justify-center min-h-[48px] px-6 text-[15px]`}>
                        {copy.offeringCreate.openCta}
                    </Link>
                    <a href={ALLOC_README} target="_blank" rel="noreferrer" className="inline-flex items-center min-h-[44px] text-[14px]">
                        {copy.home.howToCheck}
                    </a>
                </div>
            </div>
            <GuideBand />
            <div className="flex items-baseline gap-3 mb-5 flex-wrap justify-end">
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
            ) : isLoading && offerings.length === 0 ? (
                <div className="grid gap-4 sm:gap-5" style={{gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))"}}>
                    {[1, 2, 3].map((i) => (
                        <CardSkeleton key={i} />
                    ))}
                </div>
            ) : (
                <div className="flex flex-col gap-12 min-w-0">
                    {open.length > 0 && (
                        <section aria-label={copy.home.openNow} className="min-w-0">
                            <h2 className="m-0 mb-4">
                                <Eyebrow locale={copy.locale}>{copy.home.openNow}</Eyebrow>
                            </h2>
                            <div className="flex flex-col gap-5">
                                {open.map((o) => (
                                    <OpenCard key={o.address} o={o} participants={participants.countOf(o.address)} lockDuration={durationOf(o)} now={now} />
                                ))}
                            </div>
                        </section>
                    )}
                    {closed.length > 0 && (
                        <section aria-label={copy.home.closedSection} className="min-w-0">
                            <h2 className="m-0 mb-4">
                                <Eyebrow locale={copy.locale}>{copy.home.closedSection}</Eyebrow>
                            </h2>
                            <ClosedTable rows={closed} participantsOf={(a) => participants.countOf(a)} now={now} />
                        </section>
                    )}
                </div>
            )}
        </div>
    );
}
