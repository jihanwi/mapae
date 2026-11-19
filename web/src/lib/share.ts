// Share links (W-T17). Pure helpers: the share URL, the X post intent and the mobile check.

/** X web intent (docs.x.com, "Web intent"): https://x.com/intent/tweet with `text` and `url`. */
export const X_INTENT = "https://x.com/intent/tweet";

/** The preview link of a token: <origin>/t/<curve> (a vercel.json rewrite serves it). `apiBase` is
 *  VITE_API_BASE: when absolute (the Pages build) the link goes to that deployment. */
export function shareLink(curve: string, apiBase: string, pageOrigin: string): string {
    return `${deployOrigin(apiBase, pageOrigin)}/t/${curve.toLowerCase()}`;
}

/** The Vercel deployment: VITE_API_BASE when absolute (the Pages build), else this page's origin. */
const deployOrigin = (apiBase: string, pageOrigin: string) => (/^https?:\/\//.test(apiBase) ? new URL(apiBase).origin : pageOrigin);

/** MetaMask mobile deep link (docs.metamask.io "Use deeplinks"): https://link.metamask.io/dapp/{dappUrl},
 *  the dapp URL without the scheme. No hash route (a deep link can drop what follows #): on a token
 *  page /t/<curve> (the server sends it on to the token page), elsewhere the site root. */
export const METAMASK_DAPP = "https://link.metamask.io/dapp/";
export function metamaskDappUrl(pathname: string, apiBase: string, pageOrigin: string): string {
    const host = new URL(deployOrigin(apiBase, pageOrigin)).host;
    const m = /^\/t\/(0x[0-9a-fA-F]{40})(?:\/|$)/.exec(pathname);
    return m ? `${METAMASK_DAPP}${host}/t/${m[1].toLowerCase()}` : `${METAMASK_DAPP}${host}/`;
}

export function xIntentUrl(text: string, url: string): string {
    return `${X_INTENT}?${new URLSearchParams({text, url}).toString()}`;
}

/** Phones and tablets by user agent (iPadOS 13+ reports a Mac UA; touch points tell it apart). */
export function isMobileBrowser(ua: string, maxTouchPoints = 0): boolean {
    if (/Android|iPhone|iPod|iPad|Mobile|IEMobile|Opera Mini|webOS|BlackBerry/i.test(ua)) return true;
    return /Macintosh/.test(ua) && maxTouchPoints > 1;
}

/** W-T61: the default X text for a token whose trading has not opened yet, always in English:
 *  "$TICKER opens Nov 21, 21:00 KST on MAPAE. Everyone starts from the same line." The time is the
 *  sharer's local time; UTC+9 is written KST (the launch audience), any other zone with its short
 *  name from Intl (e.g. "GMT+1"). `timeZone` is for tests. */
export function opensShareText(symbol: string, startSec: number | bigint, timeZone?: string): string {
    const d = new Date(Number(startSec) * 1000);
    const day = d.toLocaleString("en-US", {month: "short", day: "numeric", timeZone});
    const hm = d.toLocaleString("en-US", {hour: "2-digit", minute: "2-digit", hour12: false, timeZone}).replace(/^24:/, "00:");
    const zoneName = d.toLocaleString("en-US", {timeZoneName: "short", timeZone}).split(" ").pop() ?? "UTC";
    const zone = /^(GMT|UTC)\+9$/.test(zoneName) ? "KST" : zoneName;
    return `${"$"}${symbol} opens ${day}, ${hm} ${zone} on MAPAE. Everyone starts from the same line.`;
}
