// "Trust signals" card on the token page (decision 51). Facts only, from /api/chain/holders
// `signals`: one text colour for every value, no score, grade, traffic light or verdict.
// Layout note (390px): label left, value right, both min-w-0 with wrapping, so nothing widens the page.
// design-token-page: a row list (1px ink-800 between rows) on ink-900, values in .num, the title in
// the W-T55 label style, and the three fixed facts (curve.fixedItems) as a checked list at the bottom.
import {ReactNode} from "react";
import {useCopy} from "../copy";
import {useHolders} from "../hooks/chainData";
import {agoLabel, useNow} from "./feed";
import {Eyebrow, Icon, Skeleton} from "./ui";
import {pctText, trustView} from "../lib/trustSignals";

function Row({label, note, children}: {label: string; note?: string; children: ReactNode}) {
    return (
        <div className="flex items-start justify-between gap-3 py-2.5 min-w-0">
            <div className="min-w-0">
                <div className="text-[13.5px] text-hanji-100">{label}</div>
                {note && <div className="text-[11.5px] text-hanji-400 mt-0.5">{note}</div>}
            </div>
            <div className="num text-[14px] text-hanji-100 text-right min-w-0 break-words">{children}</div>
        </div>
    );
}

export function TrustSignals({curve}: {curve: string}) {
    const tr = useCopy();
    const t = tr.tokenPage.trust;
    const q = useHolders(curve);
    const now = useNow();
    if (q.isLoading) return <Skeleton h={260} />;
    const s = q.isSuccess ? q.data.signals : undefined;
    const v = s ? trustView(s) : null;
    const dash = "–";
    const orDash = (bps: bigint | null) => (bps === null ? dash : pctText(bps));
    return (
        <section className="bg-ink-900 border border-ink-700 rounded-card p-4 sm:p-5 min-w-0">
            <div className="flex items-baseline justify-between gap-3 mb-1 flex-wrap">
                <h3 className="m-0">
                    <Eyebrow locale={tr.locale}>{t.title}</Eyebrow>
                </h3>
                <span className="text-[12px] text-hanji-400">{t.supplyNote}</span>
            </div>
            <div className="divide-y divide-ink-800">
                <Row label={t.devFirstBuy}>{v ? (v.devFirstBuyBps === null ? t.none : pctText(v.devFirstBuyBps)) : dash}</Row>
                <Row label={t.devHolds}>{v ? pctText(v.devHoldsBps) : dash}</Row>
                <Row label={t.devSells}>
                    {!v ? (
                        dash
                    ) : v.devSells === null ? (
                        t.none
                    ) : (
                        <>
                            <div>{t.devSellsValue(v.devSells.count, v.devSells.soldOfBoughtBps === null ? null : pctText(v.devSells.soldOfBoughtBps))}</div>
                            {v.devSells.lastTs !== null && <div className="text-[12px] text-hanji-400">{agoLabel(tr, now, v.devSells.lastTs)}</div>}
                        </>
                    )}
                </Row>
                {v && v.devOutBps !== null && <Row label={t.devTransfersOut}>{pctText(v.devOutBps)}</Row>}
                <Row label={t.top10} note={t.top10Note}>
                    {v ? orDash(v.top10Bps) : dash}
                </Row>
                <Row label={t.verifiedHold} note={t.verifiedHoldNote}>
                    {v ? (
                        <>
                            <div>{orDash(v.verifiedBps)}</div>
                            <div className="text-[12px] text-hanji-400">{t.verifiedHoldValue(v.verifiedHolders, v.holdersCount)}</div>
                        </>
                    ) : (
                        dash
                    )}
                </Row>
            </div>
            {!v && <p className="m-0 mt-2 text-[12px] text-hanji-400">{tr.chain.unavailable}</p>}
            <ul className="m-0 mt-3 pt-3 p-0 list-none border-t border-ink-700 flex flex-col gap-1.5">
                {tr.curve.fixedItems.map((item) => (
                    <li key={item} className="flex items-center gap-2 text-[13px] text-hanji-100">
                        <Icon name="check" className="w-4 h-4 text-brass-400" />
                        {item}
                    </li>
                ))}
            </ul>
        </section>
    );
}
