// v3 onboarding modal. Opened only from a trade / create CTA (never on page load). Three steps,
// finished steps are skipped: connect + network, testnet real-name verification (read: ADDR_V3.dojangAnyOf,
// self-verify write: ADDR_V3.mockDojang),
// KRWs balance for KRWs curves (ADDR_V3.mockKRW faucet, capped by the contract's FAUCET_CAP).
// Layout note (390px): the panel is w-full with a max width and mx-4 gutter; it scrolls inside
// (max-h + overflow-y-auto) when taller than the viewport.
import {createContext, ReactNode, useCallback, useContext, useState} from "react";
import {Abi} from "viem";
import {useAccount, useBalance, useReadContracts, useWriteContract} from "wagmi";
import {useWalletConnect} from "../hooks/useWalletConnect";
import {useSwitchToGiwa} from "../hooks/useSwitchToGiwa";
import {OpenInWalletApp, WalletPicker} from "./WalletPicker";
import {useCopy} from "../copy";
import {ADDR_V3} from "../contracts/addressesV3";
import {MockDojangV3Abi, MockKRWV3Abi} from "../contracts/abisV3";
import {giwaSepolia} from "../config/chain";
import {Address, CtaState, ZERO} from "../hooks/curves";
import {fmt, fmtCeil} from "../lib/format";
import {faucetAmount} from "../lib/faucet";
import {useTx} from "./tx";
import {Badge, PrimaryBtn, SecondaryBtn} from "./ui";
import {useOfficialDojang} from "../hooks/wallet";


/** CTA states that open the modal instead of rendering a disabled button. `insufficient` only
 *  counts when the user pays with v3 MockKRW (the only asset the modal can top up). */
export function opensOnboarding(state: CtaState, payToken: Address | "native" | undefined): boolean {
    if (state.kind === "connect" || state.kind === "wrongChain" || state.kind === "notVerified") return true;
    return state.kind === "insufficient" && payToken !== undefined && payToken !== "native" && payToken.toLowerCase() === ADDR_V3.mockKRW.toLowerCase();
}

type OpenArgs = {
    /** KRWs needed for the pending action (0 when no KRWs step applies). */
    krwNeeded?: bigint;
    /** Called after each completed step so the caller can refetch its CTA state. */
    onProgress?: () => void;
    /** Whether real-name verification is a required step (default true: launch, comments).
     *  v3.1 trading passes false unless the user is buying inside a curve's priority window. */
    requireVerify?: boolean;
    /** "priority": opened to buy inside a priority window (shows that waiting also works). */
    reason?: "priority";
};

const Ctx = createContext<(a?: OpenArgs) => void>(() => {});

/** Open the v3 onboarding modal. */
export function useOnboardingModal() {
    return useContext(Ctx);
}

export function OnboardingProvider({children}: {children: ReactNode}) {
    const [args, setArgs] = useState<OpenArgs | null>(null);
    const open = useCallback((a?: OpenArgs) => setArgs(a ?? {}), []);
    return (
        <Ctx.Provider value={open}>
            {children}
            {args && <OnboardingModal args={args} onClose={() => setArgs(null)} />}
        </Ctx.Provider>
    );
}

function Step({n, title, done, children}: {n: number; title: string; done: boolean; children?: ReactNode}) {
    return (
        <div className={`border-t border-ink-700 py-4 ${done ? "opacity-60" : ""}`}>
            <div className="flex items-center gap-2.5 mb-2">
                <span
                    className={`w-[22px] h-[22px] rounded-full border grid place-items-center text-[12px] flex-none ${done ? "text-success border-success" : "text-brass-400 border-brass-400"}`}
                >
                    {done ? "✓" : n}
                </span>
                <span className="text-[15px] font-semibold">{title}</span>
            </div>
            {!done && <div className="pl-[32px]">{children}</div>}
        </div>
    );
}

function OnboardingModal({args, onClose}: {args: OpenArgs; onClose: () => void}) {
    const tr = useCopy();
    const {address, isConnected, chainId} = useAccount();

    const {writeContractAsync} = useWriteContract();
    const {run, busy} = useTx();
    const owner = address ?? ZERO;
    const reads = useReadContracts({
        contracts: [
            {address: ADDR_V3.dojangAnyOf, abi: MockDojangV3Abi as Abi, functionName: "isVerified", args: [owner], chainId: giwaSepolia.id},
            {address: ADDR_V3.mockKRW, abi: MockKRWV3Abi as Abi, functionName: "balanceOf", args: [owner], chainId: giwaSepolia.id},
            {address: ADDR_V3.mockKRW, abi: MockKRWV3Abi as Abi, functionName: "FAUCET_CAP", chainId: giwaSepolia.id},
        ],
        query: {enabled: !!address, refetchInterval: 5_000},
    });
    const eth = useBalance({address, chainId: giwaSepolia.id, query: {enabled: !!address, refetchInterval: 5_000}});
    // v3.2: the official GIWA Dojang (adapter) alone, for the badge on this step
    const official = useOfficialDojang(address);

    const onRightChain = isConnected && chainId === giwaSepolia.id;
    const [vR, bR, cR] = reads.data ?? [];
    const readFailed = reads.isError || [vR, bR, cR].some((x) => x && x.status !== "success");
    const verified = vR?.status === "success" ? (vR.result as boolean) : undefined;
    const krw = bR?.status === "success" ? (bR.result as bigint) : undefined;
    const cap = cR?.status === "success" ? (cR.result as bigint) : undefined;
    const need = args.krwNeeded ?? 0n;
    const krwDone = need === 0n || (krw !== undefined && krw >= need);
    const noGas = eth.data !== undefined && eth.data.value === 0n;

    const progress = () => {
        void reads.refetch();
        void eth.refetch();
        args.onProgress?.();
    };

    const wc = useWalletConnect({onSuccess: progress});
    const {switchToGiwa, isPending: switching} = useSwitchToGiwa({onSuccess: progress});
    const requireVerify = args.requireVerify ?? true;
    const allDone = onRightChain && (!requireVerify || verified === true) && krwDone;

    return (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink-950/80" role="dialog" aria-modal="true" onClick={onClose}>
            <div
                className="w-full max-w-[440px] mx-4 max-h-[90dvh] overflow-y-auto bg-ink-800 border border-ink-700 rounded-card p-5 sm:p-7"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-3 mb-1">
                    <h2 className="m-0 text-[19px] font-bold">{tr.onboardingV3.title}</h2>
                    <button onClick={onClose} aria-label={tr.onboardingV3.close} className="text-hanji-400 hover:text-hanji-100 text-[18px] leading-none min-h-[32px] px-1">
                        ✕
                    </button>
                </div>
                <p className="m-0 mb-3 text-[13px] text-hanji-400">{tr.onboardingV3.sub}</p>

                <Step n={1} title={tr.onboardingV3.connectTitle} done={onRightChain}>
                    {!isConnected ? (
                        <PrimaryBtn className="w-full" disabled={wc.isPending} onClick={wc.connectWallet}>
                            {tr.connect}
                        </PrimaryBtn>
                    ) : (
                        <PrimaryBtn className="w-full" disabled={switching} onClick={switchToGiwa}>
                            {tr.wrongChain}
                        </PrimaryBtn>
                    )}
                </Step>

                {requireVerify && (
                <Step n={2} title={tr.onboardingV3.verifyTitle} done={verified === true}>
                    {official.data === true && (
                        <div className="mb-2">
                            <Badge kind="open">{tr.onboardingV3.dojangBadge}</Badge>
                        </div>
                    )}
                    <p className="m-0 mb-3 text-[13px] text-hanji-400">{tr.onboardingV3.verifyNote}</p>
                    {args.reason === "priority" && <p className="m-0 mb-3 text-[12px] text-hanji-400">{tr.onboardingV3.verifyOptional}</p>}
                    <SecondaryBtn
                        className="w-full"
                        disabled={!onRightChain || verified === undefined || busy || noGas}
                        onClick={async () => {
                            const ok = await run(tr.onboardingV3.verifyCta, () =>
                                writeContractAsync({address: ADDR_V3.mockDojang, abi: MockDojangV3Abi, functionName: "selfVerify", chainId: giwaSepolia.id})
                            );
                            if (ok) progress();
                        }}
                    >
                        {tr.onboardingV3.verifyCta}
                    </SecondaryBtn>
                    {/* the official path: a GIWA Dojang from the Playground (DojangAnyOf accepts either) */}
                    <a href="https://sepolia-playground.giwa.io/" target="_blank" rel="noopener noreferrer" className="inline-block mt-3 text-[13px] text-brass-400 hover:text-hanji-100">
                        {tr.onboardingV3.playgroundLink} ↗
                    </a>
                    <p className="m-0 mt-1 text-[12px] text-hanji-400">{tr.onboardingV3.playgroundNote}</p>
                </Step>
                )}

                {need > 0n && (
                    <Step n={requireVerify ? 3 : 2} title={tr.onboardingV3.krwTitle} done={krwDone}>
                        {krw !== undefined && cap !== undefined && (
                            <>
                                <p className="m-0 mb-3 text-[13px] text-hanji-400 tabular-nums">
                                    {tr.onboardingV3.krwNote(fmt(krw, 0, tr.locale), fmtCeil(need, 0, tr.locale))}
                                </p>
                                <SecondaryBtn
                                    className="w-full"
                                    disabled={!onRightChain || busy || noGas}
                                    onClick={async () => {
                                        const amount = faucetAmount(need - krw, cap);
                                        const ok = await run(tr.onboardingV3.krwCta(fmt(amount, 0, tr.locale)), () =>
                                            writeContractAsync({address: ADDR_V3.mockKRW, abi: MockKRWV3Abi, functionName: "faucet", args: [amount], chainId: giwaSepolia.id})
                                        );
                                        if (ok) progress();
                                    }}
                                >
                                    {tr.onboardingV3.krwCta(fmt(faucetAmount(need - krw, cap), 0, tr.locale))}
                                </SecondaryBtn>
                                {need - krw > cap && <p className="m-0 mt-2 text-[12px] text-hanji-400">{tr.onboardingV3.krwCapNote(fmt(cap, 0, tr.locale))}</p>}
                            </>
                        )}
                    </Step>
                )}

                {isConnected && noGas && (
                    <div className="mt-2 rounded-input px-4 py-3 text-[13px] text-brass-400" style={{background: "rgba(195,154,59,.08)", border: "1px solid rgba(195,154,59,.3)"}}>
                        {tr.onboardingV3.needGas}{" "}
                        <a href={tr.onboarding.gasFaucetUrl} target="_blank" rel="noreferrer">
                            {tr.onboardingV3.gasFaucet}
                        </a>
                    </div>
                )}
                {isConnected && readFailed && <p className="m-0 mt-2 text-[13px] text-error">{tr.onboardingV3.readError}</p>}

                {wc.choices && <WalletPicker choices={wc.choices} onChoose={wc.choose} onClose={wc.closePicker} />}
            {wc.openInApp && <OpenInWalletApp onClose={wc.closeOpenInApp} />}
                {allDone && (
                    <div className="border-t border-ink-700 pt-4">
                        <p className="m-0 mb-3 text-[14px] text-success">{tr.onboardingV3.ready}</p>
                        <SecondaryBtn className="w-full" onClick={onClose}>
                            {tr.onboardingV3.close}
                        </SecondaryBtn>
                    </div>
                )}
            </div>
        </div>
    );
}
