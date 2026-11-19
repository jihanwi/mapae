// Wallet profile: "N followers · M following" and the follow button (decision 53). Followers count
// verified wallets only. No button on one's own profile; without a wallet the button connects one.
// The first follow from this browser shows, once, that follows are public.
// W-T65: split in two so the profile header can place them apart: FollowCounts (in the header's
// second line) and FollowButton (right of the header). Both read the same counts query (one
// request: react-query shares it); the reads and the follow write are unchanged.
import {useState} from "react";
import {useAccount} from "wagmi";
import {useCopy} from "../copy";
import {ApiError} from "../hooks/comments";
import {useFollowAction, useFollowCounts} from "../hooks/follow";
import {useWalletConnect} from "../hooks/useWalletConnect";
import {OpenInWalletApp, WalletPicker} from "./WalletPicker";
import {PrimaryBtn, SecondaryBtn} from "./ui";

const NOTICE_KEY = "mapae.follow.noticeSeen";
function noticeSeen(): boolean {
    try {
        return localStorage.getItem(NOTICE_KEY) === "1";
    } catch {
        return false;
    }
}
function markNoticeSeen(): void {
    try {
        localStorage.setItem(NOTICE_KEY, "1");
    } catch {
        // storage blocked: the notice may show again in another tab
    }
}

/** "Followers N · Following N" (the numbers .num hanji-100) and the verified-only note: two flex
 *  items for the caller's line. */
export function FollowCounts({target}: {target: `0x${string}`}) {
    const tr = useCopy();
    const f = tr.follow;
    const w = f.countWords;
    const {address: me} = useAccount();
    const counts = useFollowCounts(target, me);
    const part = (n: number, word: string) => {
        const num = <span className="num text-hanji-100">{n.toLocaleString(tr.locale)}</span>;
        return w.numFirst ? (
            <>
                {num} {word}
            </>
        ) : (
            <>
                {word} {num}
            </>
        );
    };
    return (
        <>
            <span className="min-w-0">
                {counts.isSuccess ? (
                    <>
                        {part(counts.data.followers, w.followers(counts.data.followers))} · {part(counts.data.following, w.following)}
                    </>
                ) : counts.isError ? (
                    tr.chain.unavailable
                ) : (
                    "…"
                )}
            </span>
            <span className="min-w-0 text-[12px]">{f.followersNote}</span>
        </>
    );
}

/** The follow / following button (48px high: PrimaryBtn before following, SecondaryBtn while
 *  following) with the one-time public notice and the error line. Nothing on one's own profile. */
export function FollowButton({target, className = ""}: {target: `0x${string}`; className?: string}) {
    const tr = useCopy();
    const f = tr.follow;
    const {address: me} = useAccount();
    const own = !!me && me.toLowerCase() === target.toLowerCase();
    const counts = useFollowCounts(target, me);
    const act = useFollowAction();
    const wc = useWalletConnect();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState(false);
    const following = counts.data?.isFollowing === true;

    const onClick = async () => {
        if (!me) return wc.connectWallet();
        setBusy(true);
        setError(null);
        try {
            const now = await act(following ? "unfollow" : "follow", me, target);
            if (now && !noticeSeen()) {
                setNotice(true);
                markNoticeSeen();
            }
        } catch (e) {
            if (e instanceof ApiError && e.code === "rejected") return; // signature cancelled in the wallet
            console.error("follow failed", e);
            setError(e instanceof ApiError && e.code === "follow_limit" ? f.limit : f.failed);
        } finally {
            setBusy(false);
        }
    };

    if (own) return null;
    const Btn = following ? SecondaryBtn : PrimaryBtn;
    return (
        <div className={`flex flex-col gap-1.5 min-w-0 ${className}`}>
            <Btn className="min-h-[48px] !px-6" disabled={busy || (!!me && !counts.isSuccess)} onClick={() => void onClick()}>
                {following ? f.following : f.follow}
            </Btn>
            {notice && <p className="m-0 text-[12px] text-hanji-400">{f.publicNote}</p>}
            {error && <p className="m-0 text-[12px] text-error">{error}</p>}
            {wc.choices && <WalletPicker choices={wc.choices} onChoose={wc.choose} onClose={wc.closePicker} />}
            {wc.openInApp && <OpenInWalletApp onClose={wc.closeOpenInApp} />}
        </div>
    );
}
