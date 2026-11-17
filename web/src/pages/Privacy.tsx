// /privacy (W-T43): the waitlist privacy notice. Shown only while the email field is on (the API's
// `contact` is set); otherwise a "not found" note with a link back to /waitlist (W-T45: never into
// the app). Rendered in WaitlistShell. Text as written in the copy files.
import {useCopy} from "../copy";
import {SecondaryBtn, Skeleton} from "../components/ui";
import {useWaitlist} from "../hooks/waitlist";
import {DEFAULT_TITLE, useTitle} from "../lib/title";
import {WaitlistNote} from "../WaitlistShell";
import {WAITLIST_ONLY} from "../lib/waitlistOnly";

export default function Privacy() {
    useTitle(DEFAULT_TITLE);
    const tr = useCopy();
    const p = tr.privacy;
    const q = useWaitlist();
    const shell = (c: React.ReactNode) => <div className="max-w-[640px] mx-auto px-4 sm:px-8 pt-10 sm:pt-14 pb-20">{c}</div>;
    if (q.isLoading) return shell(<Skeleton h={240} />);
    if (q.data === "disabled") return WAITLIST_ONLY ? <WaitlistNote title={tr.waitlist.soon} /> : <WaitlistNote title={tr.route404.title} note={tr.route404.note} />;
    if (q.isError || !q.data) {
        return shell(
            <>
                <p className="m-0 mb-4 text-[14px] text-hanji-400">{tr.waitlist.readError}</p>
                <SecondaryBtn onClick={() => void q.refetch()}>{tr.common.retry}</SecondaryBtn>
            </>
        );
    }
    if (!q.data.contact) return <WaitlistNote title={tr.route404.title} note={tr.route404.note} toWaitlist />;
    return shell(
        <>
            <h1 className="m-0 mb-6 text-[24px] font-bold">{p.title}</h1>
            <div className="space-y-4 text-[14px] leading-relaxed text-hanji-100">
                {[p.what, p.why, p.share, p.keep, p.rights].map((x) => <p key={x} className="m-0">{x}</p>)}
                <p className="m-0 break-all">{p.contact(q.data.contact)}</p>
            </div>
        </>
    );
}
