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
import {AUTO_RETRY_MS, INITIAL_GRACE_MS, retryTarget, tokenPageState} from "../lib/tokenPage";
import {PriorityBanner} from "../components/PriorityCountdown";
import {LaunchBadges} from "../components/LaunchStatus";
import {Comments} from "../components/Comments";
import {agoLabel, prefersReducedMotion, tradeAmount, tradeUnit, useNow} from "../components/feed";
import {Badge, Eyebrow, Gauge, Icon, NetError, PrimaryBtn, SecondaryBtn, Skeleton, Stat, StaleBand, UnderlineTabs} from "../components/ui";
import {CurveAvatar, draftValid, linkDomain, MetaFields, SaveStatus} from "../components/MetaForm";
import {API_BASE, CurveMeta, draftHasContent, emptyDraft, MetaDraft, useCurveMeta, useSaveMeta} from "../hooks/meta";
import {CurveTradePanel} from "../components/CurveTradePanel";
import {TrustSignals} from "../components/TrustSignals";
import {NonStandardTicker, useSameTicker} from "../components/TickerBadge";
import {normalizeTicker} from "../lib/ticker";
import {CopyAddress} from "../components/CopyAddress";
import {DevFeeBand} from "../components/DevFees";
import {WalletLink} from "../components/WalletLink";
import {useNicknames} from "../hooks/nicknames";
import {Change, pctLabel, quoteUnit} from "./Curves";
import {DEFAULT_TITLE, titleOf, useTitle} from "../lib/title";
import {opensShareText, shareLink, xIntentUrl} from "../lib/share";
import {useToast} from "../components/tx";

// Layout note: below lg one column of full-width blocks (w-full / min-w-0, no fixed widths; the two
// column wrappers are display:contents so `order-*` interleaves their blocks), metrics in 2 columns,
// four tabs that fit 390px, and a bottom buy/sell bar. From lg: left column (header, metrics, meta,
// chart, progress, tabs) and a sticky 360px right column (banner, trade panel, fixed panel).
// design-token-page: the header is image + serif name, one bordered button (address copy) and the
// Dev facts as text, quiet share buttons; the five metrics are one band (2 columns below xl, values
// never truncated); the progress sits at the bottom of the chart card; underline tabs; the fixed
// facts moved into the trust signals card.

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

/** One item of the metrics band: label (12px) over the value (.num 20px 500); never truncated. */
function Metric({label, children}: {label: string; children: React.ReactNode}) {
    return (
        <div className="min-w-0 xl:flex-auto xl:px-5 xl:border-l xl:border-ink-700 xl:first:border-l-0 xl:first:pl-0 xl:last:pr-0">
            <div className="text-[12px] text-hanji-400 mb-1">{label}</div>
            <div className="num text-[20px] font-medium text-hanji-100 flex flex-wrap items-baseline gap-x-1.5 break-all">{children}</div>
        </div>
    );
}

/** Market cap, 24 h change, 24 h volume, holders, verified traders: one band. Below xl two columns
 *  with 16px between rows (from xl one row with 1px dividers; the lg left column is too narrow for
 *  five untruncated values). */
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
    const small = <span className="font-sans font-normal text-[12px] text-hanji-400">{unit}</span>;
    const dash = <span className="text-hanji-400">–</span>;
    return (
        <div className="bg-ink-900 border border-ink-700 rounded-[14px] px-4 sm:px-5 py-[18px] grid grid-cols-2 gap-x-4 gap-y-4 xl:flex xl:gap-0 min-w-0">
            <Metric label={tr.curve.marketCap}>
                <span>{mcap !== undefined ? fmtRound(mcap, dp, tr.locale) : "…"}</span>
                {small}
            </Metric>
            <Metric label={tr.homeRows.changeCol(86400)}>
                <Change bps={change} />
            </Metric>
            <Metric label={tr.tokenPage.volume}>
                {server ? (
                    <>
                        <span>{fmtRound(BigInt(row?.volume24h ?? "0"), dp, tr.locale)}</span>
                        {small}
                    </>
                ) : (
                    dash
                )}
            </Metric>
            <Metric label={tr.tokenPage.holders}>{holders.isSuccess ? <span>{holders.data.total.toLocaleString(tr.locale)}</span> : dash}</Metric>
            <Metric label={tr.homeRows.cols.traders}>
                <span>{c.verifiedBuyerCount}</span>
                <span className="font-sans font-normal text-[12px] text-hanji-400">{tr.tokenPage.exclDev}</span>
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
    return <span className="whitespace-nowrap">{tr.tokenPage.devHolds(b === 0n ? "0" : sharePct(b, TOTAL_SUPPLY))}</span>;
}

/** "n tokens launched by this Dev" from the flow endpoint; hidden without a server answer. */
function DevLaunched({c}: {c: CurveDetail}) {
    const tr = useCopy();
    const f = useFlow(c.address);
    if (!f.isSuccess) return null;
    return <span className="whitespace-nowrap">{tr.tokenPage.devLaunched(f.data.devLaunched)}</span>;
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
                            <span className="text-hanji-100"> · <span className="num">{fmtRound(buyVol, dp, tr.locale)}</span> {unit}</span>
                        </span>
                        <span>
                            <span className="text-error">{tr.tokenPage.sells(f.data.sells.count)}</span>
                            <span className="text-hanji-100"> · <span className="num">{fmtRound(sellVol, dp, tr.locale)}</span> {unit}</span>
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
    // decision 54: other tokens with the same ticker (from the summary list already loaded)
    const same = useSameTicker(c.symbol, c.address);
    const avatarChar = c.symbol.slice(0, 1) || "馬";
    return (
        <div className="flex flex-col gap-3 min-w-0">
            <div className="flex items-center gap-4 sm:gap-5 min-w-0">
                <span className="sm:hidden flex-none">
                    <CurveAvatar char={avatarChar} imageUrl={imageUrl} size={64} />
                </span>
                <span className="hidden sm:inline-flex flex-none">
                    <CurveAvatar char={avatarChar} imageUrl={imageUrl} size={88} />
                </span>
                <div className="min-w-0 flex-1">
                    {/* long names wrap, never cut */}
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 min-w-0">
                        <h1 className="m-0 min-w-0 font-serif text-[28px] sm:text-[38px] font-bold leading-[1.15] [overflow-wrap:anywhere]">{c.name}</h1>
                        <span className="text-[15px] text-hanji-400 min-w-0 break-all">
                            {c.symbol} · {quoteUnit(c)}
                        </span>
                    </div>
                    {/* existing badges, as they were, under the name line */}
                    <div className="mt-2 text-[13px] text-hanji-400 flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0 empty:hidden">
                        <NonStandardTicker symbol={c.symbol} />
                        {same !== null && (
                            <Link to={`/?q=${encodeURIComponent(normalizeTicker(c.symbol))}`} className="text-brass-400 hover:text-hanji-100 whitespace-nowrap">
                                {tr.tokenPage.otherSameTicker(same)}
                            </Link>
                        )}
                        {/* v3.6: start countdown before started(), then the priority countdown; verified-only mark */}
                        <LaunchBadges c={c} started={c.started} />
                    </div>
                </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 min-w-0">
                <div className="flex flex-wrap items-center gap-x-[18px] gap-y-2 min-w-0 text-[13px] text-hanji-400">
                    <CopyAddress address={c.token} label={tr.tokenPage.copyLabel} variant="outline" />
                    <span className="inline-flex flex-wrap items-center gap-x-1.5 min-w-0">
                        {tr.curve.dev} <DevNickname c={c} />{" "}
                        <Link to={`/w/${c.dev}`} className="num text-brass-400 hover:text-hanji-100">
                            {shortAddr(c.dev)}
                        </Link>
                    </span>
                    <DevHolds c={c} />
                    <DevLaunched c={c} />
                </div>
                <ShareButtons c={c} />
            </div>
        </div>
    );
}

/** Copy the preview link (/t/<curve>) and post it on X (web intent): quiet buttons, a generic share
 *  icon (no X mark). */
function ShareButtons({c}: {c: CurveDetail}) {
    const tr = useCopy();
    const push = useToast();
    const link = shareLink(c.address, API_BASE, window.location.origin);
    const copy = async () => {
        try {
            if (!navigator.clipboard) throw new Error("no clipboard");
            await navigator.clipboard.writeText(link);
            push({kind: "success", text: tr.tokenPage.linkCopied});
        } catch (e) {
            console.error("copy failed", e);
            window.prompt(tr.tokenPage.copyLink, link);
        }
    };
    const quiet = "inline-flex items-center gap-1.5 min-h-[44px] px-2 text-[13px] text-hanji-400 no-underline hover:text-hanji-100";
    return (
        <div className="flex items-center gap-1 -mx-2">
            <button type="button" onClick={() => void copy()} className={quiet}>
                <Icon name="link" />
                {tr.tokenPage.copyLink}
            </button>
            <a
                // v3.6: before the start the post carries the opening time (English on both languages)
                href={xIntentUrl(!c.graduated && !c.started ? opensShareText(c.symbol, c.startTime) : `${c.name} (${c.symbol}) | MAPAE`, link)}
                target="_blank"
                rel="noopener noreferrer"
                className={quiet}
            >
                <Icon name="share" />
                {tr.tokenPage.shareX}
            </a>
        </div>
    );
}

/** Bottom of the chart card: label, "N% · X left", a 6px gauge; graduated: the badge and pool link. */
function ProgressFooter({c}: {c: CurveDetail}) {
    const tr = useCopy();
    const unit = quoteUnit(c);
    if (c.graduated) {
        return (
            <div className="min-w-0">
                <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                    <Eyebrow locale={tr.locale}>{tr.tokenPage.progressLabel}</Eyebrow>
                    <span className="flex items-center gap-3 flex-wrap text-[13px]">
                        <Badge kind="neutral">{tr.curve.graduated}</Badge>
                        {c.pool !== ZERO && <ExtLink href={explorerAddr(c.pool)}>{tr.curve.poolLink}</ExtLink>}
                    </span>
                </div>
                <Gauge committed={10_000n} target={10_000n} height={6} />
            </div>
        );
    }
    const bps = progressBps(c.virtualQuote, c.r);
    const left = grossForNet(costToSellOut(c.virtualQuote, c.r, c.s), BigInt(c.totalFeeBps));
    return (
        <div className="min-w-0">
            <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
                <Eyebrow locale={tr.locale}>{tr.tokenPage.progressLabel}</Eyebrow>
                <span className="text-[13px] text-hanji-400">
                    <span className="num text-hanji-100">{pctLabel(bps)}%</span> · <span className="num text-hanji-100">{fmtCeil(left, unit === "ETH" ? 6 : 0, tr.locale)}</span> {unit}{" "}
                    {tr.tokenPage.leftWord}
                </span>
            </div>
            <Gauge committed={bps} target={10_000n} height={6} />
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
                            <span className="num text-hanji-400 w-[72px] flex-none">{t.ts !== undefined ? agoLabel(tr, now, t.ts) : ""}</span>
                            <span className="flex-none">
                                {t.isDev && <Badge kind="partial">{tr.curve.dev}</Badge>}
                                {t.isDev && " "}
                                <WalletLink address={t.trader} nickname={nicks.get(addrKey(t.trader))} className={`max-w-[160px] text-hanji-100 hover:text-brass-400 ${nicks.get(addrKey(t.trader)) ? "" : "num"}`} />
                            </span>
                            <span className={`flex-none font-semibold ${t.side === "buy" ? "text-success" : "text-error"}`}>{t.side === "buy" ? tr.feed.buy : tr.feed.sell}</span>
                            {/* v3.1: buys made by a verified wallet (server: indexed status, browser: Buy.verified) */}
                            {t.side === "buy" && t.verified === true && <Badge kind="neutral">{tr.priority.verifiedTag}</Badge>}
                            <span className="text-hanji-100">
                                <span className="num">{fmt(t.tokenAmount, 2, tr.locale)}</span> {c.symbol}
                            </span>
                            <span className="text-hanji-100">
                                <span className="num">{tradeAmount(t, c.isEth, tr.locale)}</span> {tradeUnit(t, c.isEth)}
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
                                <span className="num text-hanji-400 w-6 flex-none text-right">{i + 1}</span>
                                {h.label === "curve" || h.label === "pool" ? (
                                    <ExtLink href={explorerAddr(h.address)}>
                                        <span className="num">{shortAddr(h.address)}</span>
                                    </ExtLink>
                                ) : (
                                    <WalletLink address={h.address} nickname={nicks.get(addrKey(h.address))} className={`max-w-[160px] text-brass-400 hover:text-hanji-100 ${nicks.get(addrKey(h.address)) ? "" : "num"}`} />
                                )}
                                {l && <Badge kind="neutral">{l}</Badge>}
                                <span className="num ml-auto flex-none text-hanji-100">{sharePct(BigInt(h.balance), TOTAL_SUPPLY)}%</span>
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
                    <ExtLink href={explorerAddr(a)}>
                        <span className="num">{shortAddr(a)}</span>
                    </ExtLink>
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
                <Stat
                    label={tr.curve.spot}
                    value={spot !== undefined ? <span className="num">{fmtSig(spot, 4, tr.locale)}</span> : spotError ? tr.curve.quoteError : "…"}
                    unit={`${unit}${tr.curve.perToken}`}
                />
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
            <UnderlineTabs
                className="mb-4"
                idPrefix="token"
                label={tr.tokenPage.tabsLabel}
                value={tab}
                onChange={setTab}
                items={TOKEN_TABS.map((t) => ({
                    key: t,
                    label: (
                        <>
                            {tr.tokenPage.tabs[t]}
                            {t === "holders" && holders.isSuccess && <span className="num font-normal text-hanji-400"> {holders.data.total}</span>}
                        </>
                    ),
                }))}
            />
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

/** True once `ms` passed since `key` (the page's address) was set. */
function useGraceOver(key: string | undefined, ms: number): boolean {
    const [over, setOver] = useState<string | undefined>(undefined);
    useEffect(() => {
        const id = setTimeout(() => setOver(key), ms);
        return () => clearTimeout(id);
    }, [key, ms]);
    return over === key && key !== undefined;
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
    // A network failure comes back as a successful query holding a "failure" entry (multicall), so
    // the entry decides whether the registry read failed.
    const regFailed = reg.isError || reg.data?.[0]?.status === "failure";
    // isCurve is read once; keep a known true through later failures of that read.
    const knownCurve = useRef<string | undefined>(undefined);
    if (isCurve && addr) knownCurve.current = addr;
    const known = knownCurve.current === addr;
    const {curve: c, isLoading, isError, stale, refetch} = useCurve(isCurve || known ? addr : undefined);
    const retry = () => {
        const t = retryTarget({isCurve, knownCurve: known});
        if (t !== "curve") void reg.refetch();
        if (t !== "registry") refetch();
    };
    const graceOver = useGraceOver(addr, INITIAL_GRACE_MS);
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

    const page = tokenPageState({
        validAddress: valid,
        isCurve: isCurve ?? (known ? true : undefined),
        registryError: regFailed && !known,
        curveError: isError,
        curveLoaded: !isLoading && !!c,
        // c survives a failed read only as the last good one (useCurve), so it means "had data"
        hadData: !!c,
        graceOver,
    });
    if (page === "notFound") {
        return wrap(
            <div className="text-center pt-8">
                <h1 className="m-0 mb-2 text-[22px] font-bold">{tr.curve.notFoundTitle}</h1>
                <p className="m-0 mb-6 text-[14px] text-hanji-400">{tr.curve.notFoundNote}</p>
                <Link to="/"><PrimaryBtn>{tr.curve.backToList}</PrimaryBtn></Link>
            </div>
        );
    }
    if (page === "error") return wrap(<NetError onRetry={retry} autoRetryMs={AUTO_RETRY_MS} />);
    if (page === "loading" || !c) return wrap(<Skeleton h={320} />);

    const m = meta.get(c.address);
    const isDev = !!account && account.toLowerCase() === c.dev.toLowerCase();
    // Below lg the two column wrappers are display:contents and `order-*` sets the one-column order:
    // header, metrics (+ trust signals), meta, chart (with progress), banner, panel, 24 h flow, tabs.
    return wrap(
        <div className="flex flex-col gap-5 sm:gap-6 lg:flex-row lg:items-start lg:gap-8 w-full min-w-0">
            <div className="contents lg:flex lg:flex-col lg:gap-6 lg:flex-1 lg:min-w-0">
                <Link to="/" className="order-0 text-[14px]">← {tr.curve.backToList}</Link>
                {page === "stale" && <StaleBand className="order-0" />}
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
                    <CandleChart
                        curve={c.address}
                        unit={c.graduated && c.isEth ? "WETH" : quoteUnit(c)}
                        virtualQuote={c.virtualQuote}
                        graduated={c.graduated}
                        dev={c.dev}
                        footer={<ProgressFooter c={c} />}
                    />
                </div>
                <div className="order-10 lg:order-none min-w-0">
                    <TokenTabs c={c} />
                </div>
            </div>
            <div className="contents lg:flex lg:flex-col lg:gap-4 lg:w-[360px] lg:flex-none lg:sticky lg:top-6 lg:max-h-[calc(100vh-48px)] lg:overflow-y-auto">
                {/* v3.1: verified-only notice while the priority window is open (v3.6: from the start on;
                    before it the panel itself shows the rules) */}
                {!c.graduated && c.started && (
                    <div className="order-6 lg:order-none min-w-0">
                        <PriorityBanner priorityUntil={c.priorityUntil} capTokens={c.priorityMaxHolding} verifiedOnly={c.verifiedOnly} />
                    </div>
                )}
                <div ref={panelRef} className="order-7 lg:order-none min-w-0 scroll-mt-4">
                    <CurveTradePanel c={c} side={side} onSideChange={setSide} paused={page === "stale"} />
                </div>
                {/* trust signals: under the trade panel from lg, under the metrics below lg */}
                <div className="order-2 lg:order-none min-w-0">
                    <TrustSignals curve={c.address} />
                </div>
                <div className="order-9 lg:order-none min-w-0">
                    <FlowCard c={c} />
                </div>
            </div>
            <MobileTradeBar panel={panelRef} onPick={pick} />
        </div>
    );
}
