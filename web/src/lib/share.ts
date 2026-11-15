// Share links (W-T17). Pure helpers: the share URL, the X post intent and the mobile check.

/** X web intent (docs.x.com, "Web intent"): https://x.com/intent/tweet with `text` and `url`. */
export const X_INTENT = "https://x.com/intent/tweet";

/** The preview link of a token: <origin>/t/<curve> (a vercel.json rewrite serves it). `apiBase` is
 *  VITE_API_BASE: when absolute (the Pages build) the link goes to that deployment. */
export function shareLink(curve: string, apiBase: string, pageOrigin: string): string {
    const origin = /^https?:\/\//.test(apiBase) ? new URL(apiBase).origin : pageOrigin;
    return `${origin}/t/${curve.toLowerCase()}`;
}

export function xIntentUrl(text: string, url: string): string {
    return `${X_INTENT}?${new URLSearchParams({text, url}).toString()}`;
}

/** Phones and tablets by user agent (iPadOS 13+ reports a Mac UA; touch points tell it apart). */
export function isMobileBrowser(ua: string, maxTouchPoints = 0): boolean {
    if (/Android|iPhone|iPod|iPad|Mobile|IEMobile|Opera Mini|webOS|BlackBerry/i.test(ua)) return true;
    return /Macintosh/.test(ua) && maxTouchPoints > 1;
}
