// /waitlist (W-T43): join the line with X, see the position and the referral link, optionally link a
// wallet (one signature, no transaction) and an email (only with consent, removable at any time).
// Not in the top menu; rendered in WaitlistShell (W-T45). No X profile picture (CSP), no total
// signup count. W-T49: a teaser. Before joining only the logo, MAPAE, WAITLIST, the button and the
// three notes; nothing describes the product. One flat background, no glow.
import {useState} from "react";
import {Link, useSearchParams} from "react-router-dom";
import {useAccount, useSignMessage} from "wagmi";
import {useCopy, useLang} from "../copy";
import {SecondaryBtn, Skeleton} from "../components/ui";
import {OpenInWalletApp, WalletPicker} from "../components/WalletPicker";
import {useWalletConnect} from "../hooks/useWalletConnect";
import {useWaitlist, useWaitlistAction, WaitlistState} from "../hooks/waitlist";
import {API_BASE} from "../hooks/meta";
import {X_INTENT} from "../lib/share";
import {fmtCount} from "../lib/format";
import {positionFontSize} from "../lib/positionSize";
import {isRefCode, walletMessage} from "../../api/_lib/waitlist";
import {DEFAULT_TITLE, useTitle} from "../lib/title";
import {LOGO_SRC, TeaserStage, WaitlistLabel, WaitlistNote} from "../WaitlistShell";
import {WAITLIST_ONLY} from "../lib/waitlistOnly";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const BTN = "h-12 py-0 inline-flex items-center justify-center";

export default function Waitlist() {
    useTitle(DEFAULT_TITLE);
    const tr = useCopy();
    const t = tr.waitlist;
    const q = useWaitlist();
    const [params] = useSearchParams();
    const error = params.get("error");
    if (q.isLoading) return <TeaserStage><Skeleton h={320} /></TeaserStage>;
    // off: "opening soon" on a waitlist-only host; elsewhere "not found" without a link into the app
    if (q.data === "disabled") return WAITLIST_ONLY ? <WaitlistNote title={t.soon} /> : <WaitlistNote title={tr.route404.title} note={tr.route404.note} />;
    if (q.isError || !q.data) {
        return (
            <WaitlistNote title={t.readError}>
                <SecondaryBtn className={BTN} onClick={() => void q.refetch()}>{tr.common.retry}</SecondaryBtn>
            </WaitlistNote>
        );
    }
    const notice = error === "denied" ? t.denied : error === "x" ? t.xError : null;
    return (
        <>
            {q.data.joined ? <Joined s={q.data} notice={notice} /> : <Join notice={notice} />}
            <Notes />
        </>
    );
}

function Notes() {
    const t = useCopy().waitlist;
    return (
        <div className="max-w-[720px] w-full box-border mx-auto px-5 sm:px-6 pb-11 text-center text-[12px] leading-[1.6] text-hanji-400 space-y-1.5">
            <p className="m-0">{t.note1}</p>
            <p className="m-0">{t.note2}</p>
            <p className="m-0">{t.note3}</p>
        </div>
    );
}

function Notice({text}: {text: string}) {
    return (
        <div className="rounded-input px-4 py-3 text-[13px] text-brass-400 bg-ink-900 max-w-[480px] w-full box-border" style={{border: "1px solid rgba(195,154,59,.3)"}}>
            {text}
        </div>
    );
}

function Join({notice}: {notice: string | null}) {
    const t = useCopy().waitlist;
    const {lang} = useLang();
    const [params] = useSearchParams();
    const ref = params.get("ref");
    const q = new URLSearchParams({action: "start", lang});
    if (isRefCode(ref)) q.set("ref", ref);
    return (
        <TeaserStage>
            {notice && <Notice text={notice} />}
            <div className="wl-rings relative flex items-center justify-center flex-none">
                <div aria-hidden="true" className="absolute inset-0 rounded-full" style={{border: "1px solid rgba(195,154,59,.08)"}} />
                <div aria-hidden="true" className="wl-rings-inner absolute rounded-full" style={{border: "1px solid rgba(195,154,59,.16)"}} />
                <img src={LOGO_SRC} alt="" aria-hidden="true" className="wl-rings-logo relative w-auto block" />
            </div>
            <h1 className="m-0 font-serif text-[36px] sm:text-[52px] font-bold text-hanji-100 leading-tight" style={{letterSpacing: "0.34em", paddingLeft: "0.34em"}}>
                MAPAE
            </h1>
            <div aria-hidden="true" className="w-[44px] sm:w-[56px] h-px" style={{background: "rgba(195,154,59,.45)"}} />
            <WaitlistLabel />
            {/* a top-level navigation to the API, which redirects to X */}
            <a
                href={`${API_BASE}/api/waitlist?${q.toString()}`}
                className="w-full sm:w-auto box-border h-[52px] px-[34px] inline-flex items-center justify-center rounded-input bg-brass-400 hover:bg-brass-500 text-ink-950 hover:text-ink-950 text-[16px] font-bold"
            >
                {t.cta}
            </a>
        </TeaserStage>
    );
}

function Joined({s, notice}: {s: Extract<WaitlistState, {joined: true}>; notice: string | null}) {
    const tr = useCopy();
    const t = tr.waitlist;
    const post = useWaitlistAction();
    const [copied, setCopied] = useState(false);
    const intent = `${X_INTENT}?${new URLSearchParams({text: t.shareText, url: s.shareUrl}).toString()}`;
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(s.shareUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (e) {
            console.error("copy failed", e);
        }
    };
    const num = fmtCount(s.position, tr.locale);
    const size = positionFontSize(num);
    return (
        <div className="max-w-[680px] w-full box-border mx-auto px-5 sm:px-10 pt-8 sm:pt-12 pb-12 flex flex-col gap-[26px] sm:gap-[32px]">
            {notice && <div className="flex justify-center"><Notice text={notice} /></div>}
            <div className="flex flex-col items-center text-center gap-4">
                <img src={LOGO_SRC} alt="" aria-hidden="true" className="h-[84px] w-auto block" />
                <WaitlistLabel />
                <div
                    className="font-serif font-semibold tabular-nums leading-none whitespace-nowrap text-[length:var(--pos-m)] sm:text-[length:var(--pos-d)]"
                    style={{"--pos-m": size.mobile, "--pos-d": size.desktop} as React.CSSProperties}
                >
                    <span className="text-brass-400" style={{fontSize: "0.45em"}}>#</span>
                    {num}
                </div>
                <div>
                    <div className="text-[17px] font-bold">{t.position(num)}</div>
                    <div className="text-[13px] text-hanji-400 mt-1">@{s.username}</div>
                </div>
            </div>
            <section className="bg-ink-900 border border-ink-700 rounded-card p-5 sm:p-7">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <div className="text-[15px] font-semibold tabular-nums">{t.referrals(s.referrals)}</div>
                    <div className="text-[13px] text-hanji-400">{t.referralHint}</div>
                </div>
                <div className="mt-5 flex flex-wrap gap-3">
                    <div className="flex-1 min-w-[200px] h-12 box-border bg-ink-950 border border-ink-700 rounded-input px-3.5 flex items-center text-[15px] text-hanji-100 select-all overflow-hidden">
                        <span className="truncate">{s.shareUrl}</span>
                    </div>
                    <SecondaryBtn className={BTN} onClick={() => void copy()}>{copied ? tr.tokenPage.copied : t.copyLink}</SecondaryBtn>
                    <a href={intent} target="_blank" rel="noopener noreferrer" className={`${BTN} rounded-input bg-brass-400 hover:bg-brass-500 text-ink-950 hover:text-ink-950 text-[14px] font-bold px-5`}>
                        {t.shareX}
                    </a>
                </div>
            </section>
            <div className="border-t border-ink-700">
                <WalletRow s={s} />
                {(s.emailEnabled || s.email) && <EmailRow s={s} />}
            </div>
            <div className="flex justify-center">
                <button className="text-[13px] text-hanji-400 hover:text-hanji-100 min-h-[44px] px-3" onClick={() => void post({action: "logout"})}>{t.logout}</button>
            </div>
        </div>
    );
}

/** One line of the list under the referral box: title and hint on the left, the action on the right. */
function Row({title, hint, action, children}: {title: string; hint: string; action: React.ReactNode; children?: React.ReactNode}) {
    return (
        <div className="py-5 border-b border-ink-700">
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
                <div className="min-w-0">
                    <div className="text-[15px] font-semibold">{title}</div>
                    <div className="text-[13px] text-hanji-400 mt-0.5">{hint}</div>
                </div>
                <div className="flex flex-wrap items-center gap-3 max-w-full">{action}</div>
            </div>
            {children}
        </div>
    );
}

function WalletRow({s}: {s: Extract<WaitlistState, {joined: true}>}) {
    const t = useCopy().waitlist;
    const {address, isConnected} = useAccount();
    const wc = useWalletConnect();
    const {signMessageAsync, isPending} = useSignMessage();
    const post = useWaitlistAction();
    const [msg, setMsg] = useState<string | null>(null);
    const link = async () => {
        if (!address) return;
        setMsg(null);
        try {
            const wallet = address.toLowerCase();
            const signature = await signMessageAsync({message: walletMessage(s.xUserId, wallet)});
            const err = await post({action: "wallet", wallet, signature});
            if (err === "wallet_taken") setMsg(t.walletTaken);
            else if (err) setMsg(t.failed);
        } catch (e) {
            // the wallet refused or closed the prompt: nothing was sent
            console.warn("wallet signature not given", e);
        }
    };
    const action = s.wallet ? (
        <span className="text-[14px] text-hanji-100 tabular-nums break-all">{t.walletLinked(short(s.wallet))}</span>
    ) : isConnected ? (
        <SecondaryBtn className={BTN} disabled={isPending} onClick={() => void link()}>{t.walletSign}</SecondaryBtn>
    ) : (
        <SecondaryBtn className={BTN} disabled={wc.isPending} onClick={wc.connectWallet}>{t.walletConnect}</SecondaryBtn>
    );
    return (
        <Row title={t.walletTitle} hint={t.walletHint} action={action}>
            {msg && <p className="m-0 mt-3 text-[13px] text-brass-400">{msg}</p>}
            {wc.choices && <WalletPicker choices={wc.choices} onChoose={wc.choose} onClose={wc.closePicker} />}
            {wc.openInApp && <OpenInWalletApp onClose={wc.closeOpenInApp} />}
        </Row>
    );
}

function EmailRow({s}: {s: Extract<WaitlistState, {joined: true}>}) {
    const t = useCopy().waitlist;
    const post = useWaitlistAction();
    const [open, setOpen] = useState(false);
    const [email, setEmail] = useState("");
    const [consent, setConsent] = useState(false);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);
    const run = async (body: Parameters<typeof post>[0]) => {
        setBusy(true);
        setMsg(null);
        const err = await post(body);
        setBusy(false);
        if (err === "bad_email") setMsg(t.emailBad);
        else if (err) setMsg(t.failed);
        else if (body.action === "email") {
            setEmail("");
            setConsent(false);
            setOpen(false);
        }
    };
    const action = s.email ? (
        <>
            <span className="text-[14px] text-hanji-100 break-all">{t.emailSaved(s.email)}</span>
            <SecondaryBtn className={BTN} disabled={busy} onClick={() => void run({action: "email-remove"})}>{t.emailRemove}</SecondaryBtn>
        </>
    ) : s.emailEnabled && !open ? (
        <SecondaryBtn className={BTN} onClick={() => setOpen(true)}>{t.emailAdd}</SecondaryBtn>
    ) : null;
    return (
        <Row title={t.emailTitle} hint={t.emailHint} action={action}>
            {!s.email && s.emailEnabled && open && (
                <div className="mt-4">
                    <input
                        type="email"
                        autoComplete="email"
                        aria-label={t.emailPlaceholder}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder={t.emailPlaceholder}
                        className="w-full box-border h-12 bg-ink-950 border border-ink-700 rounded-input px-3.5 text-[15px] text-hanji-100 outline-none focus:border-brass-400 mb-3"
                    />
                    <label className="flex items-start gap-2 text-[13px] text-hanji-100 mb-3 cursor-pointer">
                        <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                        <span>{t.emailConsent}</span>
                    </label>
                    <div className="flex flex-wrap items-center gap-4">
                        <SecondaryBtn className={BTN} disabled={!consent || email.trim() === "" || busy} onClick={() => void run({action: "email", email, consent})}>{t.emailSave}</SecondaryBtn>
                        <Link to="/privacy" className="text-[13px] min-h-[44px] inline-flex items-center">{t.emailPolicy}</Link>
                    </div>
                </div>
            )}
            {msg && <p className="m-0 mt-3 text-[13px] text-brass-400">{msg}</p>}
        </Row>
    );
}
