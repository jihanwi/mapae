// W-T40: the offering section reads every L1 MapaeFactory (L1_FACTORIES, current first). Pure helpers:
// pair each listed offering with its factory, pick where an event scan starts, and decide the
// create-screen cap on the current factory only (the contract counts live offerings per factory).
import {L1_FACTORIES} from "../contracts/addressesV3L1";

export type L1Factory = {version: string; mapaeFactory: string; feeRouter: string; deployBlock: bigint};
export type ListedOffering = {address: `0x${string}`; factory: `0x${string}`};

const lc = (a: string) => a.toLowerCase();

/** allOfferings() of each factory -> one list, oldest factory first and each factory's own order kept
 *  (so the list is in creation order as before). An address listed twice keeps its first factory.
 *  `lists[i]` belongs to `factories[i]`; undefined means that read has not answered. */
export function pairOfferings(factories: readonly L1Factory[], lists: readonly (readonly string[] | undefined)[]): ListedOffering[] {
    const out: ListedOffering[] = [];
    const seen = new Set<string>();
    for (let i = factories.length - 1; i >= 0; i--) {
        for (const a of lists[i] ?? []) {
            if (seen.has(lc(a))) continue;
            seen.add(lc(a));
            out.push({address: a as `0x${string}`, factory: factories[i].mapaeFactory as `0x${string}`});
        }
    }
    return out;
}

/** First block of an event scan over offerings of these factories: the oldest of their deployment
 *  blocks. An unknown or missing factory starts at the oldest L1 deployment, so no event is missed. */
export function scanStartFor(factories: readonly (string | undefined)[], all: readonly L1Factory[] = L1_FACTORIES): bigint {
    const oldest = all.reduce((m, f) => (f.deployBlock < m ? f.deployBlock : m), all[0].deployBlock);
    if (factories.length === 0) return oldest;
    let start: bigint | undefined;
    for (const f of factories) {
        const hit = f ? all.find((x) => lc(x.mapaeFactory) === lc(f)) : undefined;
        const b = hit ? hit.deployBlock : oldest;
        if (start === undefined || b < start) start = b;
    }
    return start!;
}

export type CapEntry = {address: `0x${string}`; phase: number | undefined; tier: number | undefined};

/** IPrimaryMarket.Phase values the v3.4-L1 cap counts (decision 63): Open and Frozen. */
const PHASE_OPEN = 0;
const PHASE_FROZEN = 1;

/** MapaeFactory._enforceLiveCap on the current factory (v3.4-L1, decision 63): the wallet's newest
 *  L1/L2 offering there that is still Open or Frozen. Settled and Refunding offerings no longer block.
 *  `entries` are the current factory's offeringsByCreator in order; offerings of older factories are
 *  never passed in (they never block). undefined while a read is missing, null when nothing blocks. */
export function activeOfferingOf(entries: readonly CapEntry[]): `0x${string}` | null | undefined {
    for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (e.phase === undefined || e.tier === undefined) return undefined;
        if (e.tier !== 0 && (e.phase === PHASE_OPEN || e.phase === PHASE_FROZEN)) return e.address;
    }
    return null;
}
