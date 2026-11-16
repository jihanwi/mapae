// Follows and the feed (decision 53): counts and the feed through react-query, follow / unfollow
// signed with the 7-day session (the same flow as nicknames and comments).
import {useInfiniteQuery, useQuery, useQueryClient} from "@tanstack/react-query";
import {chainUrl} from "../lib/chainUrl";
import {useChainVersion} from "./chainData";
import {getJson, postJson, withSession} from "./comments";
import {actionPayload, signWithSession, useSession} from "./session";
import type {WalletTrade} from "./wallet";

export type FollowCounts = {followers: number; following: number; isFollowing?: boolean | null};
export type FeedTrade = WalletTrade & {name: string; nickname: string | null};
export const FEED_PAGE = 50;

export const followKey = (wallet: string) => ["follow", wallet.toLowerCase()];

export function useFollowCounts(wallet: string, viewer: string | undefined) {
    return useQuery({
        queryKey: [...followKey(wallet), viewer?.toLowerCase() ?? null],
        queryFn: () =>
            getJson<FollowCounts>(`/api/profile/follow?wallet=${wallet.toLowerCase()}${viewer ? `&viewer=${viewer.toLowerCase()}` : ""}`),
        enabled: wallet !== "",
        staleTime: 15_000,
        retry: 1,
    });
}

const nowSec = () => Math.floor(Date.now() / 1000);

export function useFollowAction() {
    const qc = useQueryClient();
    const {ensure} = useSession();
    return async (kind: "follow" | "unfollow", wallet: string, target: string): Promise<boolean> => {
        const s = await withSession(() => ensure(wallet));
        const t = target.toLowerCase();
        const signed = await signWithSession(s, kind, actionPayload(kind, {wallet, target: t}), nowSec());
        const r = await postJson<{following: boolean}>("/api/profile/follow", {action: kind, target: t, wallet: signed.wallet, session: signed.session, proof: signed.action});
        // the edge caches counts for 15 s: refetch both profiles now that the write is done
        await Promise.all([qc.invalidateQueries({queryKey: followKey(target)}), qc.invalidateQueries({queryKey: followKey(wallet)}), qc.invalidateQueries({queryKey: ["chain", "feed"]})]);
        return r.following;
    };
}

/** Feed pages, newest first; the next page starts before the oldest ts seen. */
export function useFeed(wallet: string | undefined) {
    const v = useChainVersion();
    return useInfiniteQuery({
        queryKey: ["chain", "feed", wallet?.toLowerCase() ?? "", v],
        enabled: !!wallet,
        initialPageParam: undefined as string | undefined,
        queryFn: ({pageParam}) => getJson<{trades: FeedTrade[]}>(chainUrl("feed", {wallet: wallet!.toLowerCase(), before: pageParam}, v)),
        getNextPageParam: (last) => nextFeedBefore(last.trades),
        staleTime: 15_000,
        retry: 1,
    });
}

/** The `before` of the next page: the oldest ts of a full page, none after a short page. */
export function nextFeedBefore(trades: readonly {ts: string}[]): string | undefined {
    return trades.length === FEED_PAGE ? trades[trades.length - 1].ts : undefined;
}
