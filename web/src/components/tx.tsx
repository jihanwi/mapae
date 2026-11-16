import {createContext, useCallback, useContext, useEffect, useState, ReactNode} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {useAccount, usePublicClient} from "wagmi";
import {explorerTx, giwaSepolia} from "../config/chain";
import {humanError, revertName} from "../lib/errors";
import {useCopy} from "../copy";
import {catchUpAfterTx} from "../hooks/poke";
import {PrimaryBtn, SecondaryBtn} from "./ui";

type Toast = {id: number; kind: "pending" | "success" | "error"; text: string; hash?: string};
/** Finished toasts (success / error) disappear after this long; pending ones stay until updated. */
export const TOAST_MS = 8_000;

type Ctx = {
    push: (t: Omit<Toast, "id">) => number;
    /** Close every finished toast (route changes). */
    dismissSettled: () => void;
    update: (id: number, t: Partial<Toast>) => void;
    busyCount: number;
    setBusyCount: (fn: (n: number) => number) => void;
};
const ToastCtx = createContext<Ctx>(null!);

/** 전역 트랜잭션 진행 여부 — 페이지 전체 이중 클릭 가드 */
export function useGlobalTxBusy() {
    return useContext(ToastCtx).busyCount > 0;
}

/** Close finished toasts whenever the route changes (mounted inside the router). */
export function ToastRouteReset({pathname}: {pathname: string}) {
    const {dismissSettled} = useContext(ToastCtx);
    useEffect(() => {
        dismissSettled();
    }, [pathname, dismissSettled]);
    return null;
}

/** 토스트 직접 발행 — run()을 타지 않는 경로(지갑 연결 실패 등)의 무음 실패 방지 (4-a) */
export function useToast() {
    return useContext(ToastCtx).push;
}

export function ToastProvider({children}: {children: ReactNode}) {
    const tr = useCopy();
    const [toasts, setToasts] = useState<Toast[]>([]);
    const [busyCount, setBusyCount] = useState(0);
    const close = useCallback((id: number) => setToasts((s) => s.filter((t) => t.id !== id)), []);
    const push = useCallback(
        (t: Omit<Toast, "id">) => {
            const id = Date.now() + Math.random();
            setToasts((s) => [...s, {...t, id}]);
            if (t.kind !== "pending") setTimeout(() => close(id), TOAST_MS);
            return id;
        },
        [close]
    );
    const update = useCallback(
        (id: number, patch: Partial<Toast>) => {
            setToasts((s) => s.map((t) => (t.id === id ? {...t, ...patch} : t)));
            setTimeout(() => close(id), TOAST_MS);
        },
        [close]
    );
    const dismissSettled = useCallback(() => setToasts((s) => s.filter((t) => t.kind === "pending")), []);
    return (
        <ToastCtx.Provider value={{push, dismissSettled, update, busyCount, setBusyCount}}>
            {children}
            <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-[340px]">
                {toasts.map((t) => (
                    <div key={t.id} className="bg-ink-900 border rounded-input px-4 py-3 text-[13px]"
                        style={{borderColor: t.kind === "error" ? "rgba(201,122,104,.5)" : t.kind === "success" ? "rgba(122,155,109,.5)" : "#3A3126"}}>
                        <div className="flex items-center gap-2">
                            {t.kind === "pending" && <span className="w-3 h-3 rounded-full border-2 border-brass-400 border-t-transparent animate-spin flex-none" />}
                            {t.kind === "success" && <span className="text-success">✓</span>}
                            {t.kind === "error" && <span className="text-error">✕</span>}
                            <span className="text-hanji-100">{t.text}</span>
                        </div>
                        <button type="button" onClick={() => close(t.id)} aria-label={tr.common.close} className="float-right -mt-5 text-hanji-400 hover:text-hanji-100 text-[14px] leading-none px-1">
                            ✕
                        </button>
                        {t.hash && (
                            <a href={explorerTx(t.hash)} target="_blank" rel="noreferrer" className="text-brass-400 text-[12px] hover:text-hanji-100">
                                {tr.tx.viewOnChain}
                            </a>
                        )}
                    </div>
                ))}
            </div>
        </ToastCtx.Provider>
    );
}

export type TxPhase = "idle" | "wallet" | "confirming";
/** scope "v3": v3 error copy; onRevert: called with the decoded custom error name on failure. */
export type RunOpts = {
    scope?: "v3";
    onRevert?: (errorName: string | undefined) => void;
    /** Replaces the default success toast text ("{label}" + the done suffix) when given. */
    successMessage?: string;
};
export type RunFn = (label: string, fn: () => Promise<`0x${string}`>, opts?: RunOpts) => Promise<boolean>;

/** 트랜잭션 실행 훅 — 3단계 상태(서명 대기 → 컨펌 대기 → 완료) + 토스트 + 쿼리 무효화 */
export function useTx() {
    const tr = useCopy();
    const {push, update, setBusyCount} = useContext(ToastCtx);
    const client = usePublicClient();
    const qc = useQueryClient();
    const [busy, setBusy] = useState(false);
    const [phase, setPhase] = useState<TxPhase>("idle");

    const run: RunFn = useCallback(
        async (label, fn, opts) => {
            // H1: 어떤 경로로도 무음 실패 금지. fn은 커넥터 기반
            // writeContractAsync라 wallet client 체크 자체가 불필요 —
            // 영수증 대기용 publicClient만 확인하고, 없으면 안내 토스트.
            if (!client) {
                push({kind: "error", text: tr.tx.notReady});
                return false;
            }
            setBusy(true);
            setBusyCount((n) => n + 1);
            setPhase("wallet"); // ① 지갑 서명 대기
            const id = push({kind: "pending", text: `${label} — ${tr.tx.pendingWallet}`});
            try {
                const hash = await fn();
                setPhase("confirming"); // ② 컨펌 대기
                update(id, {kind: "pending", text: `${label} — ${tr.tx.pendingTx}`, hash});
                const receipt = await client.waitForTransactionReceipt({hash});
                if (receipt.status !== "success") throw new Error("reverted");
                update(id, {kind: "success", text: opts?.successMessage ?? `${label} — ${tr.tx.success}`, hash}); // ③ 완료 (H3)
                // ask the server to catch up 12 s after the last successful tx (the indexer reads 10
                // blocks behind the head), so indexed numbers include this tx
                catchUpAfterTx(qc, receipt.blockNumber);
                await qc.invalidateQueries();
                // 9-f: 로그(이벤트) 인덱싱이 늦는 경우 대비해 잠시 뒤 한 번 더 무효화 → 피드/카운터 즉시 갱신
                setTimeout(() => { void qc.invalidateQueries(); }, 4000);
                return true;
            } catch (e) {
                update(id, {kind: "error", text: humanError(e, tr, opts?.scope)}); // ③′ 실패 — 버튼은 finally에서 복원
                opts?.onRevert?.(revertName(e));
                return false;
            } finally {
                setPhase("idle");
                setBusy(false);
                setBusyCount((n) => n - 1);
            }
        },
        [client, push, update, qc, setBusyCount, tr]
    );
    return {run, busy, phase};
}

/** 온체인 액션 버튼 — 3단계 라벨 + 전역 이중 클릭 가드 일괄 적용.
 *  action은 run을 받아 필요한 만큼 트랜잭션을 실행한다 (approve→commit 등 복합 가능). */
export function TxButton({
    action,
    variant = "primary",
    disabled,
    className,
    children,
}: {
    action: (run: RunFn) => Promise<unknown>;
    variant?: "primary" | "secondary";
    disabled?: boolean;
    className?: string;
    children: ReactNode;
}) {
    const tr = useCopy();
    const {run, busy, phase} = useTx();
    const globalBusy = useGlobalTxBusy();
    const {isConnected, chainId} = useAccount();
    const wrongChain = isConnected && chainId !== giwaSepolia.id; // #7: 잘못된 네트워크에선 tx 차단
    const label = wrongChain
        ? tr.hints.switchChain
        : phase === "wallet" ? tr.tx.pendingWallet : phase === "confirming" ? tr.tx.pendingTx : children;
    const Btn = variant === "primary" ? PrimaryBtn : SecondaryBtn;
    return (
        <Btn className={className} disabled={disabled || busy || globalBusy || wrongChain} onClick={() => void action(run)}>
            {label}
        </Btn>
    );
}
