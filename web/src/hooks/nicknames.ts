// Bulk nicknames: one request per 100 addresses (never one per address). Failure -> empty map, and
// the screen shows addresses. My own nickname change (useNickname cache) refetches these.
import {useEffect, useRef} from "react";
import {useQueries, useQueryClient} from "@tanstack/react-query";
import {useAccount} from "wagmi";
import {API_BASE} from "./meta";
import {useNickname} from "./comments";
import {chunk100, nicknameKey} from "../lib/nicknames";

type Address = `0x${string}`;
const ROOT = ["nicknames"] as const;

async function fetchNicknames(addresses: readonly string[]): Promise<Record<string, string>> {
    const r = await fetch(`${API_BASE}/api/profile/nicknames?addresses=${addresses.join(",")}`);
    if (!r.ok) throw new Error(`nicknames ${r.status}`);
    return ((await r.json()) as {nicknames: Record<string, string>}).nicknames;
}

/** Lowercase address -> nickname for the given addresses (look up with addrKey). */
export function useNicknames(addresses: readonly string[]): Map<Address, string> {
    const qc = useQueryClient();
    const groups = chunk100(nicknameKey(addresses));
    const results = useQueries({
        queries: groups.map((g) => ({
            queryKey: [...ROOT, g],
            queryFn: () => fetchNicknames(g),
            staleTime: 5 * 60_000,
        })),
    });
    // My nickname changed in the modal: refetch every bulk lookup.
    const {address} = useAccount();
    const mine = useNickname(address);
    const prev = useRef(mine.data);
    useEffect(() => {
        if (prev.current !== undefined && mine.data !== prev.current) void qc.invalidateQueries({queryKey: ROOT});
        prev.current = mine.data;
    }, [mine.data, qc]);
    const map = new Map<Address, string>();
    for (const r of results) for (const [k, v] of Object.entries(r.data ?? {})) map.set(k.toLowerCase() as Address, v);
    return map;
}
