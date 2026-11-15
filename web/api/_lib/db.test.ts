import {describe, expect, it} from "vitest";
import {claimPoke, INDEXER_STATE_ID, POKE_GAP_SEC, Sql} from "./db.js";
// the source text of db.ts (every SQL statement lives in that file)
import DB_SRC from "./db.ts?raw";

describe("db.ts SQL", () => {
    it("never does arithmetic between two query parameters (Postgres cannot type them: 42725)", () => {
        expect(DB_SRC.match(/\$\d+\s*[-+*/]\s*\$\d+/g)).toBeNull();
    });
});

describe("claimPoke", () => {
    function fake(rowsFor: (text: string) => unknown[]) {
        const seen: {text: string; params: unknown[]}[] = [];
        const sql = {
            query: async (text: string, params: unknown[] = []) => {
                seen.push({text, params});
                return rowsFor(text);
            },
        } as unknown as Sql;
        return {sql, seen};
    }

    it("sends now, the cursor id and the cutoff (now - 20 s), every parameter cast", async () => {
        const {sql, seen} = fake(() => [{id: INDEXER_STATE_ID}]);
        expect(await claimPoke(sql, 1_000)).toBe("claimed");
        expect(seen[0].params).toEqual([1_000, INDEXER_STATE_ID, 1_000 - POKE_GAP_SEC]);
        expect(seen[0].text).toContain("poke_ts = $1::bigint");
        expect(seen[0].text).toContain("id = $2::int");
        expect(seen[0].text).toContain("poke_ts <= $3::bigint");
        expect(seen[0].text).not.toMatch(/\$\d+\s*[-+*/]\s*\$\d+/);
    });
    it("throttled when the row exists but was claimed within 20 s; no_row when it does not exist", async () => {
        const throttled = fake((t) => (t.startsWith("UPDATE") ? [] : [{"?column?": 1}]));
        expect(await claimPoke(throttled.sql, 5)).toBe("throttled");
        const missing = fake(() => []);
        expect(await claimPoke(missing.sql, 5)).toBe("no_row");
    });
});
