// W-T43: the waitlist state (GET /api/waitlist) and its actions (POST). No module-level memo: the
// state lives in react-query, a failed read is an error state (never "not joined").
import {useQuery, useQueryClient} from "@tanstack/react-query";
import {API_BASE} from "./meta";

/** W-T70: present only when FEATURE_WAITLIST_POINTS is on (the server leaves the keys out otherwise). */
export type WaitlistWeights = {referral: number; follow: number; repost: number; wallet: number};
export type WaitlistMissions = {
    follow: {done: boolean; url: string};
    /** null: the repost mission is off */
    repost: {done: boolean; url: string} | null;
    wallet: {done: boolean};
};
type PointsOn = {pointsEnabled?: true; weights?: WaitlistWeights};

export type WaitlistState =
    | ({joined: false; emailEnabled: boolean; contact: string | null} & PointsOn)
    | ({
          joined: true;
          xUserId: string;
          username: string;
          position: number;
          referrals: number;
          refCode: string;
          shareUrl: string;
          wallet: string | null;
          /** masked (j***@gmail.com) or null */
          email: string | null;
          emailEnabled: boolean;
          contact: string | null;
          points?: number;
          missions?: WaitlistMissions;
      } & PointsOn);

/** "disabled": FEATURE_WAITLIST is off (404). Other failures throw (the page shows a retry). */
export async function fetchWaitlist(): Promise<WaitlistState | "disabled"> {
    const r = await fetch(`${API_BASE}/api/waitlist`, {credentials: "same-origin"});
    if (r.status === 404) return "disabled";
    if (!r.ok) throw new Error(`waitlist ${r.status}`);
    return (await r.json()) as WaitlistState;
}

export function useWaitlist() {
    return useQuery({queryKey: ["waitlist"], queryFn: fetchWaitlist, retry: 1, staleTime: 10_000});
}

export type WaitlistPost =
    | {action: "wallet"; wallet: string; signature: string}
    | {action: "email"; email: string; consent: boolean}
    | {action: "email-remove"}
    | {action: "logout"}
    | {action: "mission"; mission: "follow" | "repost"};

/** POST an action; the answer's `error` code (wallet_taken, bad_email, ...) or null when it worked. */
export function useWaitlistAction() {
    const qc = useQueryClient();
    return async (body: WaitlistPost): Promise<string | null> => {
        const r = await fetch(`${API_BASE}/api/waitlist`, {method: "POST", credentials: "same-origin", headers: {"content-type": "application/json"}, body: JSON.stringify(body)});
        const j = (await r.json().catch(() => ({}))) as {error?: string; joined?: unknown};
        // W-T70: a mission answers my new state; show it at once (points and position), no second read
        if (r.ok && j.joined === true) qc.setQueryData(["waitlist"], j as WaitlistState);
        else await qc.invalidateQueries({queryKey: ["waitlist"]});
        if (r.ok) return null;
        console.warn(`waitlist ${body.action} failed`, r.status, j.error);
        return j.error ?? "failed";
    };
}
