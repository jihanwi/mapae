import {describe, expect, it} from "vitest";
import {ChainBounds, checkCreate, createParams, CreateForm, DEFAULT_FORM, deadlineFor, derive, parseKrw, parsePct} from "./createOffering";
import {OFFERING_CONSTS} from "../contracts/offeringBoundsL1";

const E = 10n ** 18n;
// the deployed v3.2-L1 factory (chain values confirmed by the PM)
const B: ChainBounds = {
    guide: {minPrice: 1000n * E, maxPrice: 100_000n * E, minRaise: 5_000_000n * E, maxRaise: 500_000_000n * E, minWalletLimitBps: 10, maxWalletLimitBps: 3000},
    band: {maxUpfrontBps: 3000, minLockDuration: 3600n, maxLockDuration: 94_608_000n, maxLockCliff: 15_552_000n},
    minRaise: 500_000n * E,
    swapRoyaltyBps: 60,
    swapBurnBps: 30,
    offeringFeeBps: 750,
    maxNameBytes: 32,
};
const OK: CreateForm = {...DEFAULT_FORM, name: "노들 프로토콜", symbol: "nodl", price: "1,000", raiseTarget: "50000000", walletLimit: "5000000", minCommit: "10000"};
const err = (patch: Partial<CreateForm>) => checkCreate({...OK, ...patch}, B).errors;

describe("create form: units", () => {
    it("whole KRWs and percentages with two decimals", () => {
        expect(parseKrw("1,000")).toBe(1000n * E);
        expect(parseKrw("10.5")).toBeNull();
        expect(parseKrw("")).toBeNull();
        expect(parsePct("30")).toBe(3000);
        expect(parsePct("0.15")).toBe(15);
        expect(parsePct("12.5")).toBe(1250);
        expect(parsePct("1.234")).toBeNull();
    });
    it("a valid form gives the contract values (ticker normalized, days to seconds)", () => {
        const c = checkCreate(OK, B);
        expect(c.errors).toEqual({});
        expect(c.values).toMatchObject({symbol: "NODL", price: 1000n * E, durationSec: 86_400n, fBps: 6000, creatorTokenBps: 2000, cBps: 2500, vestingDuration: 1080n * 86_400n, proceedsUpfrontBps: 3000, proceedsLockDuration: 365n * 86_400n, proceedsLockCliff: 30n * 86_400n, sponsorBurnBps: 0, withSponsorship: false});
    });
});

describe("create form: ranges (the PM's acceptance cases)", () => {
    it("price 999 is refused, 1,000 and 100,000 pass, 100,001 is refused", () => {
        expect(err({price: "999"}).price).toBeDefined();
        expect(err({price: "1000"}).price).toBeUndefined();
        expect(err({price: "100000", raiseTarget: "500000000", walletLimit: "5000000"}).price).toBeUndefined();
        expect(err({price: "100001"}).price).toBeDefined();
    });
    it("upfront 31% is refused, 30% passes", () => {
        expect(err({upfrontPct: "31"}).upfrontPct).toBeDefined();
        expect(err({upfrontPct: "30"}).upfrontPct).toBeUndefined();
    });
    it("11 hours is refused, 12 and 48 pass, 49 is refused (codegen MIN/MAX_DURATION)", () => {
        expect(OFFERING_CONSTS.MIN_DURATION).toBe(12n * 3600n);
        expect(err({durationHours: "11"}).durationHours).toBeDefined();
        expect(err({durationHours: "12"}).durationHours).toBeUndefined();
        expect(err({durationHours: "48"}).durationHours).toBeUndefined();
        expect(err({durationHours: "49"}).durationHours).toBeDefined();
    });
    it("a lock cliff longer than the lock is refused; the band limits apply", () => {
        expect(err({lockValue: "10", lockCliffValue: "11"}).lockCliffValue).toBeDefined();
        expect(err({lockValue: "10", lockCliffValue: "10"}).lockCliffValue).toBeUndefined();
        expect(err({lockValue: "1", lockUnit: "hour", lockCliffValue: "0"}).lockValue).toBeUndefined();
        expect(err({lockValue: "59", lockUnit: "hour", lockCliffValue: "0"}).lockValue).toBeUndefined();
        expect(err({lockValue: "0", lockUnit: "hour", lockCliffValue: "0"}).lockValue).toBeDefined();
        expect(err({lockValue: "1096"}).lockValue).toBeDefined();
        expect(err({lockValue: "365", lockCliffValue: "181"}).lockCliffValue).toBeDefined();
        expect(err({lockValue: "365", lockCliffValue: "180"}).lockCliffValue).toBeUndefined();
    });
    it("raise target and the wallet limit band (0.1%–30% of the target)", () => {
        expect(err({raiseTarget: "4999999"}).raiseTarget).toBeDefined();
        expect(err({raiseTarget: "500000001"}).raiseTarget).toBeDefined();
        expect(err({walletLimit: "49999"}).walletLimit).toBeDefined();
        expect(err({walletLimit: "50000", minCommit: "10000"}).walletLimit).toBeUndefined();
        expect(err({walletLimit: "15000000"}).walletLimit).toBeUndefined();
        expect(err({walletLimit: "15000001"}).walletLimit).toBeDefined();
    });
    it("min commit must be > 0 and not above the wallet limit", () => {
        expect(err({minCommit: "0"}).minCommit).toBeDefined();
        expect(err({minCommit: "5000001"}).minCommit).toBeDefined();
        expect(err({minCommit: "5000000"}).minCommit).toBeUndefined();
    });
    it("allocation bands and the cross condition f + issuer + c x f <= 100%", () => {
        expect(err({salePct: "49.99"}).salePct).toBeDefined();
        expect(err({issuerPct: "30.01"}).issuerPct).toBeDefined();
        expect(err({lpPct: "14"}).lpPct).toBeDefined();
        // 70 + 30 + 30 x 0.7 = 121%
        expect(err({salePct: "70", issuerPct: "30", lpPct: "30"}).allocation).toBeDefined();
        // 60 + 20 + 25 x 0.6 = 95%
        expect(err({}).allocation).toBeUndefined();
    });
    it("vesting: codegen bounds, cliff at least the minimum and not longer than the duration", () => {
        expect(err({vestingDays: "359"}).vestingDays).toBeDefined();
        expect(err({vestingDays: "1441"}).vestingDays).toBeDefined();
        expect(err({vestingCliffDays: "89"}).vestingCliffDays).toBeDefined();
        expect(err({vestingDays: "360", vestingCliffDays: "361"}).vestingCliffDays).toBeDefined();
    });
    it("sponsorship burn share only checked when sponsorship is on", () => {
        expect(err({withSponsorship: false, sponsorBurnPct: "99"}).sponsorBurnPct).toBeUndefined();
        expect(err({withSponsorship: true, sponsorBurnPct: "20.01"}).sponsorBurnPct).toBeDefined();
        expect(checkCreate({...OK, withSponsorship: true, sponsorBurnPct: "10"}, B).values?.sponsorBurnBps).toBe(1000);
    });
    it("ticker rule (L0's) and the name byte limit", () => {
        expect(err({symbol: "NO DL"}).symbol).toBeDefined();
        expect(err({symbol: "ＮＯＤＬ"}).symbol).toBeUndefined();
        expect(err({name: "가".repeat(11)}).name).toBeDefined();
    });
});

describe("create form: derived values and parameters", () => {
    it("quantity, supply, shares and the proceeds split when the target is met", () => {
        const v = checkCreate(OK, B).values!;
        const d = derive(v, B);
        expect(d.qSale).toBe(50_000n * E);
        expect(d.lpTokenBps).toBe(1500);
        expect(d.alloc.creator).toBe((d.alloc.supply * 2000n) / 10_000n);
        expect(d.proceeds.platform).toBe(3_750_000n * E);
        expect(d.proceeds.upfront + d.proceeds.locked + d.proceeds.krwSeed + d.proceeds.platform).toBe(50_000_000n * E);
        expect(d.proceeds.upfront).toBe((d.proceeds.issuer * 3000n) / 10_000n);
    });
    it("deadline: chosen hours + 60 s from the chain time, never past MAX_DURATION", () => {
        expect(deadlineFor(1_000n, 12n * 3600n)).toBe(1_000n + 12n * 3600n + 60n);
        expect(deadlineFor(1_000n, 48n * 3600n)).toBe(1_000n + 48n * 3600n);
    });
    it("CreateParams: tier L1, transfer lock 0, holding cap 0, royalty / burn from the FeeRouter table", () => {
        const p = createParams(checkCreate(OK, B).values!, B, 123n);
        expect(p).toMatchObject({tier: 1, transferLockDuration: 0n, holdingCapBps: 0, swapRoyaltyBps: 60, swapBurnBps: 30, deadline: 123n, tokenSymbol: "NODL", refundMode: 0});
    });
});

describe("revert table", async () => {
    const {ko} = await import("../copy/ko");
    const abis = await import("../contracts/abisV3L1");
    it("every mapped name is an error of the factory or a contract it deploys", () => {
        const names = new Set(
            [...abis.MapaeFactoryL1Abi, ...abis.OfferingL1Abi, ...abis.MapaeVestingL1Abi, ...abis.ProceedsLockAbi].filter((x) => x.type === "error").map((x) => (x as {name: string}).name)
        );
        for (const k of Object.keys(ko.offeringCreate.revert)) if (k !== "unknown") expect(names.has(k), k).toBe(true);
    });
});
