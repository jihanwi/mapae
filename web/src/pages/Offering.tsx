import {useEffect, useMemo, useState} from "react";
import {isRefundState} from "../lib/offeringPhase";
import {allocationUrl} from "../lib/allocationUrl";
import {Link, useParams} from "react-router-dom";
import {useQuery} from "@tanstack/react-query";
import {useAccount, useReadContracts, useWriteContract} from "wagmi";
import {Abi, formatUnits, parseUnits} from "viem";
import {useCopy} from "../copy";
import {ADDR_L1} from "../contracts/addressesV3L1";
import {MapaeVestingL1Abi, OfferingL1Abi} from "../contracts/abisV3L1";
import {MockKRWV3Abi} from "../contracts/abisV3";
import {labelOf, OfferingInfo, useOfferings, useOnboarding, useParticipantCount, useRedeemItems} from "../hooks";
import {ProceedsPanel} from "../components/ProceedsPanel";
import {ChainTerms} from "../components/ChainTerms";
import {RefundPanel} from "../components/RefundPanel";
import {DisclosureSection} from "../components/DisclosureSection";
import {spanText} from "../lib/proceedsText";
import {commitBlock, isIssuerWallet} from "../lib/commitGuard";
import {needsApproval, useApprovalStep} from "../hooks/approval";
import {Badge, Eyebrow, Gauge, Icon, Medallion, NetError, PrimaryBtn, SecondaryBtn, Skeleton, TextSkeleton} from "../components/ui";
import {ALLOC_README} from "../lib/allocationUrl";
import {NumText} from "../components/NumText";
import {quickCommits} from "../lib/offeringList";
import {RunFn, TxButton} from "../components/tx";
import {countdown, fmt, sanitizeAmountInput} from "../lib/format";
import {explorerAddr, giwaSepolia} from "../config/chain";
import {DEFAULT_TITLE, useTitle} from "../lib/title";

type Alloc = {participants: string[]; allocations: string[]; refunds: string[]} & Record<string, unknown>;

function useAllocation(offering: string | undefined, account: string | undefined, settled: boolean | undefined) {
    return useQuery({
        queryKey: ["alloc", offering, account],
        enabled: !!offering && !!account && !!settled, // 9-e: 정산 전 404 방지
        queryFn: async () => {
            const res = await fetch(allocationUrl(offering!));
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

/** W-T39: the detail page's local state (commit amount, refund panel "started" / "refunded" /
 *  error, disclosure editor mode, draft, addendum text and message, form touch state, the approval
 *  bookkeeping) belongs to one offering and one wallet: a new key drops all of it. */
export function offeringViewKey(addr: string | undefined, account: string | undefined): string {
    return `${(addr ?? "").toLowerCase()}:${(account ?? "").toLowerCase()}`;
}

export default function Offering() {
    const {addr} = useParams<{addr: `0x${string}`}>();
    const {address: account} = useAccount();
    return <OfferingView key={offeringViewKey(addr, account)} />;
}

function OfferingView() {
    const copy = useCopy();
    useTitle(DEFAULT_TITLE);
    const {addr} = useParams<{addr: `0x${string}`}>();
    const {offerings, isLoading, isError, refetch} = useOfferings();
    const o = offerings.find((x) => x.address.toLowerCase() === addr?.toLowerCase());
    const {address: account} = useAccount();
    const {krwBalance, verified} = useOnboarding();
    const participants = useParticipantCount(o?.address, o?.factory);
    const {writeContractAsync} = useWriteContract();
    // W-T37: shared approval step (exact amount, only when short, waits for the new allowance)
    const approval = useApprovalStep({}, copy.offering.approveLabel);
    const [amount, setAmount] = useState("");
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        const iv = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(iv);
    }, []);

    const zero = "0x0000000000000000000000000000000000000000" as const;

    // one multicall: the wallet's position, the offering's limits
    const detail = useReadContracts({
        contracts: [
            {address: o?.address, abi: OfferingL1Abi as Abi, functionName: "walletLimit", chainId: giwaSepolia.id},
            {address: o?.address, abi: OfferingL1Abi as Abi, functionName: "minCommit", chainId: giwaSepolia.id},
            ...(account ? [
                {address: o?.address, abi: OfferingL1Abi as Abi, functionName: "committed", args: [account], chainId: giwaSepolia.id},
                {address: o?.address, abi: OfferingL1Abi as Abi, functionName: "hasClaimed", args: [account], chainId: giwaSepolia.id},
                {address: ADDR_L1.mockKRW, abi: MockKRWV3Abi as Abi, functionName: "allowance", args: [account, o?.address ?? zero], chainId: giwaSepolia.id},
            ] : []),
        ],
        query: {enabled: !!o, refetchInterval: 15_000},
    });
    const dv = detail.data?.map((x) => (x.status === "success" ? x.result : undefined)) ?? [];
    const walletLimit = {data: dv[0] as bigint | undefined};
    const minCommit = {data: dv[1] as bigint | undefined};
    const myCommit = {data: dv[2] as bigint | undefined};
    const claimed = {data: dv[3] as boolean | undefined};
    const allowance = {data: dv[4] as bigint | undefined};
    const alloc = useAllocation(o?.address, account, o?.settled);

    const amountWei = useMemo(() => {
        try { return parseUnits(amount || "0", 18); } catch { return 0n; }
    }, [amount]);

    if (isLoading) {
        return <div className="max-w-page mx-auto px-4 sm:px-8 pt-12"><Skeleton h={400} /></div>;
    }
    if (!o && isError) {
        // 1-5: RPC 장애를 not-found로 오인하지 않도록 분기
        return <div className="max-w-page mx-auto px-4 sm:px-8 pt-12"><NetError onRetry={refetch} /></div>;
    }
    if (!o) {
        // 6-a: 존재하지 않는 공모 주소 → 영구 스켈레톤 대신 not-found
        return (
            <div className="max-w-page mx-auto px-4 sm:px-8 pt-16 pb-20 text-center">
                <div className="flex justify-center mb-5"><Medallion char="馬" size={88} dashed /></div>
                <h1 className="m-0 mb-2 text-[22px] font-bold">{copy.offering.notFoundTitle}</h1>
                <p className="m-0 mb-6 text-[14px] text-hanji-400">{copy.offering.notFoundNote}</p>
                <Link to="/offerings"><PrimaryBtn>{copy.offering.backToList}</PrimaryBtn></Link>
            </div>
        );
    }
    const c = labelOf(o);
    const live = !o.settled && !o.refunding && Number(o.deadline) * 1000 > now;
    const frozen = live && Number(o.deadline) * 1000 - now < 2 * 3600 * 1000;
    const ended = !o.settled && !o.refunding && !live; // P0 2: 마감 후 정산 전
    const atClose = isRefundState(o); // W-T47: refunds do not lower totalCommitted
    const pctNum = o.raiseTarget > 0n ? Number((o.totalCommitted * 1000n) / o.raiseTarget) / 10 : 0;
    const myCommitted = (myCommit.data as bigint) ?? 0n;
    const wl = (walletLimit.data as bigint) ?? 0n;
    const minC = (minCommit.data as bigint) ?? 0n;

    // 9-a: 클릭 전 사전 검증 — 사유를 표시하고 CTA를 disabled
    // W-T36: every reason the contract would refuse, checked before any approval (lib/commitGuard)
    const guard = (nowMs: number) =>
        commitBlock({account, creator: o.creator, verified, settled: o.settled, refunding: o.refunding, deadlineSec: o.deadline, nowMs, amount: amountWei, myCommitted, minCommit: minC, walletLimit: wl, balance: krwBalance}, copy);
    const commitReason = guard(now);
    const needs = needsApproval(allowance.data, amountWei);
    // allowance not read yet: a loading button, never "approve"
    const allowanceLoading = !!account && amountWei > 0n && commitReason === "" && needs === undefined;
    const commitDisabled = amountWei === 0n || commitReason !== "" || allowanceLoading;
    const issuer = isIssuerWallet(account, o.creator);

    const commit = async (run: RunFn) => {
        if (!o || amountWei === 0n) return;
        // checked again at the click (the deadline may have passed since the last render)
        if (guard(Date.now()) !== "") return;
        if (needs === undefined) return;
        const ap = await approval.ensure(run, {needsApproval: needs, token: ADDR_L1.mockKRW as `0x${string}`, spender: o.address, amount: amountWei});
        if (!ap.ok) return;
        const ok = await run(copy.offering.commitLabel, () =>
            writeContractAsync({address: o.address, abi: OfferingL1Abi, functionName: "commit", args: [amountWei], chainId: giwaSepolia.id}));
        if (ok) {
            approval.done();
            setAmount("");
        }
    };

    const quick = quickCommits(minC, wl, myCommitted);
    const statusBadge = o.settled ? <Badge kind="neutral">{copy.badge.settled}</Badge>
        : o.refunding ? <Badge kind="neutral">{copy.badge.refunding}</Badge>
        : ended ? <Badge kind="neutral">{copy.badge.ended}</Badge>
        : frozen ? <Badge kind="frozen">{copy.badge.frozen}</Badge>
        : <Badge kind="open">{copy.badge.open}</Badge>;
    const initial = c ? [...c.name][0] : "…";

    // W-T63 layout. Below lg one column in this order: header, committed card, commit panel, how
    // allocation works, then the description, chain terms, proceeds and disclosure (the two column
    // wrappers are display:contents there and order-* interleaves their blocks).
    return (
        <div className="max-w-page mx-auto px-4 sm:px-8 pt-8 sm:pt-10 pb-16 sm:pb-20">
            <Link to="/offerings" className="text-[14px]">{copy.offering.backLink}</Link>
            <header className="mt-5 sm:mt-6 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 min-w-0">
                <div className="flex items-center gap-4 sm:gap-5 min-w-0">
                    <span className="sm:hidden flex-none"><Medallion char={initial} size={64} /></span>
                    <span className="hidden sm:inline-flex flex-none"><Medallion char={initial} size={88} /></span>
                    <div className="min-w-0">
                        <h1 className="m-0 flex flex-wrap items-baseline gap-x-3 gap-y-1 min-w-0">
                            {c ? (
                                <>
                                    <span className="font-serif text-[28px] sm:text-[38px] font-bold leading-[1.15] [overflow-wrap:anywhere]">{c.name}</span>
                                    <span className="text-[15px] font-normal text-hanji-400">{c.symbol}</span>
                                </>
                            ) : <TextSkeleton w={180} h={28} />}
                        </h1>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2 text-[13px]">
                            <span className="inline-flex items-center gap-1.5 text-success">
                                <Icon name="check" className="w-4 h-4" />
                                {copy.home.verifiedCreator}{copy.offering.dojangSuffix}
                            </span>
                            {statusBadge}
                        </div>
                    </div>
                </div>
                {live ? (
                    <div className="flex-none lg:text-right">
                        <div className="text-[12px] text-hanji-400">{copy.home.closesIn}</div>
                        <div className="num text-[30px] font-medium text-brass-400 leading-tight">{countdown(o.deadline, now, copy.offering.deadline).replace(/^D-0 /, "")}</div>
                    </div>
                ) : (
                    <a className="flex-none text-[13px] inline-flex items-center min-h-[44px]" href={explorerAddr(o.address)} target="_blank" rel="noreferrer">{copy.tx.viewOnChain}</a>
                )}
            </header>

            <div className="mt-6 sm:mt-8 flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-8 min-w-0">
                <div className="contents lg:flex lg:flex-col lg:gap-6 lg:flex-1 lg:min-w-0">
                    {!o.settled && (
                        <section className="order-1 lg:order-none bg-ink-800 border border-ink-700 rounded-card p-4 sm:p-6 min-w-0">
                            <div className="flex items-baseline justify-between gap-3 flex-wrap">
                                <Eyebrow locale={copy.locale}>{copy.offering.progressEyebrow}</Eyebrow>
                                <span className="num text-[15px] text-brass-400">
                                    {copy.offering.ofTarget(pctNum.toFixed(0))}{pctNum > 100 ? ` · ${copy.home.over}` : ""}
                                </span>
                            </div>
                            <div className="mt-3 flex flex-wrap items-baseline gap-x-2">
                                <span className="num text-[36px] font-medium leading-none">{fmt(o.totalCommitted, 0)}</span>
                                <span className="text-[12px] text-hanji-400">{copy.offering.targetOf} <span className="num">{fmt(o.raiseTarget, 0)}</span> KRWs</span>
                            </div>
                            <div className="mt-4"><Gauge committed={o.totalCommitted} target={o.raiseTarget} height={10} /></div>
                            <div className="mt-2 text-[13px] text-hanji-400">
                                {atClose ? copy.offering.totalPrefixAtClose : copy.offering.totalPrefix}<span className="num text-hanji-100">{fmt(o.totalCommitted, 0)}</span>{copy.offering.targetPart(fmt(o.raiseTarget, 0))}
                                {participants !== undefined && <> · {atClose ? copy.home.participantsAtClose(participants) : copy.home.participants(participants)}</>}
                            </div>
                        </section>
                    )}
                    <div className="order-4 lg:order-none text-[15px] leading-relaxed text-hanji-100 space-y-4 min-w-0">
                        <p className="m-0">{copy.offering.about(c ? c.name : null, fmt(o.qSale, 2))}</p>
                        <RedeemNote offering={o.address} redeemManager={o.redeemManager} factory={o.factory} />
                        <VestingNote vesting={o.vesting} />
                    </div>
                    {/* decision 58: chain-fixed terms and the issuer's own document, kept apart */}
                    <div className="order-5 lg:order-none min-w-0"><ChainTerms o={o} /></div>
                    <div className="order-6 lg:order-none min-w-0"><ProceedsPanel o={o} /></div>
                    <div className="order-7 lg:order-none min-w-0"><DisclosureSection o={o} /></div>
                </div>

                <div className="contents lg:flex lg:flex-col lg:gap-4 lg:w-[420px] lg:flex-none lg:sticky lg:top-6">
                    <div className="order-2 lg:order-none min-w-0">
                    <div className="bg-ink-800 border border-[rgba(195,154,59,.55)] rounded-card p-4 sm:p-7">
                        <div className="mb-4">
                            <Eyebrow locale={copy.locale}>{live ? copy.offering.commitEyebrow : o.settled ? copy.offering.allocEyebrow : copy.offering.afterEyebrow}</Eyebrow>
                        </div>

                        <InfoGrid o={o} walletLimit={wl} minCommit={minC} />

                        {live && (
                            <>
                                {frozen && (
                                    <div className="rounded-input px-4 py-3 mb-4 text-[13px] text-brass-400"
                                        style={{background: "rgba(195,154,59,.08)", border: "1px solid rgba(195,154,59,.3)"}}>
                                        {copy.offering.cancelFrozenNote} · {copy.offering.commitStillOpenNote}
                                    </div>
                                )}
                                {issuer ? (
                                    <p className="m-0 text-[14px] text-brass-400">{copy.offering.issuerCannotCommit}</p>
                                ) : (<>
                                <div className="bg-ink-900 border border-ink-700 rounded-input px-4 pt-3 pb-2 focus-within:border-brass-400 mb-2">
                                    <label htmlFor="commit-amount" className="block text-[12px] text-hanji-400">{copy.offering.amountLabel}</label>
                                    <div className="flex items-baseline gap-2 min-w-0">
                                        <input id="commit-amount" value={amount} onChange={(e) => setAmount(sanitizeAmountInput(e.target.value))}
                                            placeholder={copy.offering.amountPlaceholder} inputMode="decimal"
                                            className="num flex-1 min-w-0 bg-transparent border-none outline-none py-1 text-[30px] font-medium text-hanji-100 placeholder:text-hanji-400 placeholder:text-[16px] placeholder:font-sans" />
                                        <span className="text-hanji-400 text-[14px] flex-none">KRWs</span>
                                    </div>
                                </div>
                                {/* W-T63: quick amounts from the limits already read */}
                                <div className="grid grid-cols-2 gap-2 mb-2">
                                    {([[copy.offering.quickMin, quick.min], [copy.offering.quickUpTo, quick.upTo]] as const).map(([label, value]) => (
                                        <button key={label} type="button" disabled={value === null}
                                            onClick={() => value !== null && setAmount(formatUnits(value, 18))}
                                            className="num min-h-[44px] px-1 rounded-[8px] border border-ink-700 text-[13px] text-hanji-100 whitespace-nowrap hover:border-brass-600 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-ink-700">
                                            {label}
                                        </button>
                                    ))}
                                </div>
                                <div className="text-[12px] text-hanji-400 mb-4">
                                    ≈ <span className="num">{o.price > 0n ? fmt((amountWei * 10n ** 18n) / o.price) : "0"}</span>{copy.offering.unit}
                                </div>
                                <TxButton className="w-full" disabled={commitDisabled} action={commit}>
                                    {allowanceLoading ? copy.curve.cta.loading
                                        : needs ? (myCommitted > 0n ? copy.offering.approveCommitMore : copy.offering.approveCommit)
                                        : myCommitted > 0n ? copy.offering.commitMore : copy.offering.commitCta}
                                </TxButton>
                                {commitReason && <p className="text-[12px] text-brass-400 mt-2 mb-0">{commitReason}</p>}
                                </>)}

                                {myCommitted > 0n && (
                                    <div className="mt-5 pt-5 border-t border-ink-700">
                                        <div className="flex justify-between text-[13px] mb-3">
                                            <span className="text-hanji-400">{copy.offering.myStatus}</span>
                                            <span className="text-hanji-100 font-semibold"><span className="num">{fmt(myCommitted, 0)}</span> KRWs</span>
                                        </div>
                                        {frozen ? (
                                            <SecondaryBtn className="w-full" disabled>{copy.offering.cancelLocked}</SecondaryBtn>
                                        ) : (
                                            <TxButton variant="secondary" className="w-full" action={(run) =>
                                                run(copy.offering.cancelCta, () =>
                                                    writeContractAsync({address: o.address, abi: OfferingL1Abi, functionName: "cancel", args: [myCommitted], chainId: giwaSepolia.id}))
                                            }>{copy.offering.cancelAll}</TxButton>
                                        )}
                                    </div>
                                )}
                            </>
                        )}

                        {/* W-T38: after the deadline (unsettled): start refunds, take a refund, or wait for settle */}
                        {(ended || o.refunding) && (
                            <RefundPanel key={offeringViewKey(o.address, account)} o={o} myCommitted={account ? (myCommit.data as bigint | undefined) : undefined} onChanged={() => { refetch(); void detail.refetch(); }} />
                        )}

                        {o.settled && <SettledPanel o={o} account={account} alloc={alloc.data ?? null} claimed={(claimed.data as boolean) ?? false}
                            myCommitted={myCommitted} claim={(a) => (run: RunFn) =>
                                run(copy.offering.claimLabel, () =>
                                    writeContractAsync({address: o.address, abi: OfferingL1Abi, functionName: "claim", args: [a.allocation, a.refund, a.proof], chainId: giwaSepolia.id}))
                            } />}
                    </div>
                    {live && (
                        <p className="text-[12px] text-hanji-400 mt-3 mb-0">
                            {copy.offering.cancelFrozenNote}. {o.refundMode === 0 ? copy.refund.modeNote : copy.refund.partialModeNote}
                        </p>
                    )}
                    </div>
                    {/* W-T63: how allocation works (moved from the left column's note) */}
                    <section className="order-3 lg:order-none bg-ink-800 border border-ink-700 rounded-card p-4 sm:p-6 min-w-0">
                        <Eyebrow locale={copy.locale}>{copy.offering.allocHowTitle}</Eyebrow>
                        <ol className="m-0 mt-3 p-0 list-none flex flex-col gap-2.5">
                            {copy.offering.allocSteps.map((step, i) => (
                                <li key={step} className="flex items-start gap-3 text-[13.5px] text-hanji-100">
                                    <span className="num flex-none text-brass-400">{String(i + 1).padStart(2, "0")}</span>
                                    <span className="min-w-0">{step}</span>
                                </li>
                            ))}
                        </ol>
                        <a className="mt-4 inline-flex items-center min-h-[44px] text-[13px]" href={ALLOC_README} target="_blank" rel="noreferrer">{copy.offering.howToVerify}</a>
                    </section>
                </div>
            </div>
        </div>
    );
}

function InfoGrid({o, walletLimit, minCommit}: {o: OfferingInfo; walletLimit: bigint; minCommit: bigint}) {
    const copy = useCopy();
    const rows: [string, string][] = [
        [copy.terms.price, copy.offering.perToken(fmt(o.price, 0))],
        [copy.offering.saleQty, `${fmt(o.qSale, 2)}${copy.offering.unit}`], // C1: (고정 공급) 라벨 제거
        [copy.offering.minCommit, minCommit > 0n ? `${fmt(minCommit, 0)} KRWs` : "—"], // 9-b: 최소 응모 표기
        [copy.offering.walletLimit, walletLimit > 0n ? `${fmt(walletLimit, 0)} KRWs` : "—"],
        [copy.offering.ifMissed, o.refundMode === 0 ? copy.terms.refundAll : copy.terms.refundPartial],
    ];
    return (
        <dl className="m-0 text-[13px] mb-5 pb-1 border-b border-ink-700 divide-y divide-ink-800">
            {rows.map(([k, v]) => (
                <FragmentRow key={k} k={k} v={v} />
            ))}
            {/* C1: 총공급 분리 표기 */}
            {o.settled && <FragmentRow k={copy.terms.supply} v={copy.offering.totalSupplyLine(fmt(o.totalSupply, 2))} />}
        </dl>
    );
}
/** One dl row; the figures inside the value are set in .num (W-T63). */
function FragmentRow({k, v}: {k: string; v: string}) {
    return (
        <div className="flex justify-between gap-4 py-2 min-w-0">
            <dt className="text-hanji-400 flex-none">{k}</dt>
            <dd className="m-0 text-hanji-100 text-right min-w-0 break-words"><NumText text={v} /></dd>
        </div>
    );
}

function SettledPanel({o, account, alloc, claimed, myCommitted, claim}: {
    o: OfferingInfo;
    account: `0x${string}` | undefined;
    alloc: {allocation: bigint; refund: bigint; proof: `0x${string}`[]} | null;
    claimed: boolean;
    myCommitted: bigint;
    claim: (a: {allocation: bigint; refund: bigint; proof: `0x${string}`[]}) => (run: RunFn) => Promise<unknown>;
}) {
    const copy = useCopy();
    if (!alloc) {
        // 9-d: 미연결 상태에선 "이 지갑" 단정 대신 연결 유도
        return <p className="text-[13px] text-hanji-400 m-0">{account ? copy.offering.notInAllocation : copy.offering.connectForAllocation}</p>;
    }
    return (
        <div>
            <div className="bg-ink-900 rounded-stat p-5 text-center mb-4">
                <div className="text-[12px] text-hanji-400 mb-2">{copy.offering.myAllocResult}</div>
                <div className="font-serif text-[42px] font-semibold tabular-nums leading-none">{/* the big serif figure keeps its face */}
                    {fmt(alloc.allocation, 2)}<span className="text-[19px] text-hanji-400 font-sans">{copy.offering.allocUnit}</span>
                </div>
                {alloc.refund > 0n && (
                    <div className="text-[13px] text-hanji-400 mt-2">+ {copy.offering.myRefund} <span className="num text-hanji-100">{fmt(alloc.refund, 0)}</span> <span className="text-hanji-100">KRWs</span></div>
                )}
            </div>
            <dl className="m-0 text-[13px] mb-4 divide-y divide-ink-800">
                <FragmentRow k={copy.offering.myCommitShort} v={myCommitted > 0n ? `${fmt(myCommitted, 0)} KRWs` : "—"} />
                <FragmentRow k={copy.offering.allocMethod} v={copy.offering.allocMethodValue} />
            </dl>
            {claimed ? (
                <SecondaryBtn className="w-full" disabled>{copy.offering.claimed}</SecondaryBtn>
            ) : (
                <TxButton className="w-full" action={claim(alloc)}>
                    {copy.offering.claimWith(fmt(alloc.allocation, 2), copy.offering.unit, alloc.refund > 0n)}
                </TxButton>
            )}
            <p className="text-[12px] text-hanji-400 mt-3 mb-0 text-center">{copy.offering.recheckNote}</p>
        </div>
    );
}

/** Decision 55: the redeem paragraph only for an offering with redeem items (its RedeemManager's
 *  RedeemableCreated log, the read the redeem page uses). */
function RedeemNote({offering, redeemManager, factory}: {offering: `0x${string}`; redeemManager: `0x${string}` | undefined; factory: `0x${string}`}) {
    const copy = useCopy();
    const {items} = useRedeemItems(offering, redeemManager, factory);
    if (!items || items.length === 0) return null;
    return <p className="m-0">{copy.offering.aboutRedeem}</p>;
}

/** W-T32: the issuer vesting from the offering's own MapaeVesting (no fixed wording): duration, and
 *  the cliff when there is one. Nothing is written when the reads fail. */
function VestingNote({vesting}: {vesting: `0x${string}` | undefined}) {
    const copy = useCopy();
    const reads = useReadContracts({
        contracts: vesting
            ? (["start", "duration", "cliff"] as const).map((fn) => ({address: vesting, abi: MapaeVestingL1Abi as Abi, functionName: fn, chainId: giwaSepolia.id}))
            : [],
        query: {enabled: !!vesting},
    });
    const [start, duration, cliff] = (reads.data?.map((x) => (x.status === "success" ? x.result : undefined)) ?? []) as [bigint?, bigint?, bigint?];
    if (start === undefined || duration === undefined || cliff === undefined) return null;
    return <p className="m-0">{copy.offering.aboutVesting(spanText(duration, copy), cliff > start ? spanText(cliff - start, copy) : null)}</p>;
}
