import {BaseError, ContractFunctionRevertedError, UserRejectedRequestError} from "viem";
import type {Copy} from "../copy";

/** Custom error name of a contract revert, if viem decoded one. */
export function revertName(e: unknown): string | undefined {
    const err = e as BaseError;
    if (!(err instanceof BaseError)) return undefined;
    const revert = err.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    return revert?.data?.errorName;
}

/** Custom error → message in the given dictionary. scope "v3" checks copy.errorsV3 first. */
export function humanError(e: unknown, copy: Copy, scope?: "v3"): string {
    const err = e as BaseError;
    if (err instanceof BaseError) {
        if (err.walk((x) => x instanceof UserRejectedRequestError)) return copy.errors.userRejected;
        const name = revertName(e);
        if (scope === "v3" && name && name in copy.errorsV3) return (copy.errorsV3 as Record<string, string>)[name];
        if (name && name in copy.errors) return (copy.errors as Record<string, string>)[name];
    }
    if (scope === "v3") {
        const hay = [(e as Error)?.message, (err as {shortMessage?: string})?.shortMessage].filter(Boolean).join(" ").toLowerCase();
        for (const key of Object.keys(copy.errorsV3)) {
            if (hay.includes(key.toLowerCase())) return (copy.errorsV3 as Record<string, string>)[key];
        }
    }
    // 이름 + 메시지 + shortMessage를 합쳐 소문자로 부분 매칭 (대소문자/문구 변형 흡수)
    const parts = [
        (e as Error)?.name,
        (e as Error)?.message,
        (err as {shortMessage?: string})?.shortMessage,
    ];
    const hay = parts.filter(Boolean).join(" ").toLowerCase();
    for (const key of Object.keys(copy.errors)) {
        if (hay.includes(key.toLowerCase())) return (copy.errors as Record<string, string>)[key];
    }
    if (hay.includes("user rejected") || hay.includes("denied")) {
        return copy.errors.userRejected;
    }
    return copy.errors.default;
}
