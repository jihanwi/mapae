// My profile: WETH balance (ETH-paired tokens pay out WETH when sold) and [Unwrap to ETH], which
// calls WETH.withdraw(balance). Nothing when the balance is 0 or unknown.
import {useReadContract, useWriteContract} from "wagmi";
import {useCopy} from "../copy";
import {ADDR_V3} from "../contracts/addressesV3";
import {WethAbi} from "../contracts/weth";
import {giwaSepolia} from "../config/chain";
import {fmtSig} from "../lib/format";
import {TxButton} from "./tx";

type Address = `0x${string}`;

export function UnwrapWethBand({owner}: {owner: Address}) {
    const tr = useCopy();
    const {writeContractAsync} = useWriteContract();
    const bal = useReadContract({
        address: ADDR_V3.weth,
        abi: WethAbi,
        functionName: "balanceOf",
        args: [owner],
        chainId: giwaSepolia.id,
        query: {refetchInterval: 15_000},
    });
    const amount = bal.data;
    if (amount === undefined || amount === 0n) return null;
    const shown = fmtSig(amount, 4, tr.locale);
    return (
        <section className="bg-ink-800 border border-ink-700 rounded-card px-4 py-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 min-w-0">
            <span className="text-[13px] tabular-nums min-w-0 break-words">{tr.walletPage.wethHeld(shown)}</span>
            <TxButton
                variant="secondary"
                className="!py-2 !px-4 min-h-[40px]"
                action={(run) =>
                    run(tr.walletPage.unwrap, () => writeContractAsync({address: ADDR_V3.weth, abi: WethAbi, functionName: "withdraw", args: [amount], chainId: giwaSepolia.id}), {
                        scope: "v3",
                        successMessage: tr.walletPage.unwrapped(shown),
                    })
                }
            >
                {tr.walletPage.unwrap}
            </TxButton>
        </section>
    );
}
