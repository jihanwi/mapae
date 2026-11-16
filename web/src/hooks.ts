// Fixed-price offering section (W-T32): reads the v3.2-L1 MapaeFactory (ADDR_L1) and its children.
// Every per-offering read is one multicall over the whole list (no per-offering request chains).
import {useQuery, useQueryClient} from "@tanstack/react-query";
import {useAccount, useBalance, usePublicClient, useReadContract, useReadContracts} from "wagmi";
import {Abi, AbiEvent, Log, parseAbiItem} from "viem";
import {ADDR_L1} from "./contracts/addressesV3L1";
import {MapaeFactoryL1Abi, OfferingL1Abi} from "./contracts/abisV3L1";
import {MapaePoolV3Abi, MembershipTokenV3Abi, MockDojangV3Abi, MockKRWV3Abi} from "./contracts/abisV3";
import {giwaSepolia} from "./config/chain";
import {logState, LogState, planScan, ScanWindow} from "./lib/logRange";

export const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as const;
const nonZero = (a: unknown): `0x${string}` | undefined =>
    typeof a === "string" && a !== ZERO_ADDR ? (a as `0x${string}`) : undefined;

export type OfferingInfo = {
    address: `0x${string}`;
    creator: `0x${string}`;
    price: bigint;
    raiseTarget: bigint;
    deadline: bigint;
    totalCommitted: bigint;
    settled: boolean;
    refunding: boolean;
    refundMode: number;
    qSale: bigint;
    totalSold: bigint;
    totalRaised: bigint;
    fBps: number;
    token: `0x${string}`;
    pool: `0x${string}`;
    phase: number;
    tier: number;
    /** issuer token vesting (recipients().creatorVesting, a MapaeVesting) */
    vesting: `0x${string}` | undefined;
    /** ProceedsLock (zero for an offering without one) */
    proceedsLock: `0x${string}` | undefined;
    proceedsUpfrontBps: number;
    /** factory sponsorshipOf (zero when created without sponsorship) */
    sponsorship: `0x${string}` | undefined;
    redeemManager: `0x${string}` | undefined;
    tokenName: string;
    tokenSymbol: string;
    totalSupply: bigint;
    spotPrice: bigint;
};

const OFFERING_FNS = [
    "creator", "price", "raiseTarget", "deadline", "totalCommitted", "settled", "refunding", "refundMode",
    "qSale", "totalSold", "totalRaised", "fBps", "token", "pool", "phase", "tier", "recipients", "proceedsLock", "proceedsUpfrontBps",
] as const;
const FACTORY_FNS = ["sponsorshipOf", "redeemManagerOf"] as const;
const PER = OFFERING_FNS.length + FACTORY_FNS.length;

const offeringReads = (addr: `0x${string}`) => [
    ...OFFERING_FNS.map((fn) => ({address: addr, abi: OfferingL1Abi as Abi, functionName: fn, chainId: giwaSepolia.id})),
    ...FACTORY_FNS.map((fn) => ({address: ADDR_L1.mapaeFactory, abi: MapaeFactoryL1Abi as Abi, functionName: fn, args: [addr], chainId: giwaSepolia.id})),
];

/** Display label of an offering: its token's name and symbol (no screen-side name table). */
export function labelOf(o: Pick<OfferingInfo, "tokenName" | "tokenSymbol">): {name: string; symbol: string} | null {
    if (!o.tokenSymbol) return null;
    return {name: o.tokenName || o.tokenSymbol, symbol: o.tokenSymbol};
}

export function useOfferings(enabled = true) {
    const list = useReadContract({address: ADDR_L1.mapaeFactory, abi: MapaeFactoryL1Abi, functionName: "allOfferings", chainId: giwaSepolia.id, query: {enabled}});
    const addrs = (list.data ?? []) as `0x${string}`[];
    const reads = useReadContracts({
        contracts: addrs.flatMap(offeringReads),
        query: {enabled: enabled && addrs.length > 0, refetchInterval: 15_000},
    });
    const base = addrs.map((address, i) => {
        const r = reads.data?.slice(i * PER, (i + 1) * PER).map((x) => x.result);
        if (!r || r.some((v) => v === undefined)) return null;
        const v = Object.fromEntries(OFFERING_FNS.map((fn, k) => [fn, r[k]])) as Record<(typeof OFFERING_FNS)[number], unknown>;
        const recips = v.recipients as readonly [`0x${string}`, `0x${string}`];
        return {
            address,
            creator: v.creator, price: v.price, raiseTarget: v.raiseTarget, deadline: v.deadline, totalCommitted: v.totalCommitted,
            settled: v.settled, refunding: v.refunding, refundMode: Number(v.refundMode), qSale: v.qSale, totalSold: v.totalSold,
            totalRaised: v.totalRaised, fBps: Number(v.fBps), token: v.token, pool: v.pool, phase: Number(v.phase), tier: Number(v.tier),
            vesting: nonZero(recips?.[0]), proceedsLock: nonZero(v.proceedsLock), proceedsUpfrontBps: Number(v.proceedsUpfrontBps),
            sponsorship: nonZero(r[OFFERING_FNS.length]), redeemManager: nonZero(r[OFFERING_FNS.length + 1]),
        } as Omit<OfferingInfo, "tokenName" | "tokenSymbol" | "totalSupply" | "spotPrice">;
    });
    const tokenReads = useReadContracts({
        contracts: base.flatMap((b) => [
            {address: b?.token, abi: MembershipTokenV3Abi as Abi, functionName: "name", chainId: giwaSepolia.id},
            {address: b?.token, abi: MembershipTokenV3Abi as Abi, functionName: "symbol", chainId: giwaSepolia.id},
            {address: b?.token, abi: MembershipTokenV3Abi as Abi, functionName: "totalSupply", chainId: giwaSepolia.id},
        ]),
        query: {enabled: enabled && base.length > 0 && base.every((b) => b?.token), refetchInterval: 15_000},
    });
    const poolAddrs = base.map((b) => b?.pool).filter((p): p is `0x${string}` => !!p && p !== ZERO_ADDR);
    const poolReads = useReadContracts({
        contracts: poolAddrs.map((p) => ({address: p, abi: MapaePoolV3Abi as Abi, functionName: "spotPrice", chainId: giwaSepolia.id})),
        query: {enabled: enabled && poolAddrs.length > 0, refetchInterval: 15_000},
    });
    const offerings: OfferingInfo[] = base
        .map((b, i) => {
            if (!b) return null;
            const t = tokenReads.data?.slice(i * 3, (i + 1) * 3).map((x) => x.result);
            const poolIdx = poolAddrs.indexOf(b.pool);
            return {
                ...b,
                tokenName: (t?.[0] as string) ?? "",
                tokenSymbol: (t?.[1] as string) ?? "",
                totalSupply: (t?.[2] as bigint) ?? 0n,
                spotPrice: poolIdx >= 0 ? ((poolReads.data?.[poolIdx]?.result as bigint) ?? 0n) : 0n,
            } as OfferingInfo;
        })
        .filter((x): x is OfferingInfo => x !== null);
    const readFailed = reads.data?.some((x) => x.status !== "success") ?? false;
    return {
        offerings,
        /** allOfferings() answered with an empty list */
        empty: list.isSuccess && addrs.length === 0,
        isLoading: list.isLoading || (addrs.length > 0 && (reads.isLoading || tokenReads.isLoading)),
        isError: list.isError || reads.isError || readFailed,
        refetch: () => { list.refetch(); reads.refetch(); tokenReads.refetch(); poolReads.refetch(); },
    };
}

export type EventLog = Log & {args: Record<string, unknown>; eventName?: string};
type LogScan = {window: ScanWindow; logs: EventLog[]};

export type EventLogsResult = {
    logs: EventLog[] | undefined;
    /** error (nothing read), partial (read only from window.fromBlock), complete (back to the deployment) */
    state: LogState;
    window: ScanWindow | undefined;
    refetch: () => void;
};

const SCAN_CONCURRENCY = 3;

/** Chunked event scan (lib/logRange): at most 9,000 blocks per request, the first read covers the
 *  newest 12 windows (~30 h) back to the v3.2-L1 deployment at most, later reads continue from the
 *  last block. A failed request fails the read (an error state, never an empty list). */
export function useEventLogs(
    address: `0x${string}` | readonly `0x${string}`[] | undefined,
    eventSig: string | readonly string[],
    enabled = true
): EventLogsResult {
    const client = usePublicClient({chainId: giwaSepolia.id});
    const qc = useQueryClient();
    const sigs = typeof eventSig === "string" ? [eventSig] : [...eventSig];
    const addrKey = Array.isArray(address) ? [...address].map((a) => a.toLowerCase()).sort().join(",") : (address as string | undefined)?.toLowerCase();
    const queryKey = ["logsL1", addrKey, sigs.join("|")];
    const q = useQuery({
        queryKey,
        enabled: !!client && !!address && (!Array.isArray(address) || address.length > 0) && enabled,
        refetchInterval: 12_000,
        // the transport already retries each request (config/wagmi.ts); one more query attempt, so a
        // failed read reaches the error state in seconds instead of ~20 s
        retry: 1,
        structuralSharing: false,
        queryFn: async () => {
            const prev = qc.getQueryData<LogScan>(queryKey);
            try {
                const latest = await client!.getBlockNumber();
                const plan = planScan({deployBlock: ADDR_L1.deployBlock, latest, prev: prev?.window});
                if (plan.ranges.length === 0 && prev && !plan.reset) return prev;
                const events = sigs.map((s) => parseAbiItem(s) as AbiEvent);
                const found: EventLog[][] = new Array(plan.ranges.length);
                for (let i = 0; i < plan.ranges.length; i += SCAN_CONCURRENCY) {
                    await Promise.all(
                        plan.ranges.slice(i, i + SCAN_CONCURRENCY).map(async ([fromBlock, toBlock], k) => {
                            const addr = address as `0x${string}` | `0x${string}`[];
                            found[i + k] = (events.length === 1
                                ? await client!.getLogs({address: addr, event: events[0], fromBlock, toBlock})
                                : await client!.getLogs({address: addr, events, fromBlock, toBlock})) as EventLog[];
                        })
                    );
                }
                const logs = [...(plan.reset || !prev ? [] : prev.logs), ...found.flat()];
                return {window: plan.window, logs} as LogScan;
            } catch (e) {
                console.warn(`event scan failed (${sigs.map((s) => s.split("(")[0]).join(", ")}):`, e);
                throw e;
            }
        },
    });
    return {
        logs: q.data?.logs,
        // a query without data goes back to "pending" on every refetch (react-query v5), so the error
        // state is "the last settled result was an error", not isError alone
        state: logState({isError: q.isError || q.errorUpdatedAt > q.dataUpdatedAt, hasData: q.data !== undefined, complete: q.data?.window.complete}),
        window: q.data?.window,
        refetch: () => void q.refetch(),
    };
}

const blockTsCache = new Map<string, number>();

/** 로그 블록들의 타임스탬프(초) — 모듈 캐시로 블록당 1회만 조회 */
export function useBlockTimestamps(blockNumbers: bigint[]) {
    const client = usePublicClient({chainId: giwaSepolia.id});
    const uniq = [...new Set(blockNumbers.map(String))];
    return useQuery({
        queryKey: ["blockTs", uniq.length, uniq[uniq.length - 1] ?? ""],
        enabled: !!client && uniq.length > 0,
        staleTime: Infinity,
        queryFn: async () => {
            const missing = uniq.filter((b) => !blockTsCache.has(b));
            for (let i = 0; i < missing.length; i += 5) {
                await Promise.all(missing.slice(i, i + 5).map(async (b) => {
                    const blk = await client!.getBlock({blockNumber: BigInt(b)});
                    blockTsCache.set(b, Number(blk.timestamp));
                }));
            }
            return Object.fromEntries(uniq.map((b) => [b, blockTsCache.get(b)!]));
        },
    });
}

const COMMITTED = "event Committed(address indexed participant, uint256 amount, uint256 cumulative)";
const CANCELLED = "event Cancelled(address indexed participant, uint256 amount, uint256 cumulative)";

/** Wallets with a nonzero final commitment per offering, from one scan of Committed + Cancelled over
 *  every listed offering (the last cumulative of each wallet counts, same rule as snapshot.js).
 *  A count is given only when the scan reached the deployment block (complete). */
export function useParticipantCounts(offerings: readonly `0x${string}`[]) {
    const scan = useEventLogs(offerings, [COMMITTED, CANCELLED]);
    const countOf = (offering: `0x${string}` | undefined): number | undefined => {
        if (!offering || scan.state !== "complete" || !scan.logs) return undefined;
        const mine = scan.logs
            .filter((l) => l.address.toLowerCase() === offering.toLowerCase())
            .sort((a, b) => (a.blockNumber !== b.blockNumber ? (a.blockNumber! < b.blockNumber! ? -1 : 1) : (a.logIndex ?? 0) - (b.logIndex ?? 0)));
        const final = new Map<string, bigint>();
        for (const l of mine) {
            const a = l.args as {participant: string; cumulative: bigint};
            final.set(a.participant.toLowerCase(), a.cumulative);
        }
        let n = 0;
        for (const c of final.values()) if (c > 0n) n++;
        return n;
    };
    return {countOf, state: scan.state};
}

/** Offering-section onboarding: v3.2-L1 payment token balance and the factory's real-name check
 *  (DojangAnyOf: official Dojang OR MockDojang). */
export function useOnboarding() {
    const {address} = useAccount();
    const owner = address ?? ZERO_ADDR;
    const reads = useReadContracts({
        contracts: [
            {address: ADDR_L1.mockKRW, abi: MockKRWV3Abi as Abi, functionName: "balanceOf", args: [owner], chainId: giwaSepolia.id},
            {address: ADDR_L1.dojangAnyOf, abi: MockDojangV3Abi as Abi, functionName: "isVerified", args: [owner], chainId: giwaSepolia.id},
        ],
        query: {enabled: !!address, refetchInterval: 15_000},
    });
    // P0 #3: 네이티브 가스(ETH) 잔고 — 0이면 온보딩부터 막히므로 안내
    const eth = useBalance({address, chainId: giwaSepolia.id, query: {enabled: !!address, refetchInterval: 15_000}});
    const failed = reads.isError || (reads.data?.some((x) => x.status !== "success") ?? false);
    return {
        krwBalance: (reads.data?.[0]?.result as bigint | undefined) ?? 0n,
        verified: (reads.data?.[1]?.result as boolean | undefined) ?? false,
        ethBalance: eth.data?.value,
        isError: failed,
    };
}

export const REDEEMABLE_CREATED = "event RedeemableCreated(uint256 indexed id, address indexed creator, uint256 burnAmount, uint256 maxClaims, uint256 deadline)";

/** Redeem peripherals of every listed offering (decision 55): manager and sponsorship come with the
 *  offering list (one multicall); redeem items come from one RedeemableCreated scan over every
 *  manager, run only when no offering has a sponsorship (RedeemManager ids are chosen by the issuer
 *  and there is no count view, so the catalog is read from events). A partial scan that found
 *  nothing is treated as unknown (itemsError), so an older item never hides the tab. */
export function useRedeemPeripherals(enabled = true) {
    const {offerings, isLoading, isError, empty} = useOfferings(enabled);
    const per = offerings.map((o) => ({offering: o.address, redeemManager: o.redeemManager, sponsorship: o.sponsorship}));
    const managers = per.map((p) => p.redeemManager).filter((m): m is `0x${string}` => !!m);
    const sponsors = per.filter((p) => p.sponsorship).length;
    const loaded = empty || (!isLoading && offerings.length > 0);
    const logs = useEventLogs(managers, REDEEMABLE_CREATED, enabled && loaded && !isError && sponsors === 0);
    const itemCount = (m?: `0x${string}`) =>
        new Set((logs.logs ?? []).filter((l) => !m || l.address.toLowerCase() === m.toLowerCase()).map((l) => `${l.address.toLowerCase()}:${String(l.args.id)}`)).size;
    const known = logs.state === "complete" || (logs.state === "partial" && itemCount() > 0);
    const items = managers.length === 0 ? 0 : known ? itemCount() : undefined;
    const status: "loading" | "error" | "done" = isError ? "error" : !loaded ? "loading" : "done";
    return {
        status,
        sponsors,
        items,
        itemsError: logs.state === "error" || (logs.state === "partial" && itemCount() === 0),
        per: per.map((p) => ({...p, items: p.redeemManager && logs.state === "complete" ? itemCount(p.redeemManager) : undefined})),
    };
}
