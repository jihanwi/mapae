import {createConfig, http} from "wagmi";
import {injected} from "wagmi/connectors";
import {giwaSepolia} from "./chain";

export const wagmiConfig = createConfig({
    chains: [giwaSepolia],
    connectors: [injected()],
    // EIP-6963: each installed wallet extension becomes its own connector (name + icon)
    multiInjectedProviderDiscovery: true,
    transports: {[giwaSepolia.id]: http()},
});
