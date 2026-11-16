export function ctorTypes(sig: string): string;
export function encodeCtorArgs(sig: string, values: readonly unknown[]): `0x${string}`;
export function decodeCtorArgs(sig: string, hex: `0x${string}`): readonly unknown[];
