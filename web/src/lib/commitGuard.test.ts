import {describe, expect, it} from "vitest";
import {commitBlock, CommitGuardInput, isIssuerWallet} from "./commitGuard";
import {ko} from "../copy/ko";
import {humanError} from "./errors";

const E = 10n ** 18n;
const ISSUER = "0x2D6E234037Da0180be8e4B905f3baA6C544b391d";
const ME = "0x00000000000000000000000000000000000000a1";
const base: CommitGuardInput = {
    account: ME,
    creator: ISSUER,
    verified: true,
    settled: false,
    refunding: false,
    deadlineSec: 2_000_000_000n,
    nowMs: 1_900_000_000_000,
    amount: 100_000n * E,
    myCommitted: 0n,
    minCommit: 10_000n * E,
    walletLimit: 5_000_000n * E,
    balance: 1_000_000n * E,
};

describe("commit checks before any approval (W-T36)", () => {
    it("a valid commit passes", () => {
        expect(commitBlock(base)).toBe("");
    });
    it("the issuer is stopped with the issuer sentence (any address case)", () => {
        expect(commitBlock({...base, account: ISSUER.toLowerCase()})).toBe("발행자는 자기 공모에 응모할 수 없어요");
        expect(isIssuerWallet(ISSUER.toUpperCase().replace("0X", "0x"), ISSUER)).toBe(true);
        expect(isIssuerWallet(ME, ISSUER)).toBe(false);
        expect(isIssuerWallet(undefined, ISSUER)).toBe(false);
    });
    it("deadline passed (at the click), settled or refunding", () => {
        expect(commitBlock({...base, nowMs: 2_000_000_000_000})).toBe(ko.errors.DeadlinePassed);
        expect(commitBlock({...base, settled: true})).toBe(ko.errors.DeadlinePassed);
        expect(commitBlock({...base, refunding: true})).toBe(ko.errors.DeadlinePassed);
    });
    it("not connected, not verified", () => {
        expect(commitBlock({...base, account: undefined})).toBe(ko.hints.connectWallet);
        expect(commitBlock({...base, verified: false})).toBe(ko.hints.needVerify);
    });
    it("minimum only on the first commit, as the contract", () => {
        expect(commitBlock({...base, amount: 9_999n * E})).not.toBe("");
        expect(commitBlock({...base, amount: 1_000n * E, myCommitted: 50_000n * E})).toBe("");
    });
    it("wallet limit on the cumulative amount, and the balance", () => {
        expect(commitBlock({...base, amount: 1n * E, myCommitted: 5_000_000n * E})).toBe(ko.hints.overWalletLimit);
        expect(commitBlock({...base, amount: 5_000_000n * E, walletLimit: 10_000_000n * E})).toBe(ko.hints.overKrwBalance);
    });
    it("a commit revert named IssuerCannotCommit shows the same sentence", () => {
        expect(humanError(new Error("execution reverted: IssuerCannotCommit()"), ko)).toBe("발행자는 자기 공모에 응모할 수 없어요");
    });
});
