// Token page gate. Only curves of the current CurveFactory are shown: an address from an older
// factory reads isCurve == false there and lands on "curve not found", not on an error.
// W-T16: a read failure after data loaded once is "stale" (last data + band, trading disabled);
// before that (failing or still loading), the skeleton stays for INITIAL_GRACE_MS, then "error"
// (retry, auto every AUTO_RETRY_MS).
export type TokenPageState = "notFound" | "error" | "loading" | "stale" | "ready";

export const INITIAL_GRACE_MS = 8_000;
export const AUTO_RETRY_MS = 10_000;

export function tokenPageState(f: {
    validAddress: boolean;
    isCurve: boolean | undefined;
    registryError: boolean;
    curveError: boolean;
    curveLoaded: boolean;
    /** The page has shown this curve's data before (it is still at hand). */
    hadData?: boolean;
    /** INITIAL_GRACE_MS passed since the page opened without data. */
    graceOver?: boolean;
}): TokenPageState {
    if (!f.validAddress || f.isCurve === false) return "notFound";
    if (f.registryError || f.curveError) {
        if (f.hadData) return "stale";
        return f.graceOver === false ? "loading" : "error";
    }
    // still nothing after the grace period (slow RPC): the error and its retry instead of a skeleton
    if (f.isCurve === undefined || !f.curveLoaded) return f.graceOver === true ? "error" : "loading";
    return "ready";
}

/** What a retry (the button or the 10 s auto retry) reads again:
 *  - "registry": isCurve is not known yet; the curve read is still off and must not be refetched
 *    (a disabled read has no address, and wagmi batches same-tick multicalls, so its encoding
 *    error would fail the isCurve read in the same batch);
 *  - "curve": isCurve read true; only the curve data failed;
 *  - "both": the last isCurve read failed but an earlier one was true (the curve read stays on). */
export type RetryTarget = "registry" | "curve" | "both";

export function retryTarget(f: {isCurve: boolean | undefined; knownCurve: boolean}): RetryTarget {
    if (f.isCurve === true) return "curve";
    if (f.isCurve === undefined && f.knownCurve) return "both";
    return "registry";
}
