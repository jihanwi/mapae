// Single wallet-connect flow shared by the nav button and the onboarding modal.
// - EIP-6963 discovery (wagmi multiInjectedProviderDiscovery): 1 wallet → connect directly,
//   2+ wallets → let the user pick (name + icon).
// - No discovered wallet but window.ethereum present → generic injected connector.
// - Neither → "noWallet": a toast on desktop; on a mobile browser the "open in a wallet app" modal
//   (W-T17). Connect failures are classified (rejected / pending / unknown).
// - No chainId is passed to connect: the wallet connects on whatever chain it is on, and a wrong
//   chain is handled afterwards by useSwitchToGiwa (nav button / onboarding step 1).
import {useCallback, useState} from "react";
import {Connector, useConnect, useConnectors} from "wagmi";
import {useCopy} from "../copy";
import {useToast} from "../components/tx";
import {classifyConnectError} from "../lib/connectError";
import {isMobileBrowser} from "../lib/share";

const onMobile = () => typeof navigator !== "undefined" && isMobileBrowser(navigator.userAgent, navigator.maxTouchPoints ?? 0);

const GENERIC_INJECTED_ID = "injected";

export function useWalletConnect(opts?: {onSuccess?: () => void}) {
    const tr = useCopy();
    const push = useToast();
    const connectors = useConnectors();
    const {connect, isPending} = useConnect();
    const [choices, setChoices] = useState<readonly Connector[] | null>(null);
    const [openInApp, setOpenInApp] = useState(false);
    const noWallet = useCallback(() => {
        if (onMobile()) setOpenInApp(true);
        else push({kind: "error", text: tr.errors.noWallet});
    }, [push, tr]);

    const fail = useCallback(
        (err: unknown) => {
            const kind = classifyConnectError(err);
            if (kind === "noWallet") return noWallet();
            const text = kind === "rejected" ? tr.wallet.rejected : kind === "pending" ? tr.wallet.pending : tr.wallet.unknown;
            push({kind: "error", text});
        },
        [push, tr, noWallet]
    );

    const connectWith = useCallback(
        (c: Connector) => {
            setChoices(null);
            connect({connector: c}, {onSuccess: () => opts?.onSuccess?.(), onError: fail});
        },
        [connect, fail, opts]
    );

    const connectWallet = useCallback(() => {
        const discovered = connectors.filter((c) => c.id !== GENERIC_INJECTED_ID);
        if (discovered.length === 1) return connectWith(discovered[0]);
        if (discovered.length > 1) return setChoices(discovered);
        const generic = connectors.find((c) => c.id === GENERIC_INJECTED_ID);
        const hasEthereum = typeof window !== "undefined" && !!(window as {ethereum?: unknown}).ethereum;
        if (generic && hasEthereum) return connectWith(generic);
        noWallet();
    }, [connectors, connectWith, noWallet]);

    return {connectWallet, isPending, choices, choose: connectWith, closePicker: () => setChoices(null), openInApp, closeOpenInApp: () => setOpenInApp(false)};
}
