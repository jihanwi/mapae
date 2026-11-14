// "/create": open a v3 curve through CurveFactory. All limits, fees and virtual reserves are read
// from the contracts (CurveFactory, FeeRouter, MapaeFactory); nothing is hardcoded here.
// Layout note (390px): one column (w-full, max-w), inputs flex-1 min-w-0, rows flex-wrap.
import {useMemo, useState} from "react";
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
import {fmt, fmtCeil, fmtDateTime, fmtSig, sanitizeAmountInput} from "../lib/format";
import {NetError, PrimaryBtn, Skeleton} from "../components/ui";
import {RunFn, TxButton} from "../components/tx";
import {opensOnboarding, useOnboardingModal} from "../components/OnboardingModal";
import {modalLabel} from "../components/CurveTradePanel";
import {draftValid, MetaFields, SaveStatus} from "../components/MetaForm";
import {draftHasContent, emptyDraft, MetaDraft, useSaveMeta} from "../hooks/meta";

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
    };
}

function Field({label, hint, children}: {label: string; hint?: React.ReactNode; children: React.ReactNode}) {
    return (
        <div>
            <div className="flex justify-between gap-3 flex-wrap mb-2 text-[13px]">
                <label className="text-hanji-400">{label}</label>
                {hint && <span className="tabular-nums">{hint}</span>}
            </div>
            {children}
        </div>
    );
}

const inputCls =
    "w-full min-w-0 bg-ink-900 border border-ink-700 rounded-input px-4 py-3.5 text-[16px] text-hanji-100 outline-none focus:border-brass-400";

export default function Create() {
    const tr = useCopy();
    const {address} = useAccount();
    const client = usePublicClient({chainId: giwaSepolia.id});
    const {writeContractAsync} = useWriteContract();
    const openModal = useOnboardingModal();
    const r = useCreateReads(address);

    const [name, setName] = useState("");
    const [symbol, setSymbol] = useState("");
    const [kind, setKind] = useState<QuoteKind>("KRWs");
    const [rawBuy, setRawBuy] = useState("");
    const [created, setCreated] = useState<{curve: Address; hash: `0x${string}`} | null>(null);
    const [decodeFailed, setDecodeFailed] = useState<`0x${string}` | null>(null);
    // Optional metadata, signed and uploaded after the launch tx (never part of the CTA checks).
    const [draft, setDraft] = useState<MetaDraft>(emptyDraft);
    const meta = useSaveMeta();
    const wantsMeta = draftHasContent(draft);

    const devBuy = useMemo(() => {
        try {
            return parseUnits(rawBuy || "0", 18);
        } catch {
            return 0n;
        }
    }, [rawBuy]);
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

    const nameBytes = utf8ByteLength(name);
    const symbolBytes = utf8ByteLength(symbol);
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    const rateLimited = r.nextAllowedAt > nowSec;
    const quoteOk = !!cfg && cfg.registered && cfg.enabled;
    const formOk = r.loaded && withinByteLimit(name, r.maxName) && withinByteLimit(symbol, r.maxSymbol) && quoteOk;
    const blocked = !r.curveEnabled || rateLimited || !formOk || !draftValid(draft);

    const action = async (run: RunFn) => {
        if (!address || !client) return;
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
            tr.create.txLabel(symbol),
            async () => {
                hash =
                    kind === "KRWs"
                        ? await writeContractAsync({
                              address: ADDR_V3.curveFactory,
                              abi: CurveFactoryAbi,
                              functionName: "createCurve",
                              args: [quote, name, symbol, devBuy, minTokensOut],
                              chainId: giwaSepolia.id,
                          })
                        : await writeContractAsync({
                              address: ADDR_V3.curveFactory,
                              abi: CurveFactoryAbi,
                              functionName: "createCurveWithETH",
                              args: [name, symbol, minTokensOut],
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
                <p className="m-0 mb-5 text-[14px] text-hanji-400 break-all">{tr.create.doneNote(name, symbol)}</p>
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

    return wrap(
        <>
            <div>
                <h1 className="m-0 mb-2 text-[24px] sm:text-[28px] font-bold">{tr.create.title}</h1>
                <p className="m-0 text-[14px] text-hanji-400">{tr.create.sub}</p>
            </div>

            <div className="bg-ink-800 border border-ink-700 rounded-card p-4 sm:p-7 flex flex-col gap-5">
                <Field
                    label={tr.create.name}
                    hint={<span className={nameBytes > r.maxName ? "text-error" : "text-hanji-400"}>{tr.create.bytes(nameBytes, r.maxName)}</span>}
                >
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr.create.namePlaceholder} className={inputCls} />
                </Field>
                <Field
                    label={tr.create.symbol}
                    hint={<span className={symbolBytes > r.maxSymbol ? "text-error" : "text-hanji-400"}>{tr.create.bytes(symbolBytes, r.maxSymbol)}</span>}
                >
                    <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder={tr.create.symbolPlaceholder} className={inputCls} />
                </Field>
                <Field label={tr.create.quote}>
                    <div className="flex rounded-input overflow-hidden border border-ink-700">
                        {(["KRWs", "ETH"] as const).map((k) => (
                            <button
                                key={k}
                                onClick={() => {
                                    setKind(k);
                                    setRawBuy("");
                                }}
                                className={`flex-1 py-3 text-[14px] font-semibold ${kind === k ? "bg-ink-700 text-hanji-100" : "bg-transparent text-hanji-400 hover:text-hanji-100"}`}
                            >
                                {k}
                            </button>
                        ))}
                    </div>
                </Field>
                <div className="grid grid-cols-2 gap-3 text-[13px]">
                    <div className="bg-ink-900 rounded-stat px-3.5 py-3 min-w-0">
                        <div className="text-[12px] text-hanji-400 mb-1">{tr.create.startPrice}</div>
                        <div className="font-semibold tabular-nums break-all">
                            {fmtSig(spotPrice(vq, 0n, 0n), 4, tr.locale)} <span className="text-hanji-400 font-normal">{unit}</span>
                        </div>
                    </div>
                    <div className="bg-ink-900 rounded-stat px-3.5 py-3 min-w-0">
                        <div className="text-[12px] text-hanji-400 mb-1">{tr.create.sellOut}</div>
                        <div className="font-semibold tabular-nums break-all">
                            {fmtCeil(sellOut, dp, tr.locale)} <span className="text-hanji-400 font-normal">{unit}</span>
                        </div>
                    </div>
                </div>
                <Field label={tr.create.devBuy(unit)}>
                    <div className="flex items-center bg-ink-900 border border-ink-700 rounded-input px-4 focus-within:border-brass-400">
                        <input
                            value={rawBuy}
                            onChange={(e) => setRawBuy(sanitizeAmountInput(e.target.value))}
                            inputMode="decimal"
                            placeholder="0"
                            className="flex-1 min-w-0 bg-transparent border-none outline-none py-3.5 text-[16px] text-hanji-100 tabular-nums"
                        />
                        <span className="text-hanji-400 text-[14px] flex-none">{unit}</span>
                    </div>
                    <p className="m-0 mt-2 text-[12px] text-hanji-400">{tr.create.devBuyNote}</p>
                    {preview && (
                        <div className="mt-2 text-[13px] tabular-nums flex justify-between gap-3 flex-wrap">
                            <span className="text-hanji-400">{tr.create.devBuyReceive}</span>
                            <span>
                                {fmt(preview.tokensOut, 2, tr.locale)} {symbol || tr.curve.tokenUnit} · {tr.curve.paid} {fmtCeil(preview.quoteSpent, kind === "ETH" ? 8 : 2, tr.locale)} {unit}
                            </span>
                        </div>
                    )}
                    {preview && preview.tokensOut === CURVE_SUPPLY && <p className="m-0 mt-2 text-[12px] text-brass-400">{tr.create.devBuyGraduates}</p>}
                </Field>
            </div>

            <div className="bg-ink-800 border border-ink-700 rounded-card p-4 sm:p-7 flex flex-col gap-3">
                <h2 className="m-0 text-[15px] font-bold">{tr.meta.sectionTitle}</h2>
                <MetaFields draft={draft} onChange={setDraft} />
                {wantsMeta && <p className="m-0 text-[12px] text-hanji-400">{tr.meta.signNote}</p>}
            </div>

            <div className="rounded-input px-4 py-3.5 text-[13px] text-hanji-100 border border-ink-700 bg-ink-900 text-center">{tr.curve.fixedPanel}</div>
            <div className="bg-ink-900 border border-ink-700 rounded-card p-4 sm:p-6 text-[13px]">
                {(
                    [
                        [tr.create.totalSupply, `${wholeTokens(TOTAL_SUPPLY, tr.locale)}${tr.curve.tokenUnit}`],
                        [tr.create.curveSupply, `${wholeTokens(CURVE_SUPPLY, tr.locale)}${tr.curve.tokenUnit}`],
                        [tr.create.poolSupply, `${wholeTokens(DEX_SUPPLY, tr.locale)}${tr.curve.tokenUnit}`],
                        [
                            tr.create.curveFee,
                            r.fees
                                ? tr.create.feeBreakdown(bpsPct(Number(feeBps)), bpsPct(r.fees.platformBps), bpsPct(r.fees.devBps), bpsPct(r.fees.lpSeedBps))
                                : "…",
                        ],
                    ] as const
                ).map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-3 py-1.5 flex-wrap">
                        <span className="text-hanji-400">{k}</span>
                        <span className="tabular-nums text-right">{v}</span>
                    </div>
                ))}
            </div>

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
        </>
    );
}
