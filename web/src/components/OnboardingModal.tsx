// v3 onboarding modal. Opened only from a trade / create CTA (never on page load). Three steps,
// finished steps are skipped: connect + network, testnet real-name verification (ADDR_V3.mockDojang),
// KRWs balance for KRWs curves (ADDR_V3.mockKRW faucet, capped by the contract's FAUCET_CAP).
// Layout note (390px): the panel is w-full with a max width and mx-4 gutter; it scrolls inside
// (max-h + overflow-y-auto) when taller than the viewport.
import {createContext, ReactNode, useCallback, useContext, useState} from "react";
import {Abi} from "viem";
import {useAccount, useBalance, useConnect, useReadContracts, useSwitchChain, useWriteContract} from "wagmi";
import {copy} from "../copy";
import {ADDR_V3} from "../contracts/addressesV3";
import {MockDojangV3Abi, MockKRWV3Abi} from "../contracts/abisV3";
import {giwaSepolia} from "../config/chain";
import {Address, CtaState, ZERO} from "../hooks/curves";
import {fmt} from "../lib/format";
import {faucetAmount} from "../lib/faucet";
import {useToast, useTx} from "./tx";
import {PrimaryBtn, SecondaryBtn} from "./ui";


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
    const {address, isConnected, chainId} = useAccount();
    const push = useToast();
    const {connect, connectors, isPending: connecting} = useConnect({
        mutation: {onError: () => push({kind: "error", text: copy.errors.noWallet})},
    });
    // wagmi's injected connector falls back to wallet_addEthereumChain (giwaSepolia config) when
    // the wallet does not know the chain yet.
    const {switchChain, isPending: switching} = useSwitchChain();
    const {writeContractAsync} = useWriteContract();
    const {run, busy} = useTx();
    const owner = address ?? ZERO;
    const reads = useReadContracts({
        contracts: [
            {address: ADDR_V3.mockDojang, abi: MockDojangV3Abi as Abi, functionName: "isVerified", args: [owner], chainId: giwaSepolia.id},
            {address: ADDR_V3.mockKRW, abi: MockKRWV3Abi as Abi, functionName: "balanceOf", args: [owner], chainId: giwaSepolia.id},
            {address: ADDR_V3.mockKRW, abi: MockKRWV3Abi as Abi, functionName: "FAUCET_CAP", chainId: giwaSepolia.id},
        ],
        query: {enabled: !!address, refetchInterval: 5_000},
    });
    const eth = useBalance({address, chainId: giwaSepolia.id, query: {enabled: !!address, refetchInterval: 5_000}});

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

    const allDone = onRightChain && verified === true && krwDone;

    return (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink-950/80" role="dialog" aria-modal="true" onClick={onClose}>
            <div
                className="w-full max-w-[440px] mx-4 max-h-[90dvh] overflow-y-auto bg-ink-800 border border-ink-700 rounded-card p-5 sm:p-7"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-3 mb-1">
                    <h2 className="m-0 text-[19px] font-bold">{copy.onboardingV3.title}</h2>
                    <button onClick={onClose} aria-label={copy.onboardingV3.close} className="text-hanji-400 hover:text-hanji-100 text-[18px] leading-none min-h-[32px] px-1">
                        ✕
                    </button>
                </div>
                <p className="m-0 mb-3 text-[13px] text-hanji-400">{copy.onboardingV3.sub}</p>

                <Step n={1} title={copy.onboardingV3.connectTitle} done={onRightChain}>
                    {!isConnected ? (
                        <PrimaryBtn
                            className="w-full"
                            disabled={connecting}
                            onClick={() => {
                                const c = connectors[0];
                                if (!c) {
                                    push({kind: "error", text: copy.errors.noWallet});
                                    return;
                                }
                                connect({connector: c, chainId: giwaSepolia.id}, {onSuccess: progress});
                            }}
                        >
                            {copy.connect}
                        </PrimaryBtn>
                    ) : (
                        <PrimaryBtn className="w-full" disabled={switching} onClick={() => switchChain({chainId: giwaSepolia.id}, {onSuccess: progress})}>
                            {copy.wrongChain}
                        </PrimaryBtn>
                    )}
                </Step>

                <Step n={2} title={copy.onboardingV3.verifyTitle} done={verified === true}>
                    <p className="m-0 mb-3 text-[13px] text-hanji-400">{copy.onboardingV3.verifyNote}</p>
                    <SecondaryBtn
                        className="w-full"
                        disabled={!onRightChain || verified === undefined || busy || noGas}
                        onClick={async () => {
                            const ok = await run(copy.onboardingV3.verifyCta, () =>
                                writeContractAsync({address: ADDR_V3.mockDojang, abi: MockDojangV3Abi, functionName: "selfVerify", chainId: giwaSepolia.id})
                            );
                            if (ok) progress();
                        }}
                    >
                        {copy.onboardingV3.verifyCta}
                    </SecondaryBtn>
                </Step>

                {need > 0n && (
                    <Step n={3} title={copy.onboardingV3.krwTitle} done={krwDone}>
                        {krw !== undefined && cap !== undefined && (
                            <>
                                <p className="m-0 mb-3 text-[13px] text-hanji-400 tabular-nums">
                                    {copy.onboardingV3.krwNote(fmt(krw, 0), fmt(need, 0))}
                                </p>
                                <SecondaryBtn
                                    className="w-full"
                                    disabled={!onRightChain || busy || noGas}
                                    onClick={async () => {
                                        const amount = faucetAmount(need - krw, cap);
                                        const ok = await run(copy.onboardingV3.krwCta(fmt(amount, 0)), () =>
                                            writeContractAsync({address: ADDR_V3.mockKRW, abi: MockKRWV3Abi, functionName: "faucet", args: [amount], chainId: giwaSepolia.id})
                                        );
                                        if (ok) progress();
                                    }}
                                >
                                    {copy.onboardingV3.krwCta(fmt(faucetAmount(need - krw, cap), 0))}
                                </SecondaryBtn>
                                {need - krw > cap && <p className="m-0 mt-2 text-[12px] text-hanji-400">{copy.onboardingV3.krwCapNote(fmt(cap, 0))}</p>}
                            </>
                        )}
                    </Step>
                )}

                {isConnected && noGas && (
                    <div className="mt-2 rounded-input px-4 py-3 text-[13px] text-brass-400" style={{background: "rgba(195,154,59,.08)", border: "1px solid rgba(195,154,59,.3)"}}>
                        {copy.onboardingV3.needGas}
                    </div>
                )}
                {isConnected && readFailed && <p className="m-0 mt-2 text-[13px] text-error">{copy.onboardingV3.readError}</p>}

                {allDone && (
                    <div className="border-t border-ink-700 pt-4">
                        <p className="m-0 mb-3 text-[14px] text-success">{copy.onboardingV3.ready}</p>
                        <SecondaryBtn className="w-full" onClick={onClose}>
                            {copy.onboardingV3.close}
                        </SecondaryBtn>
                    </div>
                )}
            </div>
        </div>
    );
}
