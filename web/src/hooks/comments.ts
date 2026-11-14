// Comments and nicknames: reads through react-query, writes signed with the session key.
import {InfiniteData, useInfiniteQuery, useQuery, useQueryClient} from "@tanstack/react-query";
import {API_BASE} from "./meta";
import {actionPayload, rememberMine, signWithSession, useSession} from "./session";

export type CommentView = {id: number; nickname: string; body: string; createdAt: string; holder: boolean; dev: boolean};
export type CommentPage = {comments: CommentView[]; nextBefore: number | null};
type Pages = InfiniteData<CommentPage, number | undefined>;

/** Server error code from a failed write ("rejected" when the wallet signature was cancelled). */
export class ApiError extends Error {
    constructor(public code: string, public extra: Record<string, unknown> = {}) {
        super(code);
    }
}

async function getJson<T>(path: string): Promise<T> {
    const r = await fetch(`${API_BASE}${path}`);
    if (!r.ok) throw new ApiError(r.status === 503 ? "unavailable" : `http_${r.status}`);
    return (await r.json()) as T;
}
async function postJson<T>(path: string, body: unknown): Promise<T> {
    let r: Response;
    try {
        r = await fetch(`${API_BASE}${path}`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(body)});
    } catch {
        throw new ApiError("unavailable");
    }
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) throw new ApiError(typeof j.error === "string" ? j.error : "unavailable", j);
    return j as T;
}

export const nicknameKey = (wallet: string) => ["nickname", wallet.toLowerCase()];
export const commentsKey = (curve: string) => ["comments", curve.toLowerCase()];

export function useNickname(wallet: string | undefined) {
    return useQuery({
        queryKey: nicknameKey(wallet ?? ""),
        queryFn: () => getJson<{nickname: string | null}>(`/api/profile/nickname?wallet=${wallet!.toLowerCase()}`).then((r) => r.nickname),
        enabled: !!wallet,
        staleTime: 60_000,
        retry: 1,
    });
}

export function useComments(curve: string) {
    return useInfiniteQuery({
        queryKey: commentsKey(curve),
        initialPageParam: undefined as number | undefined,
        queryFn: ({pageParam}) => getJson<CommentPage>(`/api/comments?curve=${curve.toLowerCase()}&limit=30${pageParam ? `&before=${pageParam}` : ""}`),
        getNextPageParam: (last) => last.nextBefore ?? undefined,
        staleTime: 30_000,
        retry: 1,
    });
}

/** The cache with `c` on top of the first page (the edge cache can lag a fresh write). */
export function prependComment(data: Pages | undefined, c: CommentView): Pages {
    if (!data || data.pages.length === 0) return {pages: [{comments: [c], nextBefore: null}], pageParams: [undefined]};
    if (data.pages.some((p) => p.comments.some((x) => x.id === c.id))) return data;
    const [first, ...rest] = data.pages;
    return {...data, pages: [{...first, comments: [c, ...first.comments]}, ...rest]};
}

export function removeComment(data: Pages | undefined, id: number): Pages | undefined {
    if (!data) return data;
    return {...data, pages: data.pages.map((p) => ({...p, comments: p.comments.filter((c) => c.id !== id)}))};
}

const now = () => Math.floor(Date.now() / 1000);

/** Wallet-signature cancellations surface as "rejected". */
async function withSession<T>(ensure: () => Promise<T>): Promise<T> {
    try {
        return await ensure();
    } catch (e) {
        if (e instanceof ApiError) throw e;
        throw new ApiError("rejected");
    }
}

export function useSocialActions() {
    const qc = useQueryClient();
    const {ensure} = useSession();
    return {
        async setNickname(wallet: string, nickname: string): Promise<string> {
            const s = await withSession(() => ensure(wallet));
            const signed = await signWithSession(s, "set-nickname", actionPayload("set-nickname", {wallet, nickname}), now());
            const r = await postJson<{nickname: string}>("/api/profile/nickname", {...signed, nickname});
            qc.setQueryData(nicknameKey(wallet), r.nickname);
            return r.nickname;
        },
        async post(wallet: string, curve: string, body: string): Promise<CommentView> {
            const s = await withSession(() => ensure(wallet));
            const c = curve.toLowerCase();
            const signed = await signWithSession(s, "post-comment", actionPayload("post-comment", {wallet, curve: c, body}), now());
            const created = await postJson<CommentView>("/api/comments", {...signed, curve: c, body});
            rememberMine(wallet, created.id);
            qc.setQueryData<Pages>(commentsKey(curve), (d) => prependComment(d, created));
            return created;
        },
        async remove(wallet: string, curve: string, id: number): Promise<void> {
            const s = await withSession(() => ensure(wallet));
            const signed = await signWithSession(s, "delete-comment", actionPayload("delete-comment", {wallet, id}), now());
            await postJson("/api/comments/delete", {...signed, id});
            qc.setQueryData<Pages>(commentsKey(curve), (d) => removeComment(d, id));
        },
    };
}

/** Composer CTA, in the existing trade CTA order. */
export type CommentCta = "connect" | "switch" | "verify" | "loading" | "nickname" | "sign" | "post";
export function commentCta(s: {connected: boolean; rightChain: boolean; verified: boolean | undefined; nickname: string | null | undefined; hasSession: boolean}): CommentCta {
    if (!s.connected) return "connect";
    if (!s.rightChain) return "switch";
    if (s.verified === undefined) return "loading";
    if (!s.verified) return "verify";
    if (s.nickname === undefined) return "loading";
    if (s.nickname === null) return "nickname";
    return s.hasSession ? "post" : "sign";
}
