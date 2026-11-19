// W-T65: pure helpers for the feed rows and the wallet profile (initial circle, P&L figures).
import {signedPnl, Unit, walletAmount} from "./wallet";

/** The character inside a wallet's initial circle: the nickname's first character, else the two
 *  characters after "0x" of the address (lowercase, so the same wallet looks the same everywhere). */
export function walletInitial(nickname: string | null | undefined, address: string): string {
    const nick = nickname?.trim();
    if (nick) return Array.from(nick)[0];
    const hex = address.trim().replace(/^0x/i, "");
    return hex.slice(0, 2).toLowerCase();
}

/** A signed P&L figure without the unit (the unit sits in the label of the P&L band). Sign and
 *  tone follow signedPnl exactly: a value that displays as 0 has no sign and the flat tone. */
export function pnlFigure(v: bigint, unit: Unit, locale: string): {text: string; tone: "up" | "down" | "flat"} {
    const {tone} = signedPnl(v, unit, locale);
    const sign = tone === "up" ? "+" : tone === "down" ? "-" : "";
    return {text: `${sign}${walletAmount(v < 0n ? -v : v, unit, locale)}`, tone};
}
