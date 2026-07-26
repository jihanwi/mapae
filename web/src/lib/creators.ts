import {OfferingInfo} from "../hooks";

/** 데모 크리에이터 표시명 — 토큰 심볼 기준 매핑 (재배포에도 유지), 미등록은 토큰명 */
const BY_SYMBOL: Record<string, {name: string; en: string}> = {
    MAPA: {name: "하늘", en: "HANEUL"},
    MAPB: {name: "무진", en: "MUJIN"},
    MAPC: {name: "세연", en: "SEOYEON"},
};

export function creatorOf(o: Pick<OfferingInfo, "tokenSymbol" | "tokenName">): {name: string; en: string} {
    return BY_SYMBOL[o.tokenSymbol] ?? {name: o.tokenName || "크리에이터", en: o.tokenSymbol || ""};
}
