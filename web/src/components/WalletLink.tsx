// A wallet shown by nickname (or short address), linking to its public profile. Text only.
import {Link} from "react-router-dom";
import {getAddress} from "viem";
import {displayName} from "../lib/nicknames";

export function WalletLink({address, nickname, className = "", link = true}: {address: string; nickname?: string | null; className?: string; link?: boolean}) {
    const label = displayName(nickname, address);
    const cls = `inline-block max-w-full truncate whitespace-nowrap align-bottom ${className}`;
    if (!link) {
        return (
            <span className={cls} title={address}>
                {label}
            </span>
        );
    }
    let to = address;
    try {
        to = getAddress(address);
    } catch {
        // keep the given form; the profile page normalizes it
    }
    return (
        <Link to={`/w/${to}`} className={cls} title={to}>
            {label}
        </Link>
    );
}
