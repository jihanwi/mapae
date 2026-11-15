// Asks the server to catch up (POST /api/chain/summary, STATUS 결정 47), then refetches the summary
// so the data version moves and every versioned /api/chain query loads the fresh numbers.
// After a transaction: one ask 12 s after the LAST success (an approval followed by a buy asks
// once), one retry 20 s later when the answer did not cover the tx (lib/poke). Hidden tabs keep the
// timer and send when visible again. The tab watcher covers trades seen from other wallets.
import {useEffect} from "react";
import {QueryClient, useQueryClient} from "@tanstack/react-query";
import {API_BASE} from "./meta";
import {notePokedBlock, useChainSummary} from "./chainData";
import {useActivity} from "./activity";
import {afterAnswer, IDLE, nextPokeAt, onTxSuccess, PokeSchedule, shouldPoke} from "../lib/poke";

type Answer = {indexedBlock: string | null; ran: boolean};

let lastPokeMs = 0;
let inflight: Promise<Answer | null> | null = null;

/** One catch-up request (shared while in flight). null on failure (logged, not shown). */
export function pokeChain(qc: QueryClient): Promise<Answer | null> {
    if (inflight) return inflight;
    lastPokeMs = Date.now();
    inflight = (async () => {
        try {
            const r = await fetch(`${API_BASE}/api/chain/summary`, {method: "POST"});
            if (!r.ok) throw new Error(`catch-up ${r.status}`);
            const body = (await r.json()) as Answer;
            notePokedBlock(body.indexedBlock);
            await qc.invalidateQueries({queryKey: ["chain", "summary"]});
            return body;
        } catch (e) {
            console.warn("chain catch-up failed", e);
            return null;
        } finally {
            inflight = null;
        }
    })();
    return inflight;
}

// ---- after-transaction schedule (one per tab) ----
let schedule: PokeSchedule = IDLE;
let timer: ReturnType<typeof setTimeout> | null = null;

const visible = () => typeof document === "undefined" || document.visibilityState === "visible";

function arm(qc: QueryClient): void {
    if (timer) clearTimeout(timer);
    timer = null;
    const due = nextPokeAt(schedule);
    if (due === null) return;
    timer = setTimeout(() => void fire(qc), Math.max(0, due - Date.now()));
}

async function fire(qc: QueryClient): Promise<void> {
    timer = null;
    if (!visible()) {
        // keep the schedule; send once the tab is visible again
        const onVisible = () => {
            if (!visible()) return;
            document.removeEventListener("visibilitychange", onVisible);
            void fire(qc);
        };
        document.addEventListener("visibilitychange", onVisible);
        return;
    }
    const answer = await pokeChain(qc);
    schedule = afterAnswer(schedule, answer, Date.now());
    arm(qc);
}

/** A transaction from this app succeeded (block from its receipt when known). */
export function catchUpAfterTx(qc: QueryClient, block?: bigint): void {
    schedule = onTxSuccess(schedule, Date.now(), block);
    arm(qc);
}

/** Mounted once in the app: while the tab is visible, asks when the browser holds a trade past the
 *  indexer that is at least 12 s old (at most every 30 s per tab). */
export function PokeWatcher() {
    const qc = useQueryClient();
    const {trades, tsOf} = useActivity();
    const summary = useChainSummary();
    const indexedBlock = summary.isSuccess ? summary.data.indexedBlock : undefined;
    let newest: bigint | undefined;
    for (const t of trades) if (newest === undefined || t.block > newest) newest = t.block;
    const newestTs = newest !== undefined ? tsOf(newest) : undefined;
    useEffect(() => {
        const tick = () => {
            // a pending after-transaction ask covers it: no second request for the same trade
            if (nextPokeAt(schedule) !== null) return;
            if (shouldPoke({visible: visible(), indexedBlock, newestLiveBlock: newest, newestLiveTs: newestTs, lastPokeMs, nowMs: Date.now()})) void pokeChain(qc);
        };
        tick();
        const id = setInterval(tick, 5_000);
        document.addEventListener("visibilitychange", tick);
        return () => {
            clearInterval(id);
            document.removeEventListener("visibilitychange", tick);
        };
    }, [qc, indexedBlock, newest, newestTs]);
    return null;
}
