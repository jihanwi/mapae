// Constructor-argument encoding for script/verify-children.js. Values go to viem's
// encodeAbiParameters as data (never as quoted text for a parser), so user-chosen names and tickers
// with quotes, commas, brackets, backslashes, Hangul or emoji encode exactly. viem is loaded from
// web/node_modules (no package.json at the repo root); CI runs `npm ci` in web/ first.
import {createRequire} from "node:module";

const require = createRequire(new URL("../web/package.json", import.meta.url));
const {encodeAbiParameters, decodeAbiParameters, parseAbiParameters} = require("viem");

/** "constructor(<types>)" -> "<types>" (the existing signature strings stay the source of truth). */
export function ctorTypes(sig) {
    const m = /^constructor\((.*)\)$/s.exec(sig.trim());
    if (!m) throw new Error(`not a constructor signature: ${sig}`);
    return m[1];
}

/** cast prints big numbers as "123 [1.23e2]": keep the first token. */
const toBig = (v) => (typeof v === "bigint" ? v : BigInt(String(v).trim().split(/\s+/)[0]));

/** Values as cast returns them (decimal strings for numbers) -> what viem expects (bigint for
 *  int/uint, nested arrays for tuples and arrays). Strings, addresses and bytes pass through. */
function coerce(param, value) {
    const t = param.type;
    const arr = /^(.*)\[(\d*)\]$/.exec(t);
    if (arr) {
        const inner = {...param, type: arr[1]};
        return value.map((v) => coerce(inner, v));
    }
    if (t === "tuple") return param.components.map((c, i) => coerce(c, value[i]));
    if (/^u?int\d*$/.test(t)) return toBig(value);
    if (t === "bool") return value === true || value === "true";
    return value;
}

/** ABI-encodes constructor arguments for a "constructor(...)" signature; "" when it takes none.
 *  Returns 0x-prefixed hex (forge verify-contract --constructor-args). */
export function encodeCtorArgs(sig, values) {
    const types = ctorTypes(sig);
    if (types === "") return "0x";
    const params = parseAbiParameters(types);
    return encodeAbiParameters(params, params.map((p, i) => coerce(p, values[i])));
}

/** Inverse, for tests. */
export function decodeCtorArgs(sig, hex) {
    return decodeAbiParameters(parseAbiParameters(ctorTypes(sig)), hex);
}
