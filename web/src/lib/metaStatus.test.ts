import {describe, expect, it} from "vitest";
import {saveView} from "./metaStatus";

describe("saveView", () => {
    it("launch screen: not_curve reads as 'still saving' and can be retried", () => {
        expect(saveView({phase: "failed", code: "not_curve"}, "launch")).toEqual({kind: "error", message: "launchPending", canRetry: true, retryLabel: "saveAgain"});
        expect(saveView({phase: "failed", code: "temporary"}, "launch")).toEqual({kind: "error", message: "temporary", canRetry: true, retryLabel: "saveAgain"});
    });
    it("launch screen: a retry goes back through signing and can then succeed", () => {
        const steps = [{phase: "failed", code: "not_curve"}, {phase: "signing"}, {phase: "uploading"}, {phase: "saved"}] as const;
        expect(steps.map((s) => saveView(s, "launch").kind)).toEqual(["error", "progress", "progress", "saved"]);
    });
    it("add flow keeps the not_curve message and no retry for it", () => {
        expect(saveView({phase: "failed", code: "not_curve"}, "add")).toEqual({kind: "error", message: "not_curve", canRetry: false, retryLabel: "retry"});
        expect(saveView({phase: "failed", code: "temporary"}, "add").kind).toBe("error");
    });
    it("final errors are never retried", () => {
        for (const ctx of ["launch", "add"] as const) {
            expect(saveView({phase: "failed", code: "already_saved"}, ctx)).toMatchObject({canRetry: false});
            expect(saveView({phase: "failed", code: "not_dev"}, ctx)).toMatchObject({canRetry: false});
        }
        expect(saveView({phase: "idle"}, "launch")).toEqual({kind: "none"});
    });
});
