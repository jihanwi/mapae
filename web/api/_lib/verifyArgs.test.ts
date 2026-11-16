// script/verify-children.js constructor-argument encoding (script/ctorArgs.mjs): user-chosen names
// and tickers must survive any character, so values are ABI-encoded as data by viem, never as
// quoted text for cast's parser (which broke on a name with quotes).
import {describe, expect, it} from "vitest";
import {decodeCtorArgs, encodeCtorArgs} from "../../../script/ctorArgs.mjs";
import SCRIPT from "../../../script/verify-children.js?raw";

const CURVE_CTOR = "constructor((address,address,address,address,address,address,string,string,uint256,uint32))";
const TOKEN_CTOR = "constructor(string,string,address,uint256,uint16,address[])";
const OFFERING_CTOR =
    "constructor((address,address,address,address,string,string,uint256,uint256,uint256,uint256,uint256,uint256,uint16,uint16,uint16,uint16,uint16,uint8,uint256,uint16,address,address,uint8,address,(address,address)))";
const POOL_CTOR = "constructor(address,address,address,address,uint8,address,uint16,uint16)";
const OFFERING_L1_CTOR =
    "constructor((address,address,address,address,string,string,uint256,uint256,uint256,uint256,uint256,uint256,uint16,uint16,uint16,uint16,uint16,uint8,uint256,uint16,address,address,uint8,address,(address,address),address,uint16))";
const PROCEEDS_LOCK_CTOR = "constructor(address,uint64,uint64,uint64)";

const A = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const WETH = "0x4200000000000000000000000000000000000006";
const NAMES = [`<script>"'&</script>`, "a,b", "(x)", "a\\b", "말머리 토큰", "🐎🔥", `"); DROP --`, "", "X&Y"];

const curveInit = (name: string, symbol: string) => [WETH, A(1), A(2), A(3), A(4), A(5), name, symbol, "2000000000000000", "600"];

describe("constructor args: viem encoding, no text parser", () => {
    it("the script uses the same signatures and no longer calls cast abi-encode", () => {
        for (const sig of [CURVE_CTOR, TOKEN_CTOR, OFFERING_CTOR, OFFERING_L1_CTOR, PROCEEDS_LOCK_CTOR, POOL_CTOR]) expect(SCRIPT).toContain(sig);
        expect(SCRIPT).not.toContain('"abi-encode"');
        expect(SCRIPT).toContain("encodeCtorArgs(ctorSig, ctorValues)");
    });
    it.each(NAMES)("CurveSale init tuple round-trips name %j", (name) => {
        const hex = encodeCtorArgs(CURVE_CTOR, [curveInit(name, name)]);
        const [t] = decodeCtorArgs(CURVE_CTOR, hex) as [readonly unknown[]];
        expect(t[6]).toBe(name);
        expect(t[7]).toBe(name);
        expect(t[8]).toBe(2_000_000_000_000_000n);
        expect(t[9]).toBe(600);
    });
    it.each(NAMES)("MembershipToken round-trips name %j (empty and one-item address arrays)", (name) => {
        for (const exempt of [[], [A(9)]]) {
            const hex = encodeCtorArgs(TOKEN_CTOR, [name, name, A(7), "86400", "0", exempt]);
            const out = decodeCtorArgs(TOKEN_CTOR, hex);
            expect(out[0]).toBe(name);
            expect(out[1]).toBe(name);
            expect(out[3]).toBe(86_400n);
            expect((out[5] as string[]).map((x) => x.toLowerCase())).toEqual(exempt);
        }
    });
    it("the curve that failed (0x1c6d…9811): <script>\"'&</script> / X&Y on WETH, 2000000000000000, 600", () => {
        // quote and the last two values are from the failed run; the other addresses are the v3.2
        // deployment's (dojangAnyOf, feeRouter, poolFactory, factoryMock) and a stand-in dev.
        const init = [
            WETH,
            "0x87326FbbF76e724bA2bA954dAc04c3B939999f84",
            A(0xde),
            "0xAB665B7867080cd62Aa316717400f3Cc094E7bd6",
            "0xf4E7Bf1ACe429400AC23E271E4409D212677e44F",
            "0xC0E22127A44266cCC56B2503504373777d0645A9",
            `<script>"'&</script>`,
            "X&Y",
            "2000000000000000",
            "600",
        ];
        const hex = encodeCtorArgs(CURVE_CTOR, [init]);
        // one dynamic tuple: offset word + 10 head words + 2 × (length + one data word)
        expect((hex.length - 2) / 64).toBe(1 + 10 + 4);
        const [t] = decodeCtorArgs(CURVE_CTOR, hex) as [readonly unknown[]];
        expect(t[6]).toBe(`<script>"'&</script>`);
        expect(t[7]).toBe("X&Y");
        expect(String(t[0]).toLowerCase()).toBe(WETH);
    });
    it("the offering tuple (nested recipients tuple, cast-style numbers) and a pool round-trip", () => {
        const p = [A(1), A(2), A(3), A(4), `Na"me, (1)`, "S\\Y", "1000000000000000000 [1e18]", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "1", "12", "13", A(5), A(6), "2", A(7), [A(8), A(9)]];
        const [t] = decodeCtorArgs(OFFERING_CTOR, encodeCtorArgs(OFFERING_CTOR, [p])) as [readonly unknown[]];
        expect(t[4]).toBe(`Na"me, (1)`);
        expect(t[5]).toBe("S\\Y");
        expect(t[6]).toBe(10n ** 18n);
        expect((t[24] as string[]).map((x) => x.toLowerCase())).toEqual([A(8), A(9)]);
        const pool = decodeCtorArgs(POOL_CTOR, encodeCtorArgs(POOL_CTOR, [A(1), WETH, A(2), A(3), "1", A(4), "100", "50"]));
        expect(pool[4]).toBe(1);
        expect(pool[7]).toBe(50);
    });
    it("v3.2-L1: the offering tuple with (proceedsLock, proceedsUpfrontBps) and a ProceedsLock round-trip", () => {
        const p = [A(1), A(2), A(3), A(4), `Na"me`, "SY", "1000000000000000000 [1e18]", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "1", "12", "13", A(5), A(6), "1", A(7), [A(8), A(9)], A(10), "3000"];
        const [t] = decodeCtorArgs(OFFERING_L1_CTOR, encodeCtorArgs(OFFERING_L1_CTOR, [p])) as [readonly unknown[]];
        expect(t.length).toBe(27);
        expect(t[4]).toBe(`Na"me`);
        expect((t[24] as string[]).map((x) => x.toLowerCase())).toEqual([A(8), A(9)]);
        expect(String(t[25]).toLowerCase()).toBe(A(10));
        expect(t[26]).toBe(3000);
        // L0 offering on the same factory: no lock, upfront 0
        const p0 = [...p.slice(0, 25), "0x0000000000000000000000000000000000000000", "0"];
        const [t0] = decodeCtorArgs(OFFERING_L1_CTOR, encodeCtorArgs(OFFERING_L1_CTOR, [p0])) as [readonly unknown[]];
        expect(t0[26]).toBe(0);
        // ProceedsLock(beneficiary, start, duration, cliffSeconds), uint64 values as cast prints them
        const lock = decodeCtorArgs(PROCEEDS_LOCK_CTOR, encodeCtorArgs(PROCEEDS_LOCK_CTOR, [A(3), "1795000000", "31536000 [3.153e7]", "2592000"]));
        expect(String(lock[0]).toLowerCase()).toBe(A(3));
        expect(lock[1]).toBe(1_795_000_000n);
        expect(lock[2]).toBe(31_536_000n);
        expect(lock[3]).toBe(2_592_000n);
    });
    it("no-argument constructors encode to empty", () => {
        expect(encodeCtorArgs("constructor()", [])).toBe("0x");
    });
});
