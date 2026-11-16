import {describe, expect, it} from "vitest";
import {claimPoke, INDEXER_STATE_ID, pgCode, POKE_GAP_SEC, Sql, withSchemaRetry} from "./db.js";
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

describe("withSchemaRetry: one migration and one retry for a missing table or column", () => {
    const pgErr = (code: string) => Object.assign(new Error(`pg ${code}`), {code});
    const setup = (fails: unknown[]) => {
        let runs = 0;
        let ensures = 0;
        const run = async () => {
            const f = fails[runs++];
            if (f) throw f;
            return "rows";
        };
        const ensure = async () => {
            ensures++;
        };
        return {run, ensure, counts: () => ({runs, ensures})};
    };
    it("42P01 (undefined_table): ensureSchema once, then the retry answers", async () => {
        const t = setup([pgErr("42P01")]);
        await expect(withSchemaRetry("t", t.run, t.ensure)).resolves.toBe("rows");
        expect(t.counts()).toEqual({runs: 2, ensures: 1});
    });
    it("42703 (undefined_column): the same", async () => {
        const t = setup([pgErr("42703")]);
        await expect(withSchemaRetry("t", t.run, t.ensure)).resolves.toBe("rows");
        expect(t.counts()).toEqual({runs: 2, ensures: 1});
    });
    it("other codes and plain errors: no migration, no retry", async () => {
        for (const e of [pgErr("42725"), pgErr("57P01"), new Error("fetch failed")]) {
            const t = setup([e]);
            await expect(withSchemaRetry("t", t.run, t.ensure)).rejects.toBe(e);
            expect(t.counts()).toEqual({runs: 1, ensures: 0});
        }
    });
    it("the retry fails too: thrown, ensureSchema ran only once", async () => {
        const second = pgErr("42P01");
        const t = setup([pgErr("42P01"), second]);
        await expect(withSchemaRetry("t", t.run, t.ensure)).rejects.toBe(second);
        expect(t.counts()).toEqual({runs: 2, ensures: 1});
    });
    it("the normal path runs once and never migrates", async () => {
        const t = setup([]);
        await expect(withSchemaRetry("t", t.run, t.ensure)).resolves.toBe("rows");
        expect(t.counts()).toEqual({runs: 1, ensures: 0});
    });
    it("pgCode reads the code on the error or its cause", () => {
        expect(pgCode(pgErr("42P01"))).toBe("42P01");
        expect(pgCode({cause: {code: "42703"}})).toBe("42703");
        expect(pgCode(new Error("x"))).toBeUndefined();
        expect(pgCode(null)).toBeUndefined();
    });
});
