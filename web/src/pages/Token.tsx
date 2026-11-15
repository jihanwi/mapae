import {Link, useNavigate, useParams} from "react-router-dom";
import {addrKey, normalizeAddressParam} from "../lib/address";
import {useAccount, useReadContract, useReadContracts} from "wagmi";
import {useEffect, useState} from "react";
import {useCopy} from "../copy";
import {Address, CurveDetail, useCurve, ZERO} from "../hooks/curves";
import {CurveFactoryAbi, MapaePoolV3Abi} from "../contracts/abisV3";
import {ADDR_V3} from "../contracts/addressesV3";
import {costToSellOut, grossForNet, marketCapQuote, progressBps, spotPrice, TOTAL_SUPPLY, WAD} from "../lib/curveMath";
import {fmt, fmtCeil, fmtRound, fmtSig, shortAddr} from "../lib/format";
import {explorerAddr, explorerTx, giwaSepolia} from "../config/chain";
import {useActivity} from "../hooks/activity";
import {useChainSummary, useHolders, useTradeHistory} from "../hooks/chainData";
import {mergeHistory, sharePct} from "../lib/chainMerge";
import {CandleChart} from "../components/CandleChart";
import {tokenPageState} from "../lib/tokenPage";
import {PriorityBanner} from "../components/PriorityCountdown";
import {Comments} from "../components/Comments";
import {agoLabel, tradeAmount, tradeUnit, useNow} from "../components/feed";
import {Badge, Gauge, NetError, PrimaryBtn, SecondaryBtn, Skeleton, Stat} from "../components/ui";
import {CurveAvatar, draftValid, linkDomain, MetaFields, SaveStatus} from "../components/MetaForm";
import {CurveMeta, draftHasContent, emptyDraft, MetaDraft, useCurveMeta, useSaveMeta} from "../hooks/meta";
import {CurveTradePanel} from "../components/CurveTradePanel";
import {pctLabel, quoteUnit} from "./Curves";

// Layout note (390px): single column of full-width blocks (w-full / min-w-0, no fixed widths);
// addresses are shortened, long values wrap via break-all, stat grids are 2 columns.

function ExtLink({href, children}: {href: string; children: React.ReactNode}) {
    return (
        <a href={href} target="_blank" rel="noreferrer" className="text-brass-400 hover:text-hanji-100 break-all">
            {children}
        </a>
    );
}

/** Pool spot after graduation (curve reserves no longer describe the price). */
function usePoolSpot(pool: Address | undefined, enabled: boolean) {
    return useReadContract({
        address: pool,
        abi: MapaePoolV3Abi,
        functionName: "spotPrice",
        chainId: giwaSepolia.id,
        query: {enabled: enabled && !!pool && pool !== ZERO, refetchInterval: 4_000},
    });
}

function PriceStats({c}: {c: CurveDetail}) {
    const tr = useCopy();
    const unit = quoteUnit(c);
    const poolSpot = usePoolSpot(c.pool, c.graduated);
    let spot: bigint | undefined;
    let mcap: bigint | undefined;
    if (!c.graduated) {
        spot = spotPrice(c.virtualQuote, c.r, c.s);
        mcap = marketCapQuote(c.virtualQuote, c.r, c.s);
    } else if (poolSpot.data !== undefined) {
        spot = poolSpot.data as bigint;
        mcap = (spot * TOTAL_SUPPLY) / WAD;
    }
    return (
        <div className="grid grid-cols-2 gap-3">
            <Stat label={tr.curve.spot} value={spot !== undefined ? fmtSig(spot, 4, tr.locale) : poolSpot.isError ? tr.curve.quoteError : "…"} unit={`${unit}${tr.curve.perToken}`} />
            <Stat label={tr.curve.marketCap} value={mcap !== undefined ? fmtRound(mcap, unit === "ETH" ? 4 : 0, tr.locale) : "…"} unit={unit} />
        </div>
    );
}

function Progress({c}: {c: CurveDetail}) {
    const tr = useCopy();
    const unit = quoteUnit(c);
    if (c.graduated) {
        return (
            <div className="bg-ink-800 border border-ink-700 rounded-card p-4 sm:p-6">
                <Gauge committed={10_000n} target={10_000n} height={10} />
                <div className="mt-3 flex items-center justify-between gap-3 flex-wrap text-[14px]">
                    <Badge kind="neutral">{tr.curve.graduated}</Badge>
                    {c.pool !== ZERO && <ExtLink href={explorerAddr(c.pool)}>{tr.curve.poolLink}</ExtLink>}
                </div>
            </div>
        );
    }
    const bps = progressBps(c.virtualQuote, c.r);
    const left = grossForNet(costToSellOut(c.virtualQuote, c.r, c.s), BigInt(c.totalFeeBps));
    return (
        <div className="bg-ink-800 border border-ink-700 rounded-card p-4 sm:p-6">
            <Gauge committed={bps} target={10_000n} height={10} />
            <div className="mt-3 flex justify-between gap-3 flex-wrap text-[13px] tabular-nums">
                <span className="text-hanji-400">{tr.curve.progress(pctLabel(bps))}</span>
                <span className="text-hanji-100">{tr.curve.toGraduate(fmtCeil(left, unit === "ETH" ? 6 : 0, tr.locale), unit)}</span>
            </div>
        </div>
    );
}

/** Trade history: the server index (paged with "load more") plus browser RPC trades after the
 *  server's indexedBlock, deduped by (tx, logIndex). Without the server it falls back to the
 *  browser window alone, as before. Buy/sell keep the existing success/error text colors. */
function TradeHistory({c}: {c: CurveDetail}) {
    const tr = useCopy();
    const activity = useActivity();
    const summary = useChainSummary();
    const hist = useTradeHistory(c.address);
    const now = useNow();
    const browser = activity.stats.get(addrKey(c.address))?.recent ?? [];
    const serverOk = hist.isSuccess && summary.isSuccess;
    const server = serverOk ? hist.data.pages.flatMap((p) => p.trades) : [];
    const rows = mergeHistory(server, browser, serverOk ? summary.data.indexedBlock : null, activity.tsOf);
    const loading = !serverOk && !hist.isError && !summary.isError && !activity.loaded;
    return (
        <div className="bg-ink-900 border border-ink-700 rounded-card p-4 sm:p-6 min-w-0">
            <h3 className="m-0 mb-3 text-[15px] font-bold">{tr.feed.recentTitle}</h3>
            {activity.error != null && !serverOk && <p className="m-0 mb-2 text-[13px] text-error">{tr.feed.loadError}</p>}
            {loading ? (
                <p className="m-0 text-[13px] text-hanji-400">…</p>
            ) : rows.length === 0 ? (
                <p className="m-0 text-[13px] text-hanji-400">{serverOk ? tr.chain.chartEmpty : tr.feed.noTrades(activity.hours ?? 1)}</p>
            ) : (
                <ul className="m-0 p-0 list-none">
                    {rows.map((t) => (
                        <li key={t.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 border-t border-ink-700 first:border-t-0 text-[13px] tabular-nums min-w-0">
                            <span className="text-hanji-400 w-[72px] flex-none">{t.ts !== undefined ? agoLabel(tr, now, t.ts) : ""}</span>
                            <span className="flex-none">
                                {t.isDev ? <Badge kind="partial">{tr.curve.dev}</Badge> : <span className="text-hanji-100">{shortAddr(t.trader)}</span>}
                            </span>
                            <span className={`flex-none font-semibold ${t.side === "buy" ? "text-success" : "text-error"}`}>{t.side === "buy" ? tr.feed.buy : tr.feed.sell}</span>
                            {/* v3.1: buys made by a verified wallet (server: indexed status, browser: Buy.verified) */}
                            {t.side === "buy" && t.verified === true && <Badge kind="neutral">{tr.priority.verifiedTag}</Badge>}
                            <span className="text-hanji-100">
                                {fmt(t.tokenAmount, 2, tr.locale)} {c.symbol}
                            </span>
                            <span className="text-hanji-100">
                                {tradeAmount(t, c.isEth, tr.locale)} {tradeUnit(t, c.isEth)}
                            </span>
                            <span className="ml-auto flex-none">
                                <ExtLink href={explorerTx(t.tx)}>{tr.feed.txLink}</ExtLink>
                            </span>
                        </li>
                    ))}
                </ul>
            )}
            {serverOk && hist.hasNextPage && (
                <button
                    type="button"
                    disabled={hist.isFetchingNextPage}
                    onClick={() => void hist.fetchNextPage()}
                    className="mt-3 w-full min-h-[40px] rounded-input border border-ink-700 text-[13px] text-hanji-100 hover:border-brass-600 disabled:opacity-50"
                >
                    {tr.chain.loadMore}
                </button>
            )}
        </div>
    );
}

/** Top 20 holders from the index: share of the 1e9 supply (bigint, floored to 0.01%), labels. */
function Holders({c}: {c: CurveDetail}) {
    const tr = useCopy();
    const q = useHolders(c.address);
    const label = (l: string | null) => (l === "curve" ? tr.chain.labelCurve : l === "pool" ? tr.chain.labelPool : l === "dev" ? tr.chain.labelDev : null);
    return (
        <div className="bg-ink-900 border border-ink-700 rounded-card p-4 sm:p-6 min-w-0">
            <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
                <h3 className="m-0 text-[15px] font-bold">{tr.chain.holdersTitle}</h3>
                {q.isSuccess && <span className="text-[12px] text-hanji-400 tabular-nums">{tr.chain.holdersTotal(q.data.total)}</span>}
            </div>
            {q.isError ? (
                <p className="m-0 text-[13px] text-hanji-400">{tr.chain.unavailable}</p>
            ) : !q.isSuccess ? (
                <p className="m-0 text-[13px] text-hanji-400">…</p>
            ) : q.data.holders.length === 0 ? (
                <p className="m-0 text-[13px] text-hanji-400">{tr.chain.holdersEmpty}</p>
            ) : (
                <ol className="m-0 p-0 list-none">
                    {q.data.holders.slice(0, 20).map((h, i) => {
                        const l = label(h.label);
                        return (
                            <li key={h.address} className="flex items-center gap-3 py-1.5 text-[13px] tabular-nums min-w-0">
                                <span className="text-hanji-400 w-6 flex-none text-right">{i + 1}</span>
                                <ExtLink href={explorerAddr(h.address)}>{shortAddr(h.address)}</ExtLink>
                                {l && <Badge kind="neutral">{l}</Badge>}
                                <span className="ml-auto flex-none text-hanji-100">{sharePct(BigInt(h.balance), TOTAL_SUPPLY)}%</span>
                            </li>
                        );
                    })}
                </ol>
            )}
        </div>
    );
}

/** Description and links under the header. Text only (no HTML); links show the domain. */
function MetaInfo({m}: {m: CurveMeta}) {
    const tr = useCopy();
    const links = (
        [
            [tr.meta.linkX, m.links.x],
            [tr.meta.linkTelegram, m.links.telegram],
            [tr.meta.linkWebsite, m.links.website],
        ] as const
    ).filter(([, u]) => u);
    if (!m.description && links.length === 0) return null;
    return (
        <div className="flex flex-col gap-2 min-w-0">
            {m.description && <p className="m-0 text-[14px] text-hanji-100 break-words">{m.description}</p>}
            {links.length > 0 && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                    {links.map(([label, u]) => (
                        <a key={label} href={u} target="_blank" rel="noopener noreferrer nofollow" className="text-brass-400 hover:text-hanji-100 break-all">
                            {label} · {linkDomain(u)}
                        </a>
                    ))}
                </div>
            )}
        </div>
    );
}

/** Shown to the Dev on their own curve while it has no metadata: same fields and signing flow, once. */
function AddMeta({c}: {c: CurveDetail}) {
    const tr = useCopy();
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<MetaDraft>(emptyDraft);
    const {state, save} = useSaveMeta();
    if (state.phase === "saved") return <SaveStatus state={state} />;
    if (!open) {
        return (
            <SecondaryBtn className="w-full sm:w-auto" onClick={() => setOpen(true)}>
                {tr.meta.addCta}
            </SecondaryBtn>
        );
    }
    const busy = state.phase === "signing" || state.phase === "uploading";
    return (
        <div className="bg-ink-800 border border-ink-700 rounded-card p-4 sm:p-6 flex flex-col gap-3 min-w-0">
            <div className="flex items-start justify-between gap-3">
                <h3 className="m-0 text-[15px] font-bold">{tr.meta.addCta}</h3>
                <button type="button" onClick={() => setOpen(false)} className="text-[13px] text-hanji-400 hover:text-hanji-100 min-h-[32px] px-1">
                    {tr.meta.close}
                </button>
            </div>
            <MetaFields draft={draft} onChange={setDraft} disabled={busy} />
            <p className="m-0 text-[12px] text-hanji-400">{tr.meta.saveNote}</p>
            <PrimaryBtn className="w-full" disabled={busy || !draftHasContent(draft) || !draftValid(draft)} onClick={() => void save(c.address, draft)}>
                {tr.meta.save}
            </PrimaryBtn>
            <SaveStatus state={state} onRetry={() => void save(c.address, draft)} />
        </div>
    );
}

function Contracts({c}: {c: CurveDetail}) {
    const tr = useCopy();
    const rows: [string, Address][] = [
        [tr.curve.contractCurve, c.address],
        [tr.curve.contractToken, c.token],
        ...(c.pool !== ZERO ? ([[tr.curve.contractPool, c.pool]] as [string, Address][]) : []),
    ];
    return (
        <div className="bg-ink-900 border border-ink-700 rounded-card p-4 sm:p-6">
            <h3 className="m-0 mb-3 text-[15px] font-bold">{tr.curve.contracts}</h3>
            {rows.map(([label, a]) => (
                <div key={label} className="flex justify-between gap-3 text-[13px] py-1.5 min-w-0">
                    <span className="text-hanji-400 flex-none">{label}</span>
                    <ExtLink href={explorerAddr(a)}>{shortAddr(a)}</ExtLink>
                </div>
            ))}
        </div>
    );
}

export default function Token() {
    const tr = useCopy();
    const {curve: param} = useParams();
    // Any letter case is accepted; the checksummed form is used everywhere on the page.
    const addr = normalizeAddressParam(param) ?? undefined;
    const valid = addr !== undefined;
    const navigate = useNavigate();
    useEffect(() => {
        if (addr && param !== addr) navigate(`/t/${addr}`, {replace: true});
    }, [addr, param, navigate]);
    // Only curves opened by the current (v3.1) CurveFactory are shown (isCurve guard).
    const reg = useReadContracts({
        contracts: [{address: ADDR_V3.curveFactory, abi: CurveFactoryAbi, functionName: "isCurve", args: [addr ?? ZERO], chainId: giwaSepolia.id}],
        query: {enabled: valid},
    });
    const isCurve = reg.data?.[0]?.status === "success" ? (reg.data[0].result as boolean) : undefined;
    const {curve: c, isLoading, isError, refetch} = useCurve(isCurve ? addr : undefined);
    const meta = useCurveMeta();
    const {address: account} = useAccount();

    const wrap = (node: React.ReactNode) => <div className="max-w-page mx-auto px-4 sm:px-8 pt-8 sm:pt-10 pb-16 sm:pb-20">{node}</div>;

    const page = tokenPageState({validAddress: valid, isCurve, registryError: reg.isError, curveError: isError, curveLoaded: !isLoading && !!c});
    if (page === "notFound") {
        return wrap(
            <div className="text-center pt-8">
                <h1 className="m-0 mb-2 text-[22px] font-bold">{tr.curve.notFoundTitle}</h1>
                <p className="m-0 mb-6 text-[14px] text-hanji-400">{tr.curve.notFoundNote}</p>
                <Link to="/"><PrimaryBtn>{tr.curve.backToList}</PrimaryBtn></Link>
            </div>
        );
    }
    if (page === "error") return wrap(<NetError onRetry={() => { void reg.refetch(); refetch(); }} />);
    if (page === "loading" || !c) return wrap(<Skeleton h={320} />);

    const m = meta.get(c.address);
    const isDev = !!account && account.toLowerCase() === c.dev.toLowerCase();
    return wrap(
        <div className="flex flex-col gap-5 sm:gap-6 max-w-[720px] mx-auto w-full min-w-0">
            <Link to="/" className="text-[14px]">← {tr.curve.backToList}</Link>
            {/* 1) header */}
            <div className="flex items-center gap-4 min-w-0">
                <CurveAvatar char={c.symbol.slice(0, 1) || "馬"} imageUrl={m?.imageUrl} size={64} />
                <div className="min-w-0 flex-1">
                    <h1 className="m-0 text-[24px] sm:text-[28px] font-bold break-all">{c.name}</h1>
                    <div className="text-[13px] text-hanji-400 flex flex-wrap gap-x-3 gap-y-1">
                        <span>{c.symbol}</span>
                        <span>{tr.curve.quoteAsset} {quoteUnit(c)}</span>
                        <span>
                            {tr.curve.dev} <ExtLink href={explorerAddr(c.dev)}>{shortAddr(c.dev)}</ExtLink>
                        </span>
                    </div>
                </div>
            </div>
            {/* 1b) description and links (Vercel Blob metadata); the Dev can add them once */}
            {m && <MetaInfo m={m} />}
            {!m && meta.loaded && isDev && <AddMeta c={c} />}
            {/* 2) people counter */}
            <div className="text-[15px] tabular-nums">
                <span className="font-semibold">{tr.curve.verifiedTraders(c.verifiedBuyerCount)}</span>
                <span className="text-hanji-400 text-[13px]"> ({tr.curve.verifiedTradersNote})</span>
            </div>
            {/* 3) graduation progress */}
            <Progress c={c} />
            {/* 4) price / market cap */}
            <PriceStats c={c} />
            {/* 4b) candle chart from the server index */}
            <CandleChart curve={c.address} unit={c.graduated && c.isEth ? "WETH" : quoteUnit(c)} />
            {/* 5) fixed panel */}
            <div className="rounded-input px-4 py-3.5 text-[13px] text-hanji-100 border border-ink-700 bg-ink-900 text-center">
                {tr.curve.fixedPanel}
            </div>
            {/* 6) trade panel (v3.1: verified-only notice while the priority window is open) */}
            {!c.graduated && <PriorityBanner priorityUntil={c.priorityUntil} />}
            <CurveTradePanel c={c} />
            {/* 7) trade history (server index + browser RPC), holders */}
            {/* 6b) comments (verified wallets, nicknames only) */}
            <Comments curve={c.address} />
            <TradeHistory c={c} />
            <Holders c={c} />
            {/* 8) contract links */}
            <Contracts c={c} />
        </div>
    );
}
