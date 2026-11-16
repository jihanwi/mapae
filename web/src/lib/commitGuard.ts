// Checks made before the approval of a commit (W-T36): every reason Offering.commit would revert
// for that the browser can know, so an approval is never sent for a commit that cannot succeed.
// Order follows Offering.commit: phase, deadline, zero, issuer, real name, minimum on the first
// commit, wallet limit; then the wallet's balance (the transfer would fail).
import {ko, type Copy} from "../copy/ko";
import {fmt} from "./format";

export type CommitGuardInput = {
    account: string | undefined;
    creator: string;
    verified: boolean;
    settled: boolean;
    refunding: boolean;
    deadlineSec: bigint;
    nowMs: number;
    amount: bigint;
    myCommitted: bigint;
    minCommit: bigint;
    walletLimit: bigint;
    balance: bigint;
};

/** "" when the commit can go ahead, otherwise the reason shown under the button (in `copy`'s language). */
export function commitBlock(p: CommitGuardInput, copy: Copy = ko): string {
    if (!p.account) return copy.hints.connectWallet;
    if (p.account.toLowerCase() === p.creator.toLowerCase()) return copy.offering.issuerCannotCommit;
    if (p.settled || p.refunding || BigInt(Math.floor(p.nowMs / 1000)) >= p.deadlineSec) return copy.errors.DeadlinePassed;
    if (!p.verified) return copy.hints.needVerify;
    if (p.amount === 0n) return "";
    const cumulative = p.myCommitted + p.amount;
    // the minimum applies to a wallet's first commit only (Offering: committed == 0 && cumulative < min)
    if (p.myCommitted === 0n && cumulative < p.minCommit) return copy.hints.belowMinCommit(fmt(p.minCommit, 0));
    if (p.walletLimit > 0n && cumulative > p.walletLimit) return copy.hints.overWalletLimit;
    if (p.amount > p.balance) return copy.hints.overKrwBalance;
    return "";
}

/** True when the connected wallet is the offering's issuer (no commit area at all). */
export const isIssuerWallet = (account: string | undefined, creator: string) => !!account && account.toLowerCase() === creator.toLowerCase();
