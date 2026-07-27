import {OfferingInfo} from "../hooks";

/** 데모 크리에이터 표시명 — 토큰 심볼 기준 매핑 (재배포에도 유지), 미등록은 토큰명 */
const BY_SYMBOL: Record<string, {name: string; en: string}> = {
    MAPA: {name: "하늘", en: "HANEUL"},
    MAPB: {name: "무진", en: "MUJIN"},
    MAPC: {name: "세연", en: "SEOYEON"},
    MAPD: {name: "다온", en: "DAON"}, // 롤링 사이클 1 (D)
};

/** 심볼 로드 전(null)에는 호출부에서 스켈레톤을 렌더한다 — 폴백 텍스트 금지 */
export function creatorOf(o: Pick<OfferingInfo, "tokenSymbol" | "tokenName">): {name: string; en: string} | null {
    if (!o.tokenSymbol) return null;
    return BY_SYMBOL[o.tokenSymbol] ?? {name: o.tokenName || o.tokenSymbol, en: o.tokenSymbol};
}
