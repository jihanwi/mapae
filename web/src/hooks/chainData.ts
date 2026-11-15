// Indexed chain data from /api/chain/* (Vercel Functions over Neon). Same API base as the metadata
// hook. A failure is an error state for the caller: the list falls back to the browser RPC window,
// the token page shows a short retry note. No fallback data.
import {Query, useInfiniteQuery, useQuery} from "@tanstack/react-query";
import {chainUrl} from "../lib/chainUrl";
import {API_BASE} from "./meta";
import type {CandleIn} from "../lib/candles";
import type {ServerSummary, ServerTrade} from "../lib/chainMerge";

export type HolderOut = {address: `0x${string}`; balance: string; label: "curve" | "pool" | "dev" | null};
export const HISTORY_PAGE = 50;
export type HoldersOut = {total: number; holders: HolderOut[]};

async function getJson<T>(path: string): Promise<T> {
    const r = await fetch(`${API_BASE}${path}`);
    if (!r.ok) throw new Error(`${path} ${r.status}`);
    return (await r.json()) as T;
}

const opts = {staleTime: 60_000, retry: 1} as const;

export type SummaryWindow = 3600 | 86400;

/** indexedBlock answered by the last catch-up (POST /api/chain/summary). Summary GETs carry it as
 *  v so the 15 s CDN cache cannot hand back a position older than one this tab already saw. */
let pokedBlock: string | null = null;
export function notePokedBlock(b: string | null): void {
    if (b !== null && (pokedBlock === null || BigInt(b) > BigInt(pokedBlock))) pokedBlock = b;
}

/** Per-curve numbers for the last `window` seconds (default 24 h, the token page's choice). */
export function useChainSummary(window: SummaryWindow = 86400) {
    return useQuery({
        queryKey: ["chain", "summary", window],
        queryFn: () => getJson<ServerSummary>(chainUrl("summary", {window: window === 86400 ? undefined : window}, pokedBlock)),
        ...opts,
    });
}

/** The chain data version: the indexer position from the summary (undefined until it loads, null
 *  when the server has no position yet). Part of every other /api/chain query key and URL. */
export function useChainVersion(): string | null | undefined {
    return useChainSummary().data?.indexedBlock;
}

/** While the next data version loads, keep showing the previous data, but only when nothing but the
 *  version changed (key = [...base, version]); another token or wallet starts empty. */
export function keepSameBase<T>(base: readonly unknown[]) {
    const want = JSON.stringify(base);
    return (prev: T | undefined, prevQuery: Query<T, Error, T, readonly unknown[]> | undefined): T | undefined =>
        prevQuery && JSON.stringify(prevQuery.queryKey.slice(0, -1)) === want ? prev : undefined;
}

export type FlowOut = {
    window: number;
    buys: {count: number; volume: string};
    sells: {count: number; volume: string};
    verifiedBuyers: number;
    /** null when sells carry no verified status (the card then hides the sellers line) */
    verifiedSellers: number | null;
    devLaunched: number;
    /** The Dev wallet's nickname (null when none or not indexed). */
    devNickname: string | null;
};

/** Non-Dev 24 h buys and sells of one curve and the Dev's launch count. */
export function useFlow(curve: string) {
    const v = useChainVersion();
    return useQuery({
        queryKey: ["chain", "flow", curve.toLowerCase(), v],
        queryFn: () => getJson<FlowOut>(chainUrl("flow", {curve: curve.toLowerCase()}, v)),
        ...opts,
        placeholderData: keepSameBase<FlowOut>(["chain", "flow", curve.toLowerCase()]),
    });
}

export function useCandles(curve: string, interval: 300 | 3600 | 86400) {
    const v = useChainVersion();
    return useQuery({
        queryKey: ["chain", "candles", curve.toLowerCase(), interval, v],
        queryFn: () => getJson<CandleIn[]>(chainUrl("candles", {curve: curve.toLowerCase(), interval}, v)),
        ...opts,
        placeholderData: keepSameBase<CandleIn[]>(["chain", "candles", curve.toLowerCase(), interval]),
    });
}

export function useHolders(curve: string) {
    const v = useChainVersion();
    return useQuery({
        queryKey: ["chain", "holders", curve.toLowerCase(), v],
        queryFn: () => getJson<HoldersOut>(chainUrl("holders", {curve: curve.toLowerCase()}, v)),
        ...opts,
        placeholderData: keepSameBase<HoldersOut>(["chain", "holders", curve.toLowerCase()]),
    });
}

/** Trade history pages, newest first; the next page starts before the oldest ts seen. */
export function useTradeHistory(curve: string) {
    const v = useChainVersion();
    return useInfiniteQuery({
        queryKey: ["chain", "trades", curve.toLowerCase(), v],
        initialPageParam: undefined as string | undefined,
        queryFn: ({pageParam}) =>
            getJson<{trades: ServerTrade[]}>(chainUrl("trades", {curve: curve.toLowerCase(), limit: HISTORY_PAGE, before: pageParam}, v)),
        getNextPageParam: (last) => (last.trades.length === HISTORY_PAGE ? last.trades[last.trades.length - 1].ts : undefined),
        ...opts,
    });
}
