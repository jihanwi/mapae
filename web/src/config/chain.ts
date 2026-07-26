import {defineChain} from "viem";

export const giwaSepolia = defineChain({
    id: 91342,
    name: "GIWA Sepolia",
    nativeCurrency: {name: "Ether", symbol: "ETH", decimals: 18},
    rpcUrls: {default: {http: ["https://sepolia-rpc.giwa.io"]}},
    blockExplorers: {default: {name: "Blockscout", url: "https://sepolia-explorer.giwa.io"}},
    contracts: {multicall3: {address: "0xcA11bde05977b3631167028862bE2a173976CA11"}},
    testnet: true,
});

export const EXPLORER = "https://sepolia-explorer.giwa.io";
export const explorerAddr = (a: string) => `${EXPLORER}/address/${a}`;
export const explorerTx = (h: string) => `${EXPLORER}/tx/${h}`;
