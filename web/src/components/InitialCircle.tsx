// W-T65: a wallet's initial circle (feed rows, wallet profile header). The same Medallion the token
// list rows show when a token has no image; decorative (the name sits right next to it).
import {walletInitial} from "../lib/walletView";
import {Medallion} from "./ui";

export function InitialCircle({nickname, address, size}: {nickname?: string | null; address: string; size: number}) {
    return (
        <span aria-hidden="true" className="flex-none inline-flex">
            <Medallion char={walletInitial(nickname, address)} size={size} />
        </span>
    );
}
