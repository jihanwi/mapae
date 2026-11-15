import {Link, useNavigate, useParams} from "react-router-dom";
import {addrKey, normalizeAddressParam} from "../lib/address";
import {useAccount, useReadContract, useReadContracts} from "wagmi";
import {useEffect, useRef, useState} from "react";
import {useCopy} from "../copy";
import {Address, CurveDetail, useCurve, ZERO} from "../hooks/curves";
import {CurveFactoryAbi, MapaePoolV3Abi} from "../contracts/abisV3";
import {ADDR_V3} from "../contracts/addressesV3";
import {costToSellOut, grossForNet, marketCapQuote, progressBps, spotPrice, TOTAL_SUPPLY, WAD} from "../lib/curveMath";
import {MembershipTokenV3Abi} from "../contracts/abisV3";
import {changeBps, currentPrice, refPrice} from "../lib/homeList";
import {flowShare} from "../lib/flow";
import {fmt, fmtCeil, fmtRound, fmtSig, shortAddr} from "../lib/format";
import {explorerAddr, explorerTx, giwaSepolia} from "../config/chain";
import {useActivity} from "../hooks/activity";
import {useChainSummary, useFlow, useHolders, useTradeHistory} from "../hooks/chainData";
import {mergeHistory, sharePct} from "../lib/chainMerge";
import {CandleChart} from "../components/CandleChart";
import {tokenPageState} from "../lib/tokenPage";
import {PriorityBadge, PriorityBanner} from "../components/PriorityCountdown";
import {Comments} from "../components/Comments";
import {agoLabel, prefersReducedMotion, tradeAmount, tradeUnit, useNow} from "../components/feed";
import {Badge, Gauge, NetError, PrimaryBtn, SecondaryBtn, Skeleton, Stat} from "../components/ui";
import {CurveAvatar, draftValid, linkDomain, MetaFields, SaveStatus} from "../components/MetaForm";
import {CurveMeta, draftHasContent, emptyDraft, MetaDraft, useCurveMeta, useSaveMeta} from "../hooks/meta";
import {CurveTradePanel} from "../components/CurveTradePanel";
import {CopyAddress} from "../components/CopyAddress";
import {DevFeeBand} from "../components/DevFees";
import {WalletLink} from "../components/WalletLink";
import {useNicknames} from "../hooks/nicknames";
import {Change, pctLabel, quoteUnit} from "./Curves";
import {DEFAULT_TITLE, titleOf, useTitle} from "../lib/title";

// Layout note: below lg one column of full-width blocks (w-full / min-w-0, no fixed widths; the two
// column wrappers are display:contents so `order-*` interleaves their blocks), metrics in 2 columns,
// four tabs that fit 390px, and a bottom buy/sell bar. From lg: left column (header, metrics, meta,
// chart, progress, tabs) and a sticky 360px right column (banner, trade panel, fixed panel).

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

/** Spot (quote per token) and market cap: curve reserves before graduation, the pool spot after. */
function usePrice(c: CurveDetail) {
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
    return {spot, mcap, poolSpot: poolSpot.data as bigint | undefined, spotError: poolSpot.isError};
}

function Metric({label, children, big}: {label: string; children: React.ReactNode; big?: boolean}) {
    return (
        <div className="bg-ink-900 rounded-stat px-3.5 py-3 min-w-0">
            <div className="text-[12px] text-hanji-400 mb-1 truncate">{label}</div>
            <div className={`font-semibold tabular-nums truncate ${big ? "text-[20px]" : "text-[15px]"}`}>{children}</div>
        </div>
    );
}

/** Market cap, 24 h change, 24 h volume, holders, verified traders. */
function Metrics({c}: {c: CurveDetail}) {
    const tr = useCopy();
    const unit = quoteUnit(c);
    const {mcap, poolSpot} = usePrice(c);
    const summary = useChainSummary();
    const holders = useHolders(c.address);
    const server = summary.isSuccess ? summary.data : undefined;
    const change = changeBps(currentPrice({...c, poolSpot}), refPrice(c, server));
    const row = server?.curves[addrKey(c.address)];
    const dp = unit === "ETH" ? 4 : 0;
    const small = <span className="text-hanji-400 font-normal text-[12px]"> {unit}</span>;
    return (
        <div className="grid grid-cols-2 lg:grid-cols-[1.4fr_1fr_1.2fr_0.8fr_1fr] gap-3 min-w-0">
            <div className="col-span-2 lg:col-span-1 min-w-0">
                <Metric label={tr.curve.marketCap} big>
                    {mcap !== undefined ? fmtRound(mcap, dp, tr.locale) : "…"}
                    {small}
                </Metric>
            </div>
            <Metric label={tr.homeRows.changeCol(86400)}>
                <Change bps={change} />
            </Metric>
            <Metric label={tr.tokenPage.volume}>
                {server ? (
                    <>
                        {fmtRound(BigInt(row?.volume24h ?? "0"), dp, tr.locale)}
                        {small}
                    </>
                ) : (
                    <span className="text-hanji-400">–</span>
                )}
            </Metric>
            <Metric label={tr.tokenPage.holders}>{holders.isSuccess ? holders.data.total.toLocaleString(tr.locale) : <span className="text-hanji-400">–</span>}</Metric>
            <Metric label={tr.homeRows.cols.traders}>
                {c.verifiedBuyerCount}
                <span className="text-hanji-400 font-normal text-[12px]"> ({tr.curve.verifiedTradersNote})</span>
            </Metric>
        </div>
    );
}

/** "Dev holds n%": the Dev wallet's token balance over the total supply, floored to 0.01% like the
 *  holders tab (sharePct); exactly 0 -> "0%". Hidden when the read fails. */
function DevHolds({c}: {c: CurveDetail}) {
    const tr = useCopy();
    const bal = useReadContract({
        address: c.token,
        abi: MembershipTokenV3Abi,
        functionName: "balanceOf",
        args: [c.dev],
        chainId: giwaSepolia.id,
        query: {refetchInterval: 10_000},
    });
    if (bal.isError || bal.data === undefined) return null;
    const b = bal.data as bigint;
    return <Badge kind="neutral">{tr.tokenPage.devHolds(b === 0n ? "0" : sharePct(b, TOTAL_SUPPLY))}</Badge>;
}

/** "n tokens launched by this Dev" from the flow endpoint; hidden without a server answer. */
function DevLaunched({c}: {c: CurveDetail}) {
    const tr = useCopy();
    const f = useFlow(c.address);
    if (!f.isSuccess) return null;
    return <Badge kind="neutral">{tr.tokenPage.devLaunched(f.data.devLaunched)}</Badge>;
}

/** The Dev's nickname next to the Dev address (owner decision: Dev only). Plain text, never a link;
 *  nothing without a nickname or a server answer. */
function DevNickname({c}: {c: CurveDetail}) {
    const f = useFlow(c.address);
    const nick = f.isSuccess ? f.data.devNickname : null;
    if (!nick) return null;
    return <span className="text-hanji-100 whitespace-nowrap">{nick}</span>;
}

/** Last 24 h of non-Dev buys and sells: counts, amounts, a buy/sell ratio bar, verified wallets.
 *  Not rendered when the server does not answer; a same-height skeleton while loading. */
function FlowCard({c}: {c: CurveDetail}) {
    const tr = useCopy();
    const f = useFlow(c.address);
    if (f.isError) return null;
    if (!f.isSuccess) return <Skeleton h={148} />;
    const unit = quoteUnit(c);
    const dp = unit === "ETH" ? 4 : 0;
    const buyVol = BigInt(f.data.buys.volume);
    const sellVol = BigInt(f.data.sells.volume);
    const share = flowShare(buyVol, sellVol);
    const empty = f.data.buys.count + f.data.sells.count === 0;
    return (
        <section className="bg-ink-800 border border-ink-700 rounded-card p-4 sm:p-5 min-w-0 min-h-[148px]">
            <div className="flex items-baseline justify-between gap-3 mb-3">
                <h3 className="m-0 text-[15px] font-bold">{tr.tokenPage.flowTitle}</h3>
                <span className="text-[12px] text-hanji-400">{tr.tokenPage.flowNote}</span>
            </div>
            {empty ? (
                <p className="m-0 text-[13px] text-hanji-400">{tr.chain.chartEmpty}</p>
            ) : (
                <>
                    <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-[13px] tabular-nums mb-2">
                        <span>
                            <span className="text-success">{tr.tokenPage.buys(f.data.buys.count)}</span>
                            <span className="text-hanji-100"> · {fmtRound(buyVol, dp, tr.locale)} {unit}</span>
                        </span>
                        <span>
                            <span className="text-error">{tr.tokenPage.sells(f.data.sells.count)}</span>
                            <span className="text-hanji-100"> · {fmtRound(sellVol, dp, tr.locale)} {unit}</span>
                        </span>
                    </div>
                    {share !== null && (
                        <div role="img" aria-label={tr.tokenPage.flowAria(share, 100 - share)} className="flex h-2 rounded-full overflow-hidden bg-ink-700 mb-3">
                            <div className="bg-success" style={{width: `${share}%`}} />
                            <div className="bg-error" style={{width: `${100 - share}%`}} />
                        </div>
                    )}
                    <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-[12px] text-hanji-400 tabular-nums">
                        <span>{tr.tokenPage.verifiedBuyers(f.data.verifiedBuyers)}</span>
                        {f.data.verifiedSellers !== null && <span>{tr.tokenPage.verifiedSellers(f.data.verifiedSellers)}</span>}
                    </div>
                </>
            )}
        </section>
    );
}

function Header({c, imageUrl}: {c: CurveDetail; imageUrl?: string | null}) {
    const tr = useCopy();
    return (
        <div className="flex flex-col gap-3 min-w-0">
            <div className="flex items-center gap-4 min-w-0">
                <CurveAvatar char={c.symbol.slice(0, 1) || "馬"} imageUrl={imageUrl} size={64} />
                <div className="min-w-0 flex-1">
                    <h1 className="m-0 text-[24px] sm:text-[28px] font-bold break-all">{c.name}</h1>
                    <div className="text-[13px] text-hanji-400 truncate">
                        {c.symbol} · {quoteUnit(c)}
                    </div>
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 min-w-0 text-[12px]">
                <CopyAddress address={c.token} label={tr.tokenPage.copyLabel} />
                {!c.graduated && <PriorityBadge priorityUntil={c.priorityUntil} />}
                <DevHolds c={c} />
                <DevLaunched c={c} />
                <span className="inline-flex flex-wrap items-center gap-x-1.5 text-hanji-400 min-w-0">
                    {tr.curve.dev} <DevNickname c={c} /> <Link to={`/w/${c.dev}`} className="text-brass-400 hover:text-hanji-100">{shortAddr(c.dev)}</Link>
                </span>
            </div>
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
    // one bulk lookup for the traders on screen
    const nicks = useNicknames(rows.map((t) => t.trader));
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
                                {t.isDev && <Badge kind="partial">{tr.curve.dev}</Badge>}
                                {t.isDev && " "}
                                <WalletLink address={t.trader} nickname={nicks.get(addrKey(t.trader))} className="max-w-[160px] text-hanji-100 hover:text-brass-400" />
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
    // one bulk lookup for the wallets listed (not the bonding curve or the pool)
    const nicks = useNicknames((q.data?.holders ?? []).slice(0, 20).filter((h) => h.label !== "curve" && h.label !== "pool").map((h) => h.address));
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
                                {h.label === "curve" || h.label === "pool" ? (
                                    <ExtLink href={explorerAddr(h.address)}>{shortAddr(h.address)}</ExtLink>
                                ) : (
                                    <WalletLink address={h.address} nickname={nicks.get(addrKey(h.address))} className="max-w-[160px] text-brass-400 hover:text-hanji-100" />
                                )}
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

type TokenTab = "comments" | "trades" | "holders" | "info";
const TOKEN_TABS: TokenTab[] = ["comments", "trades", "holders", "info"];

/** Current price, contracts and the paired asset. */
function InfoTab({c}: {c: CurveDetail}) {
    const tr = useCopy();
    const unit = quoteUnit(c);
    const {spot, spotError} = usePrice(c);
    return (
        <div className="flex flex-col gap-3 min-w-0">
            <div className="grid grid-cols-2 gap-3">
                <Stat label={tr.curve.spot} value={spot !== undefined ? fmtSig(spot, 4, tr.locale) : spotError ? tr.curve.quoteError : "…"} unit={`${unit}${tr.curve.perToken}`} />
                <Stat label={tr.curve.quoteAsset} value={c.graduated && c.isEth ? "WETH" : unit} />
            </div>
            <Contracts c={c} />
        </div>
    );
}

/** Comments | Trades | Holders | Info. Only the selected tab is rendered (react-query keeps the data). */
function TokenTabs({c}: {c: CurveDetail}) {
    const tr = useCopy();
    const [tab, setTab] = useState<TokenTab>("comments");
    const holders = useHolders(c.address);
    return (
        <section className="min-w-0">
            <div role="tablist" className="grid grid-cols-4 border-b border-ink-700 mb-4">
                {TOKEN_TABS.map((t) => (
                    <button
                        key={t}
                        role="tab"
                        id={`token-tab-${t}`}
                        aria-selected={tab === t}
                        aria-controls={`token-panel-${t}`}
                        onClick={() => setTab(t)}
                        className={`min-h-[44px] px-1 text-[14px] whitespace-nowrap border-b-2 -mb-px ${tab === t ? "border-brass-400 text-hanji-100 font-semibold" : "border-transparent text-hanji-400 hover:text-hanji-100"}`}
                    >
                        {tr.tokenPage.tabs[t]}
                        {t === "holders" && holders.isSuccess && <span className="tabular-nums"> {holders.data.total}</span>}
                    </button>
                ))}
            </div>
            <div role="tabpanel" id={`token-panel-${tab}`} aria-labelledby={`token-tab-${tab}`} className="min-w-0">
                {tab === "comments" && <Comments curve={c.address} />}
                {tab === "trades" && <TradeHistory c={c} />}
                {tab === "holders" && <Holders c={c} />}
                {tab === "info" && <InfoTab c={c} />}
            </div>
        </section>
    );
}

/** Below lg: a bottom bar with buy / sell that jumps to the trade panel (hidden while it is on screen). */
function MobileTradeBar({panel, onPick}: {panel: React.RefObject<HTMLDivElement>; onPick: (s: "buy" | "sell") => void}) {
    const tr = useCopy();
    const [panelVisible, setPanelVisible] = useState(false);
    useEffect(() => {
        const el = panel.current;
        if (!el || typeof IntersectionObserver === "undefined") return;
        const io = new IntersectionObserver(([e]) => setPanelVisible(e.isIntersecting), {threshold: 0.15});
        io.observe(el);
        return () => io.disconnect();
    }, [panel]);
    if (panelVisible) return null;
    return (
        <div
            className="lg:hidden fixed inset-x-0 bottom-0 z-30 bg-ink-900 border-t border-ink-700 px-4 pt-3 grid grid-cols-2 gap-3"
            style={{paddingBottom: "calc(12px + env(safe-area-inset-bottom))"}}
        >
            <PrimaryBtn className="w-full" onClick={() => onPick("buy")}>
                {tr.curve.buy}
            </PrimaryBtn>
            <SecondaryBtn className="w-full" onClick={() => onPick("sell")}>
                {tr.curve.sell}
            </SecondaryBtn>
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
    useTitle(c ? titleOf(`${c.name} (${c.symbol})`) : DEFAULT_TITLE);
    const meta = useCurveMeta();
    const {address: account} = useAccount();
    // Trade side shared by the panel and the mobile bottom bar.
    const [side, setSide] = useState<"buy" | "sell">("buy");
    const panelRef = useRef<HTMLDivElement>(null);
    const pick = (s: "buy" | "sell") => {
        setSide(s);
        const el = panelRef.current;
        if (!el) return;
        el.scrollIntoView({behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start"});
        // the amount input is the panel's first decimal input
        el.querySelector<HTMLInputElement>('input[inputmode="decimal"]')?.focus({preventScroll: true});
    };

    // below lg the bottom padding leaves room for the fixed buy / sell bar (plus the iOS home indicator)
    const wrap = (node: React.ReactNode) => (
        <div className="max-w-page mx-auto px-4 sm:px-8 pt-8 sm:pt-10 pb-[calc(96px+env(safe-area-inset-bottom))] lg:pb-20">{node}</div>
    );

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
    // Below lg the two column wrappers are display:contents and `order-*` sets the one-column order:
    // header, metrics, meta, progress, chart, banner, panel, fixed panel, 24 h flow, tabs.
    return wrap(
        <div className="flex flex-col gap-5 sm:gap-6 lg:flex-row lg:items-start lg:gap-8 w-full min-w-0">
            <div className="contents lg:flex lg:flex-col lg:gap-6 lg:flex-1 lg:min-w-0">
                <Link to="/" className="order-0 text-[14px]">← {tr.curve.backToList}</Link>
                <div className="order-1 lg:order-none min-w-0">
                    <Header c={c} imageUrl={m?.imageUrl} />
                </div>
                <div className="order-2 lg:order-none min-w-0">
                    <Metrics c={c} />
                </div>
                {/* Dev only: unclaimed curve fees and [Claim] (below the metrics, above the chart) */}
                {isDev && (
                    <div className="order-2 lg:order-none min-w-0">
                        <DevFeeBand curve={c.address} isDev={isDev} accrued={c.devAccrued} isEth={c.isEth} graduated={c.graduated} />
                    </div>
                )}
                {/* description and links (Vercel Blob metadata); the Dev can add them once */}
                {(m || (meta.loaded && isDev)) && (
                    <div className="order-3 lg:order-none min-w-0">
                        {m && <MetaInfo m={m} />}
                        {!m && meta.loaded && isDev && <AddMeta c={c} />}
                    </div>
                )}
                {/* candle chart from the server index */}
                <div className="order-5 lg:order-none min-w-0">
                    <CandleChart curve={c.address} unit={c.graduated && c.isEth ? "WETH" : quoteUnit(c)} graduated={c.graduated} />
                </div>
                <div className="order-4 lg:order-none min-w-0">
                    <Progress c={c} />
                </div>
                <div className="order-10 lg:order-none min-w-0">
                    <TokenTabs c={c} />
                </div>
            </div>
            <div className="contents lg:flex lg:flex-col lg:gap-4 lg:w-[360px] lg:flex-none lg:sticky lg:top-6 lg:max-h-[calc(100vh-48px)] lg:overflow-y-auto">
                {/* v3.1: verified-only notice while the priority window is open */}
                {!c.graduated && (
                    <div className="order-6 lg:order-none min-w-0">
                        <PriorityBanner priorityUntil={c.priorityUntil} />
                    </div>
                )}
                <div ref={panelRef} className="order-7 lg:order-none min-w-0 scroll-mt-4">
                    <CurveTradePanel c={c} side={side} onSideChange={setSide} />
                </div>
                <div className="order-8 lg:order-none rounded-input px-4 py-3.5 text-[13px] text-hanji-100 border border-ink-700 bg-ink-900 text-center">
                    {tr.curve.fixedPanel}
                </div>
                <div className="order-9 lg:order-none min-w-0">
                    <FlowCard c={c} />
                </div>
            </div>
            <MobileTradeBar panel={panelRef} onPick={pick} />
        </div>
    );
}
