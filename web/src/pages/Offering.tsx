import {useEffect, useMemo, useState} from "react";
import {Link, useParams} from "react-router-dom";
import {useQuery} from "@tanstack/react-query";
import {useAccount, useReadContract, useWriteContract} from "wagmi";
import {parseUnits} from "viem";
import {copy} from "../copy";
import {ADDR} from "../contracts/addresses";
import {MockKRWAbi, OfferingAbi} from "../contracts/abis";
import {useOfferings, useParticipantCount} from "../hooks";
import {Badge, Gauge, Medallion, SecondaryBtn, Skeleton, TextSkeleton} from "../components/ui";
import {RunFn, TxButton} from "../components/tx";
import {countdown, fmt} from "../lib/format";
import {creatorOf} from "../lib/creators";
import {explorerAddr} from "../config/chain";

type Alloc = {participants: string[]; allocations: string[]; refunds: string[]} & Record<string, unknown>;

function useAllocation(offering: string | undefined, account: string | undefined) {
    return useQuery({
        queryKey: ["alloc", offering, account],
        enabled: !!offering && !!account,
        queryFn: async () => {
            const res = await fetch(`${import.meta.env.BASE_URL}allocations/${offering}.json`);
            if (!res.ok) return null;
            const data = (await res.json()) as Alloc;
            const i = data.participants.findIndex((p) => p.toLowerCase() === account!.toLowerCase());
            if (i < 0) return null;
            return {
                allocation: BigInt(data.allocations[i]),
                refund: BigInt(data.refunds[i]),
                proof: (data[`proofs_${i}`] as `0x${string}`[]) ?? [],
            };
        },
    });
}

export default function Offering() {
    const {addr} = useParams<{addr: `0x${string}`}>();
    const {offerings, isLoading} = useOfferings();
    const o = offerings.find((x) => x.address.toLowerCase() === addr?.toLowerCase());
    const {address: account} = useAccount();
    const participants = useParticipantCount(o?.address);
    const {writeContractAsync} = useWriteContract();
    const [amount, setAmount] = useState("");
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        const iv = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(iv);
    }, []);

    const zero = "0x0000000000000000000000000000000000000000" as const;

    const myCommit = useReadContract({
        address: o?.address, abi: OfferingAbi, functionName: "committed",
        args: [account ?? zero], query: {enabled: !!o && !!account, refetchInterval: 15_000},
    });
    const claimed = useReadContract({
        address: o?.address, abi: OfferingAbi, functionName: "hasClaimed",
        args: [account ?? zero], query: {enabled: !!o && !!account, refetchInterval: 15_000},
    });
    const allowance = useReadContract({
        address: ADDR.mockKRW, abi: MockKRWAbi, functionName: "allowance",
        args: [account ?? zero, o?.address ?? zero], query: {enabled: !!o && !!account, refetchInterval: 15_000},
    });
    const alloc = useAllocation(o?.address, account);

    const amountWei = useMemo(() => {
        try { return parseUnits(amount.replace(/[^0-9.]/g, "") || "0", 18); } catch { return 0n; }
    }, [amount]);

    if (isLoading || !o) {
        return <div className="max-w-page mx-auto px-4 sm:px-8 pt-12"><Skeleton h={400} /></div>;
    }
    const c = creatorOf(o);
    const live = !o.settled && !o.refunding && Number(o.deadline) * 1000 > now;
    const frozen = live && Number(o.deadline) * 1000 - now < 2 * 3600 * 1000;
    const pctNum = o.raiseTarget > 0n ? Number((o.totalCommitted * 1000n) / o.raiseTarget) / 10 : 0;
    const myCommitted = (myCommit.data as bigint) ?? 0n;

    const commit = async (run: RunFn) => {
        if (!o || amountWei === 0n) return;
        if (((allowance.data as bigint) ?? 0n) < amountWei) {
            const ok = await run("KRWs 사용 승인", () =>
                writeContractAsync({address: ADDR.mockKRW, abi: MockKRWAbi, functionName: "approve", args: [o.address, amountWei]}));
            if (!ok) return;
        }
        const ok = await run("응모", () =>
            writeContractAsync({address: o.address, abi: OfferingAbi, functionName: "commit", args: [amountWei]}));
        if (ok) setAmount("");
    };

    return (
        <div className="max-w-page mx-auto px-4 sm:px-8 pt-10 pb-20">
            <Link to="/" className="text-[14px]">← 공모 목록</Link>
            <div className="flex flex-wrap gap-7 mt-6 items-start">
                {/* 좌: 크리에이터 */}
                <div className="flex-1" style={{minWidth: 340}}>
                    <div className="flex items-center gap-5 mb-7">
                        <Medallion char={c ? c.name[0] : "…"} size={104} glow />
                        <div>
                            <h1 className="m-0 text-[28px] font-bold">
                                {c ? <>{c.name} <span className="text-hanji-400 font-normal">{c.en}</span></> : <TextSkeleton w={180} h={28} />}
                            </h1>
                            <div className="flex items-center gap-2 mt-2 text-[13px] text-success">
                                <span>✓</span> {copy.home.verifiedCreator} — Dojang Verified
                            </div>
                        </div>
                    </div>
                    <div className="text-[15px] leading-relaxed text-hanji-100 space-y-4">
                        <p className="m-0">
                            {c ? `${c.name}의` : "이"} 온체인 회원권입니다. 공모 수량 {fmt(o.qSale, 2)}장을 단 한 번만 발행하며,
                            총공급은 정산 시점에 확정돼요. 이후 추가 발행은 불가능해요.
                        </p>
                        <p className="m-0">
                            회원권으로는 리딤 카탈로그의 혜택을 소각 방식으로 사용할 수 있고, 보유 비율에 따라
                            一馬부터 五馬까지의 등급이 부여됩니다. 리딤에 사용된 회원권은 소각되어 총공급이 줄어듭니다.
                        </p>
                        <p className="m-0">발행 대금은 크리에이터 활동비와 리딤 운영에 사용됩니다. 크리에이터 배분 물량은 36개월 베스팅(6개월 클리프)으로 잠깁니다.</p>
                    </div>
                    <div className="mt-7 rounded-input px-4 py-3.5 text-[13px] text-hanji-400"
                        style={{background: "rgba(195,154,59,.08)", border: "1px solid rgba(195,154,59,.3)"}}>
                        {copy.offering.allocNote} <a href="https://github.com/jihanwi/mapae/blob/main/script/allocation/README.md" target="_blank" rel="noreferrer">검증 방법 보기</a>
                    </div>
                </div>

                {/* 우: 응모 패널 */}
                <div className="flex-1" style={{minWidth: 340}}>
                    <div className="bg-ink-800 border border-ink-700 rounded-card p-7">
                        <div className="flex justify-between items-center mb-5">
                            {o.settled ? <Badge kind="neutral">{copy.badge.settled}</Badge>
                                : o.refunding ? <Badge kind="neutral">{copy.badge.refunding}</Badge>
                                : frozen ? <Badge kind="frozen">{copy.badge.frozen}</Badge>
                                : <Badge kind="open">{copy.badge.open}</Badge>}
                            {live ? (
                                <span className="text-[13px] text-brass-400 font-semibold tabular-nums">마감까지 {countdown(o.deadline, now).replace(/^D-\d+ /, "")}</span>
                            ) : (
                                <a className="text-[13px]" href={explorerAddr(o.address)} target="_blank" rel="noreferrer">{copy.tx.viewOnChain}</a>
                            )}
                        </div>

                        {!o.settled && (
                            <>
                                <div className="mb-2"><Gauge committed={o.totalCommitted} target={o.raiseTarget} height={10} /></div>
                                <div className="text-[13px] text-hanji-400 mb-5 tabular-nums">
                                    총 응모 <span className="text-hanji-100 font-semibold">{fmt(o.totalCommitted, 0)}</span> / 목표 {fmt(o.raiseTarget, 0)} KRWs
                                    {participants !== undefined && <> · {copy.home.participants(participants)}</>}
                                    {" · "}<span className={pctNum > 100 ? "text-brass-400 font-semibold" : ""}>{pctNum.toFixed(0)}%</span>
                                </div>
                            </>
                        )}

                        <InfoGrid o={o} />

                        {live && (
                            <>
                                {frozen && (
                                    <div className="rounded-input px-4 py-3 mb-4 text-[13px] text-brass-400"
                                        style={{background: "rgba(195,154,59,.08)", border: "1px solid rgba(195,154,59,.3)"}}>
                                        {copy.offering.cancelFrozenNote} · {copy.offering.commitStillOpenNote}
                                    </div>
                                )}
                                <label className="block text-[13px] text-hanji-400 mb-2">응모 금액</label>
                                <div className="flex items-center bg-ink-900 border border-ink-700 rounded-input px-4 focus-within:border-brass-400 mb-1.5">
                                    <input value={amount} onChange={(e) => setAmount(e.target.value)}
                                        placeholder={copy.offering.amountPlaceholder} inputMode="decimal"
                                        className="flex-1 bg-transparent border-none outline-none py-3.5 text-[16px] text-hanji-100 tabular-nums" />
                                    <span className="text-hanji-400 text-[14px]">KRWs</span>
                                </div>
                                <div className="text-[12px] text-hanji-400 mb-4 tabular-nums">
                                    ≈ {o.price > 0n ? fmt((amountWei * 10n ** 18n) / o.price) : "0"}장
                                </div>
                                <TxButton className="w-full" disabled={amountWei === 0n} action={commit}>
                                    {myCommitted > 0n ? copy.offering.commitMore : copy.offering.commitCta}
                                </TxButton>

                                {myCommitted > 0n && (
                                    <div className="mt-5 pt-5 border-t border-ink-700">
                                        <div className="flex justify-between text-[13px] mb-3">
                                            <span className="text-hanji-400">내 응모 현황</span>
                                            <span className="text-hanji-100 font-semibold tabular-nums">{fmt(myCommitted, 0)} KRWs</span>
                                        </div>
                                        {frozen ? (
                                            <SecondaryBtn className="w-full" disabled>취소 잠김 — 마감 2시간 전</SecondaryBtn>
                                        ) : (
                                            <TxButton variant="secondary" className="w-full" action={(run) =>
                                                run("응모 취소", () =>
                                                    writeContractAsync({address: o.address, abi: OfferingAbi, functionName: "cancel", args: [myCommitted]}))
                                            }>전액 취소하기</TxButton>
                                        )}
                                    </div>
                                )}
                            </>
                        )}

                        {o.settled && <SettledPanel o={o} alloc={alloc.data ?? null} claimed={(claimed.data as boolean) ?? false}
                            myCommitted={myCommitted} claim={(a) => (run: RunFn) =>
                                run("배정 수령", () =>
                                    writeContractAsync({address: o.address, abi: OfferingAbi, functionName: "claim", args: [a.allocation, a.refund, a.proof]}))
                            } />}
                    </div>
                    {live && (
                        <p className="text-[12px] text-hanji-400 mt-3">
                            {copy.offering.cancelFrozenNote}. {o.refundMode === 0 ? "미달 시 전액이 자동 환불돼요." : "미달 시 판매분만 발행되고 나머지는 소각돼요."}
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}

function InfoGrid({o}: {o: ReturnType<typeof useOfferings>["offerings"][number]}) {
    const wl = useReadContract({address: o.address, abi: OfferingAbi, functionName: "walletLimit"});
    const rows: [string, string][] = [
        ["정가", `${fmt(o.price, 0)} KRWs / 장`],
        [copy.offering.saleQty, `${fmt(o.qSale, 2)}장`], // C1: (고정 공급) 라벨 제거
        ["1인 한도", wl.data ? `${fmt(wl.data as bigint, 0)} KRWs` : "—"],
        ["미달 시", o.refundMode === 0 ? "전액 환불" : "판매분만 발행 · 미판매분 소각"],
    ];
    return (
        <div className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-[13px] mb-5 pb-5 border-b border-ink-700">
            {rows.map(([k, v]) => (
                <FragmentRow key={k} k={k} v={v} />
            ))}
            {/* C1: 총공급 분리 표기 */}
            {o.settled && <FragmentRow k="총공급" v={copy.offering.totalSupplyLine(fmt(o.totalSupply, 2))} />}
        </div>
    );
}
function FragmentRow({k, v}: {k: string; v: string}) {
    return (
        <>
            <span className="text-hanji-400">{k}</span>
            <span className="text-hanji-100 text-right tabular-nums">{v}</span>
        </>
    );
}

function SettledPanel({o, alloc, claimed, myCommitted, claim}: {
    o: ReturnType<typeof useOfferings>["offerings"][number];
    alloc: {allocation: bigint; refund: bigint; proof: `0x${string}`[]} | null;
    claimed: boolean;
    myCommitted: bigint;
    claim: (a: {allocation: bigint; refund: bigint; proof: `0x${string}`[]}) => (run: RunFn) => Promise<unknown>;
}) {
    if (!alloc) {
        return <p className="text-[13px] text-hanji-400 m-0">{copy.offering.notInAllocation}</p>;
    }
    return (
        <div>
            <div className="bg-ink-900 rounded-stat p-5 text-center mb-4">
                <div className="text-[12px] text-hanji-400 mb-2">내 배정 결과</div>
                <div className="font-serif text-[42px] font-semibold tabular-nums leading-none">
                    {fmt(alloc.allocation, 2)}<span className="text-[19px] text-hanji-400 font-sans"> 장</span>
                </div>
                {alloc.refund > 0n && (
                    <div className="text-[13px] text-hanji-400 mt-2">+ {copy.offering.myRefund} <span className="text-hanji-100">{fmt(alloc.refund, 0)} KRWs</span></div>
                )}
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-[13px] mb-4">
                <FragmentRow k="내 응모" v={myCommitted > 0n ? `${fmt(myCommitted, 0)} KRWs` : "—"} />
                <FragmentRow k="배정 방식" v="균등 + 추첨" />
            </div>
            {claimed ? (
                <SecondaryBtn className="w-full" disabled>{copy.offering.claimed}</SecondaryBtn>
            ) : (
                <TxButton className="w-full" action={claim(alloc)}>
                    {copy.offering.claimCta} — {fmt(alloc.allocation, 2)}장{alloc.refund > 0n ? " + 환불" : ""}
                </TxButton>
            )}
            <p className="text-[12px] text-hanji-400 mt-3 mb-0 text-center">배정 계산은 Settled 이벤트의 시드로 누구나 재검증할 수 있습니다</p>
        </div>
    );
}
