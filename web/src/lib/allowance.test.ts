import {describe, expect, it} from "vitest";
import {approvalAlreadySent, simulateWithApprovalRetry, waitForAllowance} from "./allowance";

const seq = (vals: (bigint | Error)[]) => {
    let i = 0;
    const reads = {n: 0};
    const read = async () => {
        reads.n++;
        const v = vals[Math.min(i++, vals.length - 1)];
        if (v instanceof Error) throw v;
        return v;
    };
    return {read, reads};
};

describe("waitForAllowance", () => {
    it("returns at once when the allowance already covers the amount (no sleep)", async () => {
        const sleeps: number[] = [];
        const {read, reads} = seq([100n]);
        expect(await waitForAllowance(read, 100n, {sleep: async (ms) => void sleeps.push(ms)})).toBe(true);
        expect(reads.n).toBe(1);
        expect(sleeps).toEqual([]);
    });
    it("re-reads 700 ms apart until the node catches up", async () => {
        const sleeps: number[] = [];
        const {read, reads} = seq([0n, 0n, new Error("rpc"), 100n]);
        expect(await waitForAllowance(read, 100n, {sleep: async (ms) => void sleeps.push(ms)})).toBe(true);
        expect(reads.n).toBe(4);
        expect(sleeps).toEqual([700, 700, 700]);
    });
    it("gives up after 12 re-reads (about 8 s)", async () => {
        const sleeps: number[] = [];
        const {read, reads} = seq([0n]);
        expect(await waitForAllowance(read, 1n, {sleep: async (ms) => void sleeps.push(ms)})).toBe(false);
        expect(reads.n).toBe(13);
        expect(sleeps.length).toBe(12);
        expect(sleeps.reduce((a, b) => a + b, 0)).toBe(8_400);
    });
});

describe("approvalAlreadySent", () => {
    it("skips a second approval for the same token, spender and amount", () => {
        const sent = {token: "0xAA", spender: "0xBB", amount: 100n};
        expect(approvalAlreadySent(sent, "0xaa", "0xbb", 100n)).toBe(true);
        expect(approvalAlreadySent(sent, "0xaa", "0xbb", 50n)).toBe(true);
        expect(approvalAlreadySent(sent, "0xaa", "0xbb", 101n)).toBe(false);
        expect(approvalAlreadySent(sent, "0xaa", "0xcc", 100n)).toBe(false);
        expect(approvalAlreadySent(null, "0xaa", "0xbb", 1n)).toBe(false);
    });
});

describe("simulateWithApprovalRetry", () => {
    const named = (name?: string) => Object.assign(new Error(name ?? "boom"), {errorName: name});
    const nameOf = (e: unknown) => (e as {errorName?: string}).errorName;
    it("retries once after 1 s when an approval was just sent and the cause is not price or priority", async () => {
        let calls = 0;
        const sleeps: number[] = [];
        await simulateWithApprovalRetry(async () => {
            if (calls++ === 0) throw named("ERC20InsufficientAllowance");
        }, true, nameOf, async (ms) => void sleeps.push(ms));
        expect(calls).toBe(2);
        expect(sleeps).toEqual([1000]);
    });
    it("fails after the single retry", async () => {
        let calls = 0;
        await expect(simulateWithApprovalRetry(async () => { calls++; throw named(); }, true, nameOf, async () => {})).rejects.toThrow();
        expect(calls).toBe(2);
    });
    it("never retries InsufficientOutput, NotVerified, or when no approval was sent", async () => {
        for (const [name, just] of [["InsufficientOutput", true], ["NotVerified", true], [undefined, false]] as const) {
            let calls = 0;
            await expect(simulateWithApprovalRetry(async () => { calls++; throw named(name); }, just, nameOf, async () => {})).rejects.toThrow();
            expect(calls).toBe(1);
        }
    });
});
