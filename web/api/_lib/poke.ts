// On-demand catch-up (POST /api/chain/summary): index at most one range now, and at most once per
// POKE_GAP_SEC across all callers (the claim on the cursor row). Pure; dependencies injected.
import type {CronResult} from "./indexer.js";
import {withSchemaRetry, type PokeClaim} from "./db.js";

export type PokeDeps = {
    claim(nowSec: number): Promise<PokeClaim>;
    ensureSchema(): Promise<void>;
    /** One catch-up index run (1 range, 8 s budget). */
    index(): Promise<CronResult>;
    indexedBlock(): Promise<string | null>;
    nowMs(): number;
};

export type PokeAnswer = {indexedBlock: string | null; ran: boolean};

export async function handlePoke(deps: PokeDeps): Promise<PokeAnswer> {
    const now = Math.floor(deps.nowMs() / 1000);
    // first catch-up before the cron migrated the schema (e.g. the poke_ts column)
    const claim: PokeClaim = await withSchemaRetry("chain/summary POST", () => deps.claim(now), deps.ensureSchema);
    if (claim === "throttled") return {indexedBlock: await deps.indexedBlock(), ran: false};
    // "no_row": the cursor row of this version does not exist yet (just after a version switch);
    // the run below creates it, as the cron would.
    if (claim === "no_row") await deps.ensureSchema();
    const r = await deps.index();
    if (r.status !== 200) throw new Error(`catch-up index failed: ${JSON.stringify(r.body)}`);
    return {indexedBlock: await deps.indexedBlock(), ran: true};
}
