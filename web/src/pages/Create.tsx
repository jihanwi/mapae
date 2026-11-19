// "/create": open a v3 curve through CurveFactory. All limits, fees and virtual reserves are read
// from the contracts (CurveFactory, FeeRouter, MapaeFactory); nothing is hardcoded here.
// Layout (W-T64): head with the two ways to start (this screen and /offerings/new) as equal cards,
// then the form and a summary card in two columns from lg (summary sticky on the right, below the
// form under lg). Done / loading / error states stay one 640px column.
// Layout note (390px): one column, inputs flex-1 min-w-0, rows flex-wrap.
import {useEffect, useId, useMemo, useState} from "react";
import {Link} from "react-router-dom";
import {Abi, parseEventLogs, parseUnits} from "viem";
import {useAccount, usePublicClient, useReadContracts, useWriteContract} from "wagmi";
import {useCopy} from "../copy";
import {ADDR_V3} from "../contracts/addressesV3";
import {CurveFactoryAbi, FeeRouterAbi, MapaeFactoryV3Abi, MockKRWV3Abi} from "../contracts/abisV3";
import {explorerAddr, explorerTx, giwaSepolia} from "../config/chain";
import {Address, CtaState, useTradeCta, ZERO} from "../hooks/curves";
import {CURVE_SUPPLY, DEX_SUPPLY, TOTAL_SUPPLY, costToSellOut, grossForNet, quoteBuyWithFees, spotPrice} from "../lib/curveMath";
import {utf8ByteLength, withinByteLimit} from "../lib/bytes";
import {displayTicker, isStandardTicker, normalizeTicker, tickerCharsOk} from "../lib/ticker";
import {useSameTicker} from "../components/TickerBadge";
import {devFirstBuyCap, exceedsDevFirstBuyCap} from "../lib/devFirstBuy";
import {fmt, fmtCeil, fmtDateTime, fmtSig, sanitizeAmountInput} from "../lib/format";
import {Eyebrow, Icon, NetError, PrimaryBtn, Segmented, Skeleton} from "../components/ui";
import {supplyShares} from "../lib/launchSummary";
import {RunFn, TxButton} from "../components/tx";
import {opensOnboarding, useOnboardingModal} from "../components/OnboardingModal";
import {modalLabel} from "../components/CurveTradePanel";
import {draftValid, MetaFields, SaveStatus} from "../components/MetaForm";
import {draftHasContent, emptyDraft, MetaDraft, useSaveMeta} from "../hooks/meta";
import {titleOf, useTitle} from "../lib/title";
import {checkStart, earliestMinutes, launchArgs, parseLocalDateTime, QUICK_DELAYS, StartCheck, startLabel, StartMode, toLocalInput, utcOffsetLabel} from "../lib/launchOptions";

type QuoteKind = "KRWs" | "ETH";
type QuoteConfig = {registered: boolean; enabled: boolean; decimals: number; curveVirtualQuote: bigint};
type CurveFees = {platformBps: number; devBps: number; lpSeedBps: number};

const bpsPct = (b: number) => (b / 100).toFixed(2);
const wholeTokens = (wei: bigint, locale: string) => (wei / 10n ** 18n).toLocaleString(locale);

function useCreateReads(account: Address | undefined) {
    const reads = useReadContracts({
        contracts: [
            {address: ADDR_V3.curveFactory, abi: CurveFactoryAbi as Abi, functionName: "MAX_NAME_BYTES", chainId: giwaSepolia.id},
            {address: ADDR_V3.curveFactory, abi: CurveFactoryAbi as Abi, functionName: "MAX_SYMBOL_BYTES", chainId: giwaSepolia.id},
            {address: ADDR_V3.curveFactory, abi: CurveFactoryAbi as Abi, functionName: "curveEnabled", chainId: giwaSepolia.id},
            {address: ADDR_V3.feeRouter, abi: FeeRouterAbi as Abi, functionName: "getCurveFees", chainId: giwaSepolia.id},
            {address: ADDR_V3.mapaeFactory, abi: MapaeFactoryV3Abi as Abi, functionName: "quoteConfig", args: [ADDR_V3.mockKRW], chainId: giwaSepolia.id},
            {address: ADDR_V3.mapaeFactory, abi: MapaeFactoryV3Abi as Abi, functionName: "quoteConfig", args: [ADDR_V3.weth], chainId: giwaSepolia.id},
            {address: ADDR_V3.curveFactory, abi: CurveFactoryAbi as Abi, functionName: "nextAllowedAt", args: [account ?? ZERO], chainId: giwaSepolia.id},
            // v3.5: the Dev first-buy cap is the new curve's holding cap (bps of supply)
            {address: ADDR_V3.curveFactory, abi: CurveFactoryAbi as Abi, functionName: "priorityMaxHoldingBps", chainId: giwaSepolia.id},
            // v3.6: the band of a scheduled start (seconds from the creation block)
            {address: ADDR_V3.curveFactory, abi: CurveFactoryAbi as Abi, functionName: "MIN_START_DELAY", chainId: giwaSepolia.id},
            {address: ADDR_V3.curveFactory, abi: CurveFactoryAbi as Abi, functionName: "MAX_START_DELAY", chainId: giwaSepolia.id},
        ],
        query: {refetchInterval: 10_000},
    });
    const d = reads.data;
    const ok = !!d && d.every((x) => x.status === "success");
    const failed = reads.isError || (!!d && d.some((x) => x.status !== "success"));
    return {
        loaded: ok,
        failed,
        refetch: () => void reads.refetch(),
        maxName: ok ? Number(d![0].result as bigint) : 0,
        maxSymbol: ok ? Number(d![1].result as bigint) : 0,
        curveEnabled: ok ? (d![2].result as boolean) : false,
        fees: ok ? (d![3].result as CurveFees) : undefined,
        krw: ok ? (d![4].result as QuoteConfig) : undefined,
        weth: ok ? (d![5].result as QuoteConfig) : undefined,
        nextAllowedAt: ok && account ? (d![6].result as bigint) : 0n,
        devBuyCap: ok ? devFirstBuyCap(Number(d![7].result as number)) : undefined,
        minStartDelay: ok ? Number(d![8].result as bigint) : 0,
        maxStartDelay: ok ? Number(d![9].result as bigint) : 0,
    };
}

/** A labelled field; `htmlFor` ties the label to its input (without it the label is plain text over a
 *  control that names itself, such as a radiogroup with aria-label). */
function Field({label, hint, htmlFor, children}: {label: string; hint?: React.ReactNode; htmlFor?: string; children: React.ReactNode}) {
    return (
        <div className="min-w-0">
            <div className="flex justify-between gap-x-3 gap-y-1 flex-wrap mb-2 text-[13px]">
                {htmlFor ? (
                    <label htmlFor={htmlFor} className="text-hanji-400">
                        {label}
                    </label>
                ) : (
                    <span className="text-hanji-400">{label}</span>
                )}
                {hint}
            </div>
            {children}
        </div>
    );
}

/** One section of the form card: an Eyebrow heading, then its fields; a 1px ink-700 line above every
 *  section but the first. */
function Section({title, locale, first, children}: {title: string; locale: string; first?: boolean; children: React.ReactNode}) {
    return (
        <section className={`flex flex-col gap-5 min-w-0 ${first ? "" : "border-t border-ink-700 pt-6"}`}>
            <h2 className="m-0 leading-none">
                <Eyebrow locale={locale}>{title}</Eyebrow>
            </h2>
            {children}
        </section>
    );
}

/** One of the two "ways to start" cards at the top (W-T64): Eyebrow, serif title, three points. */
function WayBody({eyebrow, title, points, selected, locale}: {eyebrow: string; title: string; points: readonly string[]; selected: boolean; locale: string}) {
    return (
        <>
            <span
                aria-hidden="true"
                className={`absolute top-[22px] right-[22px] w-[18px] h-[18px] rounded-full border grid place-items-center ${selected ? "border-brass-400" : "border-hanji-400"}`}
            >
                {selected && <span className="w-2 h-2 rounded-full bg-brass-400" />}
            </span>
            <Eyebrow locale={locale}>{eyebrow}</Eyebrow>
            <h2 className="m-0 mt-2 mb-3 pr-8 font-serif font-bold text-[22px] leading-snug text-hanji-100">{title}</h2>
            <ul className="m-0 p-0 list-none flex flex-col gap-1.5">
                {points.map((p) => (
                    <li key={p} className="flex items-start gap-2.5 text-[13.5px] leading-relaxed text-hanji-400">
                        <span aria-hidden="true" className="flex-none w-[14px] h-px bg-brass-600 mt-[0.75em]" />
                        <span className="min-w-0">{p}</span>
                    </li>
                ))}
            </ul>
        </>
    );
}

const WAY_CARD = "relative block min-w-0 rounded-[14px] border p-[22px]";

/** Seconds since epoch, ticking every `ms` (the scheduled-start check follows the clock). */
function useClock(ms: number) {
    const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
    useEffect(() => {
        const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), ms);
        return () => clearInterval(id);
    }, [ms]);
    return now;
}

const inputCls =
    "w-full min-w-0 bg-ink-900 border border-ink-700 rounded-input px-4 py-3.5 text-[16px] text-hanji-100 outline-none focus:border-brass-400";

export default function Create() {
    const tr = useCopy();
    useTitle(titleOf(tr.create.title));
    const {address} = useAccount();
    const client = usePublicClient({chainId: giwaSepolia.id});
    const {writeContractAsync} = useWriteContract();
    const openModal = useOnboardingModal();
    const r = useCreateReads(address);
    const fid = useId();

    const [name, setName] = useState("");
    // Shown as typed through displayTicker (NFKC, a–z -> A–Z); left alone while an IME composes.
    const [symbol, setSymbol] = useState("");
    const [composing, setComposing] = useState(false);
    const [kind, setKind] = useState<QuoteKind>("KRWs");
    const [rawBuy, setRawBuy] = useState("");
    // v3.6 launch options: start now (default) or at a chosen time; verified-only (default off)
    const [startMode, setStartMode] = useState<StartMode>("now");
    const [startSec, setStartSec] = useState<number | null>(null);
    const [verifiedOnly, setVerifiedOnly] = useState(false);
    const [staleStart, setStaleStart] = useState<StartCheck | null>(null);
    const clock = useClock(5_000);
    const [created, setCreated] = useState<{curve: Address; hash: `0x${string}`} | null>(null);
    const [decodeFailed, setDecodeFailed] = useState<`0x${string}` | null>(null);
    // Optional metadata, signed and uploaded after the launch tx (never part of the CTA checks).
    const [draft, setDraft] = useState<MetaDraft>(emptyDraft);
    const meta = useSaveMeta();
    const wantsMeta = draftHasContent(draft);

    const typedBuy = useMemo(() => {
        try {
            return parseUnits(rawBuy || "0", 18);
        } catch {
            return 0n;
        }
    }, [rawBuy]);
    const scheduled = startMode === "scheduled";
    // a scheduled launch never sends a Dev first buy (the factory would revert it)
    const {options: launchOptions, devBuy} = launchArgs(startMode, startSec, typedBuy, verifiedOnly);
    const startCheck: StartCheck = scheduled ? checkStart(startSec, clock, r.minStartDelay, r.maxStartDelay) : {ok: true};
    const quote: Address = kind === "KRWs" ? ADDR_V3.mockKRW : ADDR_V3.weth;
    const cfg = kind === "KRWs" ? r.krw : r.weth;
    const vq = cfg?.curveVirtualQuote ?? 0n;
    const feeBps = r.fees ? BigInt(r.fees.platformBps + r.fees.devBps + r.fees.lpSeedBps) : 0n;

    const payToken: Address | "native" = kind === "KRWs" ? ADDR_V3.mockKRW : "native";
    const {state, refetch} = useTradeCta({payToken, amount: devBuy, spender: kind === "KRWs" ? ADDR_V3.curveFactory : undefined});
    // No first buy → nothing to pay, so "enter an amount" means ready here.
    const cta: CtaState = devBuy === 0n && state.kind === "enterAmount" ? {kind: "ready"} : state;

    const preview = vq > 0n && devBuy > 0n && r.fees ? quoteBuyWithFees(vq, 0n, 0n, devBuy, feeBps) : undefined;
    const minTokensOut = preview ? (preview.tokensOut * 99n) / 100n : 0n;
    // v3.5: the buy at launch may deliver at most the factory's holding cap; more reverts the whole creation
    const capTokens = r.devBuyCap ?? ADDR_V3.priorityMaxHoldingTokens;
    const overCap = !!preview && exceedsDevFirstBuyCap(preview.tokensOut, capTokens);

    // Leading / trailing spaces never reach the chain: validation, byte counts and tx args all use
    // the trimmed values (the inputs keep what was typed).
    const nameT = name.trim();
    // decision 54: the submitted ticker is normalizeTicker(input) and must follow the rule
    const symbolT = normalizeTicker(symbol);
    const nameBytes = utf8ByteLength(nameT);
    const symbolBytes = utf8ByteLength(symbolT);
    const symbolBadChars = !composing && symbolT !== "" && !tickerCharsOk(symbolT);
    const sameTicker = useSameTicker(composing ? "" : symbolT);
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    const rateLimited = r.nextAllowedAt > nowSec;
    const quoteOk = !!cfg && cfg.registered && cfg.enabled;
    const formOk =
        r.loaded && !composing && nameT !== "" && symbolT !== "" && withinByteLimit(nameT, r.maxName) && withinByteLimit(symbolT, r.maxSymbol) && isStandardTicker(symbolT) && quoteOk;
    const blocked = !r.curveEnabled || rateLimited || !formOk || !draftValid(draft) || overCap || !startCheck.ok;

    const action = async (run: RunFn) => {
        if (!address || !client) return;
        // re-check the start time at the moment of submitting (the clock above ticks every 5 s)
        if (scheduled) {
            const c = checkStart(startSec, Math.floor(Date.now() / 1000), r.minStartDelay, r.maxStartDelay);
            if (!c.ok) {
                setStaleStart(c);
                return;
            }
        }
        setStaleStart(null);
        const opts = {
            scope: "v3" as const,
            onRevert: (n: string | undefined) => {
                if (n === "NotVerified") openModal({krwNeeded: kind === "KRWs" ? devBuy : 0n, onProgress: refetch});
            },
        };
        if (cta.kind === "approve") {
            const ok = await run(
                tr.curve.txApprove,
                () => writeContractAsync({address: ADDR_V3.mockKRW, abi: MockKRWV3Abi, functionName: "approve", args: [ADDR_V3.curveFactory, devBuy], chainId: giwaSepolia.id}),
                opts
            );
            if (!ok) return;
        }
        let hash: `0x${string}` | undefined;
        const ok = await run(
            tr.create.txLabel(symbolT),
            async () => {
                hash =
                    kind === "KRWs"
                        ? await writeContractAsync({
                              address: ADDR_V3.curveFactory,
                              abi: CurveFactoryAbi,
                              functionName: "createCurve",
                              args: [quote, nameT, symbolT, devBuy, minTokensOut, launchOptions],
                              chainId: giwaSepolia.id,
                          })
                        : await writeContractAsync({
                              address: ADDR_V3.curveFactory,
                              abi: CurveFactoryAbi,
                              functionName: "createCurveWithETH",
                              args: [nameT, symbolT, minTokensOut, launchOptions],
                              value: devBuy,
                              chainId: giwaSepolia.id,
                          });
                return hash;
            },
            opts
        );
        if (!ok || !hash) return;
        refetch();
        r.refetch();
        // Decode CurveCreated from the mined receipt (no log scanning).
        const receipt = await client.getTransactionReceipt({hash});
        const events = parseEventLogs({abi: CurveFactoryAbi, eventName: "CurveCreated", logs: receipt.logs}).filter(
            (l) => l.address.toLowerCase() === ADDR_V3.curveFactory.toLowerCase()
        );
        const curve = events[0]?.args.curve as Address | undefined;
        if (curve) {
            setCreated({curve, hash});
            // The curve is live at this point; a rejected signature or failed upload only leaves
            // the metadata unsaved (the success screen offers a retry).
            if (wantsMeta) void meta.save(curve, draft);
        } else setDecodeFailed(hash);
    };

    const wrap = (node: React.ReactNode) => (
        <div className="max-w-page mx-auto px-4 sm:px-8 pt-8 sm:pt-10 pb-16 sm:pb-20">
            <div className="max-w-[640px] mx-auto w-full min-w-0 flex flex-col gap-5">{node}</div>
        </div>
    );

    if (created) {
        return wrap(
            <div className="bg-ink-800 border border-ink-700 rounded-card p-5 sm:p-7 text-center">
                <h1 className="m-0 mb-2 text-[22px] font-bold">{tr.create.doneTitle}</h1>
                <p className="m-0 mb-5 text-[14px] text-hanji-400 break-all">{tr.create.doneNote(nameT, symbolT)}</p>
                {wantsMeta && (
                    <div className="mb-5 text-left flex flex-col gap-2">
                        {meta.state.phase === "failed" && <p className="m-0 text-[13px] text-brass-400">{tr.meta.notSaved}</p>}
                        <SaveStatus context="launch" state={meta.state} onRetry={() => void meta.save(created.curve, draft)} />
                    </div>
                )}
                <Link to={`/t/${created.curve}`}>
                    <PrimaryBtn className="w-full">{tr.create.goToken}</PrimaryBtn>
                </Link>
                <div className="mt-4 flex flex-col gap-1.5 text-[13px]">
                    <a href={explorerAddr(created.curve)} target="_blank" rel="noreferrer" className="break-all">
                        {tr.create.viewCurve}
                    </a>
                    <a href={explorerTx(created.hash)} target="_blank" rel="noreferrer" className="break-all">
                        {tr.tx.viewOnChain}
                    </a>
                </div>
            </div>
        );
    }

    if (r.failed) return wrap(<NetError onRetry={r.refetch} />);
    if (!r.loaded) return wrap(<Skeleton h={420} />);

    const sellOut = vq > 0n ? grossForNet(costToSellOut(vq, 0n, 0n), feeBps) : 0n;
    const unit = kind;
    const dp = kind === "ETH" ? 6 : 0;

    let reason: string | null = null;
    if (!r.curveEnabled) reason = tr.create.paused;
    else if (rateLimited) reason = tr.create.rateLimited(fmtDateTime(r.nextAllowedAt, tr.locale));
    else if (!quoteOk) reason = tr.create.quoteUnavailable;

    const openForState = !blocked && opensOnboarding(cta, payToken);
    const startReason = (c: StartCheck) =>
        c.ok ? null : c.reason === "pick" ? tr.create.startPick : c.reason === "tooSoon" ? tr.create.startTooSoon(earliestMinutes(r.minStartDelay)) : tr.create.startTooLate(Math.floor(r.maxStartDelay / 86_400));
    const startError = startReason(staleStart ?? startCheck);
    const summary = [
        scheduled && startSec !== null ? tr.create.summaryAt(startLabel(startSec, tr.locale)) : scheduled ? null : tr.create.summaryNow,
        verifiedOnly ? tr.create.verifiedOnly : null,
    ].filter(Boolean);
    const pick = (sec: number) => {
        setStartSec(sec);
        setStaleStart(null);
    };

    const shares = supplyShares(CURVE_SUPPLY, DEX_SUPPLY);
    const pctText = (n: number) => n.toLocaleString(tr.locale, {maximumFractionDigits: 2});
    const counter = (n: number, max: number) => <span className={`num text-[12px] ${n > max ? "text-error" : "text-hanji-400"}`}>{tr.create.bytes(n, max)}</span>;
    const rows: [string, React.ReactNode][] = [
        [tr.create.totalSupply, `${wholeTokens(TOTAL_SUPPLY, tr.locale)}${tr.curve.tokenUnit}`],
        [
            tr.create.startPrice,
            <>
                {fmtSig(spotPrice(vq, 0n, 0n), 4, tr.locale)} <span className="text-hanji-400">{unit}</span>
            </>,
        ],
        [
            tr.create.sellOut,
            <>
                {fmtCeil(sellOut, dp, tr.locale)} <span className="text-hanji-400">{unit}</span>
            </>,
        ],
        [
            tr.create.curveFee,
            r.fees ? tr.create.feeBreakdown(bpsPct(Number(feeBps)), bpsPct(r.fees.platformBps), bpsPct(r.fees.devBps), bpsPct(r.fees.lpSeedBps)) : "…",
        ],
    ];
    const legend: [string, string, bigint][] = [
        ["bg-brass-400", tr.create.curveSupply, CURVE_SUPPLY],
        ["bg-brass-600", tr.create.poolSupply, DEX_SUPPLY],
    ];

    return (
        <div className="max-w-page mx-auto px-4 sm:px-8 pt-8 sm:pt-10 pb-16 sm:pb-20 min-w-0">
            <div className="mb-6 sm:mb-8">
                <h1 className="m-0 font-serif font-bold text-[28px] sm:text-[40px] leading-tight text-hanji-100">{tr.create.heading}</h1>
                <p className="m-0 mt-2 text-[15px] text-hanji-400">{tr.create.headingSub}</p>
            </div>

            {/* the two ways to start, side by side at the same size (stacked when narrow) */}
            <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] mb-8 sm:mb-10">
                <div aria-current="page" className={`${WAY_CARD} border-[rgba(195,154,59,.75)] bg-[rgba(195,154,59,.08)]`}>
                    <WayBody {...tr.create.wayCurve} selected locale={tr.locale} />
                </div>
                <Link to="/offerings/new" className={`${WAY_CARD} border-ink-700 bg-ink-800 hover:border-brass-600`}>
                    <WayBody {...tr.create.wayOffering} selected={false} locale={tr.locale} />
                </Link>
            </div>

            <div className="grid gap-5 lg:gap-8 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
                <div className="min-w-0 bg-ink-800 border border-ink-700 rounded-card p-4 sm:p-7 flex flex-col gap-6">
                    <Section title={tr.create.sectionToken} locale={tr.locale} first>
                        <p className="m-0 -mt-1 text-[14px] text-hanji-400">{tr.create.sub}</p>
                        <div className="grid gap-5 sm:gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                            <Field label={tr.create.name} htmlFor={`${fid}-name`} hint={counter(nameBytes, r.maxName)}>
                                <input id={`${fid}-name`} value={name} onChange={(e) => setName(e.target.value)} placeholder={tr.create.namePlaceholder} className={inputCls} />
                            </Field>
                            <Field label={tr.create.symbol} htmlFor={`${fid}-symbol`} hint={counter(symbolBytes, r.maxSymbol)}>
                                <input
                                    id={`${fid}-symbol`}
                                    value={symbol}
                                    // Hangul IME: while composing, the text is stored as typed (no NFKC, no
                                    // upper-casing, no check); compositionend applies displayTicker and the check.
                                    onCompositionStart={() => setComposing(true)}
                                    onCompositionEnd={(e) => {
                                        setComposing(false);
                                        setSymbol(displayTicker(e.currentTarget.value));
                                    }}
                                    onChange={(e) => {
                                        const v = e.target.value;
                                        const native = e.nativeEvent as InputEvent;
                                        setSymbol(composing || native.isComposing ? v : displayTicker(v));
                                    }}
                                    placeholder={tr.create.symbolPlaceholder}
                                    autoCapitalize="characters"
                                    autoCorrect="off"
                                    spellCheck={false}
                                    aria-invalid={symbolBadChars}
                                    className={inputCls}
                                />
                            </Field>
                        </div>
                        {(symbolBadChars || sameTicker !== null) && (
                            <div className="-mt-3 flex flex-col gap-1.5">
                                {symbolBadChars && <p className="m-0 text-[12px] text-error">{tr.create.symbolRule}</p>}
                                {sameTicker !== null && <p className="m-0 text-[12px] text-hanji-400">{tr.create.sameTicker(sameTicker)}</p>}
                            </div>
                        )}
                        <Field label={tr.create.quote}>
                            <Segmented
                                label={tr.create.quote}
                                items={[
                                    {key: "KRWs", label: "KRWs"},
                                    {key: "ETH", label: "ETH"},
                                ]}
                                value={kind}
                                onChange={(k) => {
                                    setKind(k);
                                    setRawBuy("");
                                }}
                            />
                        </Field>
                    </Section>

                    {/* v3.6: when trading opens, and the verified-only option */}
                    <Section title={tr.create.sectionTrading} locale={tr.locale}>
                        <div>
                            <Segmented
                                label={tr.create.startLabel}
                                items={[
                                    {key: "now", label: tr.create.startNow},
                                    {key: "scheduled", label: tr.create.startScheduled},
                                ]}
                                value={startMode}
                                onChange={(m) => {
                                    setStartMode(m);
                                    setStaleStart(null);
                                }}
                            />
                            {scheduled && (
                                <div className="mt-3 flex flex-col gap-3">
                                    <div className="grid grid-cols-3 gap-2">
                                        {QUICK_DELAYS.map((q) => (
                                            <button
                                                key={q.key}
                                                type="button"
                                                onClick={() => pick(Math.floor(Date.now() / 1000) + q.sec)}
                                                className="min-h-[44px] px-1 rounded-[8px] border border-ink-700 text-[13px] text-hanji-100 hover:border-brass-600"
                                            >
                                                {tr.create.quick[q.key]}
                                            </button>
                                        ))}
                                    </div>
                                    <label className="flex flex-col gap-1.5 text-[13px] text-hanji-400">
                                        <span>
                                            {tr.create.startCustom} · {tr.create.startLocal(utcOffsetLabel(startSec ?? clock))}
                                        </span>
                                        <input
                                            type="datetime-local"
                                            value={startSec !== null ? toLocalInput(startSec) : ""}
                                            min={toLocalInput(clock + r.minStartDelay)}
                                            max={toLocalInput(clock + r.maxStartDelay)}
                                            onChange={(e) => {
                                                setStartSec(parseLocalDateTime(e.target.value));
                                                setStaleStart(null);
                                            }}
                                            className={`${inputCls} num [color-scheme:dark]`}
                                        />
                                    </label>
                                    {startSec !== null && startError === null && (
                                        <p className="m-0 text-[13px] text-hanji-100">
                                            <span className="num">{startLabel(startSec, tr.locale)}</span>
                                        </p>
                                    )}
                                    {startError && <p className="m-0 text-[12px] text-error">{startError}</p>}
                                    <p className="m-0 text-[12px] text-hanji-400">{tr.create.scheduledNote}</p>
                                </div>
                            )}
                        </div>
                        <label className="flex items-start gap-3 min-h-[44px] cursor-pointer">
                            <input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} className="mt-1 w-4 h-4 accent-brass-400 flex-none" />
                            <span className="min-w-0">
                                <span className="block text-[14px] font-semibold text-hanji-100">{tr.create.verifiedOnly}</span>
                                <span className="block text-[12px] text-hanji-400 mt-0.5">{tr.create.verifiedOnlyNote}</span>
                            </span>
                        </label>
                        {scheduled ? (
                            <p className="m-0 rounded-input border border-ink-700 bg-ink-900 px-4 py-3 text-[13px] text-hanji-100">{tr.create.scheduledDevNote}</p>
                        ) : (
                            <Field label={tr.create.devBuy(unit)} htmlFor={`${fid}-devbuy`}>
                                <div className="flex items-center bg-ink-900 border border-ink-700 rounded-input px-4 focus-within:border-brass-400">
                                    <input
                                        id={`${fid}-devbuy`}
                                        value={rawBuy}
                                        onChange={(e) => setRawBuy(sanitizeAmountInput(e.target.value))}
                                        inputMode="decimal"
                                        placeholder="0"
                                        className="num flex-1 min-w-0 bg-transparent border-none outline-none py-3.5 text-[16px] text-hanji-100"
                                    />
                                    <span className="text-hanji-400 text-[14px] flex-none">{unit}</span>
                                </div>
                                <p className="m-0 mt-2 text-[12px] text-hanji-400">{tr.create.devBuyNote(capTokens)}</p>
                                {preview && (
                                    <div className="mt-2 text-[13px] flex justify-between gap-3 flex-wrap">
                                        <span className="text-hanji-400">{tr.create.devBuyReceive}</span>
                                        <span className="min-w-0 break-words">
                                            <span className="num">{fmt(preview.tokensOut, 2, tr.locale)}</span> {symbolT || tr.curve.tokenUnit} · {tr.curve.paid}{" "}
                                            <span className="num">{fmtCeil(preview.quoteSpent, kind === "ETH" ? 8 : 2, tr.locale)}</span> {unit}
                                        </span>
                                    </div>
                                )}
                                {overCap && <p className="m-0 mt-2 text-[12px] text-error">{tr.create.devBuyCap(capTokens)}</p>}
                            </Field>
                        )}
                    </Section>

                    <Section title={tr.create.sectionMeta} locale={tr.locale}>
                        <MetaFields draft={draft} onChange={setDraft} variant="launch" />
                        {wantsMeta && <p className="m-0 -mt-2 text-[12px] text-hanji-400">{tr.meta.signNote}</p>}
                    </Section>
                </div>

                {/* summary: below the form under lg, a sticky right column from lg (under the 64px header) */}
                <aside aria-labelledby={`${fid}-summary`} className="min-w-0 lg:sticky lg:top-[88px] bg-ink-900 border border-ink-700 rounded-card p-4 sm:p-6 flex flex-col gap-5">
                    <h2 id={`${fid}-summary`} className="m-0 leading-none">
                        <Eyebrow locale={tr.locale}>{tr.create.summaryTitle}</Eyebrow>
                    </h2>
                    <div>
                        <div role="img" aria-label={tr.create.supplyBar(pctText(shares.curvePct), pctText(shares.poolPct))} className="flex gap-[2px] h-[10px]">
                            <span className="block h-full rounded-l-full bg-brass-400 basis-0" style={{flexGrow: shares.curvePct}} />
                            <span className="block h-full rounded-r-full bg-brass-600 basis-0" style={{flexGrow: shares.poolPct}} />
                        </div>
                        <ul className="m-0 mt-3 p-0 list-none flex flex-col gap-1.5 text-[13px]">
                            {legend.map(([dot, label, amount]) => (
                                <li key={label} className="flex items-center gap-2 flex-wrap">
                                    <span aria-hidden="true" className={`w-2 h-2 rounded-full flex-none ${dot}`} />
                                    <span className="text-hanji-400 min-w-0">{label}</span>
                                    <span className="num ml-auto text-hanji-100">
                                        {wholeTokens(amount, tr.locale)}
                                        {tr.curve.tokenUnit}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                    <dl className="m-0 text-[13px] divide-y divide-ink-800 border-y border-ink-800">
                        {rows.map(([k, v]) => (
                            <div key={k} className="flex justify-between gap-x-3 gap-y-1 py-2.5 flex-wrap">
                                <dt className="text-hanji-400">{k}</dt>
                                <dd className="m-0 num text-right text-hanji-100 min-w-0 break-words">{v}</dd>
                            </div>
                        ))}
                    </dl>
                    {summary.length > 0 && <p className="m-0 text-[14px] text-hanji-100">{summary.join(" · ")}</p>}
                    <ul className="m-0 p-0 list-none flex flex-col gap-2 text-[13px] text-hanji-100">
                        {tr.curve.fixedItems.map((item) => (
                            <li key={item} className="flex items-center gap-2.5">
                                <Icon name="check" className="w-4 h-4 text-brass-400" />
                                <span className="min-w-0">{item}</span>
                            </li>
                        ))}
                    </ul>
                    <div>
                        {openForState ? (
                            <PrimaryBtn className="w-full" onClick={() => openModal({krwNeeded: kind === "KRWs" ? devBuy : 0n, onProgress: refetch})}>
                                {modalLabel(tr, cta)}
                            </PrimaryBtn>
                        ) : (
                            <TxButton className="w-full" disabled={blocked || !(cta.kind === "ready" || cta.kind === "approve")} action={action}>
                                {cta.kind === "approve" ? tr.create.approveCta : cta.kind === "insufficient" ? tr.curve.cta.insufficient : tr.create.cta}
                            </TxButton>
                        )}
                        {reason && <p className="text-[12px] text-brass-400 mt-2 mb-0">{reason}</p>}
                        <p className="text-[12px] text-hanji-400 mt-2 mb-0">{tr.create.rateRule}</p>
                        {decodeFailed && (
                            <p className="text-[12px] text-error mt-2 mb-0">
                                {tr.create.decodeFailed}{" "}
                                <a href={explorerTx(decodeFailed)} target="_blank" rel="noreferrer">
                                    {tr.tx.viewOnChain}
                                </a>
                            </p>
                        )}
                    </div>
                </aside>
            </div>
        </div>
    );
}
