import {ReactNode, useMemo, useState} from "react";
import {formatUnits, parseUnits} from "viem";
import {useAccount, useBalance, useReadContract, useWriteContract} from "wagmi";
import {Copy, useCopy} from "../copy";
import {
    Address,
    CtaState,
    CurveDetail,
    useQuoteBuy,
    useQuoteSell,
    usePoolQuote,
    useTradeCta,
    ZERO,
} from "../hooks/curves";
import {CurveFactoryAbi, CurveSaleAbi, MapaePoolV3Abi, MembershipTokenV3Abi} from "../contracts/abisV3";
import {ADDR_V3} from "../contracts/addressesV3";
import {giwaSepolia} from "../config/chain";
import {fmt, fmtCeil, sanitizeAmountInput} from "../lib/format";
import {maxInput} from "../lib/maxInput";
import {RunFn, RunOpts, TxButton} from "./tx";
import {PrimaryBtn} from "./ui";
import {opensOnboarding, useOnboardingModal} from "./OnboardingModal";

// Layout note (390px): full-width column, inputs are flex-1 min-w-0, rows wrap (flex-wrap);
// no element has a fixed pixel width.

type Side = "buy" | "sell";
const SLIPPAGE_BPS = [50, 100, 300] as const;

const minOut = (q: bigint, slipBps: number) => (q * BigInt(10_000 - slipBps)) / 10_000n;

function Row({label, value, strong}: {label: string; value: ReactNode; strong?: boolean}) {
    return (
        <div className="flex justify-between gap-3 text-[13px] mb-1 flex-wrap">
            <span className="text-hanji-400">{label}</span>
            <span className={`tabular-nums text-right ${strong ? "text-hanji-100 font-semibold" : "text-hanji-100"}`}>{value}</span>
        </div>
    );
}

function ctaLabel(tr: Copy, state: CtaState, side: Side): string {
    switch (state.kind) {
        case "connect":
            return tr.curve.cta.connect;
        case "wrongChain":
            return tr.curve.cta.wrongChain;
        case "notVerified":
            return tr.curve.cta.notVerified;
        case "enterAmount":
            return tr.curve.cta.enterAmount;
        case "insufficient":
            return tr.curve.cta.insufficient;
        case "loading":
            return tr.curve.cta.loading;
        case "approve":
            return side === "buy" ? tr.curve.cta.approveBuy : tr.curve.cta.approveSell;
        case "ready":
            return side === "buy" ? tr.curve.cta.buy : tr.curve.cta.sell;
    }
}

function useAmount(raw: string) {
    return useMemo(() => {
        try {
            return parseUnits(raw || "0", 18);
        } catch {
            return 0n;
        }
    }, [raw]);
}

/** Buy/sell panel: curve trades before graduation, pool swaps after. */
export function CurveTradePanel({c}: {c: CurveDetail}) {
    const tr = useCopy();
    const {address} = useAccount();
    const [side, setSide] = useState<Side>("buy");
    const [raw, setRaw] = useState("");
    const [slip, setSlip] = useState<number>(100);
    const amount = useAmount(raw);
    const unit = c.isEth ? "ETH" : "KRWs";

    // Balance shown under the input: the asset being paid on the buy side (KRWs on a KRWs curve,
    // wallet ETH on an ETH curve, the pool's quote token after graduation), the token on the sell side.
    const payNative = side === "buy" && c.isEth && !c.graduated;
    const balToken: Address = side === "sell" ? c.token : c.quote;
    const balUnit = side === "sell" ? c.symbol : c.graduated && c.isEth ? "WETH" : unit;
    const erc20Bal = useReadContract({
        address: balToken,
        abi: MembershipTokenV3Abi,
        functionName: "balanceOf",
        args: [address ?? ZERO],
        chainId: giwaSepolia.id,
        query: {enabled: !!address && !payNative, refetchInterval: 6_000},
    });
    const ethBal = useBalance({address, chainId: giwaSepolia.id, query: {enabled: !!address && payNative, refetchInterval: 6_000}});
    const balance: bigint | undefined = payNative ? ethBal.data?.value : (erc20Bal.data as bigint | undefined);
    const clear = () => setRaw("");

    return (
        <div className="bg-ink-800 border border-ink-700 rounded-card p-4 sm:p-7 min-w-0">
            {c.graduated && (
                <div className="mb-4">
                    <h3 className="m-0 mb-1 text-[17px] font-bold">{tr.curve.poolTitle}</h3>
                    <p className="m-0 text-[12px] text-hanji-400">{tr.curve.poolNote}</p>
                </div>
            )}
            <div className="flex rounded-input overflow-hidden border border-ink-700 mb-5">
                {(["buy", "sell"] as const).map((d) => (
                    <button
                        key={d}
                        onClick={() => {
                            setSide(d);
                            setRaw("");
                        }}
                        className={`flex-1 py-3 text-[14px] font-semibold ${side === d ? "bg-ink-700 text-hanji-100" : "bg-transparent text-hanji-400 hover:text-hanji-100"}`}
                    >
                        {d === "buy" ? tr.curve.buy : tr.curve.sell}
                    </button>
                ))}
            </div>
            <label className="block text-[13px] text-hanji-400 mb-2">
                {side === "buy" ? tr.curve.payLabel(c.graduated && c.isEth ? "WETH" : unit) : tr.curve.sellLabel}
            </label>
            <div className="flex items-center bg-ink-900 border border-ink-700 rounded-input px-4 focus-within:border-brass-400 mb-2">
                <input
                    value={raw}
                    onChange={(e) => setRaw(sanitizeAmountInput(e.target.value))}
                    inputMode="decimal"
                    placeholder="0"
                    className="flex-1 min-w-0 bg-transparent border-none outline-none py-3.5 text-[16px] text-hanji-100 tabular-nums"
                />
                <span className="text-hanji-400 text-[14px] flex-none">{side === "buy" ? (c.graduated && c.isEth ? "WETH" : unit) : c.symbol}</span>
            </div>
            {address && balance !== undefined && (
                <button
                    type="button"
                    title={tr.curve.useMax}
                    onClick={() => setRaw(formatUnits(maxInput(balance, payNative), 18))}
                    className="block text-left bg-transparent border-none p-0 text-[12px] text-hanji-400 hover:text-hanji-100 mb-3 tabular-nums cursor-pointer"
                >
                    {tr.curve.balance(fmt(balance, 4, tr.locale), balUnit)}
                </button>
            )}
            <div className="flex items-center gap-2 mb-4 flex-wrap text-[12px]">
                <span className="text-hanji-400">{tr.curve.slippage}</span>
                {SLIPPAGE_BPS.map((b) => (
                    <button
                        key={b}
                        onClick={() => setSlip(b)}
                        className={`px-3 min-h-[32px] rounded-full border ${slip === b ? "border-brass-400 text-brass-400" : "border-ink-700 text-hanji-400 hover:border-brass-600"}`}
                    >
                        {b / 100}%
                    </button>
                ))}
            </div>
            {c.graduated ? (
                <PoolSide c={c} side={side} amount={amount} slip={slip} onDone={clear} />
            ) : side === "buy" ? (
                <CurveBuy c={c} amount={amount} slip={slip} onDone={clear} />
            ) : (
                <CurveSell c={c} amount={amount} slip={slip} onDone={clear} />
            )}
        </div>
    );
}

/** Label for the button that opens the onboarding modal (no transaction is sent from it). */
export function modalLabel(tr: Copy, state: CtaState): string {
    if (state.kind === "connect") return tr.curve.cta.modalConnect;
    if (state.kind === "wrongChain") return tr.curve.cta.modalSwitch;
    if (state.kind === "notVerified") return tr.curve.cta.modalVerify;
    return tr.curve.cta.modalKrw;
}

function CtaBlock({
    state,
    side,
    action,
    payToken,
    amount,
    refetch,
}: {
    state: CtaState;
    side: Side;
    action: (run: RunFn) => Promise<unknown>;
    payToken: Address | "native";
    amount: bigint;
    refetch: () => void;
}) {
    const tr = useCopy();
    const openModal = useOnboardingModal();
    const krwNeeded = payToken !== "native" && payToken.toLowerCase() === ADDR_V3.mockKRW.toLowerCase() ? amount : 0n;
    if (opensOnboarding(state, payToken)) {
        return (
            <>
                <PrimaryBtn className="w-full" onClick={() => openModal({krwNeeded, onProgress: refetch})}>
                    {modalLabel(tr, state)}
                </PrimaryBtn>
                {state.kind === "notVerified" && <p className="text-[12px] text-brass-400 mt-2 mb-0">{tr.curve.cta.notVerifiedNote}</p>}
            </>
        );
    }
    const enabled = state.kind === "ready" || state.kind === "approve";
    return (
        <TxButton className="w-full" disabled={!enabled} action={action}>
            {ctaLabel(tr, state, side)}
        </TxButton>
    );
}

/** v3 run options: v3 error copy, and reopen onboarding when the tx reverts NotVerified. */
function useRunOpts(refetch: () => void, krwNeeded: bigint): RunOpts {
    const openModal = useOnboardingModal();
    return {
        scope: "v3",
        onRevert: (name) => {
            if (name === "NotVerified") openModal({krwNeeded, onProgress: refetch});
        },
    };
}

function Fees({platform, dev, lp, unit}: {platform: bigint; dev: bigint; lp: bigint; unit: string}) {
    const tr = useCopy();
    const dp = unit === "KRWs" ? 2 : 8;
    return (
        <Row
            label={tr.curve.feeTotal}
            value={`${fmtCeil(platform + dev + lp, dp, tr.locale)} ${unit} (${tr.curve.feePlatform} ${fmtCeil(platform, dp, tr.locale)} · ${tr.curve.feeDev} ${fmtCeil(dev, dp, tr.locale)} · ${tr.curve.feeLp} ${fmtCeil(lp, dp, tr.locale)})`}
        />
    );
}

function CurveBuy({c, amount, slip, onDone}: {c: CurveDetail; amount: bigint; slip: number; onDone: () => void}) {
    const tr = useCopy();
    const {address} = useAccount();
    const {writeContractAsync} = useWriteContract();
    const q = useQuoteBuy(c.address, amount);
    const unit = c.isEth ? "ETH" : "KRWs";
    const dp = c.isEth ? 8 : 2;
    const {state, refetch} = useTradeCta({
        payToken: c.isEth ? "native" : c.quote,
        amount,
        spender: c.isEth ? undefined : c.address,
    });
    const quote = q.settled ? q.data : undefined;
    const effective: CtaState = state.kind === "ready" || state.kind === "approve" ? (quote && quote.tokensOut > 0n ? state : {kind: "loading"}) : state;
    const payToken: Address | "native" = c.isEth ? "native" : c.quote;
    const opts = useRunOpts(refetch, c.isEth ? 0n : amount);

    const action = async (run: RunFn) => {
        if (!quote || !address) return;
        const min = minOut(quote.tokensOut, slip);
        if (state.kind === "approve") {
            const ok = await run(tr.curve.txApprove, () =>
                writeContractAsync({address: c.quote, abi: MembershipTokenV3Abi, functionName: "approve", args: [c.address, amount], chainId: giwaSepolia.id}),
                opts
            );
            if (!ok) return;
        }
        const ok = c.isEth
            ? await run(tr.curve.txBuy(c.symbol), () =>
                  writeContractAsync({
                      address: ADDR_V3.curveFactory,
                      abi: CurveFactoryAbi,
                      functionName: "buyWithETH",
                      args: [c.address, min],
                      value: amount,
                      chainId: giwaSepolia.id,
                  }),
                  opts
              )
            : await run(tr.curve.txBuy(c.symbol), () =>
                  writeContractAsync({address: c.address, abi: CurveSaleAbi, functionName: "buy", args: [amount, min], chainId: giwaSepolia.id}),
                  opts
              );
        if (ok) {
            onDone();
            refetch();
        }
    };

    return (
        <>
            <div className="mb-4">
                {amount > 0n && q.isError && <p className="text-[13px] text-error m-0 mb-2">{tr.curve.quoteError}</p>}
                {amount > 0n && !quote && !q.isError && <p className="text-[13px] text-hanji-400 m-0 mb-2">{tr.curve.quoting}</p>}
                {quote && (
                    <>
                        <Row label={tr.curve.receive} value={`${fmt(quote.tokensOut, 4, tr.locale)} ${c.symbol}`} strong />
                        <Fees platform={quote.platformFee} dev={quote.devFee} lp={quote.lpSeedFee} unit={unit} />
                        <Row label={tr.curve.paid} value={`${fmtCeil(quote.quoteSpent, dp, tr.locale)} ${unit}`} />
                        {quote.refund > 0n && <Row label={tr.curve.refund} value={`${fmt(quote.refund, dp, tr.locale)} ${unit}`} />}
                        {quote.graduates && <p className="text-[12px] text-brass-400 m-0 mt-2">{tr.curve.graduatesNow}</p>}
                    </>
                )}
            </div>
            <CtaBlock state={effective} side="buy" action={action} payToken={payToken} amount={amount} refetch={refetch} />
        </>
    );
}

function CurveSell({c, amount, slip, onDone}: {c: CurveDetail; amount: bigint; slip: number; onDone: () => void}) {
    const tr = useCopy();
    const {address} = useAccount();
    const {writeContractAsync} = useWriteContract();
    const q = useQuoteSell(c.address, amount);
    const unit = c.isEth ? "WETH" : "KRWs";
    const dp = c.isEth ? 8 : 2;
    const {state, refetch} = useTradeCta({payToken: c.token, amount, spender: c.address});
    const quote = q.settled ? q.data : undefined;
    const effective: CtaState = state.kind === "ready" || state.kind === "approve" ? (quote ? state : {kind: "loading"}) : state;
    const opts = useRunOpts(refetch, 0n);

    const action = async (run: RunFn) => {
        if (!quote || !address) return;
        if (state.kind === "approve") {
            const ok = await run(tr.curve.txApprove, () =>
                writeContractAsync({address: c.token, abi: MembershipTokenV3Abi, functionName: "approve", args: [c.address, amount], chainId: giwaSepolia.id}),
                opts
            );
            if (!ok) return;
        }
        const ok = await run(tr.curve.txSell(c.symbol), () =>
            writeContractAsync({
                address: c.address,
                abi: CurveSaleAbi,
                functionName: "sell",
                args: [amount, minOut(quote.quoteOut, slip)],
                chainId: giwaSepolia.id,
            }),
            opts
        );
        if (ok) {
            onDone();
            refetch();
        }
    };

    return (
        <>
            <div className="mb-4">
                {amount > 0n && q.isError && <p className="text-[13px] text-error m-0 mb-2">{tr.curve.quoteError}</p>}
                {amount > 0n && !quote && !q.isError && <p className="text-[13px] text-hanji-400 m-0 mb-2">{tr.curve.quoting}</p>}
                {quote && (
                    <>
                        <Row label={tr.curve.receiveQuote(unit)} value={`${fmt(quote.quoteOut, dp, tr.locale)} ${unit}`} strong />
                        <Fees platform={quote.platformFee} dev={quote.devFee} lp={quote.lpSeedFee} unit={unit} />
                    </>
                )}
                {c.isEth && <p className="text-[12px] text-hanji-400 m-0 mt-2">{tr.curve.wethOut}</p>}
            </div>
            <CtaBlock state={effective} side="sell" action={action} payToken={c.token} amount={amount} refetch={refetch} />
        </>
    );
}

function PoolSide({c, side, amount, slip, onDone}: {c: CurveDetail; side: Side; amount: bigint; slip: number; onDone: () => void}) {
    const tr = useCopy();
    const {address} = useAccount();
    const {writeContractAsync} = useWriteContract();
    const pool = c.pool as Address;
    const q = usePoolQuote(pool, side, amount);
    const payToken = side === "buy" ? c.quote : c.token;
    const {state, refetch} = useTradeCta({payToken, amount, spender: pool});
    const quote = q.settled ? q.data : undefined;
    const effective: CtaState = state.kind === "ready" || state.kind === "approve" ? (quote && quote > 0n ? state : {kind: "loading"}) : state;
    const quoteUnitLabel = c.isEth ? "WETH" : "KRWs";
    const opts = useRunOpts(refetch, side === "buy" && !c.isEth ? amount : 0n);
    const outUnit = side === "buy" ? c.symbol : quoteUnitLabel;

    const action = async (run: RunFn) => {
        if (!quote || !address) return;
        if (state.kind === "approve") {
            const ok = await run(tr.curve.txApprove, () =>
                writeContractAsync({address: payToken, abi: MembershipTokenV3Abi, functionName: "approve", args: [pool, amount], chainId: giwaSepolia.id}),
                opts
            );
            if (!ok) return;
        }
        const ok = await run(side === "buy" ? tr.curve.txBuy(c.symbol) : tr.curve.txSell(c.symbol), () =>
            writeContractAsync({
                address: pool,
                abi: MapaePoolV3Abi,
                functionName: side === "buy" ? "swapQuoteForToken" : "swapTokenForQuote",
                args: [amount, minOut(quote, slip), address],
                chainId: giwaSepolia.id,
            }),
            opts
        );
        if (ok) {
            onDone();
            refetch();
        }
    };

    return (
        <>
            {side === "buy" && c.isEth && <p className="text-[12px] text-brass-400 m-0 mb-3">{tr.curve.poolWethOnly}</p>}
            <div className="mb-4">
                {amount > 0n && q.isError && <p className="text-[13px] text-error m-0 mb-2">{tr.curve.quoteError}</p>}
                {amount > 0n && quote === undefined && !q.isError && <p className="text-[13px] text-hanji-400 m-0 mb-2">{tr.curve.quoting}</p>}
                {quote !== undefined && <Row label={tr.curve.poolReceive} value={`${fmt(quote, side === "buy" ? 4 : c.isEth ? 8 : 2, tr.locale)} ${outUnit}`} strong />}
            </div>
            <CtaBlock state={effective} side={side} action={action} payToken={payToken} amount={amount} refetch={refetch} />
        </>
    );
}
