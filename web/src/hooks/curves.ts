// v3 curve data hooks. Direct RPC only (no indexer, no getLogs). Reads are batched through
// wagmi's useReadContracts, which uses the chain's Multicall3, so the RPC count does not grow
// with the number of curves. Failures are surfaced as error state; there is no fallback data.
import {useEffect, useState} from "react";
import {Abi} from "viem";
import {useAccount, useBalance, useReadContract, useReadContracts} from "wagmi";
import {ADDR_V3} from "../contracts/addressesV3";
import {priorityRemaining} from "../lib/priority";
import {CurveFactoryAbi, CurveSaleAbi, MapaePoolV3Abi, MembershipTokenV3Abi, MockDojangV3Abi} from "../contracts/abisV3";
import {giwaSepolia} from "../config/chain";

export type Address = `0x${string}`;
export const ZERO: Address = "0x0000000000000000000000000000000000000000";

export type CurveInfo = {
    address: Address;
    token: Address;
    quote: Address;
    dev: Address;
    r: bigint;
    s: bigint;
    virtualQuote: bigint;
    graduated: boolean;
    verifiedBuyerCount: number;
    pool: Address;
    totalFeeBps: number;
    name: string;
    symbol: string;
    /** quote === ADDR_V3.weth */
    isEth: boolean;
    /** Position in allCurves (higher = newer). */
    index: number;
    /** v3.1: unix seconds until which only verified wallets may buy. */
    priorityUntil: bigint;
    /** Graduated pool spot (quote per token, 18 decimals); set by useCurves only, after graduation. */
    poolSpot?: bigint;
};

export type CurveDetail = CurveInfo & {
    devAccrued: bigint;
    platformBps: number;
    devBps: number;
    lpSeedBps: number;
};

const CURVE_FIELDS = [
    "token",
    "quote",
    "dev",
    "r",
    "s",
    "virtualQuote",
    "graduated",
    "verifiedBuyerCount",
    "pool",
    "totalFeeBps",
    "priorityUntil",
] as const;
const DETAIL_FIELDS = ["devAccrued", "platformBps", "devBps", "lpSeedBps"] as const;

const curveAbi = CurveSaleAbi as Abi;
const tokenAbi = MembershipTokenV3Abi as Abi;

function toInfo(address: Address, r: unknown[], name: unknown, symbol: unknown, index = 0): CurveInfo {
    const quote = r[1] as Address;
    return {
        address,
        token: r[0] as Address,
        quote,
        dev: r[2] as Address,
        r: r[3] as bigint,
        s: r[4] as bigint,
        virtualQuote: r[5] as bigint,
        graduated: r[6] as boolean,
        verifiedBuyerCount: Number(r[7] as number),
        pool: r[8] as Address,
        totalFeeBps: Number(r[9] as number),
        priorityUntil: BigInt(r[10] as bigint),
        name: name as string,
        symbol: symbol as string,
        isEth: quote.toLowerCase() === ADDR_V3.weth.toLowerCase(),
        index,
    };
}

/** Pull `success` results out of a multicall slice; undefined if any call is missing or failed. */
function results(data: readonly {status: string; result?: unknown}[] | undefined, from: number, n: number) {
    const slice = data?.slice(from, from + n);
    if (!slice || slice.length < n || slice.some((x) => x.status !== "success")) return undefined;
    return slice.map((x) => x.result);
}

/** Every curve from CurveFactory.allCurves(), newest first. 3 RPC calls regardless of N:
 *  allCurves, one batch of curve fields, and one batch of token name/symbol plus the graduated
 *  pools' spotPrice (both need addresses from the first batch). All refresh every 10 s. */
export function useCurves(enabled = true) {
    const list = useReadContract({
        address: ADDR_V3.curveFactory,
        abi: CurveFactoryAbi,
        functionName: "allCurves",
        chainId: giwaSepolia.id,
        query: {enabled, refetchInterval: 10_000},
    });
    const addrs = enabled ? ((list.data ?? []) as readonly Address[]).slice().reverse() : [];
    const fields = useReadContracts({
        contracts: addrs.flatMap((a) => CURVE_FIELDS.map((fn) => ({address: a, abi: curveAbi, functionName: fn, chainId: giwaSepolia.id}))),
        query: {enabled: addrs.length > 0, refetchInterval: 10_000},
    });
    const N = CURVE_FIELDS.length;
    const tokens = addrs.map((_, i) => results(fields.data, i * N, N)?.[0] as Address | undefined);
    // Graduated pools (field 6 = graduated, field 8 = pool), appended after the name/symbol pairs.
    const pools = addrs.map((_, i) => {
        const r = results(fields.data, i * N, N);
        return r && (r[6] as boolean) && (r[8] as Address) !== ZERO ? (r[8] as Address) : undefined;
    });
    const poolIdx = pools.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
    const names = useReadContracts({
        contracts: [
            ...tokens.flatMap((t) => [
                {address: t, abi: tokenAbi, functionName: "name", chainId: giwaSepolia.id},
                {address: t, abi: tokenAbi, functionName: "symbol", chainId: giwaSepolia.id},
            ]),
            ...poolIdx.map((i) => ({address: pools[i], abi: MapaePoolV3Abi as Abi, functionName: "spotPrice", chainId: giwaSepolia.id})),
        ],
        query: {enabled: addrs.length > 0 && tokens.every(Boolean), refetchInterval: 10_000},
    });
    const spotOf = new Map<number, bigint>();
    poolIdx.forEach((i, k) => {
        const x = names.data?.[addrs.length * 2 + k];
        if (x?.status === "success") spotOf.set(i, x.result as bigint);
    });
    const curves: CurveInfo[] = [];
    let incomplete = false;
    addrs.forEach((a, i) => {
        const r = results(fields.data, i * N, N);
        const ns = results(names.data, i * 2, 2);
        if (!r || !ns) {
            incomplete = true;
            return;
        }
        // allCurves order: index 0 is the oldest; addrs is reversed (newest first).
        curves.push({...toInfo(a, r, ns[0], ns[1], addrs.length - 1 - i), poolSpot: spotOf.get(i)});
    });
    const fieldFailed = fields.data?.some((x) => x.status !== "success") ?? false;
    // Only name/symbol failures block the list; a failed pool price leaves that market cap unknown.
    const nameFailed = names.data?.slice(0, addrs.length * 2).some((x) => x.status !== "success") ?? false;
    const isError = list.isError || fields.isError || names.isError || fieldFailed || nameFailed;
    return {
        curves,
        isLoading: !isError && (list.isLoading || (addrs.length > 0 && incomplete)),
        isError,
        error: list.error ?? fields.error ?? names.error ?? null,
        refetch: () => {
            void list.refetch();
            void fields.refetch();
            void names.refetch();
        },
    };
}

/** One curve with fee shares and dev accrual, refreshed every 4 s. */
export function useCurve(address: Address | undefined) {
    const ALL = [...CURVE_FIELDS, ...DETAIL_FIELDS];
    const fields = useReadContracts({
        contracts: ALL.map((fn) => ({address, abi: curveAbi, functionName: fn, chainId: giwaSepolia.id})),
        query: {enabled: !!address, refetchInterval: 4_000},
    });
    const r = results(fields.data, 0, ALL.length);
    const token = r?.[0] as Address | undefined;
    const names = useReadContracts({
        contracts: [
            {address: token, abi: tokenAbi, functionName: "name", chainId: giwaSepolia.id},
            {address: token, abi: tokenAbi, functionName: "symbol", chainId: giwaSepolia.id},
        ],
        query: {enabled: !!token, staleTime: Infinity},
    });
    const ns = results(names.data, 0, 2);
    const fieldFailed = fields.data?.some((x) => x.status !== "success") ?? false;
    const nameFailed = names.data?.some((x) => x.status !== "success") ?? false;
    const curve: CurveDetail | undefined =
        address && r && ns
            ? {
                  ...toInfo(address, r, ns[0], ns[1]),
                  devAccrued: r[11] as bigint,
                  platformBps: Number(r[12] as number),
                  devBps: Number(r[13] as number),
                  lpSeedBps: Number(r[14] as number),
              }
            : undefined;
    return {
        curve,
        isLoading: !!address && !curve && !fieldFailed && !nameFailed && !fields.isError && !names.isError,
        isError: fields.isError || names.isError || fieldFailed || nameFailed,
        error: fields.error ?? names.error ?? null,
        refetch: () => {
            void fields.refetch();
            void names.refetch();
        },
    };
}

/** Debounce a bigint input (default 300 ms) so quote views are not called on every keystroke. */
export function useDebounced<T>(value: T, ms = 300): T {
    const [v, setV] = useState(value);
    useEffect(() => {
        const id = setTimeout(() => setV(value), ms);
        return () => clearTimeout(id);
    }, [value, ms]);
    return v;
}

/** CurveSale.quoteBuy(quoteIn) as returned by the contract (BuyQuote struct). */
export type BuyQuote = {
    tokensOut: bigint;
    quoteSpent: bigint;
    refund: bigint;
    platformFee: bigint;
    devFee: bigint;
    lpSeedFee: bigint;
    nextR: bigint;
    nextS: bigint;
    graduates: boolean;
};

/** CurveSale.quoteSell(tokenIn) as returned by the contract (SellQuote struct). */
export type SellQuote = {
    quoteOut: bigint;
    platformFee: bigint;
    devFee: bigint;
    lpSeedFee: bigint;
    nextR: bigint;
    nextS: bigint;
};

export function useQuoteBuy(curve: Address | undefined, quoteIn: bigint, enabled = true) {
    const q = useDebounced(quoteIn);
    const res = useReadContract({
        address: curve,
        abi: CurveSaleAbi,
        functionName: "quoteBuy",
        args: [q],
        chainId: giwaSepolia.id,
        query: {enabled: enabled && !!curve && q > 0n, refetchInterval: 4_000},
    });
    return {...res, data: res.data as BuyQuote | undefined, settled: q === quoteIn};
}

export function useQuoteSell(curve: Address | undefined, tokenIn: bigint, enabled = true) {
    const t = useDebounced(tokenIn);
    const res = useReadContract({
        address: curve,
        abi: CurveSaleAbi,
        functionName: "quoteSell",
        args: [t],
        chainId: giwaSepolia.id,
        query: {enabled: enabled && !!curve && t > 0n, refetchInterval: 4_000},
    });
    return {...res, data: res.data as SellQuote | undefined, settled: t === tokenIn};
}

/** Graduated pool quote: getTokenOut(quoteIn) for buys, getQuoteOut(tokenIn) for sells. */
export function usePoolQuote(pool: Address | undefined, side: "buy" | "sell", amountIn: bigint, enabled = true) {
    const a = useDebounced(amountIn);
    const res = useReadContract({
        address: pool,
        abi: MapaePoolV3Abi,
        functionName: side === "buy" ? "getTokenOut" : "getQuoteOut",
        args: [a],
        chainId: giwaSepolia.id,
        query: {enabled: enabled && !!pool && pool !== ZERO && a > 0n, refetchInterval: 4_000},
    });
    return {...res, data: res.data as bigint | undefined, settled: a === amountIn};
}

// ---------------------------------------------------------------------------------------------
// CTA state (reusable; the onboarding modal of the next ticket hooks into the same states)
// ---------------------------------------------------------------------------------------------

export type CtaState =
    | {kind: "loading"}
    | {kind: "connect"}
    | {kind: "wrongChain"}
    | {kind: "notVerified"}
    | {kind: "enterAmount"}
    | {kind: "insufficient"}
    | {kind: "approve"; token: Address; spender: Address; amount: bigint}
    | {kind: "ready"}
    /** v3.1: inside the real-name priority window with an unverified wallet (buys only). */
    | {kind: "priorityWait"; remainingSec: number};

export type CtaInput = {
    /** ERC-20 the user pays with; "native" for ETH sent as msg.value. */
    payToken: Address | "native" | undefined;
    /** Amount the user pays (exact quoteIn / tokenIn / pool amountIn). */
    amount: bigint;
    /** Contract that pulls payToken via transferFrom; undefined when no approval is needed. */
    spender: Address | undefined;
    /** Real-name requirement (v3.1): "required" (launch; default), "none" (curve sells, pool swaps)
     *  or a curve buy with its priority window (verified only while the window is open). */
    verify?: VerifyRule;
};

export type VerifyRule = "required" | "none" | {priorityUntil: bigint};

/** Everything the CTA decision needs, already read. Pure so the transitions are testable. */
export type CtaFacts = {
    connected: boolean;
    rightChain: boolean;
    /** undefined while loading (or not needed). */
    verified: boolean | undefined;
    verify: VerifyRule;
    nowSec: number;
    amount: bigint;
    payToken: Address | "native" | undefined;
    spender: Address | undefined;
    nativeBalance: bigint | undefined;
    balance: bigint | undefined;
    allowance: bigint | undefined;
};

export function ctaDecision(f: CtaFacts): CtaState {
    if (!f.connected) return {kind: "connect"};
    if (!f.rightChain) return {kind: "wrongChain"};
    if (f.verify !== "none") {
        const remaining = f.verify === "required" ? Infinity : priorityRemaining(f.verify.priorityUntil, f.nowSec);
        // Only checked while it matters: always for launch, inside the window for a curve buy.
        if (remaining > 0) {
            if (f.verified === undefined) return {kind: "loading"};
            if (!f.verified) return f.verify === "required" ? {kind: "notVerified"} : {kind: "priorityWait", remainingSec: remaining};
        }
    }
    if (f.amount <= 0n || !f.payToken) return {kind: "enterAmount"};
    if (f.payToken === "native") {
        if (f.nativeBalance === undefined) return {kind: "loading"};
        return f.nativeBalance < f.amount ? {kind: "insufficient"} : {kind: "ready"};
    }
    if (f.balance === undefined) return {kind: "loading"};
    if (f.balance < f.amount) return {kind: "insufficient"};
    if (f.spender) {
        if (f.allowance === undefined) return {kind: "loading"};
        if (f.allowance < f.amount) return {kind: "approve", token: f.payToken, spender: f.spender, amount: f.amount};
    }
    return {kind: "ready"};
}

/** Unix seconds, ticking every second only while `active` (e.g. a visible countdown). */
export function useSecondClock(active: boolean): number {
    const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
    useEffect(() => {
        if (!active) return;
        setNow(Math.floor(Date.now() / 1000));
        const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
        return () => clearInterval(id);
    }, [active]);
    return active ? now : Math.floor(Date.now() / 1000);
}

/** Ordered CTA decision: not connected → wrong network → not verified (MockDojang) →
 *  no amount → insufficient balance → approval needed → ready. Approval is for the exact amount. */
export function useTradeCta({payToken, amount, spender, verify = "required"}: CtaInput): {state: CtaState; refetch: () => void} {
    const {address, isConnected, chainId} = useAccount();
    const owner = address ?? ZERO;
    const erc20 = payToken && payToken !== "native" ? payToken : undefined;
    // The window can close while the panel is open: tick every second only while it is open.
    const windowOpen = typeof verify === "object" && priorityRemaining(verify.priorityUntil, Date.now() / 1000) > 0;
    const nowSec = useSecondClock(windowOpen);
    const needsVerified = verify !== "none";
    const reads = useReadContracts({
        contracts: [
            ...(erc20
                ? [
                      {address: erc20, abi: tokenAbi, functionName: "balanceOf", args: [owner], chainId: giwaSepolia.id},
                      {address: erc20, abi: tokenAbi, functionName: "allowance", args: [owner, spender ?? ZERO], chainId: giwaSepolia.id},
                  ]
                : []),
            ...(needsVerified ? [{address: ADDR_V3.dojangAnyOf, abi: MockDojangV3Abi as Abi, functionName: "isVerified", args: [owner], chainId: giwaSepolia.id}] : []),
        ],
        query: {enabled: !!address, refetchInterval: 6_000},
    });
    const native = useBalance({address, chainId: giwaSepolia.id, query: {enabled: !!address && payToken === "native", refetchInterval: 6_000}});
    const refetch = () => {
        void reads.refetch();
        void native.refetch();
    };
    const ok = (i: number) => (reads.data?.[i]?.status === "success" ? reads.data[i].result : undefined);
    const vIdx = erc20 ? 2 : 0;
    const state = ctaDecision({
        connected: isConnected && !!address,
        rightChain: chainId === giwaSepolia.id,
        verified: needsVerified ? (ok(vIdx) as boolean | undefined) : undefined,
        verify,
        nowSec,
        amount,
        payToken,
        spender,
        nativeBalance: native.data?.value,
        balance: erc20 ? (ok(0) as bigint | undefined) : undefined,
        allowance: erc20 ? (ok(1) as bigint | undefined) : undefined,
    });
    return {state, refetch};
}
