// Offering disclosure (decision 58, W-T34): the document an issuer writes, its validation, the
// forbidden phrases, the canonical form that is hashed, and the signed message. Shared by the
// browser (what the issuer signs, the form checks) and the server (rebuilt and checked). Leaf module:
// it only imports viem (Vercel Functions need explicit extensions on relative imports).
import {getAddress, isAddress} from "viem";

export const DISCLOSURE_CHAIN_ID = 91342;

/** Phrases that promise a result. Checked in the document and in every addendum, on both sides. */
export const FORBIDDEN_PHRASES: readonly string[] = ["원금 보장", "수익 보장", "확정 수익", "손실 없", "guaranteed return", "risk-free",
    // W-T42: English
    "guaranteed profit", "guaranteed yield", "guaranteed income", "guaranteed apy", "principal guaranteed", "principal protected",
    "capital guaranteed", "fixed return", "zero risk", "can't lose", "cannot lose"];

export const LIMITS = {
    summary: 80,
    about: 1000,
    utility: 500,
    useOfFundsNote: 500,
    useOfFundsLabel: 40,
    useOfFundsItems: 10,
    issuerName: 80,
    jurisdiction: 80,
    priorSalesTerms: 500,
    risks: 500,
    issuerWallets: 10,
    link: 200,
    addendum: 1000,
    addenda: 20,
} as const;

export const LINK_KEYS = ["website", "docs", "x", "github", "audit"] as const;
export type LinkKey = (typeof LINK_KEYS)[number];

export type DisclosureDoc = {
    summary: string;
    about: string;
    utility: string;
    useOfFunds: {items: {label: string; pct: number}[]; note: string};
    issuer: {name: string; jurisdiction: string};
    priorSales: {exists: boolean; terms: string};
    issuerWallets: string[];
    risks: string;
    links: Record<LinkKey, string>;
};

export const EMPTY_DOC: DisclosureDoc = {
    summary: "",
    about: "",
    utility: "",
    useOfFunds: {items: [{label: "", pct: 100}], note: ""},
    issuer: {name: "", jurisdiction: ""},
    priorSales: {exists: false, terms: ""},
    issuerWallets: [],
    risks: "",
    links: {website: "", docs: "", x: "", github: "", audit: ""},
};

/** Control characters out (newlines and tabs kept when `multiline`), CRLF to LF, trimmed. */
export function cleanText(s: unknown, multiline: boolean): string {
    const t = typeof s === "string" ? s.replace(/\r\n?/g, "\n") : "";
    // eslint-disable-next-line no-control-regex
    const re = multiline ? /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g : /[\u0000-\u001f\u007f-\u009f]/g;
    return t.replace(re, "").trim();
}

const len = (s: string) => [...s].length;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Any input -> the canonical document (fixed key order, cleaned text, lowercase wallets). The
 *  hash and the stored copy are of this form, so the browser and the server agree byte for byte. */
export function normalizeDoc(input: unknown): DisclosureDoc {
    const d = obj(input);
    const uof = obj(d.useOfFunds);
    const issuer = obj(d.issuer);
    const prior = obj(d.priorSales);
    const links = obj(d.links);
    const items = Array.isArray(uof.items) ? uof.items : [];
    return {
        summary: cleanText(d.summary, false),
        about: cleanText(d.about, true),
        utility: cleanText(d.utility, true),
        useOfFunds: {
            items: items.map((x) => {
                const i = obj(x);
                return {label: cleanText(i.label, false), pct: typeof i.pct === "number" && Number.isFinite(i.pct) ? i.pct : NaN};
            }),
            note: cleanText(uof.note, true),
        },
        issuer: {name: cleanText(issuer.name, false), jurisdiction: cleanText(issuer.jurisdiction, false)},
        priorSales: {exists: prior.exists === true, terms: prior.exists === true ? cleanText(prior.terms, true) : ""},
        issuerWallets: (Array.isArray(d.issuerWallets) ? d.issuerWallets : []).map((w) => cleanText(w, false).toLowerCase()).filter((w) => w !== ""),
        risks: cleanText(d.risks, true),
        links: Object.fromEntries(LINK_KEYS.map((k) => [k, cleanText(links[k], false)])) as Record<LinkKey, string>,
    };
}

/** Exact bytes that are hashed and signed. */
export const canonicalJson = (doc: DisclosureDoc) => JSON.stringify(doc);

/** First forbidden phrase in `text` (case-insensitive, spaces collapsed), or null. */
export function forbiddenPhrase(text: string): string | null {
    // curly apostrophes count as straight ones ("can’t lose" = "can't lose")
    const t = text.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, " ");
    for (const p of FORBIDDEN_PHRASES) if (t.includes(p.toLowerCase())) return p;
    return null;
}

/** "" or https://, at most LIMITS.link, no spaces or credentials. */
export function validHttpsLink(s: string): boolean {
    if (s === "") return true;
    if (s.length > LIMITS.link || !s.startsWith("https://") || /\s/.test(s)) return false;
    try {
        const u = new URL(s);
        return u.protocol === "https:" && !u.username && !u.password && u.hostname.includes(".");
    } catch {
        return false;
    }
}

export type DocProblem = {field: string; error: "required" | "too_long" | "bad_value" | "pct_sum" | "bad_link" | "forbidden_phrase"; phrase?: string};

/** Problems of a normalized document, in field order (empty = valid). */
export function docProblems(d: DisclosureDoc): DocProblem[] {
    const out: DocProblem[] = [];
    const text = (field: string, v: string, max: number, required = true) => {
        if (required && v === "") out.push({field, error: "required"});
        else if (len(v) > max) out.push({field, error: "too_long"});
    };
    text("summary", d.summary, LIMITS.summary);
    text("about", d.about, LIMITS.about);
    text("utility", d.utility, LIMITS.utility);
    const items = d.useOfFunds.items;
    if (items.length === 0) out.push({field: "useOfFunds.items", error: "required"});
    else if (items.length > LIMITS.useOfFundsItems) out.push({field: "useOfFunds.items", error: "bad_value"});
    items.forEach((it, i) => {
        text(`useOfFunds.items.${i}.label`, it.label, LIMITS.useOfFundsLabel);
        if (!Number.isInteger(it.pct) || it.pct < 1 || it.pct > 100) out.push({field: `useOfFunds.items.${i}.pct`, error: "bad_value"});
    });
    if (items.length > 0 && items.every((it) => Number.isInteger(it.pct)) && items.reduce((a, it) => a + it.pct, 0) !== 100) out.push({field: "useOfFunds.items", error: "pct_sum"});
    text("useOfFunds.note", d.useOfFunds.note, LIMITS.useOfFundsNote, false);
    text("issuer.name", d.issuer.name, LIMITS.issuerName);
    text("issuer.jurisdiction", d.issuer.jurisdiction, LIMITS.jurisdiction);
    if (d.priorSales.exists) text("priorSales.terms", d.priorSales.terms, LIMITS.priorSalesTerms);
    if (d.issuerWallets.length > LIMITS.issuerWallets) out.push({field: "issuerWallets", error: "bad_value"});
    d.issuerWallets.forEach((w, i) => {
        if (!isAddress(w, {strict: false})) out.push({field: `issuerWallets.${i}`, error: "bad_value"});
    });
    text("risks", d.risks, LIMITS.risks);
    for (const k of LINK_KEYS) if (!validHttpsLink(d.links[k])) out.push({field: `links.${k}`, error: "bad_link"});
    const phrase = forbiddenPhrase(allText(d));
    if (phrase) out.push({field: "doc", error: "forbidden_phrase", phrase});
    return out;
}

/** Every text field of the document, for the phrase check. */
export function allText(d: DisclosureDoc): string {
    return [d.summary, d.about, d.utility, ...d.useOfFunds.items.map((i) => i.label), d.useOfFunds.note, d.issuer.name, d.issuer.jurisdiction, d.priorSales.terms, d.risks].join("\n");
}

/** Addendum text: cleaned, required, at most LIMITS.addendum, no forbidden phrase. */
export function addendumProblems(text: string): DocProblem[] {
    if (text === "") return [{field: "text", error: "required"}];
    if (len(text) > LIMITS.addendum) return [{field: "text", error: "too_long"}];
    const phrase = forbiddenPhrase(text);
    return phrase ? [{field: "text", error: "forbidden_phrase", phrase}] : [];
}

/** 0x-prefixed lowercase hex sha256 of UTF-8 text (Web Crypto: browser and Node 18+). */
export async function sha256Text(s: string): Promise<string> {
    const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
    return "0x" + Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

export type DisclosureKind = "disclosure" | "addendum";

/** Human-readable EIP-191 message the issuer signs. */
export function buildDisclosureMessage(m: {offering: string; kind: DisclosureKind; sha256: string; issuedAt: string}): string {
    return [
        "MAPAE offering disclosure",
        `chainId: ${DISCLOSURE_CHAIN_ID}`,
        `offering: ${getAddress(m.offering)}`,
        `kind: ${m.kind === "disclosure" ? "disclosure document" : "additional disclosure"}`,
        `sha256: ${m.sha256}`,
        `issuedAt: ${m.issuedAt}`,
    ].join("\n");
}
