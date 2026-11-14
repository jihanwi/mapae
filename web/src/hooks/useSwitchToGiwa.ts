// Switch the connected wallet to GIWA Sepolia. Kept separate from connecting: a failed or rejected
// switch never undoes the connection, and it gets its own message (not the connect-cancelled one).
// wagmi's injected connector falls back to wallet_addEthereumChain when the wallet lacks the chain.
import {useCallback} from "react";
import {useSwitchChain} from "wagmi";
import {giwaSepolia} from "../config/chain";
import {useCopy} from "../copy";
import {useToast} from "../components/tx";

export function useSwitchToGiwa(opts?: {onSuccess?: () => void}) {
    const tr = useCopy();
    const push = useToast();
    const {switchChain, isPending} = useSwitchChain();
    const switchToGiwa = useCallback(() => {
        switchChain(
            {chainId: giwaSepolia.id},
            {onSuccess: () => opts?.onSuccess?.(), onError: () => push({kind: "error", text: tr.wallet.switchFailed})}
        );
    }, [switchChain, push, tr, opts]);
    return {switchToGiwa, isPending};
}
