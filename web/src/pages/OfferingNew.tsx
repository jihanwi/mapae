// /offerings/new (W-T34, decisions 2, 55, 56, 58): an issuer opens a v3.2-L1 offering in three
// steps (조건 -> 공시 -> 확인). Bands come from the chain (guide, proceedsBand, minRaise, FeeRouter
// L1 table) and from codegen (contract constants); the form never hard-codes a range. The send is
// simulated first (no wallet prompt on a revert), the deadline is recomputed from the chain time
// right before it, and the disclosure is signed and saved right after OfferingCreated.
import {useEffect, useMemo, useState} from "react";
import {Link, useNavigate} from "react-router-dom";
import {useAccount, usePublicClient, useReadContract, useReadContracts, useWriteContract} from "wagmi";
import {Abi, BaseError, ContractFunctionRevertedError, parseEventLogs} from "viem";
import {copy} from "../copy";
import {ADDR_L1} from "../contracts/addressesV3L1";
import {ADDR_V3} from "../contracts/addressesV3";
import {MapaeFactoryL1Abi, MapaeVestingL1Abi, OfferingL1Abi, ProceedsLockAbi} from "../contracts/abisV3L1";
import {CurveFactoryAbi, FeeRouterAbi, MembershipTokenV3Abi} from "../contracts/abisV3";
import {giwaSepolia} from "../config/chain";
import {useOnboarding} from "../hooks";
import {clearDraft, loadDraft, saveDraft, useSaveDisclosure} from "../hooks/disclosure";
import {DisclosureForm} from "../components/DisclosureForm";
import {DocView} from "../components/DisclosureSection";
import {allocationText} from "../components/ChainTerms";
import {allocationBps} from "../lib/offeringMath";
import {RunFn, TxButton} from "../components/tx";
import {PrimaryBtn, SecondaryBtn, Skeleton} from "../components/ui";
import {ChainBounds, checkCreate, createParams, CreateForm, DEFAULT_FORM, deadlineFor, derive, Values} from "../lib/createOffering";
import {DisclosureDoc, docProblems, EMPTY_DOC, normalizeDoc} from "../../api/_lib/disclosure";
import {fmt} from "../lib/format";
import {bpsPct, spanText} from "../lib/proceedsText";
import {displayTicker} from "../lib/ticker";
import {DEFAULT_TITLE, useTitle} from "../lib/title";

const t = copy.offeringCreate;
/** createOffering reverts can come from the contracts it deploys (Offering, MapaeVesting,
 *  ProceedsLock); their errors are added so the simulation decodes the name. */
const CREATE_ABI = [
    ...MapaeFactoryL1Abi,
    ...[...OfferingL1Abi, ...MapaeVestingL1Abi, ...ProceedsLockAbi].filter((x) => x.type === "error"),
] as Abi;
const DRAFT_ID = "new";
const inputCls = "w-full box-border bg-ink-900 border border-ink-700 rounded-input px-3.5 py-3 text-[15px] text-hanji-100 outline-none focus:border-brass-400";

/** Fields whose change can raise another field's cross error (cliff vs length). */
export const RELATED: Partial<Record<keyof CreateForm | "allocation", readonly (keyof CreateForm)[]>> = {
    lockCliffValue: ["lockValue", "lockUnit", "lockCliffUnit"],
    vestingCliffDays: ["vestingDays"],
    minCommit: ["walletLimit"],
    walletLimit: ["raiseTarget"],
};

/** Factory bands, the FeeRouter L1 table and the name limit, in one multicall. */
function useBounds(): {bounds: ChainBounds | null; failed: boolean} {
    const r = useReadContracts({
        contracts: [
            {address: ADDR_L1.mapaeFactory, abi: MapaeFactoryL1Abi as Abi, functionName: "guide", chainId: giwaSepolia.id},
            {address: ADDR_L1.mapaeFactory, abi: MapaeFactoryL1Abi as Abi, functionName: "proceedsBand", chainId: giwaSepolia.id},
            {address: ADDR_L1.mapaeFactory, abi: MapaeFactoryL1Abi as Abi, functionName: "minRaise", chainId: giwaSepolia.id},
            {address: ADDR_L1.feeRouter, abi: FeeRouterAbi as Abi, functionName: "getFees", args: [1], chainId: giwaSepolia.id},
            {address: ADDR_V3.curveFactory, abi: CurveFactoryAbi as Abi, functionName: "MAX_NAME_BYTES", chainId: giwaSepolia.id},
        ],
    });
    const failed = r.isError || (r.data?.some((x) => x.status !== "success") ?? false);
    if (!r.data || failed) return {bounds: null, failed};
    const [g, band, minRaise, fees, maxName] = r.data.map((x) => x.result) as [
        readonly [bigint, bigint, bigint, bigint, number, number],
        {maxUpfrontBps: number; minLockDuration: bigint; maxLockDuration: bigint; maxLockCliff: bigint},
        bigint,
        {offeringFeeBps: number; swapRoyaltyBps: number; swapBurnBps: number},
        bigint,
    ];
    return {
        failed: false,
        bounds: {
            guide: {minPrice: g[0], maxPrice: g[1], minRaise: g[2], maxRaise: g[3], minWalletLimitBps: Number(g[4]), maxWalletLimitBps: Number(g[5])},
            band: {maxUpfrontBps: Number(band.maxUpfrontBps), minLockDuration: band.minLockDuration, maxLockDuration: band.maxLockDuration, maxLockCliff: band.maxLockCliff},
            minRaise,
            swapRoyaltyBps: Number(fees.swapRoyaltyBps),
            swapBurnBps: Number(fees.swapBurnBps),
            offeringFeeBps: Number(fees.offeringFeeBps),
            maxNameBytes: Number(maxName),
        },
    };
}

/** The wallet's offerings that still count for the factory's live cap (MapaeFactory._enforceLiveCap:
 *  every L1/L2 offering except a failed one, i.e. refunding with zero supply). */
function useActiveOffering(account: `0x${string}` | undefined): {active: `0x${string}` | null | undefined} {
    const list = useReadContract({
        address: ADDR_L1.mapaeFactory, abi: MapaeFactoryL1Abi, functionName: "offeringsByCreator", args: [account!], chainId: giwaSepolia.id,
        query: {enabled: !!account},
    });
    const addrs = (list.data ?? []) as `0x${string}`[];
    const first = useReadContracts({
        contracts: addrs.flatMap((o) => [
            {address: o, abi: OfferingL1Abi as Abi, functionName: "phase", chainId: giwaSepolia.id},
            {address: o, abi: OfferingL1Abi as Abi, functionName: "token", chainId: giwaSepolia.id},
        ]),
        query: {enabled: addrs.length > 0},
    });
    const tokens = addrs.map((_, i) => first.data?.[i * 2 + 1]?.result as `0x${string}` | undefined);
    const second = useReadContracts({
        contracts: tokens.flatMap((tk) => [
            {address: tk, abi: MembershipTokenV3Abi as Abi, functionName: "totalSupply", chainId: giwaSepolia.id},
            {address: ADDR_L1.mapaeFactory, abi: MapaeFactoryL1Abi as Abi, functionName: "tokenTier", args: [tk], chainId: giwaSepolia.id},
        ]),
        query: {enabled: tokens.length > 0 && tokens.every(Boolean)},
    });
    if (!account || !list.data) return {active: undefined};
    if (addrs.length === 0) return {active: null};
    if (!first.data || !second.data) return {active: undefined};
    for (let i = addrs.length - 1; i >= 0; i--) {
        const phase = Number(first.data[i * 2]?.result);
        const supply = second.data[i * 2]?.result as bigint | undefined;
        const tier = Number(second.data[i * 2 + 1]?.result);
        const failed = phase === 4 && supply === 0n;
        if (!failed && tier !== 0) return {active: addrs[i]};
    }
    return {active: null};
}

/** Revert name of a simulate failure -> Korean text (ko.ts table). */
export function revertText(e: unknown): string {
    if (e instanceof BaseError) {
        const r = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
        const name = r?.data?.errorName;
        if (name && t.revert[name]) return t.revert[name];
    }
    return t.revert.unknown;
}

function Field({label, error, hint, children}: {label: string; error?: string; hint?: string; children: React.ReactNode}) {
    return (
        <div>
            <label className="block text-[13px] text-hanji-400 mb-2">{label}</label>
            {children}
            {hint && !error && <p className="m-0 mt-1.5 text-[12px] text-hanji-400">{hint}</p>}
            {error && <p className="m-0 mt-1.5 text-[12px] text-brass-400">{error}</p>}
        </div>
    );
}

function Section({title, children}: {title: string; children: React.ReactNode}) {
    return (
        <section className="bg-ink-800 border border-ink-700 rounded-card p-4 sm:p-6 mb-5">
            <h2 className="m-0 mb-4 text-[17px] font-bold">{title}</h2>
            <div className="grid gap-4 sm:grid-cols-2">{children}</div>
        </section>
    );
}

function Rows({rows}: {rows: [string, string][]}) {
    return (
        <div className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-[13px]">
            {rows.map(([k, v]) => (
                <div key={k} className="contents">
                    <span className="text-hanji-400">{k}</span>
                    <span className="text-hanji-100 text-right tabular-nums break-words">{v}</span>
                </div>
            ))}
        </div>
    );
}

/** "소각 몫은 정산 때 바로 소각돼요" when the allocation leaves a burned share. */
function BurnNote({v}: {v: Values}) {
    return allocationBps(v).burn > 0 ? <p className="m-0 mt-3 text-[12px] text-hanji-400">{copy.terms.allocationNote}</p> : null;
}

const at = (ms: number) => new Date(ms).toLocaleString("ko-KR", {month: "long", day: "numeric", hour: "2-digit", minute: "2-digit"});

/** Terms table shared by the derived box (step 1) and the confirm step (step 3). */
function termRows(v: Values, b: ChainBounds): [string, string][] {
    const d = derive(v, b);
    const T = copy.terms;
    const u = t.derived.unit;
    return [
        [T.price, `${fmt(v.price, 0)} KRWs`],
        [T.raiseTarget, `${fmt(v.raiseTarget, 0)} KRWs`],
        [T.saleQty, `${fmt(d.qSale, 2)}${u}`],
        [T.walletLimit, `${fmt(v.walletLimit, 0)} KRWs`],
        [T.minCommit, `${fmt(v.minCommit, 0)} KRWs`],
        [T.period, `${Number(v.durationSec / 3600n)}시간`],
        [t.derived.supply, `${fmt(d.alloc.supply, 2)}${u}`],
        [T.allocation, allocationText(v.fBps, v.creatorTokenBps, v.cBps)],
        [t.derived.issuerTokens, `${fmt(d.alloc.creator, 2)}${u}`],
        [t.derived.lpTokens, `${fmt(d.alloc.lp, 2)}${u}`],
        [t.derived.burned, `${fmt(d.alloc.remainder, 2)}${u}`],
        [T.vesting, T.vestingValue(spanText(v.vestingDuration), v.vestingCliff > 0n ? spanText(v.vestingCliff) : null)],
        [T.proceeds, copy.offering.proceedsTerms(bpsPct(v.proceedsUpfrontBps), spanText(v.proceedsLockDuration)) + (v.proceedsLockCliff > 0n ? ` · ${copy.offering.proceedsCliff(spanText(v.proceedsLockCliff))}` : "")],
        [T.refundMode, v.refundMode === 0 ? T.refundAll : T.refundPartial],
        [T.sponsorship, v.withSponsorship ? `${T.sponsorshipOn} · 소각 ${bpsPct(v.sponsorBurnBps)}%` : T.sponsorshipOff],
        [T.offeringFee, `${bpsPct(b.offeringFeeBps)}%`],
        [`${t.derived.ifFull} · ${t.derived.platform}`, `${fmt(d.proceeds.platform, 0)} KRWs`],
        [`${t.derived.ifFull} · ${t.derived.lpSeed}`, `${fmt(d.proceeds.krwSeed, 0)} KRWs`],
        [`${t.derived.ifFull} · ${t.derived.upfront}`, `${fmt(d.proceeds.upfront, 0)} KRWs`],
        [`${t.derived.ifFull} · ${t.derived.locked}`, `${fmt(d.proceeds.locked, 0)} KRWs`],
    ];
}

export default function OfferingNew() {
    useTitle(DEFAULT_TITLE);
    const navigate = useNavigate();
    const {address} = useAccount();
    const client = usePublicClient({chainId: giwaSepolia.id});
    const {writeContractAsync} = useWriteContract();
    const {verified} = useOnboarding();
    const {bounds, failed} = useBounds();
    const {active} = useActiveOffering(address);
    const {save} = useSaveDisclosure();
    const [step, setStep] = useState(0);
    const [form, setForm] = useState<CreateForm>(DEFAULT_FORM);
    const [touched, setTouched] = useState<Set<string>>(new Set());
    const [showAll, setShowAll] = useState(false);
    const [doc, setDoc] = useState<DisclosureDoc>(() => loadDraft(DRAFT_ID) ?? EMPTY_DOC);
    const [checks, setChecks] = useState([false, false, false]);
    const [status, setStatus] = useState<{kind: "error" | "info"; text: string; offering?: string} | null>(null);
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        const iv = setInterval(() => setNow(Date.now()), 30_000);
        return () => clearInterval(iv);
    }, []);

    const check = useMemo(() => (bounds ? checkCreate(form, bounds) : null), [form, bounds]);
    const docOk = docProblems(normalizeDoc(doc)).length === 0;
    const set = <K extends keyof CreateForm>(k: K, v: CreateForm[K]) => {
        setTouched((s) => new Set(s).add(k));
        setForm((f) => ({...f, [k]: v}));
    };
    // W-T36: a cross check shows as soon as either field of the pair was touched (the error sits
    // on the cliff field, which the issuer may never edit when only the length changes)
    const errOf = (k: keyof CreateForm | "allocation") =>
        check && (showAll || k === "allocation" || [k, ...(RELATED[k] ?? [])].some((f) => touched.has(f))) ? check.errors[k] : undefined;

    if (!bounds) {
        return (
            <div className="max-w-page mx-auto px-4 sm:px-8 pt-10">
                {failed ? <p className="text-[14px] text-brass-400">{t.boundsError}</p> : <><p className="text-[13px] text-hanji-400">{t.loading}</p><Skeleton h={300} /></>}
            </div>
        );
    }

    const gate = !address ? t.gate.connect : !verified ? t.gate.verify : active ? t.gate.active : null;
    const v = check?.values ?? null;

    const submit = async (run: RunFn) => {
        if (!v || !address || !client) return;
        setStatus({kind: "info", text: t.confirm.checking});
        // deadline from the chain's own time, right before sending
        let args: ReturnType<typeof createParams>;
        try {
            const latest = await client.getBlock();
            args = createParams(v, bounds, deadlineFor(latest.timestamp, v.durationSec));
            await client.simulateContract({address: ADDR_L1.mapaeFactory, abi: CREATE_ABI, functionName: "createOffering", args: [args], account: address});
        } catch (e) {
            console.warn("createOffering simulation reverted", e);
            setStatus({kind: "error", text: revertText(e)});
            return;
        }
        setStatus(null);
        let hash: `0x${string}` | undefined;
        const ok = await run(t.confirm.txLabel, async () => {
            hash = await writeContractAsync({address: ADDR_L1.mapaeFactory, abi: MapaeFactoryL1Abi, functionName: "createOffering", args: [args], chainId: giwaSepolia.id});
            return hash;
        });
        if (!ok || !hash) return;
        const receipt = await client.waitForTransactionReceipt({hash});
        const created = parseEventLogs({abi: MapaeFactoryL1Abi, logs: receipt.logs, eventName: "OfferingCreated"})[0];
        const offering = (created?.args as {offering?: `0x${string}`} | undefined)?.offering;
        if (!offering) {
            setStatus({kind: "error", text: t.revert.unknown});
            return;
        }
        // the draft moves to the offering so the detail page can retry the save
        saveDraft(offering, doc);
        clearDraft(DRAFT_ID);
        setStatus({kind: "info", text: t.confirm.savingDisclosure, offering});
        // the server's RPC may not see the new offering for a few seconds: resend the same signed
        // request twice, 2 s apart (one wallet signature)
        const r = await save(offering, "disclosure", doc, {resends: 2});
        if (r.ok) {
            clearDraft(offering);
            navigate(`/offering/${offering}`);
        } else {
            setStatus({kind: "error", text: t.confirm.disclosureFailed, offering});
        }
    };

    const stepNav = (
        <div className="flex gap-2 mb-6 text-[13px]">
            {t.steps.map((s, i) => (
                <span key={s} className={`px-3 py-1.5 rounded-full border ${i === step ? "border-brass-400 text-brass-400" : "border-ink-700 text-hanji-400"}`}>{i + 1}. {s}</span>
            ))}
        </div>
    );

    const krw = (k: keyof CreateForm, label: string, hint?: string) => (
        <Field label={label} error={errOf(k)} hint={hint}>
            <input className={`${inputCls} tabular-nums`} inputMode="numeric" value={form[k] as string} onChange={(e) => set(k, e.target.value.replace(/[^\d,]/g, "") as never)} />
        </Field>
    );
    const num = (k: keyof CreateForm, label: string, decimals = false) => (
        <Field label={label} error={errOf(k)}>
            <input className={`${inputCls} tabular-nums`} inputMode={decimals ? "decimal" : "numeric"} value={form[k] as string}
                onChange={(e) => set(k, e.target.value.replace(decimals ? /[^\d.]/g : /[^\d]/g, "") as never)} />
        </Field>
    );
    const unitPick = (k: "lockUnit" | "lockCliffUnit") => (
        <select className="bg-ink-900 border border-ink-700 rounded-input px-2 text-[14px] text-hanji-100 flex-none" value={form[k]} onChange={(e) => set(k, e.target.value as "day" | "hour")}>
            <option value="day">{t.unitDay}</option>
            <option value="hour">{t.unitHour}</option>
        </select>
    );

    return (
        <div className="max-w-page mx-auto px-4 sm:px-8 pt-8 sm:pt-10 pb-16 sm:pb-20">
            <Link to="/offerings" className="text-[14px]">← {copy.nav.offeringList}</Link>
            <h1 className="m-0 mt-4 mb-2 text-[24px] sm:text-[28px] font-bold">{t.title}</h1>
            <p className="m-0 mb-5 text-[13px] text-hanji-400">{t.tierNote}</p>
            {stepNav}
            {gate && (
                <div className="rounded-input px-4 py-3.5 mb-5 text-[14px] text-brass-400 border border-brass-600 bg-ink-900">
                    {gate} {active && <Link to={`/offering/${active}`}>{t.gate.activeLink}</Link>}
                </div>
            )}

            {step === 0 && (
                <>
                    <Section title={t.sections.basic}>
                        <Field label={t.name} error={errOf("name")}>
                            <input className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} />
                        </Field>
                        <Field label={t.symbol} error={errOf("symbol")} hint={t.symbolHint}>
                            <input className={inputCls} value={displayTicker(form.symbol)} onChange={(e) => set("symbol", e.target.value)} />
                        </Field>
                    </Section>
                    <Section title={t.sections.sale}>
                        {krw("price", t.price)}
                        {krw("raiseTarget", t.raiseTarget)}
                        {num("durationHours", t.durationHours)}
                        {krw("walletLimit", t.walletLimit)}
                        {krw("minCommit", t.minCommit)}
                        <Field label={t.refundMode}>
                            <div className="flex gap-4 min-h-[44px] items-center text-[14px]">
                                {(["all", "partial"] as const).map((m) => (
                                    <label key={m} className="flex items-center gap-2">
                                        <input type="radio" checked={form.refundMode === m} onChange={() => set("refundMode", m)} />
                                        {m === "all" ? t.refundAll : t.refundPartial}
                                    </label>
                                ))}
                            </div>
                        </Field>
                    </Section>
                    <Section title={t.sections.allocation}>
                        {num("salePct", t.salePct, true)}
                        {num("issuerPct", t.issuerPct, true)}
                        {num("lpPct", t.lpPct, true)}
                        {errOf("allocation") && <p className="m-0 text-[12px] text-brass-400 sm:col-span-2">{errOf("allocation")}</p>}
                    </Section>
                    <Section title={t.sections.vesting}>
                        {num("vestingDays", t.vestingDays)}
                        {num("vestingCliffDays", t.vestingCliffDays)}
                    </Section>
                    <Section title={t.sections.sponsorship}>
                        <label className="flex items-center gap-2.5 text-[14px] min-h-[44px]">
                            <input type="checkbox" checked={form.withSponsorship} onChange={(e) => set("withSponsorship", e.target.checked)} />
                            {t.withSponsorship}
                        </label>
                        {form.withSponsorship && num("sponsorBurnPct", t.sponsorBurnPct, true)}
                    </Section>
                    <Section title={t.sections.proceeds}>
                        {num("upfrontPct", t.upfrontPct, true)}
                        <Field label={t.lockValue} error={errOf("lockValue")}>
                            <div className="flex gap-2">
                                <input className={`${inputCls} tabular-nums flex-1 min-w-0`} inputMode="numeric" value={form.lockValue} onChange={(e) => set("lockValue", e.target.value.replace(/[^\d]/g, ""))} />
                                {unitPick("lockUnit")}
                            </div>
                        </Field>
                        <Field label={t.lockCliffValue} error={errOf("lockCliffValue")}>
                            <div className="flex gap-2">
                                <input className={`${inputCls} tabular-nums flex-1 min-w-0`} inputMode="numeric" value={form.lockCliffValue} onChange={(e) => set("lockCliffValue", e.target.value.replace(/[^\d]/g, ""))} />
                                {unitPick("lockCliffUnit")}
                            </div>
                        </Field>
                    </Section>
                    {v && (
                        <section className="bg-ink-900 border border-ink-700 rounded-card p-4 sm:p-6 mb-5">
                            <h2 className="m-0 mb-1 text-[15px] font-bold">{t.derived.title}</h2>
                            <p className="m-0 mb-4 text-[12px] text-hanji-400">{t.derived.deadline(at(now + Number(v.durationSec) * 1000))}</p>
                            <Rows rows={termRows(v, bounds)} />
                            <BurnNote v={v} />
                        </section>
                    )}
                    <PrimaryBtn onClick={() => { setShowAll(true); if (v) setStep(1); }}>{t.next}</PrimaryBtn>
                </>
            )}

            {step === 1 && (
                <>
                    <section className="bg-ink-800 border border-ink-700 rounded-card p-4 sm:p-6 mb-5">
                        <p className="m-0 mb-4 text-[12px] text-brass-400">{copy.disclosure.note}</p>
                        <DisclosureForm value={doc} onChange={(d) => { setDoc(d); saveDraft(DRAFT_ID, d); }} showAll={touched.has("__doc")} />
                        <p className="m-0 mt-3 text-[12px] text-hanji-400">{copy.disclosure.draftKept}</p>
                    </section>
                    <div className="flex gap-3">
                        <SecondaryBtn onClick={() => setStep(0)}>{t.back}</SecondaryBtn>
                        <PrimaryBtn onClick={() => { setTouched((s) => new Set(s).add("__doc")); if (docOk) setStep(2); }}>{t.next}</PrimaryBtn>
                    </div>
                </>
            )}

            {step === 2 && v && (
                <>
                    <section className="bg-ink-800 border border-ink-700 rounded-card p-4 sm:p-6 mb-5">
                        <h2 className="m-0 mb-1 text-[17px] font-bold">{t.confirm.title}</h2>
                        <p className="m-0 mb-4 text-[12px] text-hanji-400">{t.derived.deadline(at(now + Number(v.durationSec) * 1000))}</p>
                        <Rows rows={[[t.fixed.tier, "L1"], [copy.offeringCreate.name, v.name], [copy.offeringCreate.symbol, v.symbol], ...termRows(v, bounds)]} />
                        <BurnNote v={v} />
                        <h3 className="m-0 mt-5 mb-3 text-[14px] font-bold">{t.fixed.title}</h3>
                        <Rows rows={[
                            [t.fixed.royalty, `${bpsPct(bounds.swapRoyaltyBps)}%`],
                            [t.fixed.burn, `${bpsPct(bounds.swapBurnBps)}%`],
                            [t.fixed.transferLock, t.fixed.none],
                            [t.fixed.holdingCap, t.fixed.none],
                        ]} />
                    </section>
                    <section className="bg-ink-800 border border-ink-700 rounded-card p-4 sm:p-6 mb-5">
                        <h2 className="m-0 mb-1 text-[17px] font-bold">{t.confirm.disclosure}</h2>
                        <p className="m-0 mb-4 text-[12px] text-brass-400">{copy.disclosure.note}</p>
                        <DocView doc={normalizeDoc(doc)} />
                    </section>
                    <div className="mb-5 space-y-1">
                        {t.confirm.lines.map((line, i) => (
                            <label key={i} className="flex items-start gap-2.5 text-[14px] text-hanji-100 min-h-[44px] py-2">
                                <input type="checkbox" className="mt-1" checked={checks[i]} onChange={(e) => setChecks((c) => c.map((x, k) => (k === i ? e.target.checked : x)))} />
                                <span>{line}</span>
                            </label>
                        ))}
                    </div>
                    <div className="flex gap-3 flex-wrap items-center">
                        <SecondaryBtn onClick={() => setStep(1)}>{t.back}</SecondaryBtn>
                        <TxButton disabled={!!gate || !checks.every(Boolean) || !docOk} action={submit}>{t.confirm.cta}</TxButton>
                    </div>
                    {status && (
                        <p className={`m-0 mt-4 text-[13px] ${status.kind === "error" ? "text-brass-400" : "text-hanji-400"}`}>
                            {status.text} {status.offering && status.kind === "error" && <Link to={`/offering/${status.offering}`}>{t.confirm.goDetail}</Link>}
                        </p>
                    )}
                </>
            )}
        </div>
    );
}
