// Neon (HTTP driver) access for the indexer and the /api/chain/* queries. Every SQL statement
// lives in this file. Production and Preview share one database, so schema changes are additive
// only (CREATE ... IF NOT EXISTS, ADD COLUMN IF NOT EXISTS); never DROP or change a type.
// Addresses are stored lowercase; amounts are raw 18-decimals integers in numeric(78,0).
import {neon, NeonQueryFunction} from "@neondatabase/serverless";
import type {FoldRow} from "./positions.js";
import type {Interval, KnownCurve, RangeWrite} from "./indexer.js";
import type {KnownOffering, RangeWriteL1} from "./indexerL1.js";

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
    // Additive: last on-demand catch-up (POST /api/chain/summary), at most one run per POKE_GAP_SEC.
    `ALTER TABLE mapae_indexer_state ADD COLUMN IF NOT EXISTS poke_ts bigint`,
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
    // v3.1 (additive): real-name status per trade, priority window and source factory per curve.
    `ALTER TABLE mapae_trades ADD COLUMN IF NOT EXISTS verified boolean`,
    `ALTER TABLE mapae_curves ADD COLUMN IF NOT EXISTS priority_until bigint`,
    `ALTER TABLE mapae_curves ADD COLUMN IF NOT EXISTS factory text`,
    `CREATE INDEX IF NOT EXISTS mapae_trades_ts ON mapae_trades (ts DESC)`,
    // Decision 50 (additive): curve reserves after each curve trade; NULL for pool trades.
    `ALTER TABLE mapae_trades ADD COLUMN IF NOT EXISTS r_after numeric(78,0)`,
    `ALTER TABLE mapae_trades ADD COLUMN IF NOT EXISTS s_after numeric(78,0)`,
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
    `CREATE TABLE IF NOT EXISTS mapae_nicknames (
        address text PRIMARY KEY,
        nickname text NOT NULL,
        nickname_lc text NOT NULL UNIQUE,
        updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS mapae_comments (
        id bigserial PRIMARY KEY,
        curve text NOT NULL,
        author text NOT NULL,
        body text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        deleted boolean NOT NULL DEFAULT false,
        hidden boolean NOT NULL DEFAULT false
    )`,
    `CREATE INDEX IF NOT EXISTS mapae_comments_curve_id ON mapae_comments (curve, id DESC)`,
    `CREATE INDEX IF NOT EXISTS mapae_comments_author_created ON mapae_comments (author, created_at DESC)`,
    // wallet profile (/api/chain/wallet, /api/chain/wallet-trades)
    `CREATE INDEX IF NOT EXISTS mapae_trades_trader_ts ON mapae_trades (trader, ts DESC)`,
    `CREATE INDEX IF NOT EXISTS mapae_transfers_to ON mapae_transfers (to_addr)`,
    // decision 53: public follows; verified = the follower's real-name status at follow time
    `CREATE TABLE IF NOT EXISTS mapae_follows (
        follower text NOT NULL,
        target text NOT NULL,
        verified boolean NOT NULL,
        ts bigint NOT NULL,
        PRIMARY KEY (follower, target)
    )`,
    `CREATE INDEX IF NOT EXISTS mapae_follows_target ON mapae_follows (target)`,
    // W-T33: v3.2-L1 fixed-price offerings (own cursor row L1_INDEXER_STATE_ID). Pool swaps of these
    // offerings live in mapae_offering_swaps, never in mapae_trades (L0 aggregates stay L0 only).
    `CREATE TABLE IF NOT EXISTS mapae_offerings (
        offering text PRIMARY KEY,
        token text NOT NULL,
        creator text NOT NULL,
        redeem_manager text NOT NULL,
        vesting text NOT NULL,
        sponsorship text NOT NULL,
        proceeds_lock text NOT NULL,
        name text,
        symbol text,
        created_block bigint NOT NULL,
        created_ts bigint NOT NULL,
        settled_block bigint,
        settled_ts bigint,
        pool text,
        total_sold numeric(78,0),
        total_raised numeric(78,0),
        platform_proceeds numeric(78,0),
        upfront numeric(78,0),
        locked numeric(78,0)
    )`,
    `CREATE TABLE IF NOT EXISTS mapae_offering_events (
        tx text,
        log_index int,
        PRIMARY KEY (tx, log_index),
        offering text NOT NULL,
        kind text NOT NULL CHECK (kind IN ('commit','cancel','claim','refund','refunds_enabled','redeemable_created','redeemed','sponsored')),
        actor text,
        amount numeric(78,0),
        amount2 numeric(78,0),
        ref text,
        message text,
        block bigint NOT NULL,
        ts bigint NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS mapae_offering_events_okb ON mapae_offering_events (offering, kind, block)`,
    `CREATE TABLE IF NOT EXISTS mapae_offering_swaps (
        tx text,
        log_index int,
        PRIMARY KEY (tx, log_index),
        offering text NOT NULL,
        pool text NOT NULL,
        trader text NOT NULL,
        quote_in boolean NOT NULL,
        quote_amount numeric(78,0) NOT NULL,
        token_amount numeric(78,0) NOT NULL,
        block bigint NOT NULL,
        ts bigint NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS mapae_offering_swaps_ob ON mapae_offering_swaps (offering, block DESC)`,
];

export async function ensureSchema(sql: Sql): Promise<void> {
    await sql.transaction(SCHEMA.map((q) => sql.query(q)));
}

/** Postgres codes of a schema the cron has not migrated yet: undefined_table, undefined_column. */
export const SCHEMA_MISSING_CODES: readonly string[] = ["42P01", "42703"];

/** The Postgres error code of a driver error (on the error or its cause); undefined otherwise. */
export function pgCode(e: unknown): string | undefined {
    const x = e as {code?: unknown; cause?: {code?: unknown}} | null;
    const code = x?.code ?? x?.cause?.code;
    return typeof code === "string" ? code : undefined;
}

/** Runs a read; if it fails because a table or column does not exist yet (a deploy that added
 *  them, before the cron ran ensureSchema), runs `ensure` once and the read once more. Any other
 *  error, and a second failure, is thrown to the caller (which logs it and answers 503). The normal
 *  path costs nothing extra. */
export async function withSchemaRetry<T>(label: string, run: () => Promise<T>, ensure: () => Promise<void>): Promise<T> {
    try {
        return await run();
    } catch (e) {
        const code = pgCode(e);
        if (code === undefined || !SCHEMA_MISSING_CODES.includes(code)) throw e;
        console.warn(`${label}: schema not migrated (${code}); running ensureSchema and retrying once`);
        await ensure();
        return run();
    }
}

/** Indexer cursor row per contract version: id 1 = v3, id 31 = v3.1, id 32 = v3.2 (all left
 *  untouched), id 33 = v3.2 reindex for decision 50 (spot price per curve trade). A new row starts at
 *  ADDR_V3.deployBlock, so every v3.2 event is read again: trades overwrite price_wad, r_after and
 *  s_after on (tx, log_index); curves and transfers keep DO NOTHING, graduations are idempotent. */
export const INDEXER_STATE_ID = 33;

/** W-T33: cursor row of the v3.2-L1 offering indexer (starts at ADDR_L1.deployBlock). Separate from
 *  INDEXER_STATE_ID so L0 is never read again; the catch-up throttle stays on the L0 row. */
export const L1_INDEXER_STATE_ID = 132;

/** Minimum seconds between two on-demand catch-up runs, across all callers. */
export const POKE_GAP_SEC = 20;

export type PokeClaim = "claimed" | "throttled" | "no_row";

/** Claims the next catch-up run in one statement: "claimed" when no run happened in the last
 *  POKE_GAP_SEC (poke_ts is set to now), "throttled" otherwise, "no_row" when the cursor row of
 *  this version does not exist yet. A missing poke_ts column (schema not migrated yet) throws. */
export async function claimPoke(sql: Sql, nowSec: number): Promise<PokeClaim> {
    const rows = (await sql.query(
        // Every parameter is cast and the cutoff (now - gap) is computed here: subtracting one bare
        // parameter from another fails in Postgres ("operator is not unique: unknown - unknown", 42725).
        `UPDATE mapae_indexer_state SET poke_ts = $1::bigint
         WHERE id = $2::int AND (poke_ts IS NULL OR poke_ts <= $3::bigint)
         RETURNING id`,
        [nowSec, INDEXER_STATE_ID, nowSec - POKE_GAP_SEC]
    )) as unknown[];
    if (rows.length > 0) return "claimed";
    const exists = (await sql.query(`SELECT 1 FROM mapae_indexer_state WHERE id = $1`, [INDEXER_STATE_ID])) as unknown[];
    return exists.length > 0 ? "throttled" : "no_row";
}

export async function readNextBlock(sql: Sql): Promise<bigint | null> {
    const rows = (await sql.query(`SELECT next_block::text AS n FROM mapae_indexer_state WHERE id = $1`, [INDEXER_STATE_ID])) as {n: string}[];
    return rows[0] ? BigInt(rows[0].n) : null;
}

/** Curves of `factory` only, so older factories' curves and pools are never indexed again. */
export async function loadCurves(sql: Sql, factory: string): Promise<KnownCurve[]> {
    const rows = (await sql.query(`SELECT curve, token, dev, pool, virtual_quote::text AS vq FROM mapae_curves WHERE factory = $1`, [factory.toLowerCase()])) as {curve: string; token: string; dev: string; pool: string | null; vq: string}[];
    return rows.map((r) => ({curve: r.curve as `0x${string}`, token: r.token as `0x${string}`, dev: r.dev as `0x${string}`, pool: (r.pool as `0x${string}` | null) ?? null, virtualQuote: BigInt(r.vq)}));
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
            `INSERT INTO mapae_curves (curve, token, dev, quote, virtual_quote, name, symbol, created_block, created_ts, priority_until, factory)
             SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::numeric[], $6::text[], $7::text[], $8::bigint[], $9::bigint[], $10::bigint[], $11::text[])
             ON CONFLICT (curve) DO NOTHING`,
            [c.map((r) => r.curve), c.map((r) => r.token), c.map((r) => r.dev), c.map((r) => r.quote), c.map((r) => r.virtualQuote), c.map((r) => r.name), c.map((r) => r.symbol), c.map((r) => r.createdBlock), c.map((r) => r.createdTs), c.map((r) => r.priorityUntil), c.map((r) => r.factory)]
        ),
        sql.query(
            `UPDATE mapae_curves AS m SET pool = u.pool, graduated_block = u.block
             FROM unnest($1::text[], $2::text[], $3::bigint[]) AS u(curve, pool, block)
             WHERE m.curve = u.curve`,
            [g.map((r) => r.curve), g.map((r) => r.pool), g.map((r) => r.block)]
        ),
        sql.query(
            // A reindex (new cursor id) rewrites the price definition of rows already stored.
            `INSERT INTO mapae_trades (tx, log_index, curve, venue, side, trader, is_dev, quote_amount, token_amount, price_wad, block, ts, verified, r_after, s_after)
             SELECT * FROM unnest($1::text[], $2::int[], $3::text[], $4::text[], $5::text[], $6::text[], $7::boolean[], $8::numeric[], $9::numeric[], $10::numeric[], $11::bigint[], $12::bigint[], $13::boolean[], $14::numeric[], $15::numeric[])
             ON CONFLICT (tx, log_index) DO UPDATE SET price_wad = EXCLUDED.price_wad, r_after = EXCLUDED.r_after, s_after = EXCLUDED.s_after`,
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
                t.map((r) => r.verified),
                t.map((r) => r.rAfter),
                t.map((r) => r.sAfter),
            ]
        ),
        sql.query(
            `INSERT INTO mapae_transfers (tx, log_index, token, from_addr, to_addr, value, block)
             SELECT * FROM unnest($1::text[], $2::int[], $3::text[], $4::text[], $5::text[], $6::numeric[], $7::bigint[])
             ON CONFLICT (tx, log_index) DO NOTHING`,
            [x.map((r) => r.tx), x.map((r) => r.logIndex), x.map((r) => r.token), x.map((r) => r.from), x.map((r) => r.to), x.map((r) => r.value), x.map((r) => r.block)]
        ),
        sql.query(
            `INSERT INTO mapae_indexer_state (id, next_block, updated_at, indexed_ts) VALUES ($3::int, $1::bigint, now(), $2::bigint)
             ON CONFLICT (id) DO UPDATE SET next_block = EXCLUDED.next_block, updated_at = now(), indexed_ts = EXCLUDED.indexed_ts`,
            [w.nextBlock.toString(), String(w.indexedTs), INDEXER_STATE_ID]
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
    /** price_wad of the last trade before the window (sinceTs); null when there is none. */
    refPriceWad: string | null;
};

export async function readState(sql: Sql): Promise<{indexedBlock: string | null; indexedTs: string | null}> {
    const rows = (await sql.query(`SELECT (next_block - 1)::text AS b, indexed_ts::text AS ts FROM mapae_indexer_state WHERE id = $1`, [INDEXER_STATE_ID])) as {b: string; ts: string | null}[];
    return {indexedBlock: rows[0]?.b ?? null, indexedTs: rows[0]?.ts ?? null};
}

/** Per-curve numbers for the window starting at sinceTs (the *24h field names are kept for any
 *  window), the last trade, and the reference price before the window, in one GROUP BY.
 *  Curves of `factory` only (v3.1). traders24h = distinct non-Dev wallets with a verified BUY. */
export async function summary(sql: Sql, sinceTs: number, factory: string): Promise<SummaryRow[]> {
    return (await sql.query(
        `SELECT t.curve,
                count(*) FILTER (WHERE t.ts >= $1)::int AS "trades24h",
                count(DISTINCT t.trader) FILTER (WHERE t.ts >= $1 AND NOT t.is_dev AND t.side = 'buy' AND t.verified IS TRUE)::int AS "traders24h",
                coalesce(sum(t.quote_amount) FILTER (WHERE t.ts >= $1), 0)::text AS "volume24h",
                coalesce(sum(t.quote_amount) FILTER (WHERE t.ts >= $1 AND NOT t.is_dev), 0)::text AS "volume24hExDev",
                max(t.ts)::text AS "lastTradeTs",
                ((array_agg(t.price_wad ORDER BY t.ts DESC, t.block DESC, t.log_index DESC))[1])::text AS "lastPriceWad",
                ((array_agg(t.price_wad ORDER BY t.ts DESC, t.block DESC, t.log_index DESC) FILTER (WHERE t.ts < $1))[1])::text AS "refPriceWad"
         FROM mapae_trades t
         JOIN mapae_curves m ON m.curve = t.curve AND m.factory = $2
         GROUP BY t.curve`,
        [sinceTs, factory.toLowerCase()]
    )) as SummaryRow[];
}

/** One curve of the current factory for the server-first home list (STATUS W-T16). */
export type ListRow = {
    curve: string;
    token: string;
    dev: string;
    quote: string;
    virtualQuote: string;
    name: string;
    symbol: string;
    createdTs: string;
    priorityUntil: string;
    pool: string | null;
    /** r / s after the latest curve trade (r_after / s_after), "0" before any trade. */
    r: string;
    s: string;
    /** Distinct non-Dev wallets with a verified curve buy, all time (CurveSale.verifiedBuyerCount). */
    verifiedBuyers: number;
};

export const LIST_MAX = 500;

/** Every curve of `factory`, newest first, at most LIST_MAX + 1 rows (one more = truncated).
 *  One statement: the latest r / s and the verified buyer count come from lateral subqueries. */
export async function curveList(sql: Sql, factory: string): Promise<ListRow[]> {
    return (await sql.query(
        `SELECT m.curve, m.token, m.dev, m.quote, m.virtual_quote::text AS "virtualQuote", m.name, m.symbol,
                m.created_ts::text AS "createdTs", COALESCE(m.priority_until, 0)::text AS "priorityUntil", m.pool,
                COALESCE(l.r_after, 0)::text AS r, COALESCE(l.s_after, 0)::text AS s,
                COALESCE(v.n, 0)::int AS "verifiedBuyers"
         FROM mapae_curves m
         LEFT JOIN LATERAL (
             SELECT t.r_after, t.s_after FROM mapae_trades t
             WHERE t.curve = m.curve AND t.venue = 'curve' AND t.r_after IS NOT NULL
             ORDER BY t.block DESC, t.log_index DESC LIMIT 1
         ) l ON true
         LEFT JOIN LATERAL (
             SELECT count(DISTINCT t.trader) AS n FROM mapae_trades t
             WHERE t.curve = m.curve AND t.venue = 'curve' AND t.side = 'buy' AND t.verified = true AND NOT t.is_dev
         ) v ON true
         WHERE m.factory = $1
         ORDER BY m.created_ts DESC, m.created_block DESC, m.curve DESC
         LIMIT $2::int`,
        [factory.toLowerCase(), LIST_MAX + 1]
    )) as ListRow[];
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

export type FlowRow = {buyCount: number; buyVolume: string; sellCount: number; sellVolume: string; verifiedBuyers: number; verifiedSellers: number};

/** Non-Dev buys and sells of one curve since sinceTs (quote_amount sums), plus distinct verified
 *  buyers and sellers, in one aggregate. Addresses are stored lowercase. */
export async function flow(sql: Sql, curve: string, sinceTs: number): Promise<FlowRow> {
    const rows = (await sql.query(
        `SELECT count(*) FILTER (WHERE side = 'buy')::int AS "buyCount",
                coalesce(sum(quote_amount) FILTER (WHERE side = 'buy'), 0)::text AS "buyVolume",
                count(*) FILTER (WHERE side = 'sell')::int AS "sellCount",
                coalesce(sum(quote_amount) FILTER (WHERE side = 'sell'), 0)::text AS "sellVolume",
                count(DISTINCT trader) FILTER (WHERE side = 'buy' AND verified IS TRUE)::int AS "verifiedBuyers",
                count(DISTINCT trader) FILTER (WHERE side = 'sell' AND verified IS TRUE)::int AS "verifiedSellers"
         FROM mapae_trades
         WHERE curve = $1 AND ts >= $2 AND NOT is_dev`,
        [curve, sinceTs]
    )) as FlowRow[];
    return rows[0];
}

/** Curves launched by this curve's Dev through the same factory (this one included) and the Dev's
 *  nickname, in one query; {0, null} when the curve is not indexed. Addresses are stored lowercase
 *  on both sides (indexer and nickname writes), so the join needs no lower(). */
export async function devInfo(sql: Sql, curve: string): Promise<{launched: number; nickname: string | null}> {
    const rows = (await sql.query(
        `SELECT (SELECT count(*)::int FROM mapae_curves m WHERE m.dev = me.dev AND m.factory = me.factory) AS n,
                nk.nickname AS nickname
         FROM mapae_curves me
         LEFT JOIN mapae_nicknames nk ON nk.address = me.dev
         WHERE me.curve = $1`,
        [curve]
    )) as {n: number; nickname: string | null}[];
    return {launched: rows[0]?.n ?? 0, nickname: rows[0]?.nickname ?? null};
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

/** Trust signals for the token page (decision 51): facts only, amounts as wei strings.
 *  - devFirstBuy: the Dev's curve buys in the launch tx (the tx of the token's mint Transfer from
 *    the zero address); "0" when none.
 *  - devBought / devSold / devSellCount / devLastSellTs: the Dev's trades on this token (curve and
 *    pool; is_dev), quantities in tokens.
 *  - devBalance: the Dev's balance from indexed transfers.
 *  - devTransferredOut: tokens the Dev sent to any address but the curve and the pool.
 *  - holders below exclude the zero address, the curve and the pool: top10 (sum of the 10 largest
 *    balances), circulating (sum of all), holdersCount; verifiedHeld / verifiedHolders: those of
 *    them with a verified buy of this token. */
export type HolderSignals = {
    devFirstBuy: string;
    devBought: string;
    devSold: string;
    devSellCount: number;
    devLastSellTs: string | null;
    devBalance: string;
    devTransferredOut: string;
    top10: string;
    circulating: string;
    verifiedHeld: string;
    verifiedHolders: number;
    holdersCount: number;
};

/** One statement. Indexes: mapae_transfers (token, from_addr) / (token, to_addr) for the balances,
 *  the launch tx and the Dev's sends; mapae_trades (curve, ts DESC) for the Dev's trades and the
 *  verified buyers of this curve. */
export async function holderSignals(sql: Sql, c: {curve: string; token: string; dev: string; pool: string | null}): Promise<HolderSignals> {
    const rows = (await sql.query(
        `WITH b AS (
             SELECT addr, sum(delta) AS bal FROM (
                 SELECT to_addr AS addr, value AS delta FROM mapae_transfers WHERE token = $1
                 UNION ALL
                 SELECT from_addr AS addr, -value AS delta FROM mapae_transfers WHERE token = $1
             ) x GROUP BY addr
         ),
         h AS (
             SELECT addr, bal FROM b
             WHERE bal > 0 AND addr <> $5 AND addr <> $3 AND ($4::text IS NULL OR addr <> $4::text)
         ),
         ranked AS (SELECT bal, row_number() OVER (ORDER BY bal DESC, addr) AS rn FROM h),
         vb AS (SELECT DISTINCT trader FROM mapae_trades WHERE curve = $3 AND side = 'buy' AND verified IS TRUE),
         born AS (SELECT tx FROM mapae_transfers WHERE token = $1 AND from_addr = $5 ORDER BY block, log_index LIMIT 1),
         dt AS (
             SELECT coalesce(sum(token_amount) FILTER (WHERE side = 'buy'), 0) AS bought,
                    coalesce(sum(token_amount) FILTER (WHERE side = 'sell'), 0) AS sold,
                    count(*) FILTER (WHERE side = 'sell')::int AS sells,
                    max(ts) FILTER (WHERE side = 'sell') AS last_sell,
                    coalesce(sum(token_amount) FILTER (WHERE side = 'buy' AND venue = 'curve' AND tx IN (SELECT tx FROM born)), 0) AS first_buy
             FROM mapae_trades WHERE curve = $3 AND is_dev
         )
         SELECT dt.first_buy::text AS "devFirstBuy",
                dt.bought::text AS "devBought",
                dt.sold::text AS "devSold",
                dt.sells AS "devSellCount",
                dt.last_sell::text AS "devLastSellTs",
                coalesce((SELECT bal FROM b WHERE addr = $2), 0)::text AS "devBalance",
                coalesce((SELECT sum(value) FROM mapae_transfers
                          WHERE token = $1 AND from_addr = $2 AND to_addr <> $3 AND ($4::text IS NULL OR to_addr <> $4::text)), 0)::text AS "devTransferredOut",
                coalesce((SELECT sum(bal) FROM ranked WHERE rn <= 10), 0)::text AS top10,
                coalesce((SELECT sum(bal) FROM h), 0)::text AS circulating,
                coalesce((SELECT sum(h.bal) FROM h JOIN vb ON vb.trader = h.addr), 0)::text AS "verifiedHeld",
                (SELECT count(*)::int FROM h JOIN vb ON vb.trader = h.addr) AS "verifiedHolders",
                (SELECT count(*)::int FROM h) AS "holdersCount"
         FROM dt`,
        [c.token, c.dev, c.curve, c.pool, "0x0000000000000000000000000000000000000000"]
    )) as HolderSignals[];
    return rows[0];
}

/** priceWad here is the executed price (quote_amount * 1e18 / token_amount, rounded down), not
 *  the stored price_wad (the post-trade spot for curve trades, used by candles and the summary). */
export type TradeOut = {tx: string; logIndex: number; side: string; venue: string; trader: string; isDev: boolean; quoteAmount: string; tokenAmount: string; priceWad: string; ts: string; block: string; verified: boolean | null};

export async function trades(sql: Sql, curve: string, before: bigint | undefined, limit: number): Promise<TradeOut[]> {
    return (await sql.query(
        `SELECT tx, log_index AS "logIndex", side, venue, trader, is_dev AS "isDev",
                quote_amount::text AS "quoteAmount", token_amount::text AS "tokenAmount",
                div(quote_amount * 1000000000000000000::numeric, token_amount)::text AS "priceWad",
                ts::text AS ts, block::text AS block, verified
         FROM mapae_trades
         WHERE curve = $1 AND ($2::bigint IS NULL OR ts < $2::bigint)
         ORDER BY ts DESC, block DESC, log_index DESC
         LIMIT $3`,
        [curve, before === undefined ? null : before.toString(), limit]
    )) as TradeOut[];
}

// ---------------------------------------------------------------------------------------------
// Wallet profile (curves of `factory` only; addresses lowercase)
// ---------------------------------------------------------------------------------------------

export type WalletCurve = {curve: string; token: string; name: string; symbol: string};
export type WalletLaunched = WalletCurve & {createdTs: string};

/** Curves this address launched (Dev), newest first, at most 50. */
export async function walletLaunched(sql: Sql, address: string, factory: string): Promise<WalletLaunched[]> {
    return (await sql.query(
        `SELECT curve, token, name, symbol, created_ts::text AS "createdTs"
         FROM mapae_curves
         WHERE dev = $1 AND factory = $2
         ORDER BY created_block DESC
         LIMIT 50`,
        [address, factory.toLowerCase()]
    )) as WalletLaunched[];
}

/** Tokens this address ever received (any transfer to it), at most 200. Balances are read on chain. */
export async function walletReceived(sql: Sql, address: string, factory: string): Promise<WalletCurve[]> {
    return (await sql.query(
        `SELECT m.curve, m.token, m.name, m.symbol
         FROM mapae_curves m
         WHERE m.factory = $2 AND m.token IN (SELECT DISTINCT t.token FROM mapae_transfers t WHERE t.to_addr = $1)
         ORDER BY m.created_block DESC
         LIMIT 200`,
        [address, factory.toLowerCase()]
    )) as WalletCurve[];
}

export const WALLET_FOLD_LIMIT = 5000;

/** This address's trades in (block, log_index) order with the curve's token, name and symbol, for
 *  the moving-average fold. At most WALLET_FOLD_LIMIT + 1 rows: one more means "truncated". */
export async function walletTradeRows(sql: Sql, address: string, factory: string): Promise<FoldRow[]> {
    return (await sql.query(
        `SELECT t.curve, m.token, m.name, m.symbol, t.side,
                t.quote_amount::text AS "quoteAmount", t.token_amount::text AS "tokenAmount"
         FROM mapae_trades t
         JOIN mapae_curves m ON m.curve = t.curve AND m.factory = $2
         WHERE t.trader = $1
         ORDER BY t.block, t.log_index
         LIMIT $3`,
        [address, factory.toLowerCase(), WALLET_FOLD_LIMIT + 1]
    )) as FoldRow[];
}

export type WalletTradeOut = TradeOut & {curve: string; symbol: string};

/** This address's trades, newest first, with the curve and its symbol (one page). */
export async function walletTrades(sql: Sql, address: string, factory: string, before: bigint | undefined, limit: number): Promise<WalletTradeOut[]> {
    return (await sql.query(
        `SELECT t.tx, t.log_index AS "logIndex", t.side, t.venue, t.trader, t.is_dev AS "isDev",
                t.quote_amount::text AS "quoteAmount", t.token_amount::text AS "tokenAmount",
                div(t.quote_amount * 1000000000000000000::numeric, t.token_amount)::text AS "priceWad",
                t.ts::text AS ts, t.block::text AS block, t.verified, t.curve, m.symbol
         FROM mapae_trades t
         JOIN mapae_curves m ON m.curve = t.curve AND m.factory = $2
         WHERE t.trader = $1 AND ($3::bigint IS NULL OR t.ts < $3::bigint)
         ORDER BY t.ts DESC, t.block DESC, t.log_index DESC
         LIMIT $4`,
        [address, factory.toLowerCase(), before === undefined ? null : before.toString(), limit]
    )) as WalletTradeOut[];
}

// ---------------------------------------------------------------------------------------------
// Nicknames and comments (lowercase addresses). Nicknames are a public profile (owner decision
// 2026-11-15): comments carry the author address, and nicknames can be looked up in bulk.
// ---------------------------------------------------------------------------------------------

export async function nicknameOf(sql: Sql, address: string): Promise<{nickname: string; updatedAtSec: number} | null> {
    const rows = (await sql.query(`SELECT nickname, extract(epoch FROM updated_at)::bigint::text AS t FROM mapae_nicknames WHERE address = $1`, [address])) as {nickname: string; t: string}[];
    return rows[0] ? {nickname: rows[0].nickname, updatedAtSec: Number(rows[0].t)} : null;
}

/** Nicknames of the given lowercase addresses (one query; addresses without one are absent). */
export async function nicknamesOf(sql: Sql, addresses: readonly string[]): Promise<{address: string; nickname: string}[]> {
    return (await sql.query(`SELECT address, nickname FROM mapae_nicknames WHERE address = ANY($1)`, [addresses])) as {address: string; nickname: string}[];
}

export async function nicknameTakenByOther(sql: Sql, nicknameLc: string, address: string): Promise<boolean> {
    const rows = (await sql.query(`SELECT 1 FROM mapae_nicknames WHERE nickname_lc = $1 AND address <> $2`, [nicknameLc, address])) as unknown[];
    return rows.length > 0;
}

/** Upsert; a nickname_lc clash with another wallet raises a unique violation (23505). */
export async function setNickname(sql: Sql, address: string, nickname: string, nicknameLc: string): Promise<void> {
    await sql.query(
        `INSERT INTO mapae_nicknames (address, nickname, nickname_lc, updated_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (address) DO UPDATE SET nickname = EXCLUDED.nickname, nickname_lc = EXCLUDED.nickname_lc, updated_at = now()`,
        [address, nickname, nicknameLc]
    );
}

export async function curveKnown(sql: Sql, curve: string): Promise<boolean> {
    return ((await sql.query(`SELECT 1 FROM mapae_curves WHERE curve = $1`, [curve])) as unknown[]).length > 0;
}

/** Both spam checks in one query: seconds since the last comment and the 24 h count. */
export async function commentRate(sql: Sql, author: string): Promise<{sinceLastSec: number | null; last24h: number}> {
    const rows = (await sql.query(
        `SELECT extract(epoch FROM (now() - max(created_at)))::float8 AS since,
                count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS n
         FROM mapae_comments WHERE author = $1`,
        [author]
    )) as {since: number | null; n: number}[];
    return {sinceLastSec: rows[0]?.since ?? null, last24h: rows[0]?.n ?? 0};
}

/** Comments with nickname, holder (token balance > 0 from indexed transfers) and dev flags, all
 *  in one query (joins + one lateral aggregate per row; no per-comment round trip). */
const COMMENT_VIEW = `
    SELECT c.id::text AS id, coalesce(n.nickname, '') AS nickname, c.body, c.author,
           to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
           coalesce(b.bal, 0) > 0 AS holder,
           (m.dev IS NOT NULL AND m.dev = c.author) AS dev
    FROM mapae_comments c
    LEFT JOIN mapae_nicknames n ON n.address = c.author
    LEFT JOIN mapae_curves m ON m.curve = c.curve
    LEFT JOIN LATERAL (
        SELECT sum(CASE WHEN t.to_addr = c.author THEN t.value ELSE 0 END)
             - sum(CASE WHEN t.from_addr = c.author THEN t.value ELSE 0 END) AS bal
        FROM mapae_transfers t
        WHERE t.token = m.token AND (t.to_addr = c.author OR t.from_addr = c.author)
    ) b ON true`;

type CommentRow = {id: string; nickname: string; body: string; author: string; createdAt: string; holder: boolean; dev: boolean};
const toComment = (r: CommentRow) => ({...r, id: Number(r.id)});

export async function listComments(sql: Sql, curve: string, before: number | undefined, limit: number) {
    const rows = (await sql.query(
        `${COMMENT_VIEW}
         WHERE c.curve = $1 AND NOT c.deleted AND NOT c.hidden AND ($2::bigint IS NULL OR c.id < $2::bigint)
         ORDER BY c.id DESC
         LIMIT $3`,
        [curve, before ?? null, limit]
    )) as CommentRow[];
    return rows.map(toComment);
}

export async function insertComment(sql: Sql, curve: string, author: string, body: string) {
    const [ins] = (await sql.query(`INSERT INTO mapae_comments (curve, author, body) VALUES ($1, $2, $3) RETURNING id::text AS id`, [curve, author, body])) as {id: string}[];
    const rows = (await sql.query(`${COMMENT_VIEW} WHERE c.id = $1::bigint`, [ins.id])) as CommentRow[];
    return toComment(rows[0]);
}

export async function deleteComment(sql: Sql, id: number, author: string): Promise<boolean> {
    const rows = (await sql.query(`UPDATE mapae_comments SET deleted = true WHERE id = $1 AND author = $2 RETURNING id`, [id, author])) as unknown[];
    return rows.length > 0;
}

export async function hideComment(sql: Sql, id: number, hidden: boolean): Promise<boolean> {
    const rows = (await sql.query(`UPDATE mapae_comments SET hidden = $2 WHERE id = $1 RETURNING id`, [id, hidden])) as unknown[];
    return rows.length > 0;
}

/** Name and symbol of one curve of `factory` (share page); null when unknown. */
export async function curveName(sql: Sql, curve: string, factory: string): Promise<{name: string; symbol: string} | null> {
    const rows = (await sql.query(`SELECT name, symbol FROM mapae_curves WHERE curve = $1 AND factory = $2`, [curve.toLowerCase(), factory.toLowerCase()])) as {name: string; symbol: string}[];
    return rows[0] ?? null;
}

// ---------------------------------------------------------------------------------------------
// Follows and the feed (decision 53; lowercase addresses)
// ---------------------------------------------------------------------------------------------

export async function followState(sql: Sql, follower: string, target: string): Promise<{exists: boolean; count: number}> {
    const rows = (await sql.query(
        `SELECT count(*)::int AS n, bool_or(target = $2) AS e FROM mapae_follows WHERE follower = $1`,
        [follower, target]
    )) as {n: number; e: boolean | null}[];
    return {exists: rows[0]?.e === true, count: rows[0]?.n ?? 0};
}

export async function insertFollow(sql: Sql, follower: string, target: string, verified: boolean, ts: number): Promise<void> {
    await sql.query(
        `INSERT INTO mapae_follows (follower, target, verified, ts) VALUES ($1, $2, $3::boolean, $4::bigint)
         ON CONFLICT (follower, target) DO NOTHING`,
        [follower, target, verified, ts]
    );
}

/** State right after a follow write (the POST answer): target's verified followers, follower's
 *  following count, relation exists. One query, never cached. */
export async function afterFollow(sql: Sql, follower: string, target: string): Promise<{isFollowing: boolean; targetFollowers: number; myFollowing: number}> {
    const rows = (await sql.query(
        `SELECT EXISTS (SELECT 1 FROM mapae_follows WHERE follower = $1 AND target = $2) AS "isFollowing",
                (SELECT count(*)::int FROM mapae_follows WHERE target = $2 AND verified) AS "targetFollowers",
                (SELECT count(*)::int FROM mapae_follows WHERE follower = $1) AS "myFollowing"`,
        [follower, target]
    )) as {isFollowing: boolean; targetFollowers: number; myFollowing: number}[];
    return rows[0];
}

export async function deleteFollow(sql: Sql, follower: string, target: string): Promise<void> {
    await sql.query(`DELETE FROM mapae_follows WHERE follower = $1 AND target = $2`, [follower, target]);
}

/** Verified followers of `wallet`, wallets it follows, and whether `viewer` follows it (null
 *  without a viewer), in one query. */
export async function followCounts(sql: Sql, wallet: string, viewer: string | null): Promise<{followers: number; following: number; isFollowing: boolean | null}> {
    const rows = (await sql.query(
        `SELECT (SELECT count(*)::int FROM mapae_follows WHERE target = $1 AND verified) AS followers,
                (SELECT count(*)::int FROM mapae_follows WHERE follower = $1) AS following,
                CASE WHEN $2::text IS NULL THEN NULL
                     ELSE EXISTS (SELECT 1 FROM mapae_follows WHERE follower = $2::text AND target = $1) END AS "isFollowing"`,
        [wallet, viewer]
    )) as {followers: number; following: number; isFollowing: boolean | null}[];
    return rows[0];
}

export const FEED_PAGE = 50;
export type FeedOut = WalletTradeOut & {name: string; nickname: string | null};

/** Trades of every wallet `wallet` follows, newest first, one page (FEED_PAGE), current factory.
 *  One statement: trader IN (follows of wallet, PK prefix) drives mapae_trades_trader_ts
 *  (trader, ts DESC) per followed wallet; the newest FEED_PAGE are then taken by ts. */
export async function feed(sql: Sql, wallet: string, factory: string, before: bigint | undefined): Promise<FeedOut[]> {
    return (await sql.query(
        `SELECT t.tx, t.log_index AS "logIndex", t.side, t.venue, t.trader, t.is_dev AS "isDev",
                t.quote_amount::text AS "quoteAmount", t.token_amount::text AS "tokenAmount",
                div(t.quote_amount * 1000000000000000000::numeric, t.token_amount)::text AS "priceWad",
                t.ts::text AS ts, t.block::text AS block, t.verified, t.curve, m.symbol, m.name, n.nickname
         FROM mapae_trades t
         JOIN mapae_curves m ON m.curve = t.curve AND m.factory = $2
         LEFT JOIN mapae_nicknames n ON n.address = t.trader
         WHERE t.trader IN (SELECT f.target FROM mapae_follows f WHERE f.follower = $1)
           AND ($3::bigint IS NULL OR t.ts < $3::bigint)
         ORDER BY t.ts DESC, t.block DESC, t.log_index DESC
         LIMIT $4`,
        [wallet, factory.toLowerCase(), before === undefined ? null : before.toString(), FEED_PAGE]
    )) as FeedOut[];
}

// ---------------------------------------------------------------------------------------------
// v3.2-L1 offerings (W-T33): indexer writes and /api/chain/offerings queries (lowercase addresses)
// ---------------------------------------------------------------------------------------------

export async function readNextBlockL1(sql: Sql): Promise<bigint | null> {
    const rows = (await sql.query(`SELECT next_block::text AS n FROM mapae_indexer_state WHERE id = $1`, [L1_INDEXER_STATE_ID])) as {n: string}[];
    return rows[0] ? BigInt(rows[0].n) : null;
}

export async function readStateL1(sql: Sql): Promise<{indexedBlock: string | null; indexedTs: string | null}> {
    const rows = (await sql.query(`SELECT (next_block - 1)::text AS b, indexed_ts::text AS ts FROM mapae_indexer_state WHERE id = $1`, [L1_INDEXER_STATE_ID])) as {b: string; ts: string | null}[];
    return {indexedBlock: rows[0]?.b ?? null, indexedTs: rows[0]?.ts ?? null};
}

export async function loadOfferings(sql: Sql): Promise<KnownOffering[]> {
    const rows = (await sql.query(`SELECT offering, redeem_manager AS rm, sponsorship AS sp, pool FROM mapae_offerings`)) as {offering: string; rm: string; sp: string; pool: string | null}[];
    const zero = "0x0000000000000000000000000000000000000000";
    return rows.map((r) => ({
        offering: r.offering as `0x${string}`,
        redeemManager: r.rm as `0x${string}`,
        sponsorship: r.sp === zero ? null : (r.sp as `0x${string}`),
        pool: (r.pool as `0x${string}` | null) ?? null,
    }));
}

/** One L1 range in one transaction (one statement per table through unnest arrays). Offerings,
 *  events and swaps are DO NOTHING on their keys; settlement values fill only what the range saw
 *  (COALESCE), so Settled, Listed and ProceedsDistributed in different ranges still end in one row. */
export async function writeRangeL1(sql: Sql, w: RangeWriteL1): Promise<void> {
    const o = w.offerings;
    const st = w.settlements;
    const e = w.events;
    const x = w.swaps;
    await sql.transaction([
        sql.query(
            `INSERT INTO mapae_offerings (offering, token, creator, redeem_manager, vesting, sponsorship, proceeds_lock, name, symbol, created_block, created_ts)
             SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::bigint[], $11::bigint[])
             ON CONFLICT (offering) DO NOTHING`,
            [o.map((r) => r.offering), o.map((r) => r.token), o.map((r) => r.creator), o.map((r) => r.redeemManager), o.map((r) => r.vesting), o.map((r) => r.sponsorship), o.map((r) => r.proceedsLock), o.map((r) => r.name), o.map((r) => r.symbol), o.map((r) => r.createdBlock), o.map((r) => r.createdTs)]
        ),
        sql.query(
            `UPDATE mapae_offerings AS m SET
                 settled_block = COALESCE(u.sb, m.settled_block), settled_ts = COALESCE(u.sts, m.settled_ts), pool = COALESCE(u.pool, m.pool),
                 total_sold = COALESCE(u.ts_, m.total_sold), total_raised = COALESCE(u.tr, m.total_raised),
                 platform_proceeds = COALESCE(u.pp, m.platform_proceeds), upfront = COALESCE(u.up, m.upfront), locked = COALESCE(u.lk, m.locked)
             FROM unnest($1::text[], $2::bigint[], $3::bigint[], $4::text[], $5::numeric[], $6::numeric[], $7::numeric[], $8::numeric[], $9::numeric[])
                  AS u(offering, sb, sts, pool, ts_, tr, pp, up, lk)
             WHERE m.offering = u.offering`,
            [st.map((r) => r.offering), st.map((r) => r.settledBlock), st.map((r) => r.settledTs), st.map((r) => r.pool), st.map((r) => r.totalSold), st.map((r) => r.totalRaised), st.map((r) => r.platformProceeds), st.map((r) => r.upfront), st.map((r) => r.locked)]
        ),
        sql.query(
            `INSERT INTO mapae_offering_events (tx, log_index, offering, kind, actor, amount, amount2, ref, message, block, ts)
             SELECT * FROM unnest($1::text[], $2::int[], $3::text[], $4::text[], $5::text[], $6::numeric[], $7::numeric[], $8::text[], $9::text[], $10::bigint[], $11::bigint[])
             ON CONFLICT (tx, log_index) DO NOTHING`,
            [e.map((r) => r.tx), e.map((r) => r.logIndex), e.map((r) => r.offering), e.map((r) => r.kind), e.map((r) => r.actor), e.map((r) => r.amount), e.map((r) => r.amount2), e.map((r) => r.ref), e.map((r) => r.message), e.map((r) => r.block), e.map((r) => r.ts)]
        ),
        sql.query(
            `INSERT INTO mapae_offering_swaps (tx, log_index, offering, pool, trader, quote_in, quote_amount, token_amount, block, ts)
             SELECT * FROM unnest($1::text[], $2::int[], $3::text[], $4::text[], $5::text[], $6::boolean[], $7::numeric[], $8::numeric[], $9::bigint[], $10::bigint[])
             ON CONFLICT (tx, log_index) DO NOTHING`,
            [x.map((r) => r.tx), x.map((r) => r.logIndex), x.map((r) => r.offering), x.map((r) => r.pool), x.map((r) => r.trader), x.map((r) => r.quoteIn), x.map((r) => r.quoteAmount), x.map((r) => r.tokenAmount), x.map((r) => r.block), x.map((r) => r.ts)]
        ),
        sql.query(
            `INSERT INTO mapae_indexer_state (id, next_block, updated_at, indexed_ts) VALUES ($3::int, $1::bigint, now(), $2::bigint)
             ON CONFLICT (id) DO UPDATE SET next_block = EXCLUDED.next_block, updated_at = now(), indexed_ts = EXCLUDED.indexed_ts`,
            [w.nextBlock.toString(), String(w.indexedTs), L1_INDEXER_STATE_ID]
        ),
    ]);
}

export type OfferingListRow = {
    offering: string;
    token: string;
    creator: string;
    redeemManager: string;
    vesting: string;
    sponsorship: string;
    proceedsLock: string;
    name: string | null;
    symbol: string | null;
    createdBlock: string;
    createdTs: string;
    settled: boolean;
    settledBlock: string | null;
    pool: string | null;
    /** wallets whose last Committed/Cancelled cumulative is > 0 */
    participants: number;
    /** sum of those last cumulatives (= totalCommitted from events) */
    totalCommitted: string;
    /** distinct RedeemableCreated ids */
    redeemItems: number;
};

/** Last cumulative per (offering, wallet) from Committed / Cancelled, latest event wins. */
const LAST_COMMITMENT = `
    SELECT DISTINCT ON (offering, actor) offering, actor, amount2 AS cumulative, block, log_index
    FROM mapae_offering_events
    WHERE kind IN ('commit','cancel') AND ($1::text IS NULL OR offering = $1::text)
    ORDER BY offering, actor, block DESC, log_index DESC`;

const OFFERING_COLUMNS = `
    o.offering, o.token, o.creator, o.redeem_manager AS "redeemManager", o.vesting, o.sponsorship, o.proceeds_lock AS "proceedsLock",
    o.name, o.symbol, o.created_block::text AS "createdBlock", o.created_ts::text AS "createdTs",
    (o.settled_block IS NOT NULL) AS settled, o.settled_block::text AS "settledBlock", o.pool,
    COALESCE(c.n, 0)::int AS participants, COALESCE(c.total, 0)::text AS "totalCommitted",
    COALESCE(r.n, 0)::int AS "redeemItems"`;

const OFFERING_JOINS = `
    LEFT JOIN (SELECT offering, count(*) FILTER (WHERE cumulative > 0) AS n, sum(cumulative) AS total FROM (${LAST_COMMITMENT}) lc GROUP BY offering) c ON c.offering = o.offering
    LEFT JOIN (SELECT offering, count(DISTINCT ref) AS n FROM mapae_offering_events WHERE kind = 'redeemable_created' AND ($1::text IS NULL OR offering = $1::text) GROUP BY offering) r ON r.offering = o.offering`;

/** Every offering, newest first, with participants, total committed and redeem item count, in one
 *  statement (grouped subqueries, no per-offering query). */
export async function offeringList(sql: Sql): Promise<OfferingListRow[]> {
    return (await sql.query(
        `SELECT ${OFFERING_COLUMNS} FROM mapae_offerings o ${OFFERING_JOINS}
         ORDER BY o.created_block DESC, o.offering DESC
         LIMIT 500`,
        [null]
    )) as OfferingListRow[];
}

export type OfferingDetail = OfferingListRow & {
    settledTs: string | null;
    totalSold: string | null;
    totalRaised: string | null;
    platformProceeds: string | null;
    upfront: string | null;
    locked: string | null;
};
export type Commitment = {wallet: string; cumulative: string; block: string; logIndex: number};
export type RedeemItem = {id: string; creator: string; burnAmount: string; maxClaims: string; block: string; tx: string; logIndex: number};

/** One offering's summary, its wallets' last commitments and its redeem items (three statements,
 *  run in parallel by the caller; none per wallet or per item). */
export async function offeringDetail(sql: Sql, offering: string): Promise<{row: OfferingDetail | null; commitments: Commitment[]; redeemItems: RedeemItem[]}> {
    const [rows, commitments, items] = await Promise.all([
        sql.query(
            `SELECT ${OFFERING_COLUMNS}, o.settled_ts::text AS "settledTs", o.total_sold::text AS "totalSold", o.total_raised::text AS "totalRaised",
                    o.platform_proceeds::text AS "platformProceeds", o.upfront::text AS upfront, o.locked::text AS locked
             FROM mapae_offerings o ${OFFERING_JOINS}
             WHERE o.offering = $1::text`,
            [offering]
        ),
        sql.query(
            `SELECT actor AS wallet, cumulative::text AS cumulative, block::text AS block, log_index AS "logIndex" FROM (${LAST_COMMITMENT}) lc ORDER BY block, log_index`,
            [offering]
        ),
        sql.query(
            `SELECT DISTINCT ON (ref) ref AS id, actor AS creator, amount::text AS "burnAmount", amount2::text AS "maxClaims", block::text AS block, tx, log_index AS "logIndex"
             FROM mapae_offering_events WHERE offering = $1 AND kind = 'redeemable_created'
             ORDER BY ref, block, log_index`,
            [offering]
        ),
    ]);
    return {row: ((rows as OfferingDetail[])[0] ?? null), commitments: commitments as Commitment[], redeemItems: items as RedeemItem[]};
}

export const OFFERING_FEED_PAGE = 50;
export type OfferingFeed = "swaps" | "sponsors" | "commits";
export type OfferingFeedRow = Record<string, string | number | boolean | null>;

/** Newest OFFERING_FEED_PAGE rows of one feed before `before` (block, exclusive). */
export async function offeringFeed(sql: Sql, offering: string, feed: OfferingFeed, before: bigint | undefined): Promise<OfferingFeedRow[]> {
    const b = before === undefined ? null : before.toString();
    if (feed === "swaps") {
        return (await sql.query(
            `SELECT tx, log_index AS "logIndex", trader, quote_in AS "quoteIn", quote_amount::text AS "quoteAmount", token_amount::text AS "tokenAmount", block::text AS block, ts::text AS ts
             FROM mapae_offering_swaps WHERE offering = $1 AND ($2::bigint IS NULL OR block < $2::bigint)
             ORDER BY block DESC, log_index DESC LIMIT $3`,
            [offering, b, OFFERING_FEED_PAGE]
        )) as OfferingFeedRow[];
    }
    const kinds = feed === "sponsors" ? ["sponsored"] : ["commit", "cancel"];
    return (await sql.query(
        `SELECT tx, log_index AS "logIndex", kind, actor, amount::text AS amount, amount2::text AS amount2, message, block::text AS block, ts::text AS ts
         FROM mapae_offering_events WHERE offering = $1 AND kind = ANY($2::text[]) AND ($3::bigint IS NULL OR block < $3::bigint)
         ORDER BY block DESC, log_index DESC LIMIT $4`,
        [offering, kinds, b, OFFERING_FEED_PAGE]
    )) as OfferingFeedRow[];
}

/** W-T34: whether the L1 indexer has seen a Committed event of this offering (disclosure lock). */
export async function hasIndexedCommit(sql: Sql, offering: string): Promise<boolean> {
    const rows = (await sql.query(`SELECT EXISTS (SELECT 1 FROM mapae_offering_events WHERE offering = $1 AND kind = 'commit') AS e`, [offering.toLowerCase()])) as {e: boolean}[];
    return rows[0]?.e === true;
}
