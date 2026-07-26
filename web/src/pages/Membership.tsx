import {Link} from "react-router-dom";
import {useAccount, useReadContracts} from "wagmi";
import {Abi} from "viem";
import {copy} from "../copy";
import {useOfferings, OfferingInfo} from "../hooks";
import {Medallion, PrimaryBtn, Skeleton} from "../components/ui";
import {fmt} from "../lib/format";
import {creatorOf} from "../lib/creators";
import {TIERS, tierIndex, toNextTier} from "../lib/tier";
import {MembershipTokenAbi} from "../contracts/abis";
import {explorerAddr} from "../config/chain";

export default function Membership() {
    const {address} = useAccount();
    const {offerings, isLoading} = useOfferings();
    const zero = "0x0000000000000000000000000000000000000000" as const;
    const balances = useReadContracts({
        contracts: offerings.map((o) => ({
            address: o.token, abi: MembershipTokenAbi as Abi, functionName: "balanceOf", args: [address ?? zero],
        })),
        query: {enabled: !!address && offerings.length > 0, refetchInterval: 15_000},
    });

    const holdings = offerings
        .map((o, i) => ({o, balance: (balances.data?.[i]?.result as bigint) ?? 0n}))
        .filter((h) => h.balance > 0n && h.o.totalSupply > 0n);

    if (isLoading || (address && balances.isLoading)) {
        return <div className="max-w-page mx-auto px-4 sm:px-8 pt-12"><Skeleton h={300} /></div>;
    }

    return (
        <div className="max-w-page mx-auto px-4 sm:px-8 pt-10 pb-20">
            <h1 className="m-0 mb-8 text-[28px] font-bold">{copy.membership.title}</h1>
            {holdings.length === 0 ? <Empty /> : holdings.map((h) => <Holding key={h.o.address} o={h.o} balance={h.balance} />)}
            <Ladder holdings={holdings} />
        </div>
    );
}

function Holding({o, balance}: {o: OfferingInfo; balance: bigint}) {
    const c = creatorOf(o);
    const idx = tierIndex(balance, o.totalSupply);
    const tier = idx >= 0 ? TIERS[idx] : null;
    const next = toNextTier(balance, o.totalSupply);
    const shareBps = o.totalSupply > 0n ? Number((balance * 100_000n) / o.totalSupply) / 1000 : 0; // C2 실계산

    return (
        <div className="flex flex-wrap gap-7 items-start bg-ink-800 border border-ink-700 rounded-card p-8 mb-6">
            <div className="flex flex-col items-center gap-4 flex-none">
                <Medallion char={tier?.hanja ?? "馬"} size={132} glow />
                <div className="text-center">
                    <div className="font-serif text-[21px] font-bold text-brass-400">{tier?.hanja} 등급</div>
                    <div className="text-[13px] text-hanji-400 mt-1">{copy.membership.share(shareBps.toFixed(1))} 보유</div>
                </div>
            </div>
            <div className="flex-1" style={{minWidth: 280}}>
                <div className="flex justify-between items-baseline flex-wrap gap-2 mb-3">
                    <div className="text-[17px] font-bold">
                        {c.name} <span className="text-hanji-400 font-normal">{c.en}</span> 회원권
                    </div>
                    <a href={explorerAddr(o.token)} target="_blank" rel="noreferrer" className="text-[13px]">{copy.tx.viewOnChain}</a>
                </div>
                <div className="font-serif text-[44px] font-semibold tabular-nums leading-none mb-5">
                    {fmt(balance, 2)}<span className="text-[20px] text-hanji-400 font-sans"> {copy.membership.unit}</span>
                </div>
                {next ? (
                    <div className="mb-5">
                        <div className="flex justify-between text-[13px] mb-2">
                            <span className="text-hanji-400">다음 등급까지</span>
                            <span className="text-brass-400 font-semibold tabular-nums">
                                {copy.membership.nextTier(next.next.hanja, fmt(next.need, 2))}
                            </span>
                        </div>
                        <div className="h-2 rounded bg-ink-700 overflow-hidden">
                            <div className="h-full bg-brass-400 rounded" style={{
                                width: `${Math.min(100, Number((balance * 100n) / (balance + next.need)))}%`,
                            }} />
                        </div>
                    </div>
                ) : (
                    <div className="text-[13px] text-brass-400 mb-5">{copy.membership.maxTier}</div>
                )}
                <div className="flex gap-3 flex-wrap">
                    <Link to="/redeem"><PrimaryBtn>{copy.redeem.redeemCta}</PrimaryBtn></Link>
                    <Link to={`/trade?o=${o.address}`}
                        className="rounded-input border border-ink-700 text-hanji-100 text-[14px] px-5 py-3 hover:border-brass-600">
                        {copy.nav.trade}
                    </Link>
                </div>
            </div>
        </div>
    );
}

function Ladder({holdings}: {holdings: {o: OfferingInfo; balance: bigint}[]}) {
    const current = holdings.length > 0 ? tierIndex(holdings[0].balance, holdings[0].o.totalSupply) : -1;
    return (
        <div className="mt-14 pt-10 border-t border-ink-700">
            <h2 className="m-0 mb-2 text-[21px] font-bold">{copy.membership.ladder}</h2>
            <p className="m-0 mb-6 text-[13px] text-hanji-400">보유 비율에 따른 등급</p>
            <div className="grid gap-4" style={{gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))"}}>
                {TIERS.map((t, i) => {
                    const active = i === current;
                    return (
                        <div key={t.hanja} className="rounded-card p-5 text-center" style={{
                            background: active ? "rgba(195,154,59,.07)" : "#2A231A",
                            border: `1px solid ${active ? "rgba(195,154,59,.45)" : "#3A3126"}`,
                        }}>
                            <div className="flex justify-center mb-3"><Medallion char={t.hanja} size={64} active={active} /></div>
                            <div className={`font-serif text-[17px] font-bold ${active ? "text-brass-400" : "text-hanji-100"}`}>{t.hanja}</div>
                            <div className="text-[12px] text-hanji-400 mt-1">
                                {t.minBps === 1n ? "보유 시" : `${Number(t.minBps) / 100}% 이상`}
                            </div>
                            {active && <div className="text-[12px] text-brass-400 mt-2">현재 등급</div>}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function Empty() {
    return (
        <div className="flex flex-wrap items-center gap-7 bg-ink-800 border border-ink-700 rounded-card p-8">
            <Medallion char="馬" size={104} dashed />
            <div className="flex-1" style={{minWidth: 220}}>
                <div className="text-[17px] font-bold mb-1">{copy.membership.empty}</div>
                <div className="text-[13px] text-hanji-400">진행 중인 공모에 응모하면 여기에 표시돼요</div>
            </div>
            <Link to="/"><PrimaryBtn>{copy.membership.emptyCta}</PrimaryBtn></Link>
        </div>
    );
}
