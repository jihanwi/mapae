import {describe, expect, it} from "vitest";
import {ResourceUnavailableRpcError, UserRejectedRequestError} from "viem";
import {ProviderNotFoundError} from "wagmi";
import {classifyConnectError} from "./connectError";

describe("classifyConnectError", () => {
    it("ProviderNotFoundError → noWallet", () => {
        expect(classifyConnectError(new ProviderNotFoundError())).toBe("noWallet");
    });
    it("code 4001 / UserRejectedRequestError → rejected", () => {
        expect(classifyConnectError({code: 4001, message: "User rejected the request."})).toBe("rejected");
        expect(classifyConnectError(new UserRejectedRequestError(new Error("denied")))).toBe("rejected");
    });
    it("code -32002 / ResourceUnavailableRpcError → pending", () => {
        expect(classifyConnectError({code: -32002, message: "Request of type 'wallet_requestPermissions' already pending"})).toBe("pending");
        expect(classifyConnectError(new ResourceUnavailableRpcError(new Error("busy")))).toBe("pending");
    });
    it("anything else → unknown (no substring guessing)", () => {
        expect(classifyConnectError(new Error("provider not found in message only"))).toBe("unknown");
        expect(classifyConnectError({code: -32603})).toBe("unknown");
        expect(classifyConnectError(undefined)).toBe("unknown");
    });
    it("follows the cause chain", () => {
        const wrappedReject = new Error("Connection failed", {cause: new Error("inner", {cause: {code: 4001}})});
        expect(classifyConnectError(wrappedReject)).toBe("rejected");
        const wrappedPending = new Error("outer", {cause: {code: -32002}});
        expect(classifyConnectError(wrappedPending)).toBe("pending");
        const wrappedMissing = new Error("outer", {cause: new ProviderNotFoundError()});
        expect(classifyConnectError(wrappedMissing)).toBe("noWallet");
    });
    it("is safe on cyclic causes", () => {
        const a: {cause?: unknown} = {};
        a.cause = a;
        expect(classifyConnectError(a)).toBe("unknown");
    });
});
