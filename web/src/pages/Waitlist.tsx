// /waitlist (W-T43): join the line with X, see the position and the referral link, optionally link a
// wallet (one signature, no transaction) and an email (only with consent, removable at any time).
// Not in the top menu. No X profile picture (CSP), no total signup count.
import {useState} from "react";
import {Link, useSearchParams} from "react-router-dom";
import {useAccount, useSignMessage} from "wagmi";
import {useCopy, useLang} from "../copy";
import {Medallion, PrimaryBtn, SecondaryBtn, Skeleton} from "../components/ui";
import {OpenInWalletApp, WalletPicker} from "../components/WalletPicker";
import {useWalletConnect} from "../hooks/useWalletConnect";
import {useWaitlist, useWaitlistAction, WaitlistState} from "../hooks/waitlist";
import {API_BASE} from "../hooks/meta";
import {X_INTENT} from "../lib/share";
import {fmtCount} from "../lib/format";
import {isRefCode, walletMessage} from "../../api/_lib/waitlist";
import {DEFAULT_TITLE, useTitle} from "../lib/title";
import NotFound from "./NotFound";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function Waitlist() {
    useTitle(DEFAULT_TITLE);
    const tr = useCopy();
    const t = tr.waitlist;
    const q = useWaitlist();
    const [params] = useSearchParams();
    const error = params.get("error");
    if (q.isLoading) return <Shell><Skeleton h={320} /></Shell>;
    if (q.data === "disabled") return <NotFound />;
    if (q.isError || !q.data) {
        return (
            <Shell>
                <p className="m-0 mb-4 text-[14px] text-hanji-400">{t.readError}</p>
                <SecondaryBtn onClick={() => void q.refetch()}>{tr.common.retry}</SecondaryBtn>
            </Shell>
        );
    }
    return (
        <Shell>
            {error === "denied" && <Notice text={t.denied} />}
            {error === "x" && <Notice text={t.xError} />}
            {q.data.joined ? <Joined s={q.data} /> : <Join />}
            <ul className="m-0 mt-10 p-0 list-none space-y-2 text-[12px] text-hanji-400">
                <li>{t.note1}</li>
                <li>{t.note2}</li>
                <li>{t.note3}</li>
            </ul>
        </Shell>
    );
}

function Shell({children}: {children: React.ReactNode}) {
    return <div className="max-w-[560px] mx-auto px-4 sm:px-8 pt-10 sm:pt-14 pb-20">{children}</div>;
}

function Notice({text}: {text: string}) {
    return (
        <div className="rounded-input px-4 py-3 mb-6 text-[13px] text-brass-400" style={{background: "rgba(195,154,59,.08)", border: "1px solid rgba(195,154,59,.3)"}}>
            {text}
        </div>
    );
}

function Join() {
    const t = useCopy().waitlist;
    const {lang} = useLang();
    const [params] = useSearchParams();
    const ref = params.get("ref");
    const q = new URLSearchParams({action: "start", lang});
    if (isRefCode(ref)) q.set("ref", ref);
    return (
        <div className="text-center">
            <div className="flex justify-center mb-5"><Medallion char="馬" size={88} glow /></div>
            <div className="text-[13px] text-brass-400 font-semibold mb-2">{t.eyebrow}</div>
            <h1 className="m-0 mb-3 text-[26px] sm:text-[30px] font-bold leading-snug">{t.title}</h1>
            <p className="m-0 mb-7 text-[15px] text-hanji-400">{t.sub}</p>
            <ul className="m-0 mb-8 p-0 list-none space-y-2 text-[14px] text-hanji-100 text-left inline-block">
                {[t.point1, t.point2, t.point3].map((p) => (
                    <li key={p} className="flex gap-2"><span className="text-brass-400">·</span><span>{p}</span></li>
                ))}
            </ul>
            <div>
                {/* a top-level navigation to the API, which redirects to X */}
                <a href={`${API_BASE}/api/waitlist?${q.toString()}`} className="no-underline">
                    <PrimaryBtn className="w-full sm:w-auto">{t.cta}</PrimaryBtn>
                </a>
            </div>
        </div>
    );
}

function Joined({s}: {s: Extract<WaitlistState, {joined: true}>}) {
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
    return (
        <div>
            <div className="text-center mb-8">
                <div className="text-[13px] text-brass-400 font-semibold mb-3">{t.eyebrow}</div>
                <div className="font-serif text-[56px] font-semibold tabular-nums leading-none mb-3">{fmtCount(s.position, tr.locale)}</div>
                <div className="text-[17px] font-bold">{t.position(fmtCount(s.position, tr.locale))}</div>
                <div className="text-[13px] text-hanji-400 mt-1">@{s.username}</div>
            </div>
            <section className="bg-ink-800 border border-ink-700 rounded-card p-5 sm:p-6 mb-5">
                <div className="text-[15px] font-semibold mb-1 tabular-nums">{t.referrals(s.referrals)}</div>
                <p className="m-0 mb-4 text-[13px] text-hanji-400">{t.referralHint}</p>
                <div className="text-[12px] text-hanji-400 mb-1">{t.myLink}</div>
                <div className="bg-ink-900 border border-ink-700 rounded-input px-3.5 py-3 text-[14px] text-hanji-100 break-all mb-3 select-all">{s.shareUrl}</div>
                <div className="flex flex-wrap gap-3">
                    <SecondaryBtn onClick={() => void copy()}>{copied ? tr.tokenPage.copied : t.copyLink}</SecondaryBtn>
                    <a href={intent} target="_blank" rel="noopener noreferrer" className="no-underline"><PrimaryBtn>{t.shareX}</PrimaryBtn></a>
                </div>
            </section>
            <WalletLink s={s} />
            {(s.emailEnabled || s.email) && <EmailBox s={s} />}
            <div className="mt-6 flex flex-wrap items-center gap-4 text-[13px]">
                <button className="text-hanji-400 hover:text-hanji-100 min-h-[44px]" onClick={() => void post({action: "logout"})}>{t.logout}</button>
            </div>
        </div>
    );
}

function WalletLink({s}: {s: Extract<WaitlistState, {joined: true}>}) {
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
    return (
        <section className="bg-ink-800 border border-ink-700 rounded-card p-5 sm:p-6 mb-5">
            <div className="text-[15px] font-semibold mb-1">{t.walletTitle}</div>
            <p className="m-0 mb-4 text-[13px] text-hanji-400">{t.walletHint}</p>
            {s.wallet ? (
                <p className="m-0 text-[14px] text-hanji-100 tabular-nums break-all">{t.walletLinked(short(s.wallet))}</p>
            ) : isConnected ? (
                <SecondaryBtn disabled={isPending} onClick={() => void link()}>{t.walletSign}</SecondaryBtn>
            ) : (
                <SecondaryBtn disabled={wc.isPending} onClick={wc.connectWallet}>{t.walletConnect}</SecondaryBtn>
            )}
            {msg && <p className="m-0 mt-3 text-[13px] text-brass-400">{msg}</p>}
            {wc.choices && <WalletPicker choices={wc.choices} onChoose={wc.choose} onClose={wc.closePicker} />}
            {wc.openInApp && <OpenInWalletApp onClose={wc.closeOpenInApp} />}
        </section>
    );
}

function EmailBox({s}: {s: Extract<WaitlistState, {joined: true}>}) {
    const t = useCopy().waitlist;
    const post = useWaitlistAction();
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
        }
    };
    return (
        <section className="bg-ink-800 border border-ink-700 rounded-card p-5 sm:p-6 mb-5">
            <div className="text-[15px] font-semibold mb-1">{t.emailTitle}</div>
            <p className="m-0 mb-4 text-[13px] text-hanji-400">{t.emailHint}</p>
            {s.email ? (
                <div className="flex flex-wrap items-center gap-3">
                    <span className="text-[14px] text-hanji-100 break-all">{t.emailSaved(s.email)}</span>
                    <SecondaryBtn disabled={busy} onClick={() => void run({action: "email-remove"})}>{t.emailRemove}</SecondaryBtn>
                </div>
            ) : s.emailEnabled ? (
                <>
                    <input
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder={t.emailPlaceholder}
                        className="w-full box-border bg-ink-900 border border-ink-700 rounded-input px-3.5 py-3 text-[15px] text-hanji-100 outline-none focus:border-brass-400 mb-3"
                    />
                    <label className="flex items-start gap-2 text-[13px] text-hanji-100 mb-3 cursor-pointer">
                        <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                        <span>{t.emailConsent}</span>
                    </label>
                    <div className="flex flex-wrap items-center gap-4">
                        <SecondaryBtn disabled={!consent || email.trim() === "" || busy} onClick={() => void run({action: "email", email, consent})}>{t.emailSave}</SecondaryBtn>
                        <Link to="/privacy" className="text-[13px]">{t.emailPolicy}</Link>
                    </div>
                </>
            ) : null}
            {msg && <p className="m-0 mt-3 text-[13px] text-brass-400">{msg}</p>}
        </section>
    );
}
