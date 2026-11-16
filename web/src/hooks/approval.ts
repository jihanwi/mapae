// Approval step shared by L0 (CurveTradePanel) and the offering section (W-T37). Sends an exact-
// amount approval only when needed and not already sent for this amount, then waits until the RPC
// reports the new allowance (waitForAllowance) before the caller sends its transaction. If it never
// shows up, nothing more is sent and a "not reflected yet" note is shown; pressing again resumes at
// the wait. Moved unchanged from CurveTradePanel.tsx (only the approval toast label is a parameter).
import {useRef} from "react";
import {parseAbi} from "viem";
import {useAccount, usePublicClient, useWriteContract} from "wagmi";
import {useCopy} from "../copy";
import {giwaSepolia} from "../config/chain";
import {RunFn, RunOpts, useToast} from "../components/tx";
import {approvalAlreadySent, SentApproval, waitForAllowance} from "../lib/allowance";

type Address = `0x${string}`;

/** approve + allowance: all MAPAE tokens (MockKRW, MembershipToken) are plain ERC-20 here. */
export const ERC20_APPROVAL_ABI = parseAbi([
    "function approve(address spender, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
]);

/** Whether `amount` needs an approval first: only when the allowance is below it. undefined while
 *  the allowance is not read yet (the caller shows a loading button, never "approve"). */
export function needsApproval(allowance: bigint | undefined, amount: bigint): boolean | undefined {
    if (allowance === undefined) return undefined;
    return allowance < amount;
}

export function useApprovalStep(opts: RunOpts, label?: string) {
    const tr = useCopy();
    const push = useToast();
    const {address} = useAccount();
    const client = usePublicClient({chainId: giwaSepolia.id});
    const {writeContractAsync} = useWriteContract();
    const sent = useRef<SentApproval>(null);
    const ensure = async (run: RunFn, p: {needsApproval: boolean; token: Address; spender: Address; amount: bigint}): Promise<{ok: boolean; justApproved: boolean}> => {
        const already = approvalAlreadySent(sent.current, p.token, p.spender, p.amount);
        if (!p.needsApproval) return {ok: true, justApproved: already};
        if (!already) {
            // exact amount only (never an unlimited approval)
            const ok = await run(label ?? tr.curve.txApprove, () =>
                writeContractAsync({address: p.token, abi: ERC20_APPROVAL_ABI, functionName: "approve", args: [p.spender, p.amount], chainId: giwaSepolia.id}),
                opts
            );
            if (!ok) return {ok: false, justApproved: false};
            sent.current = {token: p.token, spender: p.spender, amount: p.amount};
        }
        if (!client || !address) return {ok: false, justApproved: true};
        const covered = await waitForAllowance(
            () => client.readContract({address: p.token, abi: ERC20_APPROVAL_ABI, functionName: "allowance", args: [address, p.spender]}) as Promise<bigint>,
            p.amount
        );
        if (!covered) {
            push({kind: "error", text: tr.tradeGuard.approvalPending});
            return {ok: false, justApproved: true};
        }
        return {ok: true, justApproved: true};
    };
    return {ensure, done: () => void (sent.current = null)};
}
