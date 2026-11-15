// Indexer RPC adapter: block number, block timestamps and raw eth_getLogs (decoded by the pure code).
import {createPublicClient, decodeFunctionResult, encodeFunctionData, Hex, http, numberToHex, parseAbi} from "viem";
import {ADDR_V3} from "../../src/contracts/addressesV3.js";
import {MockDojangV3Abi} from "../../src/contracts/abisV3.js";
import {giwaSepolia} from "../../src/config/chain.js";
import type {RawLog} from "../../src/lib/activity.js";
import type {CronDeps} from "./indexer.js";

/** Multicall3 (same address on every OP Stack chain; also in config/chain.ts). */
export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const AGGREGATE3 = parseAbi(["function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])"]);

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
        // One eth_call: aggregate3 over isVerified(wallet); a failed sub-call reads as null.
        isVerifiedMany: async (wallets) => {
            const calls = wallets.map((w) => ({
                target: ADDR_V3.dojangAnyOf as `0x${string}`,
                allowFailure: true,
                callData: encodeFunctionData({abi: MockDojangV3Abi, functionName: "isVerified", args: [w]}),
            }));
            const res = (await client.readContract({address: MULTICALL3, abi: AGGREGATE3, functionName: "aggregate3", args: [calls]})) as readonly {success: boolean; returnData: Hex}[];
            const out = new Map<string, boolean | null>();
            wallets.forEach((w, i) => {
                const r = res[i];
                let v: boolean | null = null;
                if (r?.success) {
                    try {
                        v = decodeFunctionResult({abi: MockDojangV3Abi, functionName: "isVerified", data: r.returnData}) as boolean;
                    } catch {
                        v = null;
                    }
                }
                out.set(w.toLowerCase(), v);
            });
            return out;
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
