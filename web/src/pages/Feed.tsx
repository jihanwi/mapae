// /#/feed: recent trades of the wallets the connected wallet follows (decision 53), newest first,
// 50 per page with "Load more". No copy-trading, ranking or recommendation of any wallet.
// Buy / sell text colours follow the home live-trade list (success / error; up / down stay chart-only).
// Layout note (390px): each row wraps (flex-wrap, min-w-0, truncate), so nothing widens the page.
import {Link} from "react-router-dom";
import {useAccount} from "wagmi";
import {useCopy} from "../copy";
import {useCurves} from "../hooks/curves";
import {useFeed, useFollowCounts} from "../hooks/follow";
import {agoLabel, tradeAmount, tradeUnit, useNow} from "../components/feed";
import {WalletLink} from "../components/WalletLink";
import {fmt} from "../lib/format";
import {addrKey} from "../lib/address";
import {useTitle, titleOf} from "../lib/title";
import {Skeleton} from "../components/ui";

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
    if (!address) body = <p className="m-0 text-[14px] text-hanji-400">{f.feedConnect}</p>;
    else if (q.isError) body = <p className="m-0 text-[14px] text-hanji-400">{tr.chain.unavailable}</p>;
    else if (!q.isSuccess) body = <Skeleton h={240} />;
    else if (rows.length === 0)
        body = <p className="m-0 text-[14px] text-hanji-400">{counts.isSuccess && counts.data.following === 0 ? f.feedNoFollows : f.feedEmpty}</p>;
    else
        body = (
            <div className="bg-ink-800 border border-ink-700 rounded-card min-w-0">
                <ul className="m-0 p-0 list-none">
                    {rows.map((t) => {
                        const isEth = isEthOf.get(addrKey(t.curve)) ?? false;
                        const tt = {side: t.side, venue: t.venue, quoteAmount: BigInt(t.quoteAmount)};
                        return (
                            <li key={`${t.tx}:${t.logIndex}`} className="px-4 py-3 border-t border-ink-700 first:border-t-0 text-[13px] tabular-nums min-w-0">
                                <div className="flex items-center gap-2 min-w-0">
                                    <WalletLink address={t.trader} nickname={t.nickname} className="flex-none max-w-[40%] text-brass-400" />
                                    <span className={`flex-none ${t.side === "buy" ? "text-success" : "text-error"}`}>{t.side === "buy" ? tr.feed.buy : tr.feed.sell}</span>
                                    <Link to={`/t/${t.curve}`} className="min-w-0 truncate text-hanji-100 hover:text-brass-400">
                                        {t.name} ({t.symbol})
                                    </Link>
                                    <span className="ml-auto flex-none text-[12px] text-hanji-400">{agoLabel(tr, now, Number(t.ts))}</span>
                                </div>
                                <div className="mt-1 text-[12px] text-hanji-400 break-words">
                                    {fmt(BigInt(t.tokenAmount), 2, tr.locale)} {t.symbol} · {tradeAmount(tt, isEth, tr.locale)} {tradeUnit(tt, isEth)}
                                </div>
                            </li>
                        );
                    })}
                </ul>
                {q.hasNextPage && (
                    <button
                        onClick={() => void q.fetchNextPage()}
                        disabled={q.isFetchingNextPage}
                        className="w-full min-h-[44px] border-t border-ink-700 text-[13px] text-brass-400 hover:text-hanji-100 disabled:opacity-40"
                    >
                        {tr.chain.loadMore}
                    </button>
                )}
            </div>
        );

    return (
        <div className="max-w-page mx-auto px-4 sm:px-8 pt-8 sm:pt-10 pb-16 sm:pb-20 min-w-0">
            <div className="max-w-[720px] mx-auto w-full min-w-0 flex flex-col gap-4">
                <div>
                    <h1 className="m-0 mb-1 text-[24px] sm:text-[28px] font-bold">{f.feedTitle}</h1>
                    <p className="m-0 text-[14px] text-hanji-400">{f.feedSub}</p>
                </div>
                {body}
            </div>
        </div>
    );
}
