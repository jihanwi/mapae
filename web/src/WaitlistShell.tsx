// W-T45: the shell of /waitlist and /privacy. Logo and wordmark (to /waitlist) and KO / EN only: no
// app menu, no wallet button, no faucet, no network switch. Wallet linking happens inside the
// waitlist page (a signature needs no particular chain). No link here leads to the testnet app.
import {Link, Navigate, Outlet, useLocation} from "react-router-dom";
import {useCopy} from "./copy";
import {LangToggle} from "./components/LangToggle";
import {Medallion} from "./components/ui";
import {waitlistTarget} from "./lib/waitlistOnly";

export function WaitlistShell({children}: {children?: React.ReactNode}) {
    const tr = useCopy();
    return (
        <div className="min-h-[100dvh] bg-ink-950 text-hanji-100">
            <div className="border-b border-ink-700">
                <div className="max-w-page mx-auto px-4 sm:px-8 min-h-[60px] sm:min-h-[64px] py-2 flex items-center gap-x-3">
                    <Link to="/waitlist" className="flex items-center gap-2.5 flex-none">
                        <img src={`${import.meta.env.BASE_URL}logo.png`} alt={tr.nav.logoAlt} className="h-9 w-auto block" />
                        <span className="font-serif text-[17px] font-bold text-hanji-100" style={{letterSpacing: "0.16em"}}>MAPAE</span>
                    </Link>
                    <div className="flex-1" />
                    <LangToggle />
                </div>
            </div>
            {children ?? <Outlet />}
        </div>
    );
}

/** A centered note under the logo medallion: "Opening soon" (waitlist off on a waitlist-only host)
 *  or "page not found". `toWaitlist` adds a link back to /waitlist, never to the app. */
export function WaitlistNote({title, note, toWaitlist}: {title: string; note?: string; toWaitlist?: boolean}) {
    const tr = useCopy();
    return (
        <div className="max-w-[560px] mx-auto px-4 sm:px-8 pt-16 pb-20 text-center">
            <div className="flex justify-center mb-5"><Medallion char="馬" size={88} dashed /></div>
            <h1 className="m-0 mb-2 text-[22px] font-bold">{title}</h1>
            {note && <p className="m-0 mb-6 text-[14px] text-hanji-400">{note}</p>}
            {toWaitlist && <Link to="/waitlist" className="text-[14px]">{tr.waitlist.eyebrow}</Link>}
        </div>
    );
}

/** Any other path on a waitlist-only host: to /waitlist, keeping ref and lang. */
export function ToWaitlist() {
    const {search} = useLocation();
    return <Navigate to={waitlistTarget(search)} replace />;
}
