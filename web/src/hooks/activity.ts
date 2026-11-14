// Live activity from RPC logs only (no backend, no indexer).
// - First load: latest block, the block INITIAL_SPAN earlier (timestamps for interpolation), and
//   ONE eth_getLogs over [latest - 9000, latest] with topics[0] = [Buy, Sell, Swapped, Graduated]
//   and no address filter (the RPC caps a getLogs range at 10,000 blocks).
// - Then every 5 s: latest block (eth_getBlockByNumber, which also gives its timestamp) and ONE
//   eth_getLogs over [last seen + 1, latest]. No per-curve or per-block calls. Paused while the tab
//   is hidden; on return, a gap longer than INITIAL_SPAN restarts with a fresh window.
// - Logs are tied to curves at read time (lib/activity resolve) against the current useCurves list,
//   so a trade in the same tx that creates a curve is not lost while the list catches up.
// - Failures are exposed as `error`; there is no fallback data. The curve list never depends on it.
import {createContext, createElement, ReactNode, useContext, useEffect, useMemo, useRef, useState} from "react";
import {Hex, numberToHex} from "viem";
import {usePublicClient} from "wagmi";
import {giwaSepolia} from "../config/chain";
import {
    ACTIVITY_CAP,
    ACTIVITY_TOPICS,
    aggregate,
    BlockTime,
    coverageHours,
    CurveStats,
    decodeActivityLogs,
    Entry,
    INITIAL_SPAN,
    interpolateTs,
    mergeEntries,
    RawLog,
    resolve,
    Trade,
} from "../lib/activity";
import {Address, useCurves} from "./curves";

export const POLL_MS = 5_000;

type RpcLog = {address: Address; topics: Hex[]; data: Hex; blockNumber: Hex | null; logIndex: Hex | null; transactionHash: Hex | null};

type Raw = {entries: Entry[]; from: BlockTime | null; latest: BlockTime | null; error: unknown; loaded: boolean};

export type Activity = {
    /** First window loaded (until then the feed areas render nothing). */
    loaded: boolean;
    error: unknown;
    /** All resolved trades, newest first. */
    trades: Trade[];
    stats: Map<Address, CurveStats>;
    graduatedAt: Map<Address, bigint>;
    /** Hours actually covered by the retained window (interpolated block times). */
    hours: number | undefined;
    /** Estimated unix seconds of a block. */
    tsOf: (block: bigint) => number | undefined;
};

const EMPTY: Activity = {loaded: false, error: null, trades: [], stats: new Map(), graduatedAt: new Map(), hours: undefined, tsOf: () => undefined};
const Ctx = createContext<Activity>(EMPTY);

export function useActivity(): Activity {
    return useContext(Ctx);
}

const toRaw = (l: RpcLog): RawLog => ({
    address: l.address,
    topics: l.topics,
    data: l.data,
    blockNumber: l.blockNumber === null ? null : BigInt(l.blockNumber),
    logIndex: l.logIndex === null ? null : Number(BigInt(l.logIndex)),
    transactionHash: l.transactionHash,
});

/** Polls activity while `enabled` (v3 screens only; the legacy offering section never polls). */
export function ActivityProvider({enabled, children}: {enabled: boolean; children: ReactNode}) {
    const client = usePublicClient({chainId: giwaSepolia.id});
    const {curves} = useCurves(enabled); // no v3 reads from the legacy offering section
    const [raw, setRaw] = useState<Raw>({entries: [], from: null, latest: null, error: null, loaded: false});
    const lastSeen = useRef<bigint | null>(null);

    useEffect(() => {
        if (!enabled || !client) return;
        let stopped = false;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const getLogs = (fromBlock: bigint, toBlock: bigint) =>
            client.request({
                method: "eth_getLogs",
                params: [{fromBlock: numberToHex(fromBlock), toBlock: numberToHex(toBlock), topics: [ACTIVITY_TOPICS]}],
            }) as Promise<RpcLog[]>;

        const fresh = async () => {
            const head = await client.getBlock({blockTag: "latest"});
            const fromBlock = head.number > INITIAL_SPAN ? head.number - INITIAL_SPAN : 0n;
            const [first, logs] = await Promise.all([client.getBlock({blockNumber: fromBlock}), getLogs(fromBlock, head.number)]);
            if (stopped) return;
            lastSeen.current = head.number;
            setRaw({
                entries: mergeEntries([], decodeActivityLogs(logs.map(toRaw))),
                from: {block: first.number, ts: Number(first.timestamp)},
                latest: {block: head.number, ts: Number(head.timestamp)},
                error: null,
                loaded: true,
            });
        };

        const step = async () => {
            const seen = lastSeen.current;
            if (seen === null) return fresh();
            const head = await client.getBlock({blockTag: "latest"});
            if (head.number - seen > INITIAL_SPAN) return fresh(); // tab was hidden for a long time
            const latest = {block: head.number, ts: Number(head.timestamp)};
            if (head.number <= seen) {
                if (!stopped) setRaw((r) => ({...r, latest, error: null}));
                return;
            }
            const logs = await getLogs(seen + 1n, head.number);
            if (stopped) return;
            lastSeen.current = head.number;
            const incoming = decodeActivityLogs(logs.map(toRaw));
            setRaw((r) => ({...r, entries: mergeEntries(r.entries, incoming), latest, error: null}));
        };

        const schedule = () => {
            if (stopped || document.hidden) return;
            timer = setTimeout(tick, POLL_MS);
        };
        const tick = async () => {
            try {
                await step();
            } catch (e) {
                console.error("activity poll failed", e);
                if (!stopped) setRaw((r) => ({...r, error: e}));
            }
            schedule();
        };
        const onVisible = () => {
            if (document.hidden) {
                clearTimeout(timer);
                timer = undefined;
            } else if (timer === undefined) {
                void tick();
            }
        };

        document.addEventListener("visibilitychange", onVisible);
        if (!document.hidden) void tick();
        return () => {
            stopped = true;
            clearTimeout(timer);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, [enabled, client]);

    // useCurves returns a new array on every render; key the memo on the fields resolve() uses.
    const refsKey = curves.map((c) => `${c.address}:${c.pool}:${c.dev}:${c.index}`).join(",");
    const refs = useMemo(() => curves.map((c) => ({address: c.address, pool: c.pool, dev: c.dev, index: c.index})), [refsKey]); // eslint-disable-line react-hooks/exhaustive-deps

    const value = useMemo<Activity>(() => {
        if (!raw.loaded) return {...EMPTY, error: raw.error};
        const {trades, graduatedAt} = resolve(raw.entries, refs);
        const from = raw.from!;
        const latest = raw.latest!;
        // If the cap dropped older entries, the window starts at the oldest retained one.
        const oldest = raw.entries.at(-1);
        const start = oldest && raw.entries.length >= ACTIVITY_CAP ? {block: oldest.block, ts: interpolateTs(oldest.block, from, latest)} : from;
        return {
            loaded: true,
            error: raw.error,
            trades,
            stats: aggregate(trades),
            graduatedAt,
            hours: coverageHours(start, latest),
            tsOf: (b: bigint) => interpolateTs(b, from, latest),
        };
    }, [raw, refs]);

    return createElement(Ctx.Provider, {value}, children);
}
