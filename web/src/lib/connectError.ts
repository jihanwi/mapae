// Classify wallet-connect failures so the UI does not say "no wallet" when the user simply
// rejected the request, the wallet is locked, or a request is already pending.
// Checks error classes, EIP-1193 codes and names along the whole cause chain (not substrings).
import {ResourceUnavailableRpcError, UserRejectedRequestError} from "viem";
import {ProviderNotFoundError} from "wagmi";

export type ConnectErrorKind = "noWallet" | "rejected" | "pending" | "unknown";

const MAX_DEPTH = 8;

/** Walk err → err.cause → … (bounded, cycle-safe). */
function chain(err: unknown): unknown[] {
    const out: unknown[] = [];
    let cur: unknown = err;
    while (cur && typeof cur === "object" && out.length < MAX_DEPTH && !out.includes(cur)) {
        out.push(cur);
        cur = (cur as {cause?: unknown}).cause;
    }
    return out;
}

export function classifyConnectError(err: unknown): ConnectErrorKind {
    const links = chain(err);
    const code = (e: unknown) => (e as {code?: unknown}).code;
    const name = (e: unknown) => (e as {name?: unknown}).name;
    if (links.some((e) => e instanceof UserRejectedRequestError || code(e) === 4001 || name(e) === "UserRejectedRequestError")) {
        return "rejected";
    }
    if (links.some((e) => e instanceof ResourceUnavailableRpcError || code(e) === -32002 || name(e) === "ResourceUnavailableRpcError")) {
        return "pending";
    }
    if (links.some((e) => e instanceof ProviderNotFoundError || name(e) === "ProviderNotFoundError")) {
        return "noWallet";
    }
    return "unknown";
}
