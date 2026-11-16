import {Link} from "react-router-dom";
import {useAccount, useReadContracts} from "wagmi";
import {Abi} from "viem";
import {copy} from "../copy";
import {labelOf, useOfferings, useRedeemPeripherals, OfferingInfo} from "../hooks";
import {Medallion, NetError, PrimaryBtn, Skeleton, TextSkeleton} from "../components/ui";
import {fmt} from "../lib/format";
import {TIERS, tierIndex, toNextTier} from "../lib/tier";
import {MembershipTokenV3Abi} from "../contracts/abisV3";
import {OfferingL1Abi} from "../contracts/abisV3L1";
import {useQueries} from "@tanstack/react-query";
import {commitStatus, CommitStatus} from "../lib/holdings";
import {explorerAddr, giwaSepolia} from "../config/chain";
import {DEFAULT_TITLE, useTitle} from "../lib/title";

/** Decision 55: the tier ladder (一馬 to 五馬) is a screen constant (lib/tier.ts, not a contract or
 *  per-offering setting) from the fan-membership era; hidden for every offering, code kept. */
const SHOW_TIERS = false;

export default function Membership() {
    useTitle(DEFAULT_TITLE);
    const {address} = useAccount();
    const {offerings, isLoading, isError, refetch} = useOfferings();
    const zero = "0x0000000000000000000000000000000000000000" as const;
    const balances = useReadContracts({
        contracts: offerings.map((o) => ({
            address: o.token, abi: MembershipTokenV3Abi as Abi, functionName: "balanceOf", args: [address ?? zero], chainId: giwaSepolia.id,
        })),
        query: {enabled: !!address && offerings.length > 0, refetchInterval: 15_000},
    });

    // W-T39: every offering this wallet committed to, with its state (committed + hasClaimed for the
    // whole list in ONE multicall); W-T38's refund rows are one of these states
    const commits = useReadContracts({
        contracts: offerings.flatMap((o) => [
            {address: o.address, abi: OfferingL1Abi as Abi, functionName: "committed", args: [address ?? zero], chainId: giwaSepolia.id},
            {address: o.address, abi: OfferingL1Abi as Abi, functionName: "hasClaimed", args: [address ?? zero], chainId: giwaSepolia.id},
        ]),
        query: {enabled: !!address && offerings.length > 0, refetchInterval: 15_000},
    });
    const mine = offerings.map((o, i) => ({
        o,
        committed: commits.data?.[i * 2]?.status === "success" ? (commits.data[i * 2].result as bigint) : undefined,
        claimed: commits.data?.[i * 2 + 1]?.status === "success" ? (commits.data[i * 2 + 1].result as boolean) : undefined,
    }));
    // allocation files only for settled offerings with an unclaimed commitment (static files, in parallel)
    const toCheck = mine.filter((m) => m.o.settled && m.committed !== undefined && m.committed > 0n && m.claimed === false);
    const allocs = useQueries({
        queries: toCheck.map((m) => ({
            queryKey: ["allocListed", m.o.address.toLowerCase(), address?.toLowerCase()],
            enabled: !!address,
            queryFn: async (): Promise<boolean | null> => {
                const r = await fetch(`${import.meta.env.BASE_URL}allocations/${m.o.address}.json`);
                if (!r.ok) return null; // not published yet: unknown, the row is left out
                const d = (await r.json()) as {participants?: string[]};
                return Array.isArray(d.participants) ? d.participants.some((p) => p.toLowerCase() === address!.toLowerCase()) : null;
            },
        })),
    });
    const allocatedOf = (offering: string): boolean | undefined => {
        const i = toCheck.findIndex((m) => m.o.address === offering);
        const v = i >= 0 ? allocs[i]?.data : undefined;
        return v === null || v === undefined ? undefined : v;
    };
    const nowMs = Date.now();
    const rows = mine
        .map((m) => ({o: m.o, status: commitStatus({settled: m.o.settled, refunding: m.o.refunding, deadlineSec: m.o.deadline, nowMs, committed: m.committed, claimed: m.claimed, allocated: allocatedOf(m.o.address)})}))
        .filter((r): r is {o: OfferingInfo; status: NonNullable<CommitStatus>} => r.status !== null);

    // redeem button per offering: only with redeem items or a sponsorship (shown when unknown)
    const peripherals = useRedeemPeripherals();
    const canRedeem = (o: OfferingInfo) => {
        if (peripherals.status !== "done") return peripherals.status === "error";
        const p = peripherals.per.find((x) => x.offering.toLowerCase() === o.address.toLowerCase());
        return !p || !!p.sponsorship || (p.items ?? 0) > 0;
    };
    const holdings = offerings
        .map((o, i) => ({o, balance: (balances.data?.[i]?.result as bigint) ?? 0n}))
        .filter((h) => h.balance > 0n && h.o.totalSupply > 0n);

    if (isLoading || (address && balances.isLoading)) {
        return <div className="max-w-page mx-auto px-4 sm:px-8 pt-12"><Skeleton h={300} /></div>;
    }
    if (isError && offerings.length === 0) {
        return <div className="max-w-page mx-auto px-4 sm:px-8 pt-12"><NetError onRetry={refetch} /></div>;
    }

    return (
        <div className="max-w-page mx-auto px-4 sm:px-8 pt-8 sm:pt-10 pb-16 sm:pb-20">
            <h1 className="m-0 mb-6 sm:mb-8 text-[24px] sm:text-[28px] font-bold">{copy.membership.title}</h1>
            {rows.map((r) => {
                const c = labelOf(r.o);
                const st = r.status;
                const text = st.kind === "refund" ? `${copy.refund.canRefund} · ${fmt(st.amount, 0)} KRWs`
                    : st.kind === "claim" ? copy.membership.canClaim
                    : st.kind === "awaitSettle" ? copy.membership.awaitSettle(fmt(st.amount, 0))
                    : copy.membership.committed(fmt(st.amount, 0));
                const accent = st.kind === "refund" || st.kind === "claim";
                return (
                    <Link key={r.o.address} to={`/offering/${r.o.address}`} className="block text-hanji-100 mb-4">
                        <div className={`flex items-center justify-between gap-3 flex-wrap bg-ink-800 border ${accent ? "border-brass-600" : "border-ink-700"} rounded-card px-4 py-4 sm:px-6`}>
                            <span className="font-semibold min-w-0 break-words">{c ? `${c.name} ${c.symbol}` : r.o.address}</span>
                            <span className={`text-[13px] tabular-nums ${accent ? "text-brass-400" : "text-hanji-400"}`}>{text} →</span>
                        </div>
                    </Link>
                );
            })}
            {holdings.length === 0 ? (rows.length === 0 && (!address || offerings.length === 0 || commits.isSuccess) ? <Empty /> : null) : holdings.map((h) => <Holding key={h.o.address} o={h.o} balance={h.balance} canRedeem={canRedeem(h.o)} />)}
            {SHOW_TIERS && <Ladder holdings={holdings} />}
        </div>
    );
}

function Holding({o, balance, canRedeem}: {o: OfferingInfo; balance: bigint; canRedeem: boolean}) {
    const c = labelOf(o);
    const idx = tierIndex(balance, o.totalSupply);
    const tier = idx >= 0 ? TIERS[idx] : null;
    const next = toNextTier(balance, o.totalSupply);
    const shareBps = o.totalSupply > 0n ? Number((balance * 100_000n) / o.totalSupply) / 1000 : 0; // C2 실계산

    return (
        <div className="flex flex-wrap gap-6 sm:gap-7 items-start bg-ink-800 border border-ink-700 rounded-card p-4 sm:p-8 mb-6">
            <div className="flex flex-col items-center gap-4 flex-none mx-auto sm:mx-0">
                <Medallion char={SHOW_TIERS ? (tier?.hanja ?? "馬") : c ? [...c.name][0] : "馬"} size={132} glow />
                <div className="text-center">
                    {SHOW_TIERS && <div className="font-serif text-[21px] font-bold text-brass-400">{tier?.hanja} 등급</div>}
                    <div className="text-[13px] text-hanji-400 mt-1">{copy.membership.share(shareBps.toFixed(1))} {copy.membership.holding}</div>
                </div>
            </div>
            <div className="w-full sm:flex-1" style={{minWidth: 0}}>
                <div className="flex justify-between items-baseline flex-wrap gap-2 mb-3">
                    <div className="text-[17px] font-bold">
                        {c ? <>{c.name} <span className="text-hanji-400 font-normal">{c.symbol}</span> {copy.membership.tokenLabel}</> : <TextSkeleton w={160} h={17} />}
                    </div>
                    <a href={explorerAddr(o.token)} target="_blank" rel="noreferrer" className="text-[13px]">{copy.tx.viewOnChain}</a>
                </div>
                <div className="font-serif text-[44px] font-semibold tabular-nums leading-none mb-5">
                    {fmt(balance, 2)}<span className="text-[20px] text-hanji-400 font-sans"> {copy.membership.unit}</span>
                </div>
                {!SHOW_TIERS ? null : next ? (
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
                    {canRedeem && <Link to="/redeem"><PrimaryBtn>{copy.redeem.redeemCta}</PrimaryBtn></Link>}
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
        <div className="mt-10 sm:mt-14 pt-8 sm:pt-10 border-t border-ink-700">
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
        <div className="flex flex-wrap items-center gap-6 sm:gap-7 bg-ink-800 border border-ink-700 rounded-card p-5 sm:p-8">
            <Medallion char="馬" size={104} dashed />
            <div className="flex-1" style={{minWidth: 200}}>
                <div className="text-[17px] font-bold mb-1">{copy.membership.empty}</div>
                <div className="text-[13px] text-hanji-400">{copy.membership.emptyNote}</div>
            </div>
            <Link to="/offerings"><PrimaryBtn>{copy.membership.emptyCta}</PrimaryBtn></Link>
        </div>
    );
}
