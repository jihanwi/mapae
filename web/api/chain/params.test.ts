import {describe, expect, it} from "vitest";
import {GET as trades} from "./trades";
import {GET as summary} from "./summary";

const CURVE = "0xCB8dE4Caac1aCBa352F1D8c659d4578115E8f781";

describe("chain routes reject unknown query parameters before any DB access", () => {
    it("/api/chain/trades?curve=..&zzz=1 is 400", async () => {
        const r = await trades(new Request(`https://x.test/api/chain/trades?curve=${CURVE}&zzz=1`));
        expect(r.status).toBe(400);
        expect(await r.json()).toEqual({error: "bad_request"});
    });
    it("a malformed v is 400 too", async () => {
        const r = await trades(new Request(`https://x.test/api/chain/trades?curve=${CURVE}&v=abc`));
        expect(r.status).toBe(400);
    });
    it("summary rejects unknown parameters", async () => {
        const r = await summary(new Request("https://x.test/api/chain/summary?window=86400&foo=1"));
        expect(r.status).toBe(400);
    });
});
