// Disclosure document editor (decision 58, W-T34). Checks run on every change with the same rules
// the server uses (api/_lib/disclosure); a field's problem shows once it was edited or after a
// save attempt (`showAll`).
import {useState} from "react";
import {copy} from "../copy";
import {DisclosureDoc, docProblems, DocProblem, LIMITS, LINK_KEYS, normalizeDoc} from "../../api/_lib/disclosure";

const inputCls = "w-full box-border bg-ink-900 border border-ink-700 rounded-input px-3.5 py-3 text-[15px] text-hanji-100 outline-none focus:border-brass-400";

export function problemText(p: DocProblem): string {
    const t = copy.disclosure.problems;
    return p.error === "forbidden_phrase" ? t.forbidden_phrase(p.phrase ?? "") : t[p.error];
}

export function DisclosureForm({value, onChange, showAll}: {value: DisclosureDoc; onChange: (d: DisclosureDoc) => void; showAll: boolean}) {
    const [touched, setTouched] = useState<Set<string>>(new Set());
    const problems = docProblems(normalizeDoc(value));
    const touch = (f: string) => setTouched((s) => (s.has(f) ? s : new Set(s).add(f)));
    const problemOf = (field: string) => {
        const p = problems.find((x) => x.field === field);
        return p && (showAll || touched.has(field)) ? problemText(p) : null;
    };
    const set = (patch: Partial<DisclosureDoc>, field: string) => {
        touch(field);
        onChange({...value, ...patch});
    };
    const t = copy.disclosure;
    const pctSum = value.useOfFunds.items.reduce((a, i) => a + (Number.isFinite(i.pct) ? i.pct : 0), 0);
    const phrase = problems.find((p) => p.error === "forbidden_phrase");

    return (
        <div className="space-y-5">
            <Field label={t.summary} max={LIMITS.summary} len={value.summary} error={problemOf("summary")}>
                <input className={inputCls} value={value.summary} onChange={(e) => set({summary: e.target.value}, "summary")} />
            </Field>
            <Field label={t.about} max={LIMITS.about} len={value.about} error={problemOf("about")}>
                <textarea rows={6} className={`${inputCls} resize-y`} value={value.about} onChange={(e) => set({about: e.target.value}, "about")} />
            </Field>
            <Field label={t.utility} max={LIMITS.utility} len={value.utility} error={problemOf("utility")}>
                <textarea rows={3} className={`${inputCls} resize-y`} value={value.utility} onChange={(e) => set({utility: e.target.value}, "utility")} />
            </Field>

            <div>
                <div className="flex justify-between text-[13px] mb-2">
                    <span className="text-hanji-400">{t.useOfFunds}</span>
                    <span className={pctSum === 100 ? "text-hanji-400" : "text-brass-400"}>{t.pctSum(pctSum)}</span>
                </div>
                {value.useOfFunds.items.map((it, i) => (
                    <div key={i} className="mb-2">
                        <div className="flex gap-2 items-center">
                            <input className={`${inputCls} flex-1 min-w-0`} placeholder={t.itemLabel} value={it.label}
                                onChange={(e) => {
                                    const items = value.useOfFunds.items.map((x, k) => (k === i ? {...x, label: e.target.value} : x));
                                    set({useOfFunds: {...value.useOfFunds, items}}, `useOfFunds.items.${i}.label`);
                                }} />
                            <input className={`${inputCls} w-[84px] flex-none tabular-nums`} inputMode="numeric" placeholder={t.itemPct} value={Number.isFinite(it.pct) ? String(it.pct) : ""}
                                onChange={(e) => {
                                    const v = e.target.value.replace(/[^\d]/g, "");
                                    const items = value.useOfFunds.items.map((x, k) => (k === i ? {...x, pct: v === "" ? NaN : Number(v)} : x));
                                    set({useOfFunds: {...value.useOfFunds, items}}, `useOfFunds.items.${i}.pct`);
                                }} />
                            {value.useOfFunds.items.length > 1 && (
                                <button type="button" className="text-[12px] text-hanji-400 hover:text-hanji-100 min-h-[44px] px-2 flex-none"
                                    onClick={() => set({useOfFunds: {...value.useOfFunds, items: value.useOfFunds.items.filter((_, k) => k !== i)}}, "useOfFunds.items")}>
                                    {t.removeItem}
                                </button>
                            )}
                        </div>
                        <Err text={problemOf(`useOfFunds.items.${i}.label`) ?? problemOf(`useOfFunds.items.${i}.pct`)} />
                    </div>
                ))}
                {value.useOfFunds.items.length < LIMITS.useOfFundsItems && (
                    <button type="button" className="text-[13px] text-brass-400 min-h-[44px]"
                        onClick={() => set({useOfFunds: {...value.useOfFunds, items: [...value.useOfFunds.items, {label: "", pct: NaN}]}}, "useOfFunds.items")}>
                        + {t.addItem}
                    </button>
                )}
                <Err text={problemOf("useOfFunds.items")} />
            </div>
            <Field label={t.useOfFundsNote} max={LIMITS.useOfFundsNote} len={value.useOfFunds.note} error={problemOf("useOfFunds.note")}>
                <textarea rows={3} className={`${inputCls} resize-y`} value={value.useOfFunds.note} onChange={(e) => set({useOfFunds: {...value.useOfFunds, note: e.target.value}}, "useOfFunds.note")} />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
                <Field label={`${t.issuer} · ${t.issuerName}`} max={LIMITS.issuerName} len={value.issuer.name} error={problemOf("issuer.name")}>
                    <input className={inputCls} value={value.issuer.name} onChange={(e) => set({issuer: {...value.issuer, name: e.target.value}}, "issuer.name")} />
                </Field>
                <Field label={`${t.issuer} · ${t.jurisdiction}`} max={LIMITS.jurisdiction} len={value.issuer.jurisdiction} error={problemOf("issuer.jurisdiction")}>
                    <input className={inputCls} value={value.issuer.jurisdiction} onChange={(e) => set({issuer: {...value.issuer, jurisdiction: e.target.value}}, "issuer.jurisdiction")} />
                </Field>
            </div>

            <div>
                <label className="flex items-center gap-2.5 text-[14px] text-hanji-100 min-h-[44px]">
                    <input type="checkbox" checked={value.priorSales.exists} onChange={(e) => set({priorSales: {...value.priorSales, exists: e.target.checked}}, "priorSales.terms")} />
                    {t.priorSalesExists}
                </label>
                {value.priorSales.exists && (
                    <Field label={t.priorSalesTerms} max={LIMITS.priorSalesTerms} len={value.priorSales.terms} error={problemOf("priorSales.terms")}>
                        <textarea rows={3} className={`${inputCls} resize-y`} value={value.priorSales.terms} onChange={(e) => set({priorSales: {...value.priorSales, terms: e.target.value}}, "priorSales.terms")} />
                    </Field>
                )}
            </div>

            <Field label={t.issuerWallets} error={problems.find((p) => p.field.startsWith("issuerWallets")) && (showAll || touched.has("issuerWallets")) ? copy.disclosure.problems.bad_value : null}>
                <textarea rows={2} className={`${inputCls} resize-y tabular-nums`} placeholder={t.walletsPlaceholder} value={value.issuerWallets.join("\n")}
                    onChange={(e) => set({issuerWallets: e.target.value.split("\n")}, "issuerWallets")} />
            </Field>

            <Field label={t.risks} max={LIMITS.risks} len={value.risks} error={problemOf("risks")}>
                <textarea rows={4} className={`${inputCls} resize-y`} value={value.risks} onChange={(e) => set({risks: e.target.value}, "risks")} />
            </Field>

            <div>
                <div className="text-[13px] text-hanji-400 mb-2">{t.links}</div>
                <div className="grid gap-2 sm:grid-cols-2">
                    {LINK_KEYS.map((k) => (
                        <div key={k}>
                            <input className={inputCls} placeholder={`${t.linkLabels[k]} (https://…)`} value={value.links[k]}
                                onChange={(e) => set({links: {...value.links, [k]: e.target.value}}, `links.${k}`)} />
                            <Err text={problemOf(`links.${k}`)} />
                        </div>
                    ))}
                </div>
            </div>
            {phrase && <p className="m-0 text-[13px] text-brass-400">{problemText(phrase)}</p>}
        </div>
    );
}

function Err({text}: {text: string | null | undefined}) {
    return text ? <p className="m-0 mt-1.5 text-[12px] text-brass-400">{text}</p> : null;
}

function Field({label, children, error, max, len}: {label: string; children: React.ReactNode; error?: string | null; max?: number; len?: string}) {
    return (
        <div>
            <div className="flex justify-between text-[13px] mb-2">
                <span className="text-hanji-400">{label}</span>
                {max !== undefined && len !== undefined && <span className="text-hanji-400 tabular-nums">{[...len].length} / {max}</span>}
            </div>
            {children}
            <Err text={error} />
        </div>
    );
}
