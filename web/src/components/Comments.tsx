// Token page comments. Only verified wallets post. The author is shown by nickname and links to
// the author's public profile (/w/:address); nicknames are a public profile (owner decision 2026-11-15).
// Bodies are plain text (no HTML, no auto links); newlines kept, long words wrap.
// Layout note (390px): one column, break-words + whitespace-pre-wrap, no fixed widths.
import {useState} from "react";
import {WalletLink} from "./WalletLink";
import {useAccount, useReadContract} from "wagmi";
import {useCopy} from "../copy";
import {ADDR_V3} from "../contracts/addressesV3";
import {MockDojangV3Abi} from "../contracts/abisV3";
import {giwaSepolia} from "../config/chain";
import {ApiError, commentCta, useComments, useNickname, useSocialActions} from "../hooks/comments";
import {isMine, useSession} from "../hooks/session";
import {useWalletConnect} from "../hooks/useWalletConnect";
import {useSwitchToGiwa} from "../hooks/useSwitchToGiwa";
import {BODY_MAX, bodyLength, cleanBody} from "../../api/_lib/social";
import {agoLabel, useNow} from "./feed";
import {useOnboardingModal} from "./OnboardingModal";
import {useNicknameModal} from "./NicknameModal";
import {WalletPicker} from "./WalletPicker";
import {Badge, PrimaryBtn} from "./ui";
import {ZERO} from "../hooks/curves";

export function Comments({curve}: {curve: string}) {
    const tr = useCopy();
    const now = useNow();
    const {address, isConnected, chainId} = useAccount();
    const list = useComments(curve);
    const nick = useNickname(address);
    const session = useSession();
    const actions = useSocialActions();
    const wc = useWalletConnect();
    const {switchToGiwa} = useSwitchToGiwa();
    const openOnboarding = useOnboardingModal();
    const openNickname = useNicknameModal();
    const verified = useReadContract({
        address: ADDR_V3.mockDojang,
        abi: MockDojangV3Abi,
        functionName: "isVerified",
        args: [address ?? ZERO],
        chainId: giwaSepolia.id,
        query: {enabled: !!address, refetchInterval: 15_000},
    });
    const [text, setText] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [, bump] = useState(0);

    const cleaned = cleanBody(text);
    const len = bodyLength(cleaned);
    const cta = commentCta({
        connected: isConnected && !!address,
        rightChain: chainId === giwaSepolia.id,
        verified: verified.isSuccess ? (verified.data as boolean) : undefined,
        nickname: nick.isSuccess ? nick.data : nick.isError ? null : undefined,
        hasSession: session.has(address),
    });
    const errMsg = (e: unknown) => {
        const code = e instanceof ApiError ? e.code : "unavailable";
        const m = tr.social.errors as Record<string, string>;
        return m[code] ?? tr.social.errors.unavailable;
    };

    const submit = async () => {
        if (!address || len < 1 || len > BODY_MAX) return;
        setBusy(true);
        setError(null);
        try {
            await actions.post(address, curve, cleaned);
            setText("");
        } catch (e) {
            setError(errMsg(e));
            if (e instanceof ApiError && e.code === "nickname_required") openNickname();
        } finally {
            setBusy(false);
        }
    };

    const button = (() => {
        switch (cta) {
            case "connect":
                return <PrimaryBtn className="w-full sm:w-auto" disabled={wc.isPending} onClick={wc.connectWallet}>{tr.social.connect}</PrimaryBtn>;
            case "switch":
                return <PrimaryBtn className="w-full sm:w-auto" onClick={switchToGiwa}>{tr.wrongChain}</PrimaryBtn>;
            case "verify":
                return <PrimaryBtn className="w-full sm:w-auto" onClick={() => openOnboarding({onProgress: () => void verified.refetch()})}>{tr.social.verify}</PrimaryBtn>;
            case "nickname":
                return <PrimaryBtn className="w-full sm:w-auto" onClick={openNickname}>{tr.social.setNickname}</PrimaryBtn>;
            case "loading":
                return <PrimaryBtn className="w-full sm:w-auto" disabled>{tr.curve.cta.loading}</PrimaryBtn>;
            default:
                return (
                    <PrimaryBtn className="w-full sm:w-auto" disabled={busy || len < 1 || len > BODY_MAX} onClick={() => void submit()}>
                        {busy ? tr.social.posting : tr.social.post}
                    </PrimaryBtn>
                );
        }
    })();

    const rows = list.data?.pages.flatMap((p) => p.comments) ?? [];
    return (
        <div className="bg-ink-900 border border-ink-700 rounded-card p-4 sm:p-6 min-w-0">
            <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
                <h3 className="m-0 text-[15px] font-bold">{tr.social.title}</h3>
                {nick.data && (
                    <button type="button" onClick={openNickname} className="text-[12px] text-hanji-400 hover:text-hanji-100 break-all text-right">
                        {tr.social.myNickname(nick.data)} · <span className="text-brass-400">{tr.social.change}</span>
                    </button>
                )}
            </div>
            <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                placeholder={tr.social.placeholder}
                disabled={cta !== "post" && cta !== "sign"}
                className="w-full min-w-0 resize-y bg-ink-800 border border-ink-700 rounded-input px-4 py-3 text-[15px] text-hanji-100 outline-none focus:border-brass-400 disabled:opacity-60"
            />
            <div className="flex items-center justify-between gap-3 flex-wrap mt-2">
                <span className={`text-[12px] tabular-nums ${len > BODY_MAX ? "text-error" : "text-hanji-400"}`}>{tr.social.chars(len, BODY_MAX)}</span>
                {button}
            </div>
            {cta === "sign" && <p className="m-0 mt-2 text-[12px] text-hanji-400">{tr.social.signNote}</p>}
            {error && <p className="m-0 mt-2 text-[13px] text-error">{error}</p>}
            {wc.choices && <WalletPicker choices={wc.choices} onChoose={wc.choose} onClose={wc.closePicker} />}

            <div className="mt-4">
                {list.isError ? (
                    <p className="m-0 text-[13px] text-hanji-400">{tr.social.unavailable}</p>
                ) : !list.isSuccess ? (
                    <p className="m-0 text-[13px] text-hanji-400">…</p>
                ) : rows.length === 0 ? (
                    <p className="m-0 text-[13px] text-hanji-400">{tr.social.empty}</p>
                ) : (
                    <ul className="m-0 p-0 list-none">
                        {rows.map((c) => {
                            const ts = Date.parse(c.createdAt) / 1000;
                            return (
                                <li key={c.id} className="py-3 border-t border-ink-700 first:border-t-0 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap text-[13px] mb-1">
                                        {c.author ? (
                                            <WalletLink address={c.author} nickname={c.nickname} className="font-semibold text-hanji-100 hover:text-brass-400" />
                                        ) : (
                                            <span className="font-semibold text-hanji-100 break-all">{c.nickname}</span>
                                        )}
                                        {c.dev && <Badge kind="partial">{tr.social.dev}</Badge>}
                                        {c.holder && <Badge kind="neutral">{tr.social.holder}</Badge>}
                                        <span className="text-hanji-400 text-[12px]">{Number.isFinite(ts) ? agoLabel(tr, now, ts) : ""}</span>
                                        {isMine(address, c.id) && (
                                            <button
                                                type="button"
                                                className="ml-auto text-[12px] text-hanji-400 hover:text-hanji-100"
                                                onClick={async () => {
                                                    if (!address) return;
                                                    try {
                                                        await actions.remove(address, curve, c.id);
                                                        bump((n) => n + 1);
                                                    } catch (e) {
                                                        setError(errMsg(e));
                                                    }
                                                }}
                                            >
                                                {tr.social.delete}
                                            </button>
                                        )}
                                    </div>
                                    <p className="m-0 text-[14px] text-hanji-100 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{c.body}</p>
                                </li>
                            );
                        })}
                    </ul>
                )}
                {list.hasNextPage && (
                    <button
                        type="button"
                        disabled={list.isFetchingNextPage}
                        onClick={() => void list.fetchNextPage()}
                        className="mt-3 w-full min-h-[40px] rounded-input border border-ink-700 text-[13px] text-hanji-100 hover:border-brass-600 disabled:opacity-50"
                    >
                        {tr.social.loadMore}
                    </button>
                )}
            </div>
        </div>
    );
}
