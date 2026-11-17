// W-T45: the shell of /waitlist and /privacy. The "MAPAE" wordmark (to /waitlist) and KO / EN only:
// no app menu, no wallet button, no faucet, no network switch. Wallet linking happens inside the
// waitlist page (a signature needs no particular chain). No link here leads to the testnet app.
// W-T49: one flat ink-950 background, no border under the bar, text wordmark only.
import {Link, Navigate, Outlet, useLocation} from "react-router-dom";
import {useCopy} from "./copy";
import {LangToggle} from "./components/LangToggle";
import {waitlistTarget} from "./lib/waitlistOnly";

export const LOGO_SRC = `${import.meta.env.BASE_URL}logo.png`;

export function WaitlistShell({children}: {children?: React.ReactNode}) {
    return (
        <div className="min-h-[100dvh] bg-ink-950 text-hanji-100 flex flex-col">
            <div className="px-5 sm:px-10 py-2 flex items-center gap-x-3">
                <Link
                    to="/waitlist"
                    className="min-h-[44px] flex items-center font-serif text-[14px] font-bold text-hanji-400 hover:text-hanji-100"
                    style={{letterSpacing: "0.32em"}}
                >
                    MAPAE
                </Link>
                <div className="flex-1" />
                <LangToggle />
            </div>
            <main className="flex-1 flex flex-col">{children ?? <Outlet />}</main>
        </div>
    );
}

/** "WAITLIST": an English label in every language. */
export function WaitlistLabel() {
    const t = useCopy().waitlist;
    return (
        <p className="m-0 text-[12px] sm:text-[13px] font-semibold text-brass-400" style={{letterSpacing: "0.42em", paddingLeft: "0.42em"}}>
            {t.eyebrow}
        </p>
    );
}

/** The vertically centered column under the bar (the pre-join screen and the notes). */
/** `hero` (the pre-join screen): sizes and gaps from the .wl-hero rules in index.css (W-T51). */
export function TeaserStage({children, hero}: {children: React.ReactNode; hero?: boolean}) {
    const gap = hero ? "wl-hero" : "gap-[26px] sm:gap-[30px]";
    return (
        <div className={`flex-1 flex flex-col items-center justify-center ${gap} px-5 sm:px-6 py-6 sm:pb-10 text-center`}>
            {children}
        </div>
    );
}

/** A centered note under the logo: "Opening soon" (waitlist off on a waitlist-only host), a read
 *  error, or "page not found". `toWaitlist` adds a link back to /waitlist, never to the app. */
export function WaitlistNote({title, note, toWaitlist, children}: {title: string; note?: string; toWaitlist?: boolean; children?: React.ReactNode}) {
    return (
        <TeaserStage>
            <img src={LOGO_SRC} alt="" aria-hidden="true" className="h-[120px] w-auto block" />
            <div>
                <h1 className="m-0 text-[22px] font-bold">{title}</h1>
                {note && <p className="m-0 mt-2 text-[14px] text-hanji-400">{note}</p>}
            </div>
            {toWaitlist && (
                <Link to="/waitlist" className="min-h-[44px] flex items-center">
                    <WaitlistLabel />
                </Link>
            )}
            {children}
        </TeaserStage>
    );
}

/** Any other path on a waitlist-only host: to /waitlist, keeping ref and lang. */
export function ToWaitlist() {
    const {search} = useLocation();
    return <Navigate to={waitlistTarget(search)} replace />;
}
