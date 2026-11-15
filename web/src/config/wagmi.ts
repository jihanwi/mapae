import {createConfig, http} from "wagmi";
import {injected} from "wagmi/connectors";
import {giwaSepolia} from "./chain";

export const wagmiConfig = createConfig({
    chains: [giwaSepolia],
    connectors: [injected()],
    // EIP-6963: each installed wallet extension becomes its own connector (name + icon)
    multiInjectedProviderDiscovery: true,
    // W-T16: a slow or flaky RPC answer is retried (3 times, 500 ms apart) and cut at 8 s.
    transports: {[giwaSepolia.id]: http(undefined, {retryCount: 3, retryDelay: 500, timeout: 8_000})},
});
