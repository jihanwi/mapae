// Chain reads for the meta functions: CurveFactory.isCurve and CurveSale.dev on GIWA Sepolia.
import {createPublicClient, http} from "viem";
import {ADDR_V3} from "../../src/contracts/addressesV3.js";
import {CurveFactoryAbi, CurveSaleAbi, MockDojangV3Abi} from "../../src/contracts/abisV3.js";
import {MapaeFactoryL1Abi, OfferingL1Abi} from "../../src/contracts/abisV3L1.js";
import {ADDR_L1} from "../../src/contracts/addressesV3L1.js";
import type {DisclosureChain} from "./disclosureHandler.js";
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

/** Chain reads for nickname/comment writes: MockDojang.isVerified and CurveFactory.isCurve. */
export function socialChain(): import("./social.js").SocialChain {
    const client = createPublicClient({chain: giwaSepolia, transport: http(process.env.GIWA_RPC_URL || undefined)});
    return {
        isVerified: (wallet) => client.readContract({address: ADDR_V3.dojangAnyOf, abi: MockDojangV3Abi, functionName: "isVerified", args: [wallet]}) as Promise<boolean>,
        isCurve: (curve) => client.readContract({address: ADDR_V3.curveFactory, abi: CurveFactoryAbi, functionName: "isCurve", args: [curve]}) as Promise<boolean>,
    };
}

/** W-T34: chain reads for disclosure saves: v3.2-L1 factory membership (redeemManagerOf != 0),
 *  the offering's creator and totalCommitted. */
export function disclosureChain(): DisclosureChain {
    const client = createPublicClient({chain: giwaSepolia, transport: http(process.env.GIWA_RPC_URL || undefined)});
    return {
        isOffering: async (o) =>
            ((await client.readContract({address: ADDR_L1.mapaeFactory, abi: MapaeFactoryL1Abi, functionName: "redeemManagerOf", args: [o]})) as string).toLowerCase() !==
            "0x0000000000000000000000000000000000000000",
        creatorOf: (o) => client.readContract({address: o, abi: OfferingL1Abi, functionName: "creator"}) as Promise<Address>,
        totalCommitted: (o) => client.readContract({address: o, abi: OfferingL1Abi, functionName: "totalCommitted"}) as Promise<bigint>,
    };
}
