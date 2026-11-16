// Wallet profile: "N followers · M following" and the follow button (decision 53). Followers count
// verified wallets only. No button on one's own profile; without a wallet the button connects one.
// The first follow from this browser shows, once, that follows are public.
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

export function FollowBar({target}: {target: `0x${string}`}) {
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

    const Btn = following ? SecondaryBtn : PrimaryBtn;
    return (
        <div className="flex flex-col gap-1.5 min-w-0">
            <div className="flex items-center gap-x-3 gap-y-2 flex-wrap min-w-0">
                <span className="text-[13px] text-hanji-100 tabular-nums">
                    {counts.isSuccess ? f.counts(counts.data.followers, counts.data.following) : counts.isError ? tr.chain.unavailable : "…"}
                </span>
                <span className="text-[12px] text-hanji-400">{f.followersNote}</span>
                {!own && (
                    <Btn className="!py-2 !px-4 !text-[13px] min-h-[36px]" disabled={busy || (!!me && !counts.isSuccess)} onClick={() => void onClick()}>
                        {following ? f.following : f.follow}
                    </Btn>
                )}
            </div>
            {notice && <p className="m-0 text-[12px] text-hanji-400">{f.publicNote}</p>}
            {error && <p className="m-0 text-[12px] text-error">{error}</p>}
            {wc.choices && <WalletPicker choices={wc.choices} onChoose={wc.choose} onClose={wc.closePicker} />}
            {wc.openInApp && <OpenInWalletApp onClose={wc.closeOpenInApp} />}
        </div>
    );
}
