// Chain reads for the meta functions: CurveFactory.isCurve and CurveSale.dev on GIWA Sepolia.
import {createPublicClient, http} from "viem";
import {ADDR_V3} from "../../src/contracts/addressesV3.js";
import {CurveFactoryAbi, CurveSaleAbi} from "../../src/contracts/abisV3.js";
import {giwaSepolia} from "../../src/config/chain.js";
import type {Address, Chain} from "./handler.js";

export function giwaChain(): Chain {
    // GIWA_RPC_URL overrides the public RPC in config/chain.ts; undefined falls back to the chain's default.
    const client = createPublicClient({chain: giwaSepolia, transport: http(process.env.GIWA_RPC_URL || undefined)});
    return {
        isCurve: (curve: Address) => client.readContract({address: ADDR_V3.curveFactory, abi: CurveFactoryAbi, functionName: "isCurve", args: [curve]}) as Promise<boolean>,
        devOf: (curve: Address) => client.readContract({address: curve, abi: CurveSaleAbi, functionName: "dev"}) as Promise<Address>,
    };
}
