import {useQuery, useQueryClient} from "@tanstack/react-query";
import {useAccount, usePublicClient, useReadContract, useReadContracts} from "wagmi";
import {Abi, AbiEvent, Log, parseAbiItem} from "viem";
import {ADDR, DEPLOY_BLOCK} from "./contracts/addresses";
import {MapaeFactoryAbi, MembershipTokenAbi, MockDojangAbi, MockKRWAbi, OfferingAbi, MapaePoolAbi} from "./contracts/abis";

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
    fBps: number;
    token: `0x${string}`;
    pool: `0x${string}`;
    tokenName: string;
    tokenSymbol: string;
    totalSupply: bigint;
    spotPrice: bigint;
    phase: number;
};

const offeringReads = (addr: `0x${string}`) =>
    (["creator", "price", "raiseTarget", "deadline", "totalCommitted", "settled", "refunding", "refundMode", "qSale", "totalSold", "fBps", "token", "pool", "phase"] as const).map(
        (fn) => ({address: addr, abi: OfferingAbi as Abi, functionName: fn})
    );

export function useOfferings() {
    const list = useReadContract({address: ADDR.factory, abi: MapaeFactoryAbi, functionName: "allOfferings"});
    const addrs = (list.data ?? []) as `0x${string}`[];
    const reads = useReadContracts({
        contracts: addrs.flatMap(offeringReads),
        query: {enabled: addrs.length > 0, refetchInterval: 15_000},
    });
    const N = 14;
    const base = addrs.map((address, i) => {
        const r = reads.data?.slice(i * N, (i + 1) * N).map((x) => x.result);
        if (!r || r.some((v) => v === undefined)) return null;
        return {
            address, creator: r[0], price: r[1], raiseTarget: r[2], deadline: r[3], totalCommitted: r[4],
            settled: r[5], refunding: r[6], refundMode: r[7], qSale: r[8], totalSold: r[9], fBps: r[10],
            token: r[11], pool: r[12], phase: r[13],
        } as Partial<OfferingInfo> & {address: `0x${string}`; token: `0x${string}`; pool: `0x${string}`};
    });
    const tokenReads = useReadContracts({
        contracts: base.flatMap((b) => [
            {address: b?.token, abi: MembershipTokenAbi as Abi, functionName: "name"},
            {address: b?.token, abi: MembershipTokenAbi as Abi, functionName: "symbol"},
            {address: b?.token, abi: MembershipTokenAbi as Abi, functionName: "totalSupply"},
        ]),
        query: {enabled: base.length > 0 && base.every((b) => b?.token), refetchInterval: 15_000},
    });
    const poolAddrs = base.map((b) => b?.pool).filter((p): p is `0x${string}` => !!p && p !== "0x0000000000000000000000000000000000000000");
    const poolReads = useReadContracts({
        contracts: poolAddrs.map((p) => ({address: p, abi: MapaePoolAbi as Abi, functionName: "spotPrice"})),
        query: {enabled: poolAddrs.length > 0, refetchInterval: 15_000},
    });
    const offerings: OfferingInfo[] = base
        .map((b, i) => {
            if (!b) return null;
            const t = tokenReads.data?.slice(i * 3, (i + 1) * 3).map((x) => x.result);
            const poolIdx = poolAddrs.indexOf(b.pool!);
            return {
                ...b,
                tokenName: (t?.[0] as string) ?? "",
                tokenSymbol: (t?.[1] as string) ?? "",
                totalSupply: (t?.[2] as bigint) ?? 0n,
                spotPrice: poolIdx >= 0 ? ((poolReads.data?.[poolIdx]?.result as bigint) ?? 0n) : 0n,
            } as OfferingInfo;
        })
        .filter((x): x is OfferingInfo => x !== null);
    return {offerings, isLoading: list.isLoading || reads.isLoading || tokenReads.isLoading};
}

export type EventLog = Log & {args: Record<string, unknown>};
type LogScan = {lastScanned: bigint; logs: EventLog[]};

/** GIWA getLogs 100k 상한 대응 청크 스캔 — 초회 전체, 이후 lastScanned+1부터 증분 누적 */
export function useEventLogs(address: `0x${string}` | undefined, eventSig: string, enabled = true) {
    const client = usePublicClient();
    const qc = useQueryClient();
    const queryKey = ["logs", address, eventSig];
    return useQuery({
        queryKey,
        enabled: !!client && !!address && enabled,
        refetchInterval: 30_000,
        structuralSharing: false,
        select: (d: LogScan) => d.logs,
        queryFn: async () => {
            const prev = qc.getQueryData<LogScan>(queryKey);
            const latest = await client!.getBlockNumber();
            const start = prev ? prev.lastScanned + 1n : DEPLOY_BLOCK;
            if (prev && start > latest) return prev;
            const event = parseAbiItem(eventSig) as AbiEvent;
            const logs = prev ? [...prev.logs] : [];
            for (let from = start; from <= latest; from += 90_000n) {
                const to = from + 89_999n < latest ? from + 89_999n : latest;
                logs.push(...((await client!.getLogs({address, event, fromBlock: from, toBlock: to})) as EventLog[]));
            }
            return {lastScanned: latest, logs} as LogScan;
        },
    });
}

const blockTsCache = new Map<string, number>();

/** 로그 블록들의 타임스탬프(초) — 모듈 캐시로 블록당 1회만 조회 */
export function useBlockTimestamps(blockNumbers: bigint[]) {
    const client = usePublicClient();
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

export function useParticipantCount(offering: `0x${string}` | undefined) {
    const logs = useEventLogs(offering, "event Committed(address indexed participant, uint256 amount, uint256 cumulative)");
    if (!logs.data) return undefined;
    return new Set(logs.data.map((l) => (l.args as {participant: string}).participant)).size;
}

export function useOnboarding() {
    const {address} = useAccount();
    const krw = useReadContract({
        address: ADDR.mockKRW, abi: MockKRWAbi, functionName: "balanceOf",
        args: [address ?? "0x0000000000000000000000000000000000000000"], query: {enabled: !!address, refetchInterval: 15_000},
    });
    const verified = useReadContract({
        address: ADDR.mockDojang, abi: MockDojangAbi, functionName: "isVerified",
        args: [address ?? "0x0000000000000000000000000000000000000000"], query: {enabled: !!address, refetchInterval: 15_000},
    });
    return {krwBalance: (krw.data as bigint) ?? 0n, verified: (verified.data as boolean) ?? false};
}
