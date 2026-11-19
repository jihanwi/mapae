// design-home: up to three fixed-price offerings between the home top and the token list. Data is
// the offering section's own chain read (useOfferings: allOfferings of every L1 factory, then one
// multicall for all offerings, token reads and pool prices, no read per offering in sequence) plus
// the offering index for the settle order. Nothing is drawn while loading, with no pick, or when the
// chain read fails (logged).
import {useEffect} from "react";
import {Link} from "react-router-dom";
import {useCopy} from "../copy";
import {labelOf, OfferingInfo, useOfferings, useOfferingsApi} from "../hooks";
import {useCurveMeta} from "../hooks/meta";
import {fmt} from "../lib/format";
import {hms, pickStrip, StripPick} from "../lib/offeringStrip";
import {Badge, Eyebrow, Gauge} from "./ui";
import {CurveAvatar} from "./MetaForm";
import {useNow} from "./feed";

const FROZEN_SECS = 2 * 3600; // same "cancel locked" window as the offering list card

function StripCard({pick, now, imageUrl}: {pick: StripPick<OfferingInfo>; now: number; imageUrl?: string | null}) {
    const tr = useCopy();
    const s = tr.homeRows.strip;
    const {o, kind} = pick;
    const c = labelOf(o);
    const left = Number(o.deadline) - now;
    const pct = o.raiseTarget > 0n ? Number((o.totalCommitted * 1000n) / o.raiseTarget) / 10 : 0;
    const href = kind === "committing" ? `/offering/${o.address}` : `/trade?o=${o.address}`;
    return (
        <Link
            to={href}
            className="block min-w-0 no-underline text-hanji-100 hover:text-hanji-100 bg-ink-800 border border-ink-700 rounded-card p-4 sm:p-5 hover:border-brass-600 transition-colors duration-300"
        >
            <div className="flex items-center gap-3 min-w-0">
                <CurveAvatar char={c ? [...c.name][0] : "馬"} imageUrl={imageUrl} size={36} />
                <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-semibold truncate">{c?.name ?? "…"}</div>
                    <div className="text-[12px] text-hanji-400 truncate">{c?.symbol ?? ""}</div>
                </div>
                <span className="flex-none">
                    {kind === "trading" ? (
                        <Badge kind="neutral">{tr.badge.settled}</Badge>
                    ) : left < FROZEN_SECS ? (
                        <Badge kind="frozen">{tr.badge.frozen}</Badge>
                    ) : (
                        <Badge kind="open">{tr.badge.open}</Badge>
                    )}
                </span>
            </div>
            {kind === "committing" ? (
                <>
                    <div className="mt-4">
                        <Gauge committed={o.totalCommitted} target={o.raiseTarget} height={5} />
                    </div>
                    <div className="mt-2 flex justify-between gap-3 flex-wrap text-[12px] text-hanji-400">
                        <span>
                            {s.committed} <span className="num text-hanji-100">{pct.toFixed(0)}%</span>
                        </span>
                        <span>
                            {s.closesIn} <span className="num text-hanji-100">{hms(left)}</span>
                        </span>
                    </div>
                </>
            ) : (
                <div className="mt-4 flex justify-between gap-3 flex-wrap text-[12px] text-hanji-400">
                    <span>
                        {s.offerPrice} <span className="num text-hanji-100">{fmt(o.price, 0, tr.locale)}</span> KRWs
                    </span>
                    {o.spotPrice > 0n && (
                        <span>
                            {s.priceNow} <span className="num text-hanji-100">{fmt(o.spotPrice, 0, tr.locale)}</span> KRWs
                        </span>
                    )}
                </div>
            )}
        </Link>
    );
}

export function OfferingStrip({className = ""}: {className?: string}) {
    const tr = useCopy();
    const s = tr.homeRows.strip;
    const {offerings, isLoading, isError} = useOfferings();
    const index = useOfferingsApi(); // settle order only; without it the later deadline goes first
    const meta = useCurveMeta();
    const now = useNow(1000);
    useEffect(() => {
        if (isError) console.error("home offering strip: offering read failed; strip hidden");
    }, [isError]);
    if (isError || isLoading) return null;
    const settledBlock = new Map((index.data?.offerings ?? []).map((r) => [r.offering.toLowerCase(), r.settledBlock]));
    const picks = pickStrip(offerings, now, (o) => {
        const b = settledBlock.get(o.address.toLowerCase());
        return b ? BigInt(b) : undefined;
    });
    if (picks.length === 0) return null;
    return (
        <section aria-label={s.label} className={`min-w-0 ${className}`}>
            <div className="flex items-end justify-between gap-x-4 gap-y-1 flex-wrap mb-4">
                <div className="min-w-0">
                    <Eyebrow locale={tr.locale}>{s.label}</Eyebrow>
                    <p className="m-0 mt-1 text-[13.5px] text-hanji-400">{s.sub}</p>
                </div>
                <Link to="/offerings" className="inline-flex items-center min-h-[44px] text-[13.5px] text-brass-400 hover:text-hanji-100">
                    {s.all}
                </Link>
            </div>
            <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))]">
                {picks.map((p) => (
                    <StripCard key={p.o.address} pick={p} now={now} imageUrl={meta.get(p.o.address)?.imageUrl} />
                ))}
            </div>
        </section>
    );
}
