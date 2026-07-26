import {createConfig, http} from "wagmi";
import {injected} from "wagmi/connectors";
import {giwaSepolia} from "./chain";

export const wagmiConfig = createConfig({
    chains: [giwaSepolia],
    connectors: [injected()],
    transports: {[giwaSepolia.id]: http()},
});
