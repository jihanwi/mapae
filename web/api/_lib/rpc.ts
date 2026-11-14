// Indexer RPC adapter: block number, block timestamps and raw eth_getLogs (decoded by the pure code).
import {createPublicClient, Hex, http, numberToHex} from "viem";
import {giwaSepolia} from "../../src/config/chain.js";
import type {RawLog} from "../../src/lib/activity.js";
import type {CronDeps} from "./indexer.js";

type RpcLog = {address: `0x${string}`; topics: Hex[]; data: Hex; blockNumber: Hex | null; logIndex: Hex | null; transactionHash: Hex | null};

export function giwaRpc(): CronDeps["rpc"] {
    // GIWA_RPC_URL overrides the public RPC in config/chain.ts; undefined falls back to the chain's default.
    const client = createPublicClient({chain: giwaSepolia, transport: http(process.env.GIWA_RPC_URL || undefined)});
    return {
        blockNumber: () => client.getBlockNumber({cacheTime: 0}),
        blockTime: async (n) => {
            const b = await client.getBlock({blockNumber: n});
            return {block: b.number, ts: Number(b.timestamp)};
        },
        getLogs: async (q) => {
            const logs = (await client.request({
                method: "eth_getLogs",
                params: [{fromBlock: numberToHex(q.fromBlock), toBlock: numberToHex(q.toBlock), ...(q.address ? {address: q.address as `0x${string}` | `0x${string}`[]} : {}), topics: q.topics}],
            })) as RpcLog[];
            return logs.map(
                (l): RawLog => ({
                    address: l.address,
                    topics: l.topics,
                    data: l.data,
                    blockNumber: l.blockNumber === null ? null : BigInt(l.blockNumber),
                    logIndex: l.logIndex === null ? null : Number(BigInt(l.logIndex)),
                    transactionHash: l.transactionHash,
                })
            );
        },
    };
}
