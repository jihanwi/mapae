// Asks the server to catch up (POST /api/chain/summary, STATUS 결정 47), then refetches the summary
// so the data version moves and every versioned /api/chain query loads the fresh numbers.
import {useEffect} from "react";
import {QueryClient, useQueryClient} from "@tanstack/react-query";
import {API_BASE} from "./meta";
import {notePokedBlock, useChainSummary} from "./chainData";
import {useActivity} from "./activity";
import {shouldPoke} from "../lib/poke";

let lastPokeMs = 0;
let inflight: Promise<void> | null = null;

/** One catch-up request (shared while in flight). Failures only log: the next chance retries. */
export function pokeChain(qc: QueryClient): Promise<void> {
    if (inflight) return inflight;
    lastPokeMs = Date.now();
    inflight = (async () => {
        try {
            const r = await fetch(`${API_BASE}/api/chain/summary`, {method: "POST"});
            if (!r.ok) throw new Error(`catch-up ${r.status}`);
            const body = (await r.json()) as {indexedBlock: string | null; ran: boolean};
            notePokedBlock(body.indexedBlock);
            await qc.invalidateQueries({queryKey: ["chain", "summary"]});
        } catch (e) {
            console.warn("chain catch-up failed", e);
        } finally {
            inflight = null;
        }
    })();
    return inflight;
}

/** Mounted once in the app: while the tab is visible, asks when the browser's own trades run more
 *  than 60 blocks ahead of the indexer (at most once a minute per tab). */
export function PokeWatcher() {
    const qc = useQueryClient();
    const {trades} = useActivity();
    const summary = useChainSummary();
    const indexedBlock = summary.isSuccess ? summary.data.indexedBlock : undefined;
    let newest: bigint | undefined;
    for (const t of trades) if (newest === undefined || t.block > newest) newest = t.block;
    useEffect(() => {
        const tick = () => {
            const visible = typeof document === "undefined" || document.visibilityState === "visible";
            if (shouldPoke({visible, indexedBlock, newestLiveBlock: newest, lastPokeMs, nowMs: Date.now()})) void pokeChain(qc);
        };
        tick();
        const id = setInterval(tick, 15_000);
        document.addEventListener("visibilitychange", tick);
        return () => {
            clearInterval(id);
            document.removeEventListener("visibilitychange", tick);
        };
    }, [qc, indexedBlock, newest]);
    return null;
}
