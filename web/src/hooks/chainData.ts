// Indexed chain data from /api/chain/* (Vercel Functions over Neon). Same API base as the metadata
// hook. A failure is an error state for the caller: the list falls back to the browser RPC window,
// the token page shows a short retry note. No fallback data.
import {useInfiniteQuery, useQuery} from "@tanstack/react-query";
import {API_BASE} from "./meta";
import type {CandleIn} from "../lib/candles";
import type {ServerSummary, ServerTrade} from "../lib/chainMerge";

export type HolderOut = {address: `0x${string}`; balance: string; label: "curve" | "pool" | "dev" | null};
export const HISTORY_PAGE = 50;

async function getJson<T>(path: string): Promise<T> {
    const r = await fetch(`${API_BASE}${path}`);
    if (!r.ok) throw new Error(`${path} ${r.status}`);
    return (await r.json()) as T;
}

const opts = {staleTime: 60_000, retry: 1} as const;

export function useChainSummary() {
    return useQuery({queryKey: ["chain", "summary"], queryFn: () => getJson<ServerSummary>("/api/chain/summary"), ...opts});
}

export function useCandles(curve: string, interval: 300 | 3600 | 86400) {
    return useQuery({
        queryKey: ["chain", "candles", curve.toLowerCase(), interval],
        queryFn: () => getJson<CandleIn[]>(`/api/chain/candles?curve=${curve.toLowerCase()}&interval=${interval}`),
        ...opts,
    });
}

export function useHolders(curve: string) {
    return useQuery({
        queryKey: ["chain", "holders", curve.toLowerCase()],
        queryFn: () => getJson<{total: number; holders: HolderOut[]}>(`/api/chain/holders?curve=${curve.toLowerCase()}`),
        ...opts,
    });
}

/** Trade history pages, newest first; the next page starts before the oldest ts seen. */
export function useTradeHistory(curve: string) {
    return useInfiniteQuery({
        queryKey: ["chain", "trades", curve.toLowerCase()],
        initialPageParam: undefined as string | undefined,
        queryFn: ({pageParam}) =>
            getJson<{trades: ServerTrade[]}>(`/api/chain/trades?curve=${curve.toLowerCase()}&limit=${HISTORY_PAGE}${pageParam ? `&before=${pageParam}` : ""}`),
        getNextPageParam: (last) => (last.trades.length === HISTORY_PAGE ? last.trades[last.trades.length - 1].ts : undefined),
        ...opts,
    });
}
