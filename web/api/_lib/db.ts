// Neon (HTTP driver) access for the indexer and the /api/chain/* queries. Every SQL statement
// lives in this file. Production and Preview share one database, so schema changes are additive
// only (CREATE ... IF NOT EXISTS, ADD COLUMN IF NOT EXISTS); never DROP or change a type.
// Addresses are stored lowercase; amounts are raw 18-decimals integers in numeric(78,0).
import {neon, NeonQueryFunction} from "@neondatabase/serverless";
import type {Interval, KnownCurve, RangeWrite} from "./indexer.js";

export type Sql = NeonQueryFunction<false, false>;

/** A client for this call. No module-level memo: a missing DATABASE_URL is reported on every
 *  call (the caller logs it and answers 503) instead of being cached as a broken client. */
export function getSql(): Sql {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    return neon(url);
}

const SCHEMA = [
    `CREATE TABLE IF NOT EXISTS mapae_indexer_state (
        id int PRIMARY KEY DEFAULT 1,
        next_block bigint NOT NULL,
        updated_at timestamptz
    )`,
    // Additive: block time of the last indexed block (for /api/chain/summary indexedTs).
    `ALTER TABLE mapae_indexer_state ADD COLUMN IF NOT EXISTS indexed_ts bigint`,
    `CREATE TABLE IF NOT EXISTS mapae_curves (
        curve text PRIMARY KEY,
        token text NOT NULL,
        dev text NOT NULL,
        quote text NOT NULL,
        virtual_quote numeric(78,0) NOT NULL,
        name text,
        symbol text,
        created_block bigint,
        created_ts bigint,
        pool text,
        graduated_block bigint
    )`,
    `CREATE TABLE IF NOT EXISTS mapae_trades (
        tx text,
        log_index int,
        PRIMARY KEY (tx, log_index),
        curve text NOT NULL,
        venue text NOT NULL CHECK (venue IN ('curve','pool')),
        side text NOT NULL CHECK (side IN ('buy','sell')),
        trader text NOT NULL,
        is_dev boolean NOT NULL,
        quote_amount numeric(78,0) NOT NULL,
        token_amount numeric(78,0) NOT NULL,
        price_wad numeric(78,0) NOT NULL,
        block bigint NOT NULL,
        ts bigint NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS mapae_trades_curve_ts ON mapae_trades (curve, ts DESC)`,
    `CREATE INDEX IF NOT EXISTS mapae_trades_ts ON mapae_trades (ts DESC)`,
    `CREATE TABLE IF NOT EXISTS mapae_transfers (
        tx text,
        log_index int,
        PRIMARY KEY (tx, log_index),
        token text NOT NULL,
        from_addr text NOT NULL,
        to_addr text NOT NULL,
        value numeric(78,0) NOT NULL,
        block bigint NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS mapae_transfers_token_to ON mapae_transfers (token, to_addr)`,
    `CREATE INDEX IF NOT EXISTS mapae_transfers_token_from ON mapae_transfers (token, from_addr)`,
];

export async function ensureSchema(sql: Sql): Promise<void> {
    await sql.transaction(SCHEMA.map((q) => sql.query(q)));
}

export async function readNextBlock(sql: Sql): Promise<bigint | null> {
    const rows = (await sql.query(`SELECT next_block::text AS n FROM mapae_indexer_state WHERE id = 1`)) as {n: string}[];
    return rows[0] ? BigInt(rows[0].n) : null;
}

export async function loadCurves(sql: Sql): Promise<KnownCurve[]> {
    const rows = (await sql.query(`SELECT curve, token, dev, pool FROM mapae_curves`)) as {curve: string; token: string; dev: string; pool: string | null}[];
    return rows.map((r) => ({curve: r.curve as `0x${string}`, token: r.token as `0x${string}`, dev: r.dev as `0x${string}`, pool: (r.pool as `0x${string}` | null) ?? null}));
}

/** One range in one transaction: new curves, graduations, trades, transfers and the cursor.
 *  Multi-row inserts through unnest() arrays (one statement per table, never one per row). */
export async function writeRange(sql: Sql, w: RangeWrite): Promise<void> {
    const c = w.curves;
    const g = w.graduations;
    const t = w.trades;
    const x = w.transfers;
    await sql.transaction([
        sql.query(
            `INSERT INTO mapae_curves (curve, token, dev, quote, virtual_quote, name, symbol, created_block, created_ts)
             SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::numeric[], $6::text[], $7::text[], $8::bigint[], $9::bigint[])
             ON CONFLICT (curve) DO NOTHING`,
            [c.map((r) => r.curve), c.map((r) => r.token), c.map((r) => r.dev), c.map((r) => r.quote), c.map((r) => r.virtualQuote), c.map((r) => r.name), c.map((r) => r.symbol), c.map((r) => r.createdBlock), c.map((r) => r.createdTs)]
        ),
        sql.query(
            `UPDATE mapae_curves AS m SET pool = u.pool, graduated_block = u.block
             FROM unnest($1::text[], $2::text[], $3::bigint[]) AS u(curve, pool, block)
             WHERE m.curve = u.curve`,
            [g.map((r) => r.curve), g.map((r) => r.pool), g.map((r) => r.block)]
        ),
        sql.query(
            `INSERT INTO mapae_trades (tx, log_index, curve, venue, side, trader, is_dev, quote_amount, token_amount, price_wad, block, ts)
             SELECT * FROM unnest($1::text[], $2::int[], $3::text[], $4::text[], $5::text[], $6::text[], $7::boolean[], $8::numeric[], $9::numeric[], $10::numeric[], $11::bigint[], $12::bigint[])
             ON CONFLICT (tx, log_index) DO NOTHING`,
            [
                t.map((r) => r.tx),
                t.map((r) => r.logIndex),
                t.map((r) => r.curve),
                t.map((r) => r.venue),
                t.map((r) => r.side),
                t.map((r) => r.trader),
                t.map((r) => r.isDev),
                t.map((r) => r.quoteAmount),
                t.map((r) => r.tokenAmount),
                t.map((r) => r.priceWad),
                t.map((r) => r.block),
                t.map((r) => r.ts),
            ]
        ),
        sql.query(
            `INSERT INTO mapae_transfers (tx, log_index, token, from_addr, to_addr, value, block)
             SELECT * FROM unnest($1::text[], $2::int[], $3::text[], $4::text[], $5::text[], $6::numeric[], $7::bigint[])
             ON CONFLICT (tx, log_index) DO NOTHING`,
            [x.map((r) => r.tx), x.map((r) => r.logIndex), x.map((r) => r.token), x.map((r) => r.from), x.map((r) => r.to), x.map((r) => r.value), x.map((r) => r.block)]
        ),
        sql.query(
            `INSERT INTO mapae_indexer_state (id, next_block, updated_at, indexed_ts) VALUES (1, $1::bigint, now(), $2::bigint)
             ON CONFLICT (id) DO UPDATE SET next_block = EXCLUDED.next_block, updated_at = now(), indexed_ts = EXCLUDED.indexed_ts`,
            [w.nextBlock.toString(), String(w.indexedTs)]
        ),
    ]);
}

// ---------------------------------------------------------------------------------------------
// Queries for /api/chain/*
// ---------------------------------------------------------------------------------------------

export type SummaryRow = {
    curve: string;
    trades24h: number;
    traders24h: number;
    volume24h: string;
    volume24hExDev: string;
    lastTradeTs: string;
    lastPriceWad: string;
};

export async function readState(sql: Sql): Promise<{indexedBlock: string | null; indexedTs: string | null}> {
    const rows = (await sql.query(`SELECT (next_block - 1)::text AS b, indexed_ts::text AS ts FROM mapae_indexer_state WHERE id = 1`)) as {b: string; ts: string | null}[];
    return {indexedBlock: rows[0]?.b ?? null, indexedTs: rows[0]?.ts ?? null};
}

/** Per-curve 24 h numbers and the last trade, in one GROUP BY. */
export async function summary(sql: Sql, sinceTs: number): Promise<SummaryRow[]> {
    return (await sql.query(
        `SELECT curve,
                count(*) FILTER (WHERE ts >= $1)::int AS "trades24h",
                count(DISTINCT trader) FILTER (WHERE ts >= $1 AND NOT is_dev)::int AS "traders24h",
                coalesce(sum(quote_amount) FILTER (WHERE ts >= $1), 0)::text AS "volume24h",
                coalesce(sum(quote_amount) FILTER (WHERE ts >= $1 AND NOT is_dev), 0)::text AS "volume24hExDev",
                max(ts)::text AS "lastTradeTs",
                ((array_agg(price_wad ORDER BY ts DESC, block DESC, log_index DESC))[1])::text AS "lastPriceWad"
         FROM mapae_trades
         GROUP BY curve`,
        [sinceTs]
    )) as SummaryRow[];
}

export type CandleRow = {t: string; o: string; h: string; l: string; c: string; v: string};

/** Latest 300 non-empty buckets, oldest first. Open/close by (ts, block, log_index). */
export async function candles(sql: Sql, curve: string, interval: Interval): Promise<CandleRow[]> {
    const rows = (await sql.query(
        `SELECT (bucket * $2)::text AS t,
                ((array_agg(price_wad ORDER BY ts, block, log_index))[1])::text AS o,
                max(price_wad)::text AS h,
                min(price_wad)::text AS l,
                ((array_agg(price_wad ORDER BY ts DESC, block DESC, log_index DESC))[1])::text AS c,
                sum(quote_amount)::text AS v
         FROM (SELECT floor(ts / $2)::bigint AS bucket, ts, block, log_index, price_wad, quote_amount
               FROM mapae_trades WHERE curve = $1) b
         GROUP BY bucket
         ORDER BY bucket DESC
         LIMIT 300`,
        [curve, interval]
    )) as CandleRow[];
    return rows.reverse();
}

export async function curveRow(sql: Sql, curve: string): Promise<{token: string; dev: string; pool: string | null} | null> {
    const rows = (await sql.query(`SELECT token, dev, pool FROM mapae_curves WHERE curve = $1`, [curve])) as {token: string; dev: string; pool: string | null}[];
    return rows[0] ?? null;
}

/** Balances from transfers (received - sent), > 0, top 50, plus the holder count without the
 *  zero address and the given excluded addresses (curve, pool). */
export async function holders(sql: Sql, token: string, exclude: string[]): Promise<{rows: {address: string; balance: string}[]; total: number}> {
    const rows = (await sql.query(
        `WITH b AS (
             SELECT addr, sum(delta) AS bal FROM (
                 SELECT to_addr AS addr, value AS delta FROM mapae_transfers WHERE token = $1
                 UNION ALL
                 SELECT from_addr AS addr, -value AS delta FROM mapae_transfers WHERE token = $1
             ) x GROUP BY addr
         )
         SELECT addr AS address, bal::text AS balance,
                (SELECT count(*)::int FROM b WHERE bal > 0 AND addr <> $2 AND NOT (addr = ANY($3::text[]))) AS total
         FROM b
         WHERE bal > 0 AND addr <> $2
         ORDER BY bal DESC
         LIMIT 50`,
        [token, "0x0000000000000000000000000000000000000000", exclude]
    )) as {address: string; balance: string; total: number}[];
    let total = rows[0]?.total ?? 0;
    if (rows.length === 0) total = 0;
    return {rows: rows.map((r) => ({address: r.address, balance: r.balance})), total};
}

export type TradeOut = {tx: string; logIndex: number; side: string; venue: string; trader: string; isDev: boolean; quoteAmount: string; tokenAmount: string; priceWad: string; ts: string; block: string};

export async function trades(sql: Sql, curve: string, before: bigint | undefined, limit: number): Promise<TradeOut[]> {
    return (await sql.query(
        `SELECT tx, log_index AS "logIndex", side, venue, trader, is_dev AS "isDev",
                quote_amount::text AS "quoteAmount", token_amount::text AS "tokenAmount", price_wad::text AS "priceWad",
                ts::text AS ts, block::text AS block
         FROM mapae_trades
         WHERE curve = $1 AND ($2::bigint IS NULL OR ts < $2::bigint)
         ORDER BY ts DESC, block DESC, log_index DESC
         LIMIT $3`,
        [curve, before === undefined ? null : before.toString(), limit]
    )) as TradeOut[];
}
