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
