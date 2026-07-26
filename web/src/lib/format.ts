import {formatUnits} from "viem";

/** 18-decimals → "1,234,567" (소수점은 유효할 때만, 최대 dp자리) */
export function fmt(wei: bigint, dp = 2): string {
    const s = formatUnits(wei, 18);
    const [i, f] = s.split(".");
    const int = BigInt(i).toLocaleString("en-US");
    if (!f || dp === 0) return int;
    const frac = f.slice(0, dp).replace(/0+$/, "");
    return frac ? `${int}.${frac}` : int;
}

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function countdown(deadline: bigint, now: number): string {
    const left = Number(deadline) - Math.floor(now / 1000);
    if (left <= 0) return "마감";
    const d = Math.floor(left / 86400);
    const p = (n: number) => String(n).padStart(2, "0");
    const hms = `${p(Math.floor(left / 3600) % 24)}:${p(Math.floor(left / 60) % 60)}:${p(left % 60)}`;
    return `D-${d} ${hms}`;
}
