// "체인에 고정된 조건" (decision 58, W-T34): every row is read from the offering and its children
// (one multicall for the offering and its MapaeVesting, then the FeeRouter tier). A value that could
// not be read is left out, never filled in. The proceeds terms are in ProceedsPanel right below
// (W-T35: shown once).
import {useReadContract, useReadContracts} from "wagmi";
import {Abi} from "viem";
import {useCopy, type Copy} from "../copy";
import {ko} from "../copy/ko";
import {MapaeVestingL1Abi, OfferingL1Abi} from "../contracts/abisV3L1";
import {FeeRouterAbi} from "../contracts/abisV3";
import {giwaSepolia} from "../config/chain";
import {OfferingInfo, useOfferingDetailApi} from "../hooks";
import {fmt, fmtWhen} from "../lib/format";
import {allocationBps, allocationOf} from "../lib/offeringMath";
import {bpsPct, spanText} from "../lib/proceedsText";
import {Eyebrow} from "./ui";
import {NumText} from "./NumText";

const OFFERING_FNS = ["minCommit", "walletLimit", "cBps", "creatorTokenBps", "lpTokenBps", "swapRoyaltyBps", "swapBurnBps", "offeringFeeBps", "feeRouter"] as const;

/** One dl row (W-T63): name 13.5px hanji-400, value 14px; figures in the value set in .num. */
function Row({k, v}: {k: string; v: React.ReactNode}) {
    return (
        <div className="flex justify-between gap-4 py-2.5 min-w-0">
            <dt className="text-[13.5px] text-hanji-400 flex-none max-w-[45%]">{k}</dt>
            <dd className="m-0 text-[14px] text-hanji-100 text-right min-w-0 break-words">{typeof v === "string" ? <NumText text={v} /> : v}</dd>
        </div>
    );
}

/** W-T63: sale / issuer / liquidity / burned as one bar (2px gaps) with a legend. */
function AllocationBar({fBps, creatorTokenBps, cBps}: {fBps: number; creatorTokenBps: number; cBps: number}) {
    const copy = useCopy();
    const a = allocationBps({fBps, creatorTokenBps, cBps});
    const parts = (
        [
            ["sale", a.sale, "bg-brass-400"],
            ["issuer", a.issuer, "bg-brass-600"],
            ["lp", a.lp, "bg-success"],
            ["burn", a.burn, "bg-hanji-400"],
        ] as const
    ).filter(([, bps]) => bps > 0);
    return (
        <div className="mb-4">
            <div role="img" aria-label={allocationText(fBps, creatorTokenBps, cBps, copy)} className="flex gap-[2px] h-[10px] rounded-full overflow-hidden">
                {parts.map(([k, bps, cls]) => (
                    <div key={k} className={cls} style={{width: `${bps / 100}%`}} />
                ))}
            </div>
            <ul className="m-0 mt-2.5 p-0 list-none flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-hanji-400">
                {parts.map(([k, bps, cls]) => (
                    <li key={k} className="inline-flex items-center gap-1.5">
                        <span aria-hidden="true" className={`w-2 h-2 rounded-full ${cls}`} />
                        {copy.terms.legend[k]} <span className="num text-hanji-100">{bpsPct(bps)}%</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

export function ChainTerms({o}: {o: OfferingInfo}) {
    const copy = useCopy();
    const reads = useReadContracts({
        contracts: [
            ...OFFERING_FNS.map((fn) => ({address: o.address, abi: OfferingL1Abi as Abi, functionName: fn, chainId: giwaSepolia.id})),
            ...(o.vesting ? (["start", "duration", "cliff"] as const).map((fn) => ({address: o.vesting!, abi: MapaeVestingL1Abi as Abi, functionName: fn, chainId: giwaSepolia.id})) : []),
        ],
    });
    const r = reads.data?.map((x) => (x.status === "success" ? x.result : undefined)) ?? [];
    const v = Object.fromEntries(OFFERING_FNS.map((fn, i) => [fn, r[i]])) as Record<(typeof OFFERING_FNS)[number], unknown>;
    let i = OFFERING_FNS.length;
    const vest = o.vesting ? (r.slice(i, (i += 3)) as (bigint | undefined)[]) : [];
    const fees = useReadContract({
        address: v.feeRouter as `0x${string}` | undefined, abi: FeeRouterAbi, functionName: "getFees", args: [o.tier], chainId: giwaSepolia.id,
        query: {enabled: v.feeRouter !== undefined},
    }).data as {swapPlatformBps: number; swapLpBps: number} | undefined;
    const detail = useOfferingDetailApi(o.address);
    const createdTs = (detail.data?.offering as {createdTs?: string} | undefined)?.createdTs;

    const n = (x: unknown) => (x === undefined ? undefined : Number(x));
    const cBps = n(v.cBps), creatorBps = n(v.creatorTokenBps);
    const alloc = cBps !== undefined && creatorBps !== undefined ? allocationOf(o.qSale, {fBps: o.fBps, creatorTokenBps: creatorBps, cBps}) : undefined;
    const end = fmtWhen(Number(o.deadline) * 1000, copy.locale);
    const t = copy.terms;
    const royalty = n(v.swapRoyaltyBps), burn = n(v.swapBurnBps);

    const rows: [string, React.ReactNode][] = [
        [t.price, `${fmt(o.price, 0)} KRWs`],
        [t.raiseTarget, `${fmt(o.raiseTarget, 0)} KRWs`],
        [t.saleQty, `${fmt(o.qSale, 2)}${copy.offering.unit}`],
        ...(v.walletLimit !== undefined ? [[t.walletLimit, `${fmt(v.walletLimit as bigint, 0)} KRWs`] as [string, string]] : []),
        ...(v.minCommit !== undefined ? [[t.minCommit, `${fmt(v.minCommit as bigint, 0)} KRWs`] as [string, string]] : []),
        [createdTs ? t.period : t.deadline, createdTs ? t.periodValue(String(Math.round((Number(o.deadline) - Number(createdTs)) / 3600)), end) : end],
        ...(o.settled
            ? [[t.supply, t.supplySettled(fmt(o.totalSupply, 2))] as [string, string]]
            : alloc ? [[t.supply, t.supplyIfFull(fmt(alloc.supply, 2))] as [string, string]] : []),
        ...(creatorBps !== undefined && cBps !== undefined ? [[t.allocation, allocationText(o.fBps, creatorBps, cBps, copy)] as [string, string]] : []),
        ...(vest.length === 3 && vest.every((x) => x !== undefined)
            ? [[t.vesting, t.vestingValue(spanText(vest[1]!, copy), vest[2]! > vest[0]! ? spanText(vest[2]! - vest[0]!, copy) : null)] as [string, string]]
            : []),
        [t.refundMode, o.refundMode === 0 ? t.refundAll : t.refundPartial],
        ...(v.offeringFeeBps !== undefined ? [[t.offeringFee, `${bpsPct(n(v.offeringFeeBps)!)}%`] as [string, string]] : []),
        ...(royalty !== undefined && burn !== undefined && fees
            ? [[t.swapFee, t.swapFeeValue(bpsPct(royalty + burn + fees.swapLpBps + fees.swapPlatformBps), bpsPct(royalty), bpsPct(burn), bpsPct(fees.swapLpBps), bpsPct(fees.swapPlatformBps))] as [string, string]]
            : []),
        [t.sponsorship, o.sponsorship ? t.sponsorshipOn : t.sponsorshipOff],
        [t.lpLock, t.lpLockValue],
        [t.mint, t.mintValue],
    ];
    return (
        <section className="bg-ink-800 border border-ink-700 rounded-card p-4 sm:p-6 min-w-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-4">
                <h2 className="m-0">
                    <Eyebrow locale={copy.locale}>{t.title}</Eyebrow>
                </h2>
                <p className="m-0 text-[12.5px] text-hanji-400">{t.note}</p>
            </div>
            {creatorBps !== undefined && cBps !== undefined && <AllocationBar fBps={o.fBps} creatorTokenBps={creatorBps} cBps={cBps} />}
            <dl className="m-0 divide-y divide-ink-800">
                {rows.map(([k, val]) => <Row key={k} k={k} v={val} />)}
            </dl>
            {creatorBps !== undefined && cBps !== undefined && allocationBps({fBps: o.fBps, creatorTokenBps: creatorBps, cBps}).burn > 0 && (
                <p className="m-0 mt-3 text-[12px] text-hanji-400">{t.allocationNote}</p>
            )}
            {reads.isError && <p className="m-0 mt-3 text-[12px] text-brass-400">{t.readError}</p>}
        </section>
    );
}

/** "판매 60% · 발행자 20% · 유동성 12% · 소각 8%" (the burned share left out when it is 0). */
export function allocationText(fBps: number, creatorTokenBps: number, cBps: number, copy: Copy = ko): string {
    const a = allocationBps({fBps, creatorTokenBps, cBps});
    return copy.terms.allocationValue(bpsPct(a.sale), bpsPct(a.issuer), bpsPct(a.lp), a.burn > 0 ? bpsPct(a.burn) : null);
}
