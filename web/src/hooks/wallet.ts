// Wallet profile data: the server profile and trade pages, on-chain balances (one multicall) and
// the real-name status (the same Dojang read as the comments composer).
import {useInfiniteQuery, useQuery} from "@tanstack/react-query";
import {chainUrl} from "../lib/chainUrl";
import {keepSameBase, useChainVersion} from "./chainData";
import {Abi} from "viem";
import {useReadContract, useReadContracts} from "wagmi";
import {API_BASE} from "./meta";
import {MembershipTokenV3Abi, MockDojangV3Abi} from "../contracts/abisV3";
import {ADDR_V3} from "../contracts/addressesV3";
import {giwaSepolia} from "../config/chain";
import type {ServerTrade} from "../lib/chainMerge";
import type {ServerPosition} from "../lib/wallet";

type Address = `0x${string}`;
export const WALLET_TRADES_PAGE = 50;

export type WalletCurveOut = {curve: string; token: string; name: string; symbol: string};
export type WalletOut = {
    nickname: string | null;
    launched: (WalletCurveOut & {createdTs: string})[];
    received: WalletCurveOut[];
    /** indexer position read in the same request as the positions (null: browser trades not added) */
    indexedBlock: string | null;
    positions: ServerPosition[];
    /** more trades than the server folds: positions is empty and P&L is not shown */
    positionsTruncated?: boolean;
};
export type WalletTrade = ServerTrade & {curve: string; symbol: string; block: string};

async function getJson<T>(path: string): Promise<T> {
    const r = await fetch(`${API_BASE}${path}`);
    if (!r.ok) throw new Error(`${path} ${r.status}`);
    return (await r.json()) as T;
}

export const walletKey = (address: string) => ["chain", "wallet", address.toLowerCase()];

export function useWalletProfile(address: string) {
    const v = useChainVersion();
    return useQuery({
        queryKey: [...walletKey(address), v],
        queryFn: () => getJson<WalletOut>(chainUrl("wallet", {address: address.toLowerCase()}, v)),
        staleTime: 60_000,
        retry: 1,
        placeholderData: keepSameBase<WalletOut>(walletKey(address)),
    });
}

/** Trade pages, newest first; the next page starts before the oldest ts seen. Off for an empty
 *  address (e.g. the chart's "my trades" with no wallet connected). */
export function useWalletTrades(address: string) {
    const v = useChainVersion();
    return useInfiniteQuery({
        enabled: address !== "",
        queryKey: ["chain", "wallet-trades", address.toLowerCase(), v],
        initialPageParam: undefined as string | undefined,
        queryFn: ({pageParam}) =>
            getJson<{trades: WalletTrade[]}>(chainUrl("wallet-trades", {address: address.toLowerCase(), limit: WALLET_TRADES_PAGE, before: pageParam}, v)),
        getNextPageParam: (last) => (last.trades.length === WALLET_TRADES_PAGE ? last.trades[last.trades.length - 1].ts : undefined),
        staleTime: 60_000,
        retry: 1,
    });
}

/** balanceOf(address) for every token (deduped, lowercase keys) in one multicall, every 15 s. */
export function useWalletBalances(address: Address, tokens: readonly string[]) {
    const list = [...new Set(tokens.map((t) => t.toLowerCase()))] as Address[];
    const q = useReadContracts({
        contracts: list.map((t) => ({address: t, abi: MembershipTokenV3Abi as Abi, functionName: "balanceOf", args: [address], chainId: giwaSepolia.id})),
        query: {enabled: list.length > 0, refetchInterval: 15_000},
    });
    const map = new Map<Address, bigint>();
    q.data?.forEach((r, i) => {
        if (r.status === "success") map.set(list[i], r.result as bigint);
    });
    // a single failed balanceOf (or the whole batch) means the holdings are incomplete
    const failed = q.isError || (q.data?.some((r) => r.status !== "success") ?? false);
    return {
        balances: map,
        isLoading: q.isLoading && list.length > 0,
        isError: failed,
        /** Every balance of this list answered (an empty list reads nothing). */
        read: list.length > 0 && q.isSuccess && !failed,
    };
}

/** Real-name check (v3.2: ADDR_V3.dojangAnyOf = official Dojang OR MockDojang; isVerified(address)). */
export function useIsVerified(address: Address) {
    return useReadContract({
        address: ADDR_V3.dojangAnyOf,
        abi: MockDojangV3Abi,
        functionName: "isVerified",
        args: [address],
        chainId: giwaSepolia.id,
        query: {refetchInterval: 15_000},
    });
}

/** Official GIWA Dojang only (ADDR_V3.dojangEASAdapter, TESTNET_FAUCET attester): the "GIWA Dojang"
 *  badge. Read for the connected wallet only (pass undefined otherwise), so no extra request per
 *  wallet shown on screen. */
export function useOfficialDojang(address: Address | undefined) {
    return useReadContract({
        address: ADDR_V3.dojangEASAdapter,
        abi: MockDojangV3Abi,
        functionName: "isVerified",
        args: [address ?? "0x0000000000000000000000000000000000000000"],
        chainId: giwaSepolia.id,
        query: {enabled: !!address, refetchInterval: 60_000},
    });
}
