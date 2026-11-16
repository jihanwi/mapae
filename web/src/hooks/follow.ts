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

/** POST /api/profile/follow answer: the state right after the write (never cached). */
export type FollowAnswer = {following: boolean; isFollowing: boolean; targetFollowers: number; myFollowing: number};

/** After a follow write the counts GET can come from the CDN (s-maxage=15) with the old state; for
 *  this long the written wallets' counts are not re-read (the POST answer is shown), then re-read once. */
export const FOLLOW_PROTECT_MS = 20_000;
const protectedUntil = new Map<string, number>();

/** True while `wallet`'s counts must not be re-read (pure: the map and the clock are passed in). */
export function followProtected(until: ReadonlyMap<string, number>, wallet: string, nowMs: number): boolean {
    return (until.get(wallet.toLowerCase()) ?? 0) > nowMs;
}

/** The cached counts of profile `wallet` as seen by `viewer`, updated with a POST answer of `me`
 *  following / unfollowing `target`. Only what the answer states changes: the target's verified
 *  followers and (for my own view) isFollowing, and my following count; nothing is guessed.
 *  undefined when there is nothing to update from. */
export function nextCounts(prev: FollowCounts | undefined, key: {wallet: string; viewer: string | null}, me: string, target: string, ans: FollowAnswer): FollowCounts | undefined {
    if (!prev) return prev;
    const w = key.wallet.toLowerCase();
    const out: FollowCounts = {...prev};
    if (w === target.toLowerCase()) {
        out.followers = ans.targetFollowers;
        if (key.viewer?.toLowerCase() === me.toLowerCase()) out.isFollowing = ans.isFollowing;
    }
    if (w === me.toLowerCase()) out.following = ans.myFollowing;
    return out;
}

export function useFollowCounts(wallet: string, viewer: string | undefined) {
    const qc = useQueryClient();
    const key = [...followKey(wallet), viewer?.toLowerCase() ?? null];
    return useQuery({
        queryKey: key,
        queryFn: async () => {
            const cached = qc.getQueryData<FollowCounts>(key);
            // just after a follow write: keep the POST answer instead of a possibly old CDN copy
            if (cached && followProtected(protectedUntil, wallet, Date.now())) return cached;
            return getJson<FollowCounts>(`/api/profile/follow?wallet=${wallet.toLowerCase()}${viewer ? `&viewer=${viewer.toLowerCase()}` : ""}`);
        },
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
        const me = wallet.toLowerCase();
        const signed = await signWithSession(s, kind, actionPayload(kind, {wallet, target: t}), nowSec());
        const ans = await postJson<FollowAnswer>("/api/profile/follow", {action: kind, target: t, wallet: signed.wallet, session: signed.session, proof: signed.action});
        // show the answer at once and hold it against old CDN copies, then re-read once
        const until = Date.now() + FOLLOW_PROTECT_MS;
        protectedUntil.set(t, until);
        protectedUntil.set(me, until);
        for (const w of [t, me]) {
            for (const [k, prev] of qc.getQueriesData<FollowCounts>({queryKey: followKey(w)})) {
                const next = nextCounts(prev, {wallet: String(k[1]), viewer: (k[2] as string | null) ?? null}, me, t, ans);
                if (next) qc.setQueryData(k, next);
            }
        }
        setTimeout(() => {
            void qc.invalidateQueries({queryKey: followKey(t)});
            void qc.invalidateQueries({queryKey: followKey(me)});
        }, FOLLOW_PROTECT_MS + 100);
        // the feed is keyed by the chain data version: refetch it for the new follow set
        void qc.invalidateQueries({queryKey: ["chain", "feed"]});
        return ans.isFollowing;
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
