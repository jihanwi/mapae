import {describe, expect, it} from "vitest";
import {ERC20_APPROVAL_ABI, needsApproval} from "./approval";
import {MembershipTokenV3Abi, MockKRWV3Abi} from "../contracts/abisV3";
import SRC_TRADE from "../pages/Trade.tsx?raw";
import SRC_REDEEM from "../pages/Redeem.tsx?raw";
import SRC_OFFERING from "../pages/Offering.tsx?raw";
import SRC_CURVE from "../components/CurveTradePanel.tsx?raw";

describe("approval step (W-T37)", () => {
    it("an approval is needed only when the allowance is below the amount", () => {
        expect(needsApproval(0n, 1n)).toBe(true);
        expect(needsApproval(99n, 100n)).toBe(true);
        expect(needsApproval(100n, 100n)).toBe(false);
        expect(needsApproval(10n ** 30n, 100n)).toBe(false);
        expect(needsApproval(0n, 0n)).toBe(false);
    });
    it("an allowance not read yet is unknown, never 'approve'", () => {
        expect(needsApproval(undefined, 100n)).toBeUndefined();
    });
    it("the shared ERC-20 fragment matches both token ABIs (MockKRW, MembershipToken)", () => {
        const sig = (abi: readonly {type: string; name?: string; inputs?: readonly {type: string}[]}[], name: string) =>
            abi.filter((x) => x.type === "function" && x.name === name).map((x) => (x.inputs ?? []).map((i) => i.type).join(","));
        for (const name of ["approve", "allowance"]) {
            const shared = sig(ERC20_APPROVAL_ABI, name);
            expect(sig(MockKRWV3Abi, name)).toEqual(shared);
            expect(sig(MembershipTokenV3Abi, name)).toEqual(shared);
        }
    });
    it("every approval in the offering section and L0 goes through the shared step (no direct approve call)", () => {
        for (const src of [SRC_TRADE, SRC_REDEEM, SRC_OFFERING, SRC_CURVE]) {
            expect(src).not.toMatch(/functionName: "approve"/);
            expect(src).toMatch(/useApprovalStep/);
        }
    });
});
