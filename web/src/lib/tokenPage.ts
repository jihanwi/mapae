// Token page gate. Only curves of the current (v3.1) CurveFactory are shown: an address from an
// older factory reads isCurve == false there and lands on "curve not found", not on an error.
export type TokenPageState = "notFound" | "error" | "loading" | "ready";

export function tokenPageState(f: {validAddress: boolean; isCurve: boolean | undefined; registryError: boolean; curveError: boolean; curveLoaded: boolean}): TokenPageState {
    if (!f.validAddress || f.isCurve === false) return "notFound";
    if (f.registryError || f.curveError) return "error";
    if (f.isCurve === undefined || !f.curveLoaded) return "loading";
    return "ready";
}
