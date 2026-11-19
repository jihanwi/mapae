// /#/feed: recent trades of the wallets the connected wallet follows (decision 53), newest first,
// 50 per page with "Load more". No copy-trading, ranking or recommendation of any wallet.
// Buy / sell text colours follow the home live-trade list (success / error; up / down stay chart-only).
// W-T65 row: initial circle 40px | name + (side, token, ticker) | amount + unit over the token
// amount | elapsed time (fixed width). Layout note (390px): the name column shrinks (truncate);
// the amount and the time are never cut. When the name column and the amount do not fit on one
// line the amount group wraps under the name (flex-wrap), so nothing widens the page.
import {Link} from "react-router-dom";
import {useAccount} from "wagmi";
import {useCopy} from "../copy";
import {useCurves} from "../hooks/curves";
import {useFeed, useFollowCounts} from "../hooks/follow";
import {agoLabel, tradeAmount, tradeUnit, useNow} from "../components/feed";
import {WalletLink} from "../components/WalletLink";
import {InitialCircle} from "../components/InitialCircle";
import {fmt} from "../lib/format";
import {addrKey} from "../lib/address";
import {useTitle, titleOf} from "../lib/title";
import {Skeleton} from "../components/ui";

/** A state line (connect a wallet, no follows, empty feed, unavailable) centred in a card. */
function StateCard({children}: {children: React.ReactNode}) {
    return (
        <div className="rounded-[14px] border border-ink-700 bg-ink-800 p-7 text-center">
            <p className="m-0 text-[14px] text-hanji-400 break-keep">{children}</p>
        </div>
    );
}

export default function Feed() {
    const tr = useCopy();
    const f = tr.follow;
    useTitle(titleOf(f.feedTitle));
    const {address} = useAccount();
    const counts = useFollowCounts(address ?? "", undefined);
    const q = useFeed(address);
    const {curves} = useCurves();
    const isEthOf = new Map(curves.map((c) => [addrKey(c.address), c.isEth]));
    const now = useNow();
    const rows = q.data?.pages.flatMap((p) => p.trades) ?? [];

    let body: React.ReactNode;
    if (!address) body = <StateCard>{f.feedConnect}</StateCard>;
    else if (q.isError) body = <StateCard>{tr.chain.unavailable}</StateCard>;
    else if (!q.isSuccess) body = <Skeleton h={240} />;
    else if (rows.length === 0) body = <StateCard>{counts.isSuccess && counts.data.following === 0 ? f.feedNoFollows : f.feedEmpty}</StateCard>;
    else
        body = (
            <div className="min-w-0">
                <ul className="m-0 p-0 list-none border-y border-ink-800 divide-y divide-ink-800">
                    {rows.map((t) => {
                        const isEth = isEthOf.get(addrKey(t.curve)) ?? false;
                        const tt = {side: t.side, venue: t.venue, quoteAmount: BigInt(t.quoteAmount)};
                        return (
                            <li key={`${t.tx}:${t.logIndex}`} className="flex items-center gap-3 px-5 py-4 min-w-0">
                                <InitialCircle nickname={t.nickname} address={t.trader} size={40} />
                                <div className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-1 min-w-0">
                                    <div className="flex-1 basis-[140px] min-w-0">
                                        <WalletLink
                                            address={t.trader}
                                            nickname={t.nickname}
                                            className={`text-[14.5px] font-semibold text-hanji-100 hover:text-brass-400 ${t.nickname ? "" : "num"}`}
                                        />
                                        <div className="flex items-baseline gap-1.5 min-w-0 text-[14px]">
                                            <span className={`flex-none font-semibold ${t.side === "buy" ? "text-success" : "text-error"}`}>{t.side === "buy" ? tr.feed.buy : tr.feed.sell}</span>
                                            <Link to={`/t/${t.curve}`} className="min-w-0 truncate font-semibold text-hanji-100 hover:text-brass-400">
                                                {t.name}
                                            </Link>
                                            <span className="flex-none max-w-[40%] truncate text-hanji-400">{t.symbol}</span>
                                        </div>
                                    </div>
                                    <div className="flex-none ml-auto text-right">
                                        <div className="whitespace-nowrap">
                                            <span className="num text-[14.5px] font-medium text-hanji-100">{tradeAmount(tt, isEth, tr.locale)}</span>{" "}
                                            <span className="text-[12px] text-hanji-400">{tradeUnit(tt, isEth)}</span>
                                        </div>
                                        <div className="num text-[12px] text-hanji-400 whitespace-nowrap">
                                            {fmt(BigInt(t.tokenAmount), 2, tr.locale)} {t.symbol}
                                        </div>
                                    </div>
                                </div>
                                <span className="num flex-none w-[76px] text-right text-[12.5px] text-hanji-400 whitespace-nowrap">{agoLabel(tr, now, Number(t.ts))}</span>
                            </li>
                        );
                    })}
                </ul>
                {q.hasNextPage && (
                    <button
                        onClick={() => void q.fetchNextPage()}
                        disabled={q.isFetchingNextPage}
                        className="w-full min-h-[44px] border-b border-ink-800 text-[13px] text-brass-400 hover:text-hanji-100 disabled:opacity-40"
                    >
                        {tr.chain.loadMore}
                    </button>
                )}
            </div>
        );

    return (
        <div className="max-w-page mx-auto px-4 sm:px-8 pt-8 sm:pt-10 pb-16 sm:pb-20 min-w-0">
            <div className="max-w-[720px] mx-auto w-full min-w-0 flex flex-col gap-5">
                <div>
                    <h1 className="m-0 mb-1.5 font-serif font-bold text-[28px] sm:text-[40px] leading-tight">{f.feedTitle}</h1>
                    <p className="m-0 text-[15px] text-hanji-400">{f.feedSub}</p>
                </div>
                {body}
            </div>
        </div>
    );
}
