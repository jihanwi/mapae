import {useMemo, useState} from "react";
import {useSearchParams} from "react-router-dom";
import {useAccount, useReadContract, useReadContracts, useWriteContract} from "wagmi";
import {Abi, formatUnits, parseUnits} from "viem";
import {copy} from "../copy";
import {ADDR_L1} from "../contracts/addressesV3L1";
import {FeeRouterAbi, MapaePoolV3Abi, MembershipTokenV3Abi, MockKRWV3Abi} from "../contracts/abisV3";
import {ERC20_APPROVAL_ABI, needsApproval, useApprovalStep} from "../hooks/approval";
import {ApiFeedRow, EventLog, labelOf, useBlockTimestamps, useOfferingHistory, useOfferings, OfferingInfo} from "../hooks";
import {LogStateNote} from "../components/LogStateNote";
import {bpsPct} from "../lib/proceedsText";
import {NetError, Skeleton, Stat, TextSkeleton} from "../components/ui";
import {PriceChart, PricePoint} from "../components/PriceChart";
import {RunFn, TxButton} from "../components/tx";
import {fmt, sanitizeAmountInput, shortAddr} from "../lib/format";
import {computeBurned} from "./Home";
import {explorerAddr, giwaSepolia} from "../config/chain";
import {DEFAULT_TITLE, useTitle} from "../lib/title";

const DEAD = "0x000000000000000000000000000000000000dEaD" as const;
const ZERO = "0x0000000000000000000000000000000000000000" as const;

export default function Trade() {
    useTitle(DEFAULT_TITLE);
    const {offerings, isLoading, isError, refetch} = useOfferings();
    const [params] = useSearchParams();
    const listed = offerings.filter((o) => o.settled && o.pool !== ZERO);
    const wanted = params.get("o")?.toLowerCase();
    const [selManual, setSel] = useState<number | null>(null);
    const sel = selManual ?? Math.max(0, listed.findIndex((o) => o.address.toLowerCase() === wanted));
    const o = listed[sel];

    if (isLoading) return <div className="max-w-page mx-auto px-4 sm:px-8 pt-12"><Skeleton h={300} /></div>;
    // #8: RPC 장애 시 "상장된 회원권이 없어요"(거짓) 대신 네트워크 에러로 분기
    if (!o) {
        if (isError) return <div className="max-w-page mx-auto px-4 sm:px-8 pt-12"><NetError onRetry={refetch} /></div>;
        return <div className="max-w-page mx-auto px-4 sm:px-8 pt-12 text-hanji-400 text-[14px]">{copy.trade.noListed}</div>;
    }

    return (
        <div className="max-w-page mx-auto px-4 sm:px-8 pt-8 sm:pt-10 pb-16 sm:pb-20">
            <h1 className="m-0 mb-2 text-[24px] sm:text-[28px] font-bold">{copy.trade.title}</h1>
            <div className="flex gap-2 mt-4 flex-wrap">
                {listed.map((x, i) => {
                    const c = labelOf(x);
                    return (
                        <button key={x.address} onClick={() => setSel(i)}
                            className={`px-4 min-h-[44px] rounded-full text-[13px] border ${i === sel ? "border-brass-400 text-brass-400 bg-ink-700" : "border-ink-700 text-hanji-400 hover:border-brass-600 active:border-brass-400"}`}>
                            {c ? `${c.name} ${c.symbol}` : <TextSkeleton w={64} h={13} />}
                        </button>
                    );
                })}
            </div>
            <TradePanel o={o} key={o.address} />
        </div>
    );
}

function TradePanel({o}: {o: OfferingInfo}) {
    const {address} = useAccount();
    const {writeContractAsync} = useWriteContract();
    const [dir, setDir] = useState<"buy" | "sell">("buy");
    const [amount, setAmount] = useState("");
    const pool = o.pool;

    const amountWei = useMemo(() => {
        try { return parseUnits(amount || "0", 18); } catch { return 0n; }
    }, [amount]);

    const quote = useReadContract({
        address: pool, abi: MapaePoolV3Abi, functionName: dir === "buy" ? "getTokenOut" : "getQuoteOut",
        args: [amountWei], chainId: giwaSepolia.id, query: {enabled: amountWei > 0n, refetchInterval: 10_000},
    });
    // W-T32: LP lock and the fee this pool actually charges (platform + LP from the FeeRouter tier,
    // royalty + burn from the pool), one multicall
    const poolInfo = useReadContracts({
        contracts: [
            {address: pool, abi: MapaePoolV3Abi as Abi, functionName: "balanceOf", args: [DEAD], chainId: giwaSepolia.id},
            {address: pool, abi: MapaePoolV3Abi as Abi, functionName: "totalSupply", chainId: giwaSepolia.id},
            {address: pool, abi: MapaePoolV3Abi as Abi, functionName: "totalFeeBps", chainId: giwaSepolia.id},
            {address: pool, abi: MapaePoolV3Abi as Abi, functionName: "royaltyBps", chainId: giwaSepolia.id},
            {address: pool, abi: MapaePoolV3Abi as Abi, functionName: "burnBps", chainId: giwaSepolia.id},
            {address: pool, abi: MapaePoolV3Abi as Abi, functionName: "feeRouter", chainId: giwaSepolia.id},
            {address: pool, abi: MapaePoolV3Abi as Abi, functionName: "tier", chainId: giwaSepolia.id},
        ],
    });
    const pi = poolInfo.data?.map((x) => (x.status === "success" ? x.result : undefined)) ?? [];
    const lpDead = {data: pi[0] as bigint | undefined};
    const lpTotal = {data: pi[1] as bigint | undefined};
    const tierFees = useReadContract({
        address: pi[5] as `0x${string}` | undefined, abi: FeeRouterAbi, functionName: "getFees",
        args: [Number(pi[6] ?? 0)], chainId: giwaSepolia.id, query: {enabled: pi[5] !== undefined && pi[6] !== undefined},
    });
    const fees = feeParts(pi[2] as number | undefined, pi[3] as number | undefined, pi[4] as number | undefined, tierFees.data as {swapPlatformBps: number; swapLpBps: number} | undefined);
    // W-T33: history from the indexer, the browser reads only the blocks after it
    const swaps = useOfferingHistory<SwapItem>({
        offering: o.address, factory: o.factory, feed: "swaps", address: pool, eventSig: SWAPPED, fromApi: swapFromApi, fromLog: swapFromLog,
    });

    // T3: 내 보유 (multicall 배칭으로 부담 없음)
    // W-T37: allowance of the token going in (KRWs to buy, the offering token to sell) for the pool
    const inToken = (dir === "buy" ? ADDR_L1.mockKRW : o.token) as `0x${string}`;
    const allowance = useReadContract({
        address: inToken, abi: ERC20_APPROVAL_ABI, functionName: "allowance", args: [address ?? ZERO, pool], chainId: giwaSepolia.id,
        query: {enabled: !!address, refetchInterval: 15_000},
    });
    const needs = needsApproval(allowance.data as bigint | undefined, amountWei);
    const approval = useApprovalStep({}, copy.trade.approveLabel);

    const myBalances = useReadContracts({
        contracts: [
            {address: o.token, abi: MembershipTokenV3Abi as Abi, functionName: "balanceOf", args: [address ?? ZERO], chainId: giwaSepolia.id},
            {address: ADDR_L1.mockKRW, abi: MockKRWV3Abi as Abi, functionName: "balanceOf", args: [address ?? ZERO], chainId: giwaSepolia.id},
        ],
        query: {enabled: !!address, refetchInterval: 15_000},
    });
    const tokenBal = myBalances.data?.[0]?.result as bigint | undefined;
    const krwBal = myBalances.data?.[1]?.result as bigint | undefined;
    const sellEmpty = dir === "sell" && !!address && tokenBal === 0n;

    // 1-2: 최대는 매도(보유 전량)에서만. 매수 전액은 얕은 풀에서 가격 폭등을 유발하므로 미제공
    const fillMax = () => {
        if (tokenBal !== undefined) setAmount(formatUnits(tokenBal, 18));
    };

    // 스왑 후 예상 보유 (장)
    const afterSwap = useMemo(() => {
        if (tokenBal === undefined || amountWei === 0n) return undefined;
        if (dir === "buy") return quote.data !== undefined ? tokenBal + (quote.data as bigint) : undefined;
        const left = tokenBal - amountWei;
        return left > 0n ? left : 0n;
    }, [tokenBal, amountWei, dir, quote.data]);

    // 1-3a: 가격 영향 = 실효가/스팟 − 1 (기존 값만 사용, 새 읽기 없음)
    const impact = useMemo(() => {
        if (quote.data === undefined || amountWei === 0n || o.spotPrice === 0n) return undefined;
        const q = Number(quote.data as bigint);
        if (q === 0) return undefined;
        const eff = dir === "buy" ? Number(amountWei) / q : q / Number(amountWei);
        const spot = Number(o.spotPrice) / 1e18;
        if (!Number.isFinite(eff) || spot === 0) return undefined;
        return eff / spot - 1;
    }, [quote.data, amountWei, dir, o.spotPrice]);

    // T4: 체결가 시계열 — Swapped별 실효가(KRWs/장) + 블록 타임스탬프
    // block times only for the browser's own rows (indexed rows carry ts)
    const blockTs = useBlockTimestamps((swaps.items ?? []).filter((x) => x.ts === undefined).map((x) => x.block));
    const points: PricePoint[] = useMemo(() => {
        if (!swaps.items) return [];
        return [...swaps.items]
            .reverse()
            .map((a) => {
                const price = a.quoteIn ? Number(a.amountIn) / Number(a.amountOut) : Number(a.amountOut) / Number(a.amountIn);
                return {t: a.ts ?? blockTs.data?.[a.block.toString()] ?? 0, price, buy: a.quoteIn};
            })
            .filter((p) => p.t > 0 && Number.isFinite(p.price));
    }, [swaps.items, blockTs.data]);

    // 4-b / 9-a: 클릭 전 사전 검증 — 미연결·견적 실패·잔고 초과 사유를 표시하고 disabled
    const swapReason =
        !address ? copy.hints.connectWallet
        : amountWei === 0n ? ""
        : dir === "sell" && tokenBal !== undefined && amountWei > tokenBal ? copy.hints.overTokenBalance
        : dir === "buy" && krwBal !== undefined && amountWei > krwBal ? copy.hints.overKrwBalance
        : quote.data === undefined ? copy.hints.quoteUnavailable
        : "";
    // allowance not read yet: a loading button, never "approve"
    const allowanceLoading = !!address && amountWei > 0n && needs === undefined;
    const swapDisabled = amountWei === 0n || sellEmpty || swapReason !== "" || allowanceLoading;

    const doSwap = async (run: RunFn) => {
        if (!address || amountWei === 0n || quote.data === undefined) return;
        if (needs === undefined) return;
        const minOut = ((quote.data as bigint) * 99n) / 100n; // 1% slippage
        // approval only when the allowance is short; then wait until the RPC sees it
        const ap = await approval.ensure(run, {needsApproval: needs, token: inToken, spender: pool, amount: amountWei});
        if (!ap.ok) return;
        const done = await run(dir === "buy" ? copy.trade.buy : copy.trade.sell, () =>
            writeContractAsync({
                address: pool, abi: MapaePoolV3Abi,
                functionName: dir === "buy" ? "swapQuoteForToken" : "swapTokenForQuote",
                args: [amountWei, minOut, address], chainId: giwaSepolia.id,
            }));
        if (done) {
            approval.done();
            setAmount("");
        }
    };

    const events = (swaps.items ?? []).slice(0, 10);
    const burned = computeBurned(o);
    return (
        <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 mb-6 sm:mb-7">
                {/* 스팟 vs 공모가 병렬 — 등락색 금지 */}
                <Stat label={copy.trade.spot} value={o.spotPrice > 0n ? fmt(o.spotPrice, 0) : "—"} unit="KRWs" />
                <Stat label={copy.trade.offer} value={fmt(o.price, 0)} unit="KRWs" />
                <Stat label={copy.trade.burnedTotal} value={fmt(burned, 2)} unit={copy.trade.unit} />
                <Stat label={copy.trade.circulating} value={fmt(o.totalSupply, 2)} unit={copy.trade.unit} />
            </div>

            {/* T4: 후행 체결가 라인 차트 — 정가 기준선 위 유통 프리미엄의 시각화 */}
            <div className="bg-ink-800 border border-ink-700 rounded-card p-4 sm:p-6 mb-6 sm:mb-7">
                <h3 className="m-0 mb-4 text-[17px] font-bold">{copy.trade.chartTitle}</h3>
                <PriceChart points={points} offerPrice={Number(o.price) / 1e18} />
            </div>

            <div className="flex flex-col sm:flex-row flex-wrap gap-6 sm:gap-7 items-start">
                <div className="w-full sm:flex-1" style={{minWidth: 0}}>
                    <div className="bg-ink-800 border border-ink-700 rounded-card p-4 sm:p-7">
                        {address && tokenBal !== undefined && krwBal !== undefined && (
                            <div className="text-[13px] text-hanji-400 mb-4 tabular-nums">
                                {copy.trade.myStrip(fmt(tokenBal, 2), fmt(krwBal, 0))}
                            </div>
                        )}
                        <div className="flex rounded-input overflow-hidden border border-ink-700 mb-5">
                            {(["buy", "sell"] as const).map((d) => (
                                <button key={d} onClick={() => { setDir(d); setAmount(""); }}
                                    className={`flex-1 py-3 text-[14px] font-semibold ${dir === d ? "bg-ink-700 text-hanji-100" : "bg-transparent text-hanji-400 hover:text-hanji-100"}`}>
                                    {d === "buy" ? copy.trade.buy : copy.trade.sell}
                                </button>
                            ))}
                        </div>
                        <label className="block text-[13px] text-hanji-400 mb-2">
                            {dir === "buy" ? copy.trade.buyLabel : copy.trade.sellLabel}
                        </label>
                        <div className={`flex items-center bg-ink-900 border border-ink-700 rounded-input px-4 focus-within:border-brass-400 ${sellEmpty ? "mb-1.5 opacity-60" : "mb-3"}`}>
                            <input value={amount} onChange={(e) => setAmount(sanitizeAmountInput(e.target.value))}
                                placeholder={dir === "buy" ? copy.trade.buyPlaceholder : copy.trade.amountIn} inputMode="decimal"
                                disabled={sellEmpty}
                                className="flex-1 min-w-0 bg-transparent border-none outline-none py-3.5 text-[16px] text-hanji-100 tabular-nums disabled:cursor-not-allowed" />
                            {address && dir === "sell" && !sellEmpty && (
                                <button onClick={fillMax}
                                    className="text-[12px] text-brass-400 border border-ink-700 rounded px-2 py-1 mr-2 hover:border-brass-600 whitespace-nowrap flex-none">
                                    {copy.trade.maxBtn}
                                </button>
                            )}
                            <span className="text-hanji-400 text-[14px] flex-none">{dir === "buy" ? "KRWs" : copy.trade.unit}</span>
                        </div>
                        {sellEmpty && <div className="text-[13px] text-hanji-400 mb-3">{copy.trade.noHoldings}</div>}
                        <div className="flex justify-between text-[13px] mb-1">
                            <span className="text-hanji-400">{copy.trade.quote}</span>
                            <span className="text-hanji-100 font-semibold tabular-nums">
                                {quote.data !== undefined ? `${fmt(quote.data as bigint, dir === "buy" ? 4 : 0)} ${dir === "buy" ? copy.trade.unit : "KRWs"}` : "—"}
                            </span>
                        </div>
                        {impact !== undefined && (
                            <div className={`flex justify-between text-[12px] mb-1 tabular-nums ${Math.abs(impact) > 0.05 ? "text-brass-400" : "text-hanji-400"}`}>
                                <span>{copy.trade.priceImpact}</span>
                                <span>{impact >= 0 ? "+" : ""}{(impact * 100).toFixed(1)}%</span>
                            </div>
                        )}
                        {afterSwap !== undefined && (
                            <div className="text-[12px] text-hanji-400 mb-1 text-right tabular-nums">{copy.trade.afterSwap(fmt(afterSwap, 2))}</div>
                        )}
                        <div className="text-[12px] text-hanji-400 mb-1">
                            {fees ? `${copy.trade.feeNote(fees.total, fees.royalty, fees.burn, fees.lp, fees.platform)} · ` : ""}슬리피지 1%
                        </div>
                        <div className="text-[12px] text-hanji-400 mb-5">{copy.trade.shallowPool}</div>
                        <TxButton className="w-full" disabled={swapDisabled} action={doSwap}>
                            {allowanceLoading ? copy.curve.cta.loading : needs ? (dir === "buy" ? copy.curve.cta.approveBuy : copy.curve.cta.approveSell) : copy.trade.swapCta}
                        </TxButton>
                        {swapReason && !sellEmpty && <p className="text-[12px] text-brass-400 mt-2 mb-0">{swapReason}</p>}
                    </div>
                    {/* LP 신뢰 스트립 (C5) */}
                    <div className="mt-4 rounded-input px-4 py-3.5 text-[13px] text-hanji-400 border border-ink-700 bg-ink-900">
                        {copy.trade.lpTrust}
                        {lpDead.data !== undefined && lpTotal.data !== undefined && (lpTotal.data as bigint) > 0n && (
                            <span className="tabular-nums"> ({fmt(lpDead.data as bigint, 0)} / {fmt(lpTotal.data as bigint, 0)} LP)</span>
                        )}{" "}
                        <a href={explorerAddr(pool)} target="_blank" rel="noreferrer">{copy.tx.viewOnChain}</a>
                    </div>
                </div>

                {/* 히스토리 — 캔들 금지, 리스트만. 방향 라벨은 뮤트 통일 (C6) */}
                <div className="w-full sm:flex-1" style={{minWidth: 0}}>
                    <h3 className="m-0 mb-4 text-[17px] font-bold">{copy.trade.history}</h3>
                    <LogStateNote scan={swaps} count={events.length} recent={copy.logs.noTradesRecent} none={copy.logs.noTrades} />
                    {events.map((a, i) => {
                        const mine = !!address && a.sender.toLowerCase() === address.toLowerCase();
                        return (
                            <div key={i} className="flex justify-between items-center gap-2 flex-wrap bg-ink-900 rounded-stat px-4 py-3 mb-2 text-[13px]">
                                <span className="text-hanji-400 flex items-center gap-1.5 flex-none">
                                    {a.quoteIn ? copy.trade.buy : copy.trade.sell}
                                    {mine && (
                                        <span className="text-[11px] text-brass-400 border border-brass-600 rounded-full px-1.5 leading-[16px]">
                                            {copy.trade.meBadge}
                                        </span>
                                    )}
                                    <span className="text-hanji-400 tabular-nums sm:hidden">{shortAddr(a.sender)}</span>
                                </span>
                                <span className="text-hanji-100 tabular-nums text-right">
                                    {a.quoteIn
                                        ? `${fmt(a.amountIn, 0)} KRWs → ${fmt(a.amountOut, 3)}${copy.trade.unit}`
                                        : `${fmt(a.amountIn, 3)}${copy.trade.unit} → ${fmt(a.amountOut, 0)} KRWs`}
                                </span>
                                <span className="text-hanji-400 tabular-nums hidden sm:inline">{shortAddr(a.sender)}</span>
                            </div>
                        );
                    })}
                </div>
            </div>
        </>
    );
}

/** The pool's fee split as percent strings, only when every part was read and they add up to the
 *  pool's own totalFeeBps (otherwise no numbers are written). */
export function feeParts(
    totalBps: number | undefined, royaltyBps: number | undefined, burnBps: number | undefined,
    tier: {swapPlatformBps: number; swapLpBps: number} | undefined
): {total: string; royalty: string; burn: string; lp: string; platform: string} | undefined {
    if (totalBps === undefined || royaltyBps === undefined || burnBps === undefined || !tier) return undefined;
    if (Number(royaltyBps) + Number(burnBps) + Number(tier.swapLpBps) + Number(tier.swapPlatformBps) !== Number(totalBps)) return undefined;
    return {total: bpsPct(totalBps), royalty: bpsPct(royaltyBps), burn: bpsPct(burnBps), lp: bpsPct(tier.swapLpBps), platform: bpsPct(tier.swapPlatformBps)};
}

const SWAPPED = "event Swapped(address indexed sender, address indexed to, bool quoteIn, uint256 amountIn, uint256 amountOut, uint256 royalty)";

/** One pool swap, from the indexer or from the browser's log (newest first in lists). */
export type SwapItem = {tx: string; logIndex: number; block: bigint; ts?: number; sender: string; quoteIn: boolean; amountIn: bigint; amountOut: bigint};

export function swapFromApi(r: ApiFeedRow): SwapItem {
    const quoteIn = r.quoteIn === true;
    const q = BigInt(r.quoteAmount as string);
    const t = BigInt(r.tokenAmount as string);
    return {tx: r.tx, logIndex: r.logIndex, block: BigInt(r.block), ts: Number(r.ts), sender: r.trader as string, quoteIn, amountIn: quoteIn ? q : t, amountOut: quoteIn ? t : q};
}

export function swapFromLog(l: EventLog): SwapItem {
    const a = l.args as {sender: string; quoteIn: boolean; amountIn: bigint; amountOut: bigint};
    return {tx: l.transactionHash!, logIndex: l.logIndex!, block: l.blockNumber!, sender: a.sender, quoteIn: a.quoteIn, amountIn: a.amountIn, amountOut: a.amountOut};
}
