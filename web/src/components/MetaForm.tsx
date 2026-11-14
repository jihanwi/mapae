// Optional curve metadata inputs (image, one-line description, X / Telegram / website) and the
// avatar that shows a saved image in place of the initial medallion.
// Layout note (390px): one column, inputs w-full min-w-0, the preview is a fixed 64px square.
import {useState} from "react";
import {useCopy} from "../copy";
import {MAX_DESCRIPTION, descriptionLength, sanitizeDescription, validLink} from "../../api/_lib/validate";
import {MetaDraft, SaveState} from "../hooks/meta";
import {prepareImage} from "../lib/metaImage";
import {Medallion} from "./ui";

const inputCls =
    "w-full min-w-0 bg-ink-900 border border-ink-700 rounded-input px-4 py-3 text-[15px] text-hanji-100 outline-none focus:border-brass-400";

/** Saved image in a medallion-sized circle; falls back to the initial medallion when missing or broken. */
export function CurveAvatar({char, imageUrl, size = 52}: {char: string; imageUrl?: string | null; size?: number}) {
    const [broken, setBroken] = useState(false);
    if (!imageUrl || broken) return <Medallion char={char} size={size} />;
    return (
        <img
            src={imageUrl}
            alt=""
            width={size}
            height={size}
            loading="lazy"
            onError={() => setBroken(true)}
            className="flex-none rounded-full object-cover bg-ink-900"
            style={{width: size, height: size, border: `${size >= 100 ? 2 : 1.5}px solid #C39A3B`}}
        />
    );
}

type LinkKey = keyof MetaDraft["links"];

/** Per-link validation message, or null when the value is empty or valid. */
export function linkError(tr: ReturnType<typeof useCopy>, k: LinkKey, v: string): string | null {
    const s = v.trim();
    if (s === "" || validLink(k, s)) return null;
    if (!s.startsWith("https://")) return tr.meta.linkInvalid;
    if (k === "x") return tr.meta.linkXHost;
    if (k === "telegram") return tr.meta.linkTelegramHost;
    return tr.meta.linkInvalid;
}

export function draftValid(d: MetaDraft): boolean {
    return (
        descriptionLength(sanitizeDescription(d.description)) <= MAX_DESCRIPTION &&
        (["x", "telegram", "website"] as const).every((k) => d.links[k].trim() === "" || validLink(k, d.links[k].trim()))
    );
}

export function MetaFields({draft, onChange, disabled}: {draft: MetaDraft; onChange: (d: MetaDraft) => void; disabled?: boolean}) {
    const tr = useCopy();
    const [imgErr, setImgErr] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const descLen = descriptionLength(sanitizeDescription(draft.description));
    const links: [LinkKey, string][] = [
        ["x", tr.meta.linkX],
        ["telegram", tr.meta.linkTelegram],
        ["website", tr.meta.linkWebsite],
    ];
    return (
        <div className="flex flex-col gap-4">
            <div>
                <div className="text-[13px] text-hanji-400 mb-2">{tr.meta.imageLabel}</div>
                <div className="flex items-center gap-3 flex-wrap">
                    {draft.image && <img src={draft.image.previewUrl} alt="" className="w-16 h-16 rounded-full object-cover flex-none border border-brass-400" />}
                    <label className={`inline-flex items-center min-h-[40px] px-4 rounded-input border border-ink-700 text-[13px] ${disabled || busy ? "opacity-50" : "cursor-pointer hover:border-brass-600"}`}>
                        {tr.meta.imagePick}
                        <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="hidden"
                            disabled={disabled || busy}
                            onChange={async (e) => {
                                const f = e.target.files?.[0];
                                e.target.value = "";
                                if (!f) return;
                                setBusy(true);
                                const r = await prepareImage(f);
                                setBusy(false);
                                if (typeof r === "string") {
                                    setImgErr(r === "tooBig" ? tr.meta.imageTooBig : r === "badType" ? tr.meta.imageBadType : tr.meta.imageFailed);
                                    return;
                                }
                                setImgErr(null);
                                onChange({...draft, image: r});
                            }}
                        />
                    </label>
                    {draft.image && (
                        <button type="button" disabled={disabled} onClick={() => onChange({...draft, image: undefined})} className="text-[13px] text-hanji-400 hover:text-hanji-100 min-h-[40px] px-2">
                            {tr.meta.imageRemove}
                        </button>
                    )}
                </div>
                <p className="m-0 mt-2 text-[12px] text-hanji-400">{tr.meta.imageHint}</p>
                {imgErr && <p className="m-0 mt-1 text-[12px] text-error">{imgErr}</p>}
            </div>
            <div>
                <div className="flex justify-between gap-3 flex-wrap mb-2 text-[13px]">
                    <label className="text-hanji-400">{tr.meta.description}</label>
                    <span className={`tabular-nums ${descLen > MAX_DESCRIPTION ? "text-error" : "text-hanji-400"}`}>{tr.meta.chars(descLen, MAX_DESCRIPTION)}</span>
                </div>
                <input
                    value={draft.description}
                    disabled={disabled}
                    onChange={(e) => onChange({...draft, description: e.target.value})}
                    placeholder={tr.meta.descriptionPlaceholder}
                    className={inputCls}
                />
            </div>
            {links.map(([k, label]) => {
                const errMsg = linkError(tr, k, draft.links[k]);
                return (
                    <div key={k}>
                        <label className="block text-[13px] text-hanji-400 mb-2">{label}</label>
                        <input
                            value={draft.links[k]}
                            disabled={disabled}
                            inputMode="url"
                            onChange={(e) => onChange({...draft, links: {...draft.links, [k]: e.target.value}})}
                            placeholder="https://"
                            className={inputCls}
                        />
                        {errMsg && <p className="m-0 mt-1 text-[12px] text-error">{errMsg}</p>}
                    </div>
                );
            })}
            <p className="m-0 text-[12px] text-brass-400">{tr.meta.immutable}</p>
        </div>
    );
}

/** Status line for a save attempt (signing / saving / saved / failed with the server code). */
export function SaveStatus({state, onRetry}: {state: SaveState; onRetry?: () => void}) {
    const tr = useCopy();
    if (state.phase === "idle") return null;
    if (state.phase === "signing") return <p className="m-0 text-[13px] text-hanji-400">{tr.meta.signing}</p>;
    if (state.phase === "uploading") return <p className="m-0 text-[13px] text-hanji-400">{tr.meta.uploading}</p>;
    if (state.phase === "saved") return <p className="m-0 text-[13px] text-success">{tr.meta.saved}</p>;
    const msg = (tr.meta.errors as Record<string, string>)[state.code] ?? tr.meta.errors.temporary;
    return (
        <div className="text-[13px]">
            <p className="m-0 text-error">{msg}</p>
            {onRetry && state.code !== "already_saved" && state.code !== "not_dev" && state.code !== "not_curve" && (
                <button type="button" onClick={onRetry} className="mt-2 min-h-[40px] px-4 rounded-input border border-ink-700 text-hanji-100 hover:border-brass-600">
                    {tr.meta.retry}
                </button>
            )}
        </div>
    );
}

/** Domain shown for a link (no scheme, no path). */
export function linkDomain(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, "");
    } catch {
        return url;
    }
}
