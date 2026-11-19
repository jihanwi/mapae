// /waitlist (W-T43): join the line with X, see the position and the referral link, optionally link a
// wallet (one signature, no transaction) and an email (only with consent, removable at any time).
// Not in the top menu; rendered in WaitlistShell (W-T45). No X profile picture (CSP), no total
// signup count. W-T49: a teaser. Before joining only the logo, MAPAE, WAITLIST, the button and the
// three notes; nothing describes the product. One flat background, no glow.
import {useState} from "react";
import {Link, useSearchParams} from "react-router-dom";
import {useAccount, useSignMessage} from "wagmi";
import {useCopy, useLang} from "../copy";
import {Eyebrow, Icon, SecondaryBtn, Skeleton} from "../components/ui";
import {OpenInWalletApp, WalletPicker} from "../components/WalletPicker";
import {useWalletConnect} from "../hooks/useWalletConnect";
import {useWaitlist, useWaitlistAction, WaitlistMissions, WaitlistState, WaitlistWeights} from "../hooks/waitlist";
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
/** W-T69: the three share actions under the card (52px). */
const ACT = "h-[52px] py-0 inline-flex items-center justify-center box-border";
const SECONDARY_LOOK = "rounded-input bg-transparent border border-ink-700 text-hanji-100 hover:text-hanji-100 text-[14px] px-5 hover:border-brass-600";
/** W-T70: the SecondaryBtn look on a link (the mission buttons open X in a new tab). */
const SECONDARY_LINK = `${BTN} rounded-input bg-transparent border border-ink-700 text-hanji-100 hover:text-hanji-100 text-[14px] px-5 hover:border-brass-600`;

type Joined = Extract<WaitlistState, {joined: true}>;
/** W-T70: the points part of my state, only when the server sent it (FEATURE_WAITLIST_POINTS on). */
type PointsView = {points: number; weights: WaitlistWeights; missions: WaitlistMissions};
const pointsView = (s: Joined): PointsView | null =>
    s.pointsEnabled === true && s.weights && s.missions && typeof s.points === "number" ? {points: s.points, weights: s.weights, missions: s.missions} : null;

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
        <TeaserStage hero>
            {/* W-T68: the backdrop picture (pre-join screen only) */}
            <div aria-hidden="true" className="wl-backdrop" />
            {notice && <Notice text={notice} />}
            <div className="wl-rings relative flex items-center justify-center flex-none">
                <div aria-hidden="true" className="wl-ring absolute inset-0 rounded-full" style={{border: "1px solid rgba(195,154,59,.08)"}} />
                <div aria-hidden="true" className="wl-ring wl-rings-inner absolute rounded-full" style={{border: "1px solid rgba(195,154,59,.16)"}} />
                <span className="relative block">
                    <img src={LOGO_SRC} alt="" aria-hidden="true" className="wl-rings-logo relative w-auto block" />
                    <span aria-hidden="true" className="wl-shine" />
                </span>
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

function Joined({s, notice}: {s: Joined; notice: string | null}) {
    const tr = useCopy();
    const t = tr.waitlist;
    const post = useWaitlistAction();
    const [copied, setCopied] = useState(false);
    // W-T69: one card state for the image, its fallback and the save button
    const [cardFailed, setCardFailed] = useState(false);
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
    const pv = pointsView(s);
    const cardSrc = `${API_BASE}/api/waitlist?card=${encodeURIComponent(s.refCode)}`;
    return (
        <div className="max-w-[800px] w-full box-border mx-auto px-5 sm:px-10 pt-8 sm:pt-12 pb-12 flex flex-col gap-[26px] sm:gap-[32px]">
            {/* W-T69: the picture at the top of the page; scrolls with it, fades into ink-950. The body
                is 720px wide (800 with its 40px sides). */}
            <div aria-hidden="true" className="wl-joined-backdrop" />
            {notice && <div className="flex justify-center"><Notice text={notice} /></div>}
            <div className="flex flex-col items-center text-center gap-3">
                <WaitlistLabel />
                <h1 className="m-0 font-serif font-bold text-[26px] sm:text-[34px] leading-tight text-hanji-100">{t.position(num)}</h1>
                <p className="m-0 text-[14px] text-hanji-400">
                    @{s.username}
                    {pv && (
                        <>
                            {" · "}
                            <span className="text-brass-400 font-semibold">
                                <WithNum text={t.points(fmtCount(pv.points, tr.locale))} />
                            </span>
                        </>
                    )}
                </p>
            </div>
            <div className="flex flex-col gap-3">
                <MyCard src={cardSrc} position={s.position} num={num} failed={cardFailed} onFail={() => setCardFailed(true)} />
                <div className="flex flex-wrap gap-3">
                    <a href={intent} target="_blank" rel="noopener noreferrer" className={`${ACT} basis-full sm:basis-0 flex-[2_1_0%] rounded-input bg-brass-400 hover:bg-brass-500 text-ink-950 hover:text-ink-950 text-[15px] font-bold px-5`}>
                        {t.shareX}
                    </a>
                    <SecondaryBtn className={`${ACT} flex-[1_1_0%] min-w-[120px] !px-3`} onClick={() => void copy()}>{copied ? tr.tokenPage.copied : t.copyLink}</SecondaryBtn>
                    {!cardFailed && (
                        <a href={cardSrc} download={`mapae-waitlist-${s.position}.png`} className={`${ACT} ${SECONDARY_LOOK} flex-[1_1_0%] min-w-[120px] !px-3`}>
                            {t.cardSave}
                        </a>
                    )}
                </div>
                <div className="h-12 box-border bg-ink-950 border border-ink-700 rounded-[10px] px-3.5 flex items-center gap-3">
                    <span className="num flex-1 min-w-0 truncate select-all text-[14px] text-hanji-100">{s.shareUrl}</span>
                    <span className="flex-none text-[12.5px] text-hanji-400">{t.referrals(s.referrals)}</span>
                </div>
            </div>
            <RankList s={s} pv={pv} />
            {(s.emailEnabled || s.email) && (
                <div className="border-t border-ink-700">
                    <EmailRow s={s} />
                </div>
            )}
            <div className="flex justify-center">
                <button className="text-[13px] text-hanji-400 hover:text-hanji-100 min-h-[44px] px-3" onClick={() => void post({action: "logout"})}>{t.logout}</button>
            </div>
        </div>
    );
}

/** The digits of a sentence in .num (the rest keeps the body font). */
function WithNum({text}: {text: string}) {
    return <>{text.split(/(\d[\d,.]*)/).map((part, i) => (i % 2 === 1 ? <span key={i} className="num">{part}</span> : part))}</>;
}

/** W-T52 / W-T69: my line-number card (the image link previews show), full body width. When the
 *  image does not load, a box with the logo, WAITLIST and the big number takes its place, so the
 *  position is always on the screen. */
function MyCard({src, position, num, failed, onFail}: {src: string; position: number; num: string; failed: boolean; onFail: () => void}) {
    const frame = "w-full box-border rounded-[16px] border border-[rgba(195,154,59,.55)] shadow-[0_30px_60px_rgba(0,0,0,.55)]";
    if (failed) {
        const size = positionFontSize(num);
        return (
            <div className={`${frame} bg-ink-950 flex flex-col items-center justify-center gap-4 px-4 py-9 sm:py-12`}>
                <img src={LOGO_SRC} alt="" aria-hidden="true" className="h-[84px] w-auto block" />
                <WaitlistLabel />
                <div
                    className="font-serif font-semibold tabular-nums leading-none whitespace-nowrap text-[length:var(--pos-m)] sm:text-[length:var(--pos-d)]"
                    style={{"--pos-m": size.mobile, "--pos-d": size.desktop} as React.CSSProperties}
                >
                    <span className="text-brass-400" style={{fontSize: "0.45em"}}>#</span>
                    {num}
                </div>
            </div>
        );
    }
    return <img src={src} alt={`MAPAE Waitlist #${position}`} width={1200} height={630} onError={onFail} className={`${frame} block h-auto aspect-[1200/630] bg-ink-950`} />;
}

/** One line of a list: title and hint on the left, the action on the right. The list draws the
 *  lines between rows. */
function Row({title, hint, action, children}: {title: string; hint?: string; action: React.ReactNode; children?: React.ReactNode}) {
    return (
        <div className="py-5">
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
                <div className="min-w-0">
                    <div className="text-[15px] font-semibold">{title}</div>
                    {hint && <div className="text-[13px] text-hanji-400 mt-0.5">{hint}</div>}
                </div>
                <div className="flex flex-wrap items-center gap-3 max-w-full">{action}</div>
            </div>
            {children}
        </div>
    );
}

/** W-T70: "+N" of a line. Before: brass-400. Done: hanji-400 (the wallet line adds a check; a
 *  mission line shows its check on "Done" instead). */
function PointsPlus({n, done, check}: {n: number; done: boolean; check?: boolean}) {
    const t = useCopy().waitlist;
    return (
        <span className={`num inline-flex items-center gap-1 text-[14px] ${done ? "text-hanji-400" : "text-brass-400"}`}>
            {done && check && <Icon name="check" className="w-3.5 h-3.5" />}
            {t.pointsPlus(n)}
        </span>
    );
}

/** W-T69: "순번 올리기", one list for every way up the line: invite, follow, repost (when on) and
 *  the wallet. Points off: the title, the invite line and the wallet line only (no "+N", no
 *  missions, no note). */
function RankList({s, pv}: {s: Joined; pv: PointsView | null}) {
    const tr = useCopy();
    const t = tr.waitlist;
    return (
        <section aria-labelledby="wl-rank">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pb-3 border-b border-ink-700">
                <h2 id="wl-rank" className="m-0 leading-none">
                    <Eyebrow locale={tr.locale}>{t.missionsTitle}</Eyebrow>
                </h2>
                {pv && <span className="text-[12.5px] text-hanji-400">{t.rankNote}</span>}
            </div>
            <div className="divide-y divide-ink-800">
                <Row
                    title={t.inviteTitle}
                    hint={t.inviteHint}
                    action={
                        <>
                            {pv && <PointsPlus n={pv.weights.referral} done={false} />}
                            <span className="num text-[14px] text-hanji-400">{t.inviteCount(s.referrals)}</span>
                        </>
                    }
                />
                {pv && <MissionRow mission="follow" title={t.missionFollow} cta={t.missionFollowCta} url={pv.missions.follow.url} done={pv.missions.follow.done} n={pv.weights.follow} />}
                {pv?.missions.repost && (
                    <MissionRow mission="repost" title={t.missionRepost} cta={t.missionRepostCta} url={pv.missions.repost.url} done={pv.missions.repost.done} n={pv.weights.repost} />
                )}
                <WalletRow s={s} plus={pv ? {n: pv.weights.wallet, done: pv.missions.wallet.done} : null} />
            </div>
            {pv && <p className="m-0 mt-3 text-[13px] text-hanji-400">{t.missionNote}</p>}
        </section>
    );
}

/** One mission: the link opens X in a new tab and, at the same time, records the press. The new
 *  tab stays open when the record fails; the line then shows the error and is not marked done. */
function MissionRow({mission, title, cta, url, done, n}: {mission: "follow" | "repost"; title: string; cta: string; url: string; done: boolean; n: number}) {
    const t = useCopy().waitlist;
    const post = useWaitlistAction();
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);
    const press = async () => {
        setBusy(true);
        setFailed(false);
        const err = await post({action: "mission", mission});
        setBusy(false);
        if (err) setFailed(true);
    };
    const action = (
        <>
            <PointsPlus n={n} done={done} />
            {done ? (
                <span className="min-h-[44px] inline-flex items-center gap-1.5 text-[14px] text-hanji-100">
                    <Icon name="check" className="w-4 h-4 text-brass-400" />
                    {t.missionDone}
                </span>
            ) : (
                <a href={url} target="_blank" rel="noopener noreferrer" aria-busy={busy || undefined} onClick={() => void press()} className={SECONDARY_LINK}>
                    {cta}
                </a>
            )}
        </>
    );
    return (
        <Row title={title} action={action}>
            {failed && <p className="m-0 mt-3 text-[13px] text-brass-400">{t.missionError}</p>}
        </Row>
    );
}

function WalletRow({s, plus}: {s: Joined; plus: {n: number; done: boolean} | null}) {
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
        <Row title={t.walletTitle} hint={t.walletHint} action={plus ? <><PointsPlus n={plus.n} done={plus.done} check />{action}</> : action}>
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
