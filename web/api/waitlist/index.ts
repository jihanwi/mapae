// /api/waitlist (W-T43): the waitlist with X sign-in. Off unless FEATURE_WAITLIST = "1" (404
// {"error":"disabled"}). Logic in _lib/waitlistApi.ts; also serves the /waitlist, /waitlist/callback
// and /w/:code rewrites (vercel.json). W-T52: ?card=<code> returns the line-number card PNG.
// W-T70: points and missions behind FEATURE_WAITLIST_POINTS.
import {ensureSchema, getSql, joinWaitlist, removeWaitlistEmail, setWaitlistEmail, setWaitlistMission, setWaitlistWallet, waitlistMe, waitlistPositionByCode, withSchemaRetry} from "../_lib/db.js";
import {renderCard} from "../_lib/waitlistCard.js";
import {preflight} from "../_lib/http.js";
import {handleWaitlist, WaitlistStore} from "../_lib/waitlistApi.js";

function store(): WaitlistStore {
    const sql = getSql();
    const retry = <T>(label: string, run: () => Promise<T>) => withSchemaRetry(`waitlist ${label}`, run, () => ensureSchema(sql));
    return {
        join: (j) => retry("join", () => joinWaitlist(sql, j)),
        me: (xid, rank) => retry("me", () => waitlistMe(sql, xid, rank)),
        setWallet: (xid, wallet) => retry("wallet", () => setWaitlistWallet(sql, xid, wallet)),
        setEmail: (xid, email) => retry("email", () => setWaitlistEmail(sql, xid, email)),
        removeEmail: (xid) => retry("email-remove", () => removeWaitlistEmail(sql, xid)),
        positionByCode: (code, rank) => retry("card", () => waitlistPositionByCode(sql, code, rank)),
        setMission: (xid, mission) => retry("mission", () => setWaitlistMission(sql, xid, mission)),
    };
}

const deps = () => ({env: process.env, store, fetch, nowSec: () => Math.floor(Date.now() / 1000), renderCard});

export const GET = (request: Request) => handleWaitlist(request, deps());
export const POST = (request: Request) => handleWaitlist(request, deps());
export async function HEAD(request: Request): Promise<Response> {
    const r = await handleWaitlist(request, deps());
    return new Response(null, {status: r.status, headers: r.headers});
}
export const OPTIONS = (request: Request) => preflight(request);
