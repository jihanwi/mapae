// Offering create form (W-T34): parsing, range checks and derived values. Pure. Bounds are never
// written here: factory bands (guide, proceedsBand, minRaise) come from the chain, contract
// constants from codegen (contracts/offeringBoundsL1.ts), the default royalty / burn from the
// FeeRouter tier table. Every check mirrors the contract that would revert on it.
import {copy} from "../copy";
import {MAPAEVESTING_CONSTS, OFFERING_CONSTS, SPONSORSHIP_CONSTS} from "../contracts/offeringBoundsL1";
import {utf8ByteLength} from "./bytes";
import {isStandardTicker, normalizeTicker} from "./ticker";
import {allocationOf, BPS, lpTokenBpsOf, proceedsOf, qSaleOf, WAD} from "./offeringMath";

export type CreateForm = {
    name: string;
    symbol: string;
    /** KRWs per token, whole KRWs */
    price: string;
    raiseTarget: string;
    durationHours: string;
    walletLimit: string;
    minCommit: string;
    refundMode: "all" | "partial";
    /** percentages with up to 2 decimals */
    salePct: string;
    issuerPct: string;
    /** share of the raise seeded into the pool (Offering cBps) */
    lpPct: string;
    vestingDays: string;
    vestingCliffDays: string;
    withSponsorship: boolean;
    sponsorBurnPct: string;
    upfrontPct: string;
    lockValue: string;
    lockUnit: "day" | "hour";
    lockCliffValue: string;
    lockCliffUnit: "day" | "hour";
};

export type ChainBounds = {
    guide: {minPrice: bigint; maxPrice: bigint; minRaise: bigint; maxRaise: bigint; minWalletLimitBps: number; maxWalletLimitBps: number};
    band: {maxUpfrontBps: number; minLockDuration: bigint; maxLockDuration: bigint; maxLockCliff: bigint};
    /** factory minRaise (Offering invariant 5) */
    minRaise: bigint;
    /** FeeRouter tier L1 table: default per-pool royalty / burn and the offering fee */
    swapRoyaltyBps: number;
    swapBurnBps: number;
    offeringFeeBps: number;
    /** name length limit (bytes); the L0 rule (CurveFactory.MAX_NAME_BYTES) */
    maxNameBytes: number;
};

export const DEFAULT_FORM: CreateForm = {
    name: "",
    symbol: "",
    price: "",
    raiseTarget: "",
    durationHours: "24",
    walletLimit: "",
    minCommit: "",
    refundMode: "all",
    salePct: "60",
    issuerPct: "20",
    lpPct: "25",
    vestingDays: "1080",
    vestingCliffDays: "180",
    withSponsorship: false,
    sponsorBurnPct: "10",
    upfrontPct: "30",
    lockValue: "365",
    lockUnit: "day",
    lockCliffValue: "30",
    lockCliffUnit: "day",
};

const DAY = 86_400n;
const HOUR = 3_600n;

/** Whole KRWs ("1,000" ok) -> wei; null when empty or not a whole number. */
export function parseKrw(s: string): bigint | null {
    const t = s.replace(/,/g, "").trim();
    return /^\d{1,15}$/.test(t) ? BigInt(t) * WAD : null;
}
/** Percent with up to 2 decimals -> bps; null otherwise. */
export function parsePct(s: string): number | null {
    const t = s.trim();
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
    const [i, f = ""] = t.split(".");
    return Number(i) * 100 + Number(f.padEnd(2, "0"));
}
/** Whole number (days, hours) -> bigint; null otherwise. */
export function parseWhole(s: string): bigint | null {
    const t = s.trim();
    return /^\d{1,6}$/.test(t) ? BigInt(t) : null;
}
const unitSec = (u: "day" | "hour") => (u === "day" ? DAY : HOUR);

const krwText = (wei: bigint) => (wei / WAD).toLocaleString("ko-KR");
const pctText = (bps: bigint | number) => String(Number(bps) / 100);
const daysText = (sec: bigint) => (sec % DAY === 0n ? `${(sec / DAY).toLocaleString("ko-KR")}일` : `${(sec / HOUR).toLocaleString("ko-KR")}시간`);

export type Values = {
    name: string;
    symbol: string;
    price: bigint;
    raiseTarget: bigint;
    durationSec: bigint;
    walletLimit: bigint;
    minCommit: bigint;
    refundMode: 0 | 1;
    fBps: number;
    creatorTokenBps: number;
    cBps: number;
    vestingDuration: bigint;
    vestingCliff: bigint;
    withSponsorship: boolean;
    sponsorBurnBps: number;
    proceedsUpfrontBps: number;
    proceedsLockDuration: bigint;
    proceedsLockCliff: bigint;
};

export type Check = {errors: Partial<Record<keyof CreateForm | "allocation", string>>; values: Values | null};

/** Every field checked against the contract's rule; `values` only when there is no error. */
export function checkCreate(f: CreateForm, b: ChainBounds): Check {
    const e: Check["errors"] = {};
    const t = copy.offeringCreate.err;
    const range = (lo: string, hi: string) => t.range(lo, hi);

    const name = f.name.trim();
    if (name === "") e.name = t.required;
    else if (utf8ByteLength(name) > b.maxNameBytes) e.name = t.nameBytes(b.maxNameBytes);
    const symbol = normalizeTicker(f.symbol);
    if (symbol === "") e.symbol = t.required;
    else if (!isStandardTicker(symbol)) e.symbol = t.ticker;

    const price = parseKrw(f.price);
    if (price === null) e.price = t.wholeKrw;
    else if (price < b.guide.minPrice || price > b.guide.maxPrice) e.price = range(`${krwText(b.guide.minPrice)} KRWs`, `${krwText(b.guide.maxPrice)} KRWs`);

    const raise = parseKrw(f.raiseTarget);
    const minRaise = b.guide.minRaise > b.minRaise ? b.guide.minRaise : b.minRaise;
    if (raise === null) e.raiseTarget = t.wholeKrw;
    else if (raise < minRaise || raise > b.guide.maxRaise) e.raiseTarget = range(`${krwText(minRaise)} KRWs`, `${krwText(b.guide.maxRaise)} KRWs`);
    else if (price !== null && qSaleOf(raise, price) === 0n) e.raiseTarget = t.zeroQuantity;

    const hours = parseWhole(f.durationHours);
    const minH = OFFERING_CONSTS.MIN_DURATION / HOUR;
    const maxH = OFFERING_CONSTS.MAX_DURATION / HOUR;
    if (hours === null) e.durationHours = t.whole;
    else if (hours < minH || hours > maxH) e.durationHours = range(`${minH}시간`, `${maxH}시간`);

    const wl = parseKrw(f.walletLimit);
    if (wl === null) e.walletLimit = t.wholeKrw;
    else if (raise !== null && !e.raiseTarget) {
        const lo = (raise * BigInt(b.guide.minWalletLimitBps)) / BPS;
        const hi = (raise * BigInt(b.guide.maxWalletLimitBps)) / BPS;
        if (wl < lo || wl > hi) e.walletLimit = t.walletLimit(pctText(b.guide.minWalletLimitBps), pctText(b.guide.maxWalletLimitBps), krwText(lo), krwText(hi));
    }
    const mc = parseKrw(f.minCommit);
    if (mc === null || mc === 0n) e.minCommit = t.minCommitPositive;
    else if (wl !== null && mc > wl) e.minCommit = t.minCommitOverLimit;

    const fBps = parsePct(f.salePct);
    const cr = parsePct(f.issuerPct);
    const c = parsePct(f.lpPct);
    if (fBps === null) e.salePct = t.pct;
    else if (fBps < OFFERING_CONSTS.MIN_F_BPS || fBps > OFFERING_CONSTS.MAX_F_BPS) e.salePct = range(`${pctText(OFFERING_CONSTS.MIN_F_BPS)}%`, `${pctText(OFFERING_CONSTS.MAX_F_BPS)}%`);
    if (cr === null) e.issuerPct = t.pct;
    else if (cr < OFFERING_CONSTS.MIN_CREATOR_TOKEN_BPS || cr > OFFERING_CONSTS.MAX_CREATOR_TOKEN_BPS) e.issuerPct = range(`${pctText(OFFERING_CONSTS.MIN_CREATOR_TOKEN_BPS)}%`, `${pctText(OFFERING_CONSTS.MAX_CREATOR_TOKEN_BPS)}%`);
    if (c === null) e.lpPct = t.pct;
    else if (c < OFFERING_CONSTS.MIN_C_BPS || c > OFFERING_CONSTS.MAX_C_BPS) e.lpPct = range(`${pctText(OFFERING_CONSTS.MIN_C_BPS)}%`, `${pctText(OFFERING_CONSTS.MAX_C_BPS)}%`);
    // Offering: f + creator + (c x f) must fit in 100% of the supply
    if (fBps !== null && cr !== null && c !== null && !e.salePct && !e.issuerPct && !e.lpPct) {
        const sum = BigInt(fBps) + BigInt(cr) + lpTokenBpsOf(c, fBps);
        if (sum > BPS) e.allocation = t.allocationSum(pctText(sum));
    }

    const vd = parseWhole(f.vestingDays);
    const vc = parseWhole(f.vestingCliffDays);
    const V = MAPAEVESTING_CONSTS;
    if (vd === null) e.vestingDays = t.whole;
    else if (vd * DAY < V.MIN_VESTING_DURATION || vd * DAY > V.MAX_VESTING_DURATION) e.vestingDays = range(daysText(V.MIN_VESTING_DURATION), daysText(V.MAX_VESTING_DURATION));
    if (vc === null) e.vestingCliffDays = t.whole;
    else if (vc * DAY < V.MIN_CLIFF) e.vestingCliffDays = t.atLeast(daysText(V.MIN_CLIFF));
    else if (vd !== null && vc > vd) e.vestingCliffDays = t.cliffOverDuration;

    const burn = parsePct(f.sponsorBurnPct);
    if (f.withSponsorship) {
        if (burn === null) e.sponsorBurnPct = t.pct;
        else if (burn > SPONSORSHIP_CONSTS.MAX_BURN_SHARE_BPS) e.sponsorBurnPct = range("0%", `${pctText(SPONSORSHIP_CONSTS.MAX_BURN_SHARE_BPS)}%`);
    }

    const up = parsePct(f.upfrontPct);
    if (up === null) e.upfrontPct = t.pct;
    else if (up > b.band.maxUpfrontBps) e.upfrontPct = range("0%", `${pctText(b.band.maxUpfrontBps)}%`);
    const lv = parseWhole(f.lockValue);
    const lockSec = lv === null ? null : lv * unitSec(f.lockUnit);
    if (lockSec === null) e.lockValue = t.whole;
    else if (lockSec < b.band.minLockDuration || lockSec > b.band.maxLockDuration) e.lockValue = range(daysText(b.band.minLockDuration), daysText(b.band.maxLockDuration));
    const lcv = parseWhole(f.lockCliffValue);
    const lockCliff = lcv === null ? null : lcv * unitSec(f.lockCliffUnit);
    if (lockCliff === null) e.lockCliffValue = t.whole;
    else if (lockCliff > b.band.maxLockCliff) e.lockCliffValue = t.atMost(daysText(b.band.maxLockCliff));
    else if (lockSec !== null && lockCliff > lockSec) e.lockCliffValue = t.cliffOverLock;

    if (Object.keys(e).length > 0) return {errors: e, values: null};
    return {
        errors: e,
        values: {
            name,
            symbol,
            price: price!,
            raiseTarget: raise!,
            durationSec: hours! * HOUR,
            walletLimit: wl!,
            minCommit: mc!,
            refundMode: f.refundMode === "all" ? 0 : 1,
            fBps: fBps!,
            creatorTokenBps: cr!,
            cBps: c!,
            vestingDuration: vd! * DAY,
            vestingCliff: vc! * DAY,
            withSponsorship: f.withSponsorship,
            sponsorBurnBps: f.withSponsorship ? burn! : 0,
            proceedsUpfrontBps: up!,
            proceedsLockDuration: lockSec!,
            proceedsLockCliff: lockCliff!,
        },
    };
}

/** Numbers shown next to the form, as the contract would compute them when fully sold. */
export function derive(v: Values, b: ChainBounds) {
    const qSale = qSaleOf(v.raiseTarget, v.price);
    const alloc = allocationOf(qSale, v);
    const proceeds = proceedsOf(v.raiseTarget, {...v, offeringFeeBps: b.offeringFeeBps, hasLock: true}, qSale);
    return {qSale, alloc, proceeds, lpTokenBps: Number(lpTokenBpsOf(v.cBps, v.fBps))};
}

/** Deadline sent with the transaction, from the chain's latest block time: the chosen hours plus a
 *  60 s margin for the block that includes it, never past MAX_DURATION from that time (Offering
 *  checks MIN_DURATION <= deadline - block.timestamp <= MAX_DURATION). */
export function deadlineFor(latestTs: bigint, durationSec: bigint): bigint {
    const want = latestTs + durationSec + 60n;
    const cap = latestTs + OFFERING_CONSTS.MAX_DURATION;
    return want < cap ? want : cap;
}

/** MapaeFactory.CreateParams (tier L1, transfer lock 0, holding cap 0: owner decision). */
export function createParams(v: Values, b: ChainBounds, deadline: bigint) {
    return {
        tokenName: v.name,
        tokenSymbol: v.symbol,
        price: v.price,
        raiseTarget: v.raiseTarget,
        deadline,
        walletLimit: v.walletLimit,
        minCommit: v.minCommit,
        fBps: v.fBps,
        cBps: v.cBps,
        creatorTokenBps: v.creatorTokenBps,
        swapRoyaltyBps: b.swapRoyaltyBps,
        swapBurnBps: b.swapBurnBps,
        tier: 1,
        refundMode: v.refundMode,
        transferLockDuration: 0n,
        holdingCapBps: 0,
        sponsorBurnBps: v.sponsorBurnBps,
        vestingDuration: v.vestingDuration,
        vestingCliff: v.vestingCliff,
        withSponsorship: v.withSponsorship,
        proceedsUpfrontBps: v.proceedsUpfrontBps,
        proceedsLockDuration: v.proceedsLockDuration,
        proceedsLockCliff: v.proceedsLockCliff,
    } as const;
}
