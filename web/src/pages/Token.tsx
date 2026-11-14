import {Link, useParams} from "react-router-dom";
import {isAddress} from "viem";
import {useReadContract, useReadContracts} from "wagmi";
import {useCopy} from "../copy";
import {Address, CurveDetail, useCurve, ZERO} from "../hooks/curves";
import {CurveFactoryAbi, MapaePoolV3Abi} from "../contracts/abisV3";
import {ADDR_V3} from "../contracts/addressesV3";
import {costToSellOut, grossForNet, marketCapQuote, progressBps, spotPrice, TOTAL_SUPPLY, WAD} from "../lib/curveMath";
import {fmtCeil, fmtRound, fmtSig, shortAddr} from "../lib/format";
import {explorerAddr, giwaSepolia} from "../config/chain";
import {Badge, Gauge, Medallion, NetError, PrimaryBtn, Skeleton, Stat} from "../components/ui";
import {CurveTradePanel} from "../components/CurveTradePanel";
import {pctLabel, quoteUnit} from "./Curves";

// Layout note (390px): single column of full-width blocks (w-full / min-w-0, no fixed widths);
// addresses are shortened, long values wrap via break-all, stat grids are 2 columns.

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

function PriceStats({c}: {c: CurveDetail}) {
    const tr = useCopy();
    const unit = quoteUnit(c);
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
    return (
        <div className="grid grid-cols-2 gap-3">
            <Stat label={tr.curve.spot} value={spot !== undefined ? fmtSig(spot, 4, tr.locale) : poolSpot.isError ? tr.curve.quoteError : "…"} unit={`${unit}${tr.curve.perToken}`} />
            <Stat label={tr.curve.marketCap} value={mcap !== undefined ? fmtRound(mcap, unit === "ETH" ? 4 : 0, tr.locale) : "…"} unit={unit} />
        </div>
    );
}

function Progress({c}: {c: CurveDetail}) {
    const tr = useCopy();
    const unit = quoteUnit(c);
    if (c.graduated) {
        return (
            <div className="bg-ink-800 border border-ink-700 rounded-card p-4 sm:p-6">
                <Gauge committed={10_000n} target={10_000n} height={10} />
                <div className="mt-3 flex items-center justify-between gap-3 flex-wrap text-[14px]">
                    <Badge kind="neutral">{tr.curve.graduated}</Badge>
                    {c.pool !== ZERO && <ExtLink href={explorerAddr(c.pool)}>{tr.curve.poolLink}</ExtLink>}
                </div>
            </div>
        );
    }
    const bps = progressBps(c.virtualQuote, c.r);
    const left = grossForNet(costToSellOut(c.virtualQuote, c.r, c.s), BigInt(c.totalFeeBps));
    return (
        <div className="bg-ink-800 border border-ink-700 rounded-card p-4 sm:p-6">
            <Gauge committed={bps} target={10_000n} height={10} />
            <div className="mt-3 flex justify-between gap-3 flex-wrap text-[13px] tabular-nums">
                <span className="text-hanji-400">{tr.curve.progress(pctLabel(bps))}</span>
                <span className="text-hanji-100">{tr.curve.toGraduate(fmtCeil(left, unit === "ETH" ? 6 : 0, tr.locale), unit)}</span>
            </div>
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
                    <ExtLink href={explorerAddr(a)}>{shortAddr(a)}</ExtLink>
                </div>
            ))}
        </div>
    );
}

export default function Token() {
    const tr = useCopy();
    const {curve: param} = useParams();
    const valid = !!param && isAddress(param);
    const addr = valid ? (param as Address) : undefined;
    // Only curves opened by the v3 CurveFactory are shown (isCurve guard).
    const reg = useReadContracts({
        contracts: [{address: ADDR_V3.curveFactory, abi: CurveFactoryAbi, functionName: "isCurve", args: [addr ?? ZERO], chainId: giwaSepolia.id}],
        query: {enabled: valid},
    });
    const isCurve = reg.data?.[0]?.status === "success" ? (reg.data[0].result as boolean) : undefined;
    const {curve: c, isLoading, isError, refetch} = useCurve(isCurve ? addr : undefined);

    const wrap = (node: React.ReactNode) => <div className="max-w-page mx-auto px-4 sm:px-8 pt-8 sm:pt-10 pb-16 sm:pb-20">{node}</div>;

    if (!valid || isCurve === false) {
        return wrap(
            <div className="text-center pt-8">
                <h1 className="m-0 mb-2 text-[22px] font-bold">{tr.curve.notFoundTitle}</h1>
                <p className="m-0 mb-6 text-[14px] text-hanji-400">{tr.curve.notFoundNote}</p>
                <Link to="/"><PrimaryBtn>{tr.curve.backToList}</PrimaryBtn></Link>
            </div>
        );
    }
    if (reg.isError || isError) return wrap(<NetError onRetry={() => { void reg.refetch(); refetch(); }} />);
    if (isCurve === undefined || isLoading || !c) return wrap(<Skeleton h={320} />);

    return wrap(
        <div className="flex flex-col gap-5 sm:gap-6 max-w-[720px] mx-auto w-full min-w-0">
            <Link to="/" className="text-[14px]">← {tr.curve.backToList}</Link>
            {/* 1) header */}
            <div className="flex items-center gap-4 min-w-0">
                <Medallion char={c.symbol.slice(0, 1) || "馬"} size={64} />
                <div className="min-w-0 flex-1">
                    <h1 className="m-0 text-[24px] sm:text-[28px] font-bold break-all">{c.name}</h1>
                    <div className="text-[13px] text-hanji-400 flex flex-wrap gap-x-3 gap-y-1">
                        <span>{c.symbol}</span>
                        <span>{tr.curve.quoteAsset} {quoteUnit(c)}</span>
                        <span>
                            {tr.curve.dev} <ExtLink href={explorerAddr(c.dev)}>{shortAddr(c.dev)}</ExtLink>
                        </span>
                    </div>
                </div>
            </div>
            {/* 2) people counter */}
            <div className="text-[15px] tabular-nums">
                <span className="font-semibold">{tr.curve.verifiedTraders(c.verifiedBuyerCount)}</span>
                <span className="text-hanji-400 text-[13px]"> ({tr.curve.verifiedTradersNote})</span>
            </div>
            {/* 3) graduation progress */}
            <Progress c={c} />
            {/* 4) price / market cap */}
            <PriceStats c={c} />
            {/* 5) fixed panel */}
            <div className="rounded-input px-4 py-3.5 text-[13px] text-hanji-100 border border-ink-700 bg-ink-900 text-center">
                {tr.curve.fixedPanel}
            </div>
            {/* 6) trade panel */}
            <CurveTradePanel c={c} />
            {/* 7) contract links */}
            <Contracts c={c} />
        </div>
    );
}
