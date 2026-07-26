import {BaseError, ContractFunctionRevertedError, UserRejectedRequestError} from "viem";
import {copy} from "../copy";

/** 커스텀 에러 → 한국어 매핑 */
export function humanError(e: unknown): string {
    const err = e as BaseError;
    if (err instanceof BaseError) {
        if (err.walk((x) => x instanceof UserRejectedRequestError)) return copy.errors.userRejected;
        const revert = err.walk((x) => x instanceof ContractFunctionRevertedError) as
            | ContractFunctionRevertedError
            | null;
        const name = revert?.data?.errorName;
        if (name && name in copy.errors) return (copy.errors as Record<string, string>)[name];
    }
    const msg = String((e as Error)?.message ?? "");
    for (const key of Object.keys(copy.errors)) {
        if (msg.includes(key)) return (copy.errors as Record<string, string>)[key];
    }
    if (msg.toLowerCase().includes("user rejected") || msg.toLowerCase().includes("denied")) {
        return copy.errors.userRejected;
    }
    return copy.errors.default;
}
