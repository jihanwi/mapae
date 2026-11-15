// After an approval is mined, the RPC node may still answer with the old allowance for a moment.
// Wait until it reports at least `needed` before re-quoting / simulating the trade.

export type WaitOpts = {tries?: number; delayMs?: number; sleep?: (ms: number) => Promise<void>};
export const ALLOWANCE_TRIES = 12;
export const ALLOWANCE_DELAY_MS = 700;
export const RESIMULATE_DELAY_MS = 1_000;
export const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Reads the allowance once, then up to `tries` more times `delayMs` apart (12 x 700 ms by
 *  default, about 8 s). True as soon as it covers `needed`; a failed read counts as "not yet". */
export async function waitForAllowance(read: () => Promise<bigint>, needed: bigint, o: WaitOpts = {}): Promise<boolean> {
    const tries = o.tries ?? ALLOWANCE_TRIES;
    const delay = o.delayMs ?? ALLOWANCE_DELAY_MS;
    const sleep = o.sleep ?? sleepMs;
    for (let i = 0; i <= tries; i++) {
        if (i > 0) await sleep(delay);
        try {
            if ((await read()) >= needed) return true;
        } catch {
            // transient RPC error: try again
        }
    }
    return false;
}

/** Approval bookkeeping per trade side: an approval already sent for this spender and at least
 *  this amount is never sent again (a re-press goes straight to the allowance check). */
export type SentApproval = {token: string; spender: string; amount: bigint} | null;
export function approvalAlreadySent(sent: SentApproval, token: string, spender: string, amount: bigint): boolean {
    return !!sent && sent.token.toLowerCase() === token.toLowerCase() && sent.spender.toLowerCase() === spender.toLowerCase() && sent.amount >= amount;
}

/** Simulate once; if an approval was just sent and the revert is neither InsufficientOutput nor
 *  NotVerified (the node may not see the approval yet), wait RESIMULATE_DELAY_MS and try exactly
 *  once more. Any remaining failure is thrown to the caller's normal error handling. */
export async function simulateWithApprovalRetry(
    simulate: () => Promise<unknown>,
    justApproved: boolean,
    errorName: (e: unknown) => string | undefined,
    sleep: (ms: number) => Promise<void> = sleepMs
): Promise<void> {
    try {
        await simulate();
    } catch (e) {
        const name = errorName(e);
        if (!justApproved || name === "InsufficientOutput" || name === "NotVerified") throw e;
        await sleep(RESIMULATE_DELAY_MS);
        await simulate();
    }
}
