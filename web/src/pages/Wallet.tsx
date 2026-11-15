// Public wallet profile (/w/:address): nickname (public by owner decision 2026-11-15), holdings with
// average-cost P&L, tokens launched, trades. Real names are never stored or shown.
// Layout note (390px): every row is a min-w-0 flex row with truncation; from lg the holdings rows
// become a five-column grid. The three tabs fit one line. No fixed widths wider than the viewport.
import {useEffect, useState} from "react";
import {Link, useNavigate, useParams} from "react-router-dom";
import {useQueryClient} from "@tanstack/react-query";
import {useAccount} from "wagmi";
import {useCopy} from "../copy";
import {CurveInfo, useCurves} from "../hooks/curves";
import {useActivity} from "../hooks/activity";
import {useChainSummary} from "../hooks/chainData";
import {useCurveMeta} from "../hooks/meta";
import {useNickname} from "../hooks/comments";
import {useIsVerified, useWalletBalances, useWalletProfile, useWalletTrades, walletKey} from "../hooks/wallet";
import {normalizeAddressParam} from "../lib/address";
import {sharePct} from "../lib/chainMerge";
import {marketCap} from "../lib/activity";
import {progressBps, TOTAL_SUPPLY} from "../lib/curveMath";
import {currentPrice} from "../lib/homeList";
import {fmt, fmtDateTime, fmtRound, shortAddr} from "../lib/format";
import {holdingValue, mergeBrowserTrades, parsePosition, pnl, Position, splitHoldings, totals, Unit} from "../lib/wallet";
import {explorerAddr, explorerTx} from "../config/chain";
import {agoLabel, tradeAmount, tradeUnit, useNow} from "../components/feed";
import {Badge, Gauge, PrimaryBtn, SecondaryBtn} from "../components/ui";
import {CurveAvatar} from "../components/MetaForm";
import {CopyAddress} from "../components/CopyAddress";
import {useNicknameModal} from "../components/NicknameModal";
import {pctLabel, quoteUnit} from "./Curves";

type Address = `0x${string}`;
const lc = (a: string) => a.toLowerCase() as Address;
const dpOf = (u: Unit) => (u === "ETH" ? 4 : 0);

function ExtLink({href, children}: {href: string; children: React.ReactNode}) {
    return (
        <a href={href} target="_blank" rel="noreferrer" className="text-brass-400 hover:text-hanji-100">
            {children}
        </a>
    );
}

/** Signed P&L: "+" with text-success, "-" with text-error, 0 plain, "–" when unknown. */
function Pnl({v, unit, bps}: {v: bigint | undefined; unit: Unit; bps?: bigint}) {
    const tr = useCopy();
    if (v === undefined) return <span className="text-hanji-400">–</span>;
    const abs = v < 0n ? -v : v;
    const sign = v > 0n ? "+" : v < 0n ? "-" : "";
    const cls = v > 0n ? "text-success" : v < 0n ? "text-error" : "text-hanji-100";
    let pct = "";
    if (bps !== undefined) {
        const b = bps < 0n ? -bps : bps;
        const tenths = (b + 5n) / 10n;
        pct = ` (${sign}${tenths / 10n}.${tenths % 10n}%)`;
    }
    return (
        <span className={cls}>
            {sign}
            {fmtRound(abs, dpOf(unit), tr.locale)} {unit}
            {pct}
        </span>
    );
}

type Row = {
    c: CurveInfo;
    unit: Unit;
    balance: bigint;
    value?: bigint;
    realized?: bigint;
    unrealized?: bigint;
    unrealizedBps?: bigint;
    traded: boolean;
};

function HoldingRow({r, imageUrl}: {r: Row; imageUrl?: string | null}) {
    const tr = useCopy();
    const value = r.value !== undefined ? `${fmtRound(r.value, dpOf(r.unit), tr.locale)} ${r.unit}` : "–";
    return (
        <Link to={`/t/${r.c.address}`} className="block no-underline text-hanji-100 px-4 py-2.5 min-h-[56px] border-t border-ink-700 first:border-t-0 hover:bg-ink-900 min-w-0">
            <div className="flex items-center gap-3 min-w-0 lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(0,0.6fr)] lg:gap-4">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                    <CurveAvatar char={r.c.symbol.slice(0, 1) || "馬"} imageUrl={imageUrl} size={36} />
                    <div className="min-w-0">
                        <div className="font-semibold truncate text-[14px]">{r.c.name}</div>
                        <div className="text-[12px] text-hanji-400 truncate tabular-nums">
                            {r.c.symbol}
                            <span className="lg:hidden"> · {fmt(r.balance, 2, tr.locale)}</span>
                        </div>
                    </div>
                </div>
                <div className="hidden lg:block text-right text-[13px] tabular-nums truncate">{fmt(r.balance, 2, tr.locale)}</div>
                <div className="flex-none text-right tabular-nums min-w-0 max-w-[50%] lg:max-w-none">
                    <div className="text-[13px] font-semibold truncate">{value}</div>
                    <div className="text-[12px] truncate lg:hidden">
                        <Pnl v={r.unrealized} unit={r.unit} bps={r.unrealizedBps} />
                    </div>
                </div>
                <div className="hidden lg:block text-right text-[13px] tabular-nums truncate">
                    <Pnl v={r.unrealized} unit={r.unit} bps={r.unrealizedBps} />
                </div>
                <div className="hidden lg:block text-right text-[12px] text-hanji-400 tabular-nums">{sharePct(r.balance, TOTAL_SUPPLY)}%</div>
            </div>
        </Link>
    );
}

function SoldRow({r, imageUrl}: {r: Row; imageUrl?: string | null}) {
    return (
        <Link to={`/t/${r.c.address}`} className="flex items-center gap-3 no-underline text-hanji-100 px-4 py-2.5 min-h-[56px] border-t border-ink-700 first:border-t-0 hover:bg-ink-900 min-w-0">
            <CurveAvatar char={r.c.symbol.slice(0, 1) || "馬"} imageUrl={imageUrl} size={36} />
            <div className="min-w-0 flex-1">
                <div className="font-semibold truncate text-[14px]">{r.c.name}</div>
                <div className="text-[12px] text-hanji-400 truncate">{r.c.symbol}</div>
            </div>
            <div className="flex-none text-right text-[13px] tabular-nums max-w-[50%] truncate">
                <Pnl v={r.realized} unit={r.unit} />
            </div>
        </Link>
    );
}

function HoldingsTab({holding, soldOut, meta, loading}: {holding: Row[]; soldOut: Row[]; meta: ReturnType<typeof useCurveMeta>; loading: boolean}) {
    const tr = useCopy();
    const h = tr.walletPage.cols;
    if (holding.length === 0 && soldOut.length === 0 && loading) return <p className="m-0 text-[13px] text-hanji-400">…</p>;
    if (holding.length === 0 && soldOut.length === 0) return <p className="m-0 text-[14px] text-hanji-400">{tr.walletPage.emptyHeld}</p>;
    return (
        <div className="flex flex-col gap-5 min-w-0">
            {holding.length > 0 && (
                <section className="min-w-0">
                    <h3 className="m-0 mb-2 text-[14px] font-semibold">{tr.walletPage.groups.holding}</h3>
                    <div className="bg-ink-800 border border-ink-700 rounded-card overflow-hidden min-w-0">
                        <div className="hidden lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(0,0.6fr)] lg:gap-4 px-4 py-2 border-b border-ink-700 text-[12px] text-hanji-400">
                            <span>{h.token}</span>
                            <span className="text-right">{h.balance}</span>
                            <span className="text-right">{h.value}</span>
                            <span className="text-right">{h.unrealized}</span>
                            <span className="text-right">{h.share}</span>
                        </div>
                        {holding.map((r) => (
                            <HoldingRow key={r.c.address} r={r} imageUrl={meta.get(r.c.address)?.imageUrl} />
                        ))}
                    </div>
                </section>
            )}
            {soldOut.length > 0 && (
                <section className="min-w-0">
                    <h3 className="m-0 mb-2 text-[14px] font-semibold">{tr.walletPage.groups.soldOut}</h3>
                    <div className="bg-ink-800 border border-ink-700 rounded-card overflow-hidden min-w-0">
                        {soldOut.map((r) => (
                            <SoldRow key={r.c.address} r={r} imageUrl={meta.get(r.c.address)?.imageUrl} />
                        ))}
                    </div>
                </section>
            )}
            <p className="m-0 text-[12px] text-hanji-400">{tr.walletPage.note}</p>
        </div>
    );
}

function LaunchedTab({launched, byCurve, meta}: {launched: {curve: string; name: string; symbol: string; createdTs: string}[]; byCurve: Map<Address, CurveInfo>; meta: ReturnType<typeof useCurveMeta>}) {
    const tr = useCopy();
    if (launched.length === 0) return <p className="m-0 text-[14px] text-hanji-400">{tr.walletPage.emptyLaunched}</p>;
    return (
        <div className="bg-ink-800 border border-ink-700 rounded-card overflow-hidden min-w-0">
            {launched.map((l) => {
                const c = byCurve.get(lc(l.curve));
                const bps = c ? (c.graduated ? 10_000n : progressBps(c.virtualQuote, c.r)) : undefined;
                const m = c ? marketCap(c, c.poolSpot) : undefined;
                return (
                    <Link key={l.curve} to={`/t/${c?.address ?? l.curve}`} className="flex items-center gap-3 no-underline text-hanji-100 px-4 py-2.5 min-h-[56px] border-t border-ink-700 first:border-t-0 hover:bg-ink-900 min-w-0">
                        <CurveAvatar char={l.symbol.slice(0, 1) || "馬"} imageUrl={meta.get(c?.address ?? (l.curve as Address))?.imageUrl} size={36} />
                        <div className="min-w-0 flex-1">
                            <div className="font-semibold truncate text-[14px]">{l.name}</div>
                            <div className="text-[12px] text-hanji-400 truncate tabular-nums">
                                {l.symbol} · {fmtDateTime(BigInt(l.createdTs || "0"), tr.locale)}
                            </div>
                            {bps !== undefined && (
                                <div className="mt-1.5 flex items-center gap-2">
                                    <div className="flex-1 min-w-0">
                                        <Gauge committed={bps} target={10_000n} height={3} />
                                    </div>
                                    <span className="text-[11px] text-hanji-400 tabular-nums flex-none">{pctLabel(bps)}%</span>
                                </div>
                            )}
                        </div>
                        <div className="flex-none text-right text-[13px] tabular-nums max-w-[45%] truncate">
                            {c && m !== undefined ? `${fmtRound(m, c.isEth ? 4 : 0, tr.locale)} ${quoteUnit(c)}` : "–"}
                        </div>
                    </Link>
                );
            })}
        </div>
    );
}

function TradesTab({address, byCurve}: {address: Address; byCurve: Map<Address, CurveInfo>}) {
    const tr = useCopy();
    const q = useWalletTrades(address);
    const now = useNow();
    if (q.isError) return <p className="m-0 text-[13px] text-hanji-400">{tr.chain.unavailable}</p>;
    if (!q.isSuccess) return <p className="m-0 text-[13px] text-hanji-400">…</p>;
    const rows = q.data.pages.flatMap((p) => p.trades);
    if (rows.length === 0) return <p className="m-0 text-[13px] text-hanji-400">{tr.chain.chartEmpty}</p>;
    return (
        <div className="bg-ink-900 border border-ink-700 rounded-card p-4 sm:p-6 min-w-0">
            <ul className="m-0 p-0 list-none">
                {rows.map((t) => {
                    const c = byCurve.get(lc(t.curve));
                    const isEth = c?.isEth ?? false;
                    const tt = {side: t.side, venue: t.venue, quoteAmount: BigInt(t.quoteAmount)};
                    return (
                        <li key={`${t.tx}:${t.logIndex}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 border-t border-ink-700 first:border-t-0 text-[13px] tabular-nums min-w-0">
                            <span className="text-hanji-400 w-[72px] flex-none">{agoLabel(tr, now, Number(t.ts))}</span>
                            <Link to={`/t/${c?.address ?? t.curve}`} className="flex-none font-semibold text-hanji-100 hover:text-brass-400">
                                {t.symbol}
                            </Link>
                            <span className={`flex-none font-semibold ${t.side === "buy" ? "text-success" : "text-error"}`}>{t.side === "buy" ? tr.feed.buy : tr.feed.sell}</span>
                            {t.side === "buy" && t.verified === true && <Badge kind="neutral">{tr.priority.verifiedTag}</Badge>}
                            <span className="text-hanji-100">
                                {fmt(BigInt(t.tokenAmount), 2, tr.locale)} {t.symbol}
                            </span>
                            <span className="text-hanji-100">
                                {tradeAmount(tt, isEth, tr.locale)} {tradeUnit(tt, isEth)}
                            </span>
                            <span className="ml-auto flex-none">
                                <ExtLink href={explorerTx(t.tx)}>{tr.feed.txLink}</ExtLink>
                            </span>
                        </li>
                    );
                })}
            </ul>
            {q.hasNextPage && (
                <button
                    type="button"
                    disabled={q.isFetchingNextPage}
                    onClick={() => void q.fetchNextPage()}
                    className="mt-3 w-full min-h-[40px] rounded-input border border-ink-700 text-[13px] text-hanji-100 hover:border-brass-600 disabled:opacity-40"
                >
                    {tr.chain.loadMore}
                </button>
            )}
        </div>
    );
}

type WalletTab = "holdings" | "launched" | "trades";

function WalletView({address}: {address: Address}) {
    const tr = useCopy();
    const qc = useQueryClient();
    const {address: account} = useAccount();
    const own = !!account && lc(account) === lc(address);
    const profile = useWalletProfile(address);
    const {curves, isLoading: curvesLoading} = useCurves();
    const activity = useActivity();
    const summary = useChainSummary();
    const meta = useCurveMeta();
    const verified = useIsVerified(address);
    const openNickname = useNicknameModal();
    const [tab, setTab] = useState<WalletTab>("holdings");

    // The nickname modal updates the nickname cache; refetch the profile so the header follows.
    const myNick = useNickname(own ? address : undefined);
    const serverNick = profile.data?.nickname ?? null;
    useEffect(() => {
        if (own && myNick.isSuccess && (myNick.data ?? null) !== serverNick) void qc.invalidateQueries({queryKey: walletKey(address)});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [myNick.data]);

    const byCurve = new Map(curves.map((c) => [lc(c.address), c]));
    const byToken = new Map(curves.map((c) => [lc(c.token), c]));
    const serverOk = profile.isSuccess;
    const indexedBlock = summary.isSuccess && summary.data.indexedBlock !== null ? BigInt(summary.data.indexedBlock) : null;
    const info = (curve: Address) => {
        const c = byCurve.get(curve);
        return c ? {token: c.token, name: c.name, symbol: c.symbol} : undefined;
    };
    const positions: Position[] = serverOk ? mergeBrowserTrades(profile.data.positions.map(parsePosition), activity.trades, address, indexedBlock, info) : [];
    const posByCurve = new Map(positions.map((p) => [p.curve, p]));
    // Tokens to read: received + traded (server) + traded in the browser window.
    const mineInBrowser = activity.trades.filter((t) => lc(t.trader) === lc(address));
    const tokenSet = new Set<string>([
        ...(profile.data?.received.map((r) => lc(r.token)) ?? []),
        ...positions.map((p) => p.token),
        ...mineInBrowser.map((t) => byCurve.get(lc(t.curve))?.token).filter((t): t is Address => !!t).map(lc),
    ]);
    const bal = useWalletBalances(address, [...tokenSet]);
    const balances = bal.balances;
    // still waiting for the profile, the curve list or the balances (not "nothing held")
    const loading = profile.isLoading || curvesLoading || bal.isLoading;

    const rows: Row[] = [];
    for (const t of tokenSet) {
        const c = byToken.get(lc(t));
        const balance = balances.get(lc(t));
        if (!c || balance === undefined) continue;
        const unit: Unit = c.isEth ? "ETH" : "KRWs";
        const price = currentPrice(c);
        const pos = posByCurve.get(lc(c.address));
        const p = serverOk && pos ? pnl(pos, balance, price) : undefined;
        rows.push({
            c,
            unit,
            balance,
            value: holdingValue(balance, price),
            realized: p?.realized,
            unrealized: p?.unrealized,
            unrealizedBps: p?.unrealizedBps,
            traded: !!pos && (pos.buyTokens > 0n || pos.sellTokens > 0n),
        });
    }
    const {holding, soldOut} = splitHoldings(rows);
    const sums = totals(rows);
    const launchedCount = serverOk ? profile.data.launched.length : curves.filter((c) => lc(c.dev) === lc(address)).length;
    const nick = profile.data?.nickname ?? null;

    return (
        <div className="flex flex-col gap-5 sm:gap-6 min-w-0">
            {/* header */}
            <div className="flex flex-col gap-2 min-w-0">
                {own && <span className="text-[12px] text-brass-400">{tr.walletPage.mine}</span>}
                <div className="flex items-center gap-3 flex-wrap min-w-0">
                    <h1 className="m-0 text-[24px] sm:text-[28px] font-bold break-all min-w-0">{nick ?? shortAddr(address)}</h1>
                    {verified.data === true && <Badge kind="neutral">{tr.priority.verifiedTag}</Badge>}
                    {own && (
                        <SecondaryBtn className="!py-2 !px-3 !text-[13px] min-h-[36px]" onClick={openNickname}>
                            {tr.social.nicknameButton}
                        </SecondaryBtn>
                    )}
                </div>
                <div className="flex items-center gap-x-3 gap-y-2 flex-wrap min-w-0 text-[13px]">
                    {nick && <span className="text-hanji-400 tabular-nums">{shortAddr(address)}</span>}
                    <CopyAddress address={address} label={`${shortAddr(address)} ${tr.tokenPage.copy}`} />
                    <ExtLink href={explorerAddr(address)}>{tr.walletPage.explorer}</ExtLink>
                </div>
            </div>
            {/* summary per quote unit */}
            {sums.size > 0 && (
                <div className="flex flex-col gap-3 min-w-0">
                    {(["KRWs", "ETH"] as const)
                        .filter((u) => sums.has(u))
                        .map((u) => {
                            const s = sums.get(u)!;
                            return (
                                <div key={u} className="grid grid-cols-3 gap-3 min-w-0">
                                    <div className="bg-ink-900 rounded-stat px-3.5 py-3 min-w-0">
                                        <div className="text-[12px] text-hanji-400 mb-1 truncate">{tr.walletPage.value}</div>
                                        <div className="text-[15px] font-semibold tabular-nums truncate">{s.value !== undefined ? `${fmtRound(s.value, dpOf(u), tr.locale)} ${u}` : "–"}</div>
                                    </div>
                                    <div className="bg-ink-900 rounded-stat px-3.5 py-3 min-w-0">
                                        <div className="text-[12px] text-hanji-400 mb-1 truncate">{tr.walletPage.unrealized}</div>
                                        <div className="text-[15px] font-semibold tabular-nums truncate">
                                            <Pnl v={s.unrealized} unit={u} />
                                        </div>
                                    </div>
                                    <div className="bg-ink-900 rounded-stat px-3.5 py-3 min-w-0">
                                        <div className="text-[12px] text-hanji-400 mb-1 truncate">{tr.walletPage.realized}</div>
                                        <div className="text-[15px] font-semibold tabular-nums truncate">
                                            <Pnl v={s.realized} unit={u} />
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                </div>
            )}
            <p className="m-0 text-[13px] text-hanji-400 tabular-nums">{tr.walletPage.counts(holding.length, launchedCount)}</p>
            {/* tabs */}
            <section className="min-w-0">
                <div role="tablist" className="grid grid-cols-3 border-b border-ink-700 mb-4">
                    {(["holdings", "launched", "trades"] as const).map((t) => (
                        <button
                            key={t}
                            role="tab"
                            id={`wallet-tab-${t}`}
                            aria-selected={tab === t}
                            aria-controls={`wallet-panel-${t}`}
                            onClick={() => setTab(t)}
                            className={`min-h-[44px] px-1 text-[14px] whitespace-nowrap border-b-2 -mb-px ${tab === t ? "border-brass-400 text-hanji-100 font-semibold" : "border-transparent text-hanji-400 hover:text-hanji-100"}`}
                        >
                            {tr.walletPage.tabs[t]}
                        </button>
                    ))}
                </div>
                <div role="tabpanel" id={`wallet-panel-${tab}`} aria-labelledby={`wallet-tab-${tab}`} className="min-w-0">
                    {tab === "holdings" && <HoldingsTab holding={holding} soldOut={soldOut} meta={meta} loading={loading} />}
                    {tab === "launched" &&
                        (serverOk ? (
                            <LaunchedTab launched={profile.data.launched} byCurve={byCurve} meta={meta} />
                        ) : profile.isError ? (
                            <p className="m-0 text-[13px] text-hanji-400">{tr.chain.unavailable}</p>
                        ) : (
                            <p className="m-0 text-[13px] text-hanji-400">…</p>
                        ))}
                    {tab === "trades" && <TradesTab address={address} byCurve={byCurve} />}
                </div>
            </section>
        </div>
    );
}

export default function Wallet() {
    const tr = useCopy();
    const {address: param} = useParams();
    const addr = normalizeAddressParam(param) ?? undefined;
    const navigate = useNavigate();
    useEffect(() => {
        if (addr && param !== addr) navigate(`/w/${addr}`, {replace: true});
    }, [addr, param, navigate]);
    return (
        <div className="max-w-page mx-auto px-4 sm:px-8 pt-8 sm:pt-10 pb-16 sm:pb-20 min-w-0">
            {addr ? (
                <WalletView key={addr} address={addr} />
            ) : (
                <div className="text-center pt-8">
                    <h1 className="m-0 mb-2 text-[22px] font-bold">{tr.walletPage.notFoundTitle}</h1>
                    <p className="m-0 mb-6 text-[14px] text-hanji-400">{tr.walletPage.notFoundNote}</p>
                    <Link to="/">
                        <PrimaryBtn>{tr.curve.backToList}</PrimaryBtn>
                    </Link>
                </div>
            )}
        </div>
    );
}
