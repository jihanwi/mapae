// "발행자가 작성한 내용" (decision 58, W-T34): the issuer's document as plain text (never parsed as
// HTML), its hash, version, last edit time, lock state and the additional disclosures in date order.
// The issuer wallet edits before the first commitment and appends after it; an offering without a
// document lets its issuer save a first one even after commitments (marked "응모가 시작된 뒤 작성됨").
// Commitments are never blocked by a missing disclosure.
import {useState} from "react";
import {useAccount} from "wagmi";
import {copy} from "../copy";
import {OfferingInfo} from "../hooks";
import {clearDraft, loadDraft, saveDraft, SaveResult, useDisclosure, useSaveDisclosure} from "../hooks/disclosure";
import {addendumProblems, cleanText, DisclosureDoc, docProblems, EMPTY_DOC, LIMITS, LINK_KEYS, normalizeDoc} from "../../api/_lib/disclosure";
import {DisclosureForm, problemText} from "./DisclosureForm";
import {PrimaryBtn, SecondaryBtn, TextSkeleton} from "./ui";

const when = (iso: string) => new Date(iso).toLocaleString("ko-KR", {year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit"});
const t = copy.disclosure;

function Block({title, children}: {title: string; children: React.ReactNode}) {
    return (
        <div className="mb-4">
            <div className="text-[12px] text-hanji-400 mb-1">{title}</div>
            <div className="text-[14px] text-hanji-100 leading-relaxed whitespace-pre-wrap break-words">{children}</div>
        </div>
    );
}

function HashChip({hash}: {hash: string}) {
    const [done, setDone] = useState(false);
    const copyHash = async () => {
        try {
            await navigator.clipboard.writeText(hash);
            setDone(true);
            setTimeout(() => setDone(false), 1500);
        } catch (e) {
            console.warn("clipboard write failed", e);
        }
    };
    return (
        <span className="inline-flex items-center gap-2">
            <span className="tabular-nums">{t.hash} {hash.slice(0, 10)}</span>
            <button type="button" onClick={() => void copyHash()} className="text-brass-400 min-h-[32px] px-1">{done ? t.copied : t.copy}</button>
        </span>
    );
}

export function DocView({doc}: {doc: DisclosureDoc}) {
    const links = LINK_KEYS.filter((k) => doc.links[k].startsWith("https://"));
    return (
        <div>
            <p className="m-0 mb-4 text-[16px] font-semibold text-hanji-100 break-words">{doc.summary}</p>
            <Block title={t.about}>{doc.about}</Block>
            <Block title={t.utility}>{doc.utility}</Block>
            <Block title={t.useOfFunds}>
                {doc.useOfFunds.items.map((i) => `${i.label} ${i.pct}%`).join(" · ")}
                {doc.useOfFunds.note ? `\n${doc.useOfFunds.note}` : ""}
            </Block>
            <Block title={t.issuer}>{`${doc.issuer.name} · ${doc.issuer.jurisdiction}`}</Block>
            <Block title={t.priorSales}>{doc.priorSales.exists ? `${t.priorSalesExists}\n${doc.priorSales.terms}` : t.priorSalesNone}</Block>
            {doc.issuerWallets.length > 0 && <Block title={t.issuerWallets}>{doc.issuerWallets.join("\n")}</Block>}
            <Block title={t.risks}>{doc.risks}</Block>
            {links.length > 0 && (
                <div className="mb-2">
                    <div className="text-[12px] text-hanji-400 mb-1">{t.links}</div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[14px]">
                        {links.map((k) => (
                            <a key={k} href={doc.links[k]} target="_blank" rel="noopener noreferrer nofollow">{t.linkLabels[k]} ↗</a>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function errorText(r: Extract<SaveResult, {ok: false}>): string {
    const p = r.problems?.[0];
    if (p && (p.error === "forbidden_phrase" || p.error in t.problems)) return problemText(p as Parameters<typeof problemText>[0]);
    return t.errors[r.code] ?? t.errors.temporary;
}

export function DisclosureSection({o}: {o: OfferingInfo}) {
    const {address} = useAccount();
    const q = useDisclosure(o.address);
    const {save, busy} = useSaveDisclosure();
    const [mode, setMode] = useState<"view" | "edit" | "addendum">("view");
    const [draft, setDraft] = useState<DisclosureDoc>(EMPTY_DOC);
    const [text, setText] = useState("");
    const [showAll, setShowAll] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);

    const d = q.data;
    const isIssuer = !!address && address.toLowerCase() === o.creator.toLowerCase();
    // the server decides; this only picks which button to show (chain commitment or stored lock)
    const locked = (d?.locked ?? false) || o.totalCommitted > 0n;
    const hasDoc = !!d?.disclosure;

    const startEdit = () => {
        setDraft(loadDraft(o.address) ?? d?.disclosure?.doc ?? EMPTY_DOC);
        setShowAll(false);
        setMsg(null);
        setMode("edit");
    };
    const submitDoc = async () => {
        setShowAll(true);
        if (docProblems(normalizeDoc(draft)).length > 0) return;
        saveDraft(o.address, draft);
        const r = await save(o.address, "disclosure", draft);
        if (r.ok) {
            clearDraft(o.address);
            setMode("view");
            setMsg(t.saved);
        } else setMsg(errorText(r));
    };
    const addendumProblem = addendumProblems(cleanText(text, true))[0];
    const submitAddendum = async () => {
        setShowAll(true);
        if (addendumProblem) return;
        const r = await save(o.address, "addendum", text);
        if (r.ok) {
            setText("");
            setMode("view");
            setMsg(t.saved);
        } else setMsg(errorText(r));
    };

    return (
        <section className="mt-7 bg-ink-800 border border-ink-700 rounded-card p-4 sm:p-6">
            <h2 className="m-0 text-[17px] font-bold">{t.title}</h2>
            <p className="m-0 mt-1 mb-4 text-[12px] text-brass-400">{t.note}</p>

            {q.isLoading && <TextSkeleton w={240} h={14} />}
            {q.isError && (
                <div className="flex items-center gap-3 text-[13px] text-hanji-400">
                    {t.readError}
                    <button type="button" className="min-h-[44px] px-3 border border-ink-700 rounded-full text-hanji-100" onClick={() => void q.refetch()}>{copy.common.retry}</button>
                </div>
            )}

            {d && mode === "view" && (
                <>
                    {d.disclosure ? (
                        <>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-hanji-400 mb-4">
                                <HashChip hash={d.disclosure.sha256} />
                                <span>{t.version(d.disclosure.version)}</span>
                                <span>{t.edits(d.disclosure.edits, when(d.disclosure.savedAt))}</span>
                                <span>{locked ? t.locked : t.unlocked}</span>
                                {d.disclosure.postCommit && <span className="text-brass-400">{t.postCommit}</span>}
                            </div>
                            <DocView doc={d.disclosure.doc} />
                        </>
                    ) : (
                        <div className="rounded-input px-4 py-3.5 text-[14px] font-semibold text-brass-400 border border-brass-600 bg-ink-900">{t.none}</div>
                    )}
                    {d.addenda.length > 0 && (
                        <div className="mt-5 pt-4 border-t border-ink-700">
                            <div className="text-[13px] font-semibold mb-3">{t.addenda}</div>
                            {d.addenda.map((a) => (
                                <div key={a.n} className="bg-ink-900 rounded-stat px-4 py-3 mb-2">
                                    <div className="text-[12px] text-hanji-400 mb-1">{t.addendumAt(when(a.savedAt))}</div>
                                    <div className="text-[14px] text-hanji-100 whitespace-pre-wrap break-words">{a.text}</div>
                                </div>
                            ))}
                        </div>
                    )}
                    {isIssuer && !d.hidden && (
                        <div className="mt-5 flex gap-3 flex-wrap">
                            {!hasDoc && <PrimaryBtn onClick={startEdit}>{t.writeCta}</PrimaryBtn>}
                            {hasDoc && !locked && <SecondaryBtn onClick={startEdit}>{t.editCta}</SecondaryBtn>}
                            {hasDoc && locked && d.addenda.length < LIMITS.addenda && (
                                <SecondaryBtn onClick={() => { setMode("addendum"); setShowAll(false); setMsg(null); }}>{t.addCta}</SecondaryBtn>
                            )}
                        </div>
                    )}
                </>
            )}

            {mode === "edit" && (
                <div>
                    <DisclosureForm value={draft} onChange={(x) => { setDraft(x); saveDraft(o.address, x); }} showAll={showAll} />
                    <p className="m-0 mt-3 text-[12px] text-hanji-400">{t.draftKept}</p>
                    <div className="mt-4 flex gap-3 flex-wrap">
                        <PrimaryBtn disabled={busy} onClick={() => void submitDoc()}>{t.saveCta}</PrimaryBtn>
                        <SecondaryBtn disabled={busy} onClick={() => setMode("view")}>{t.cancel}</SecondaryBtn>
                    </div>
                </div>
            )}

            {mode === "addendum" && (
                <div>
                    <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={t.addendumPlaceholder}
                        className="w-full box-border bg-ink-900 border border-ink-700 rounded-input px-3.5 py-3 text-[15px] text-hanji-100 outline-none focus:border-brass-400 resize-y" />
                    <div className="text-[12px] text-hanji-400 text-right tabular-nums">{[...text].length} / {LIMITS.addendum}</div>
                    {showAll && addendumProblem && <p className="m-0 text-[12px] text-brass-400">{problemText(addendumProblem)}</p>}
                    <div className="mt-3 flex gap-3 flex-wrap">
                        <PrimaryBtn disabled={busy} onClick={() => void submitAddendum()}>{t.saveCta}</PrimaryBtn>
                        <SecondaryBtn disabled={busy} onClick={() => setMode("view")}>{t.cancel}</SecondaryBtn>
                    </div>
                </div>
            )}
            {msg && <p className="m-0 mt-3 text-[13px] text-brass-400">{msg}</p>}
        </section>
    );
}
