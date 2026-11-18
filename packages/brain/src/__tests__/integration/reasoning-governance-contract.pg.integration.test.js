import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
vi.mock('../../alerting.js', () => ({ raise: vi.fn().mockResolvedValue(undefined) }));
import { claimDedupeKey, releaseDedupeKey } from '../../lib/dedupe.js';
import { judgeUnit } from '../../crystal-judge.js';

const schema = `reasoning_${randomUUID().replaceAll('-', '')}`;
let pool;
beforeAll(async () => {
  const url = new URL(process.env.TEST_DB_URL || process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.endsWith('_scratch')) {
    throw new Error('此测试只允许本机独占scratch PostgreSQL');
  }
  pool = new pg.Pool({ connectionString: url.toString(), options: `-csearch_path=${schema}` });
  await pool.query(`CREATE SCHEMA "${schema}"`);
  await pool.query(`CREATE TABLE side_effect_dedupe (
    id bigserial PRIMARY KEY, kind text, dedupe_key text, expires_at timestamptz,
    created_at timestamptz DEFAULT now(), UNIQUE(kind, dedupe_key))`);
  await pool.query(`CREATE TABLE crystal_run_evidence (
    unit_key text, funnel_cell text, report_date date, runs int, passes int,
    baseline_tokens numeric, hot_path_tokens numeric, avg_ms numeric, crystallized boolean,
    has_postcondition boolean, new_branch_count int, broken_count int)`);
  await pool.query(`CREATE TABLE crystal_ledger (
    report_date date, grid_key text, n_runs int, success_rate numeric, token_cost numeric,
    latency_ms numeric, new_branch_rate numeric, broken_count int, data_gap boolean,
    cost_gap boolean, funnel_cell text, created_at timestamptz, updated_at timestamptz,
    UNIQUE(report_date, grid_key))`);
  await pool.query(`CREATE TABLE crystal_verdict (
    report_date date, grid_key text, verdict text, basis jsonb, funnel_cell text,
    created_at timestamptz, updated_at timestamptz, UNIQUE(report_date, grid_key))`);
});
afterAll(async () => {
  if (!pool) return;
  try { await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { await pool.end(); }
});

it('真实PG并发claim仅一个获准，过期重占与失败释放允许合法重试', async () => {
  const winners = await Promise.all(Array.from({ length: 10 }, () => claimDedupeKey('notify', 'same', 60, pool)));
  expect(winners.filter(row => row.claimed && !row.degraded)).toHaveLength(1);
  expect((await pool.query('SELECT count(*)::int AS count FROM side_effect_dedupe')).rows[0].count).toBe(1);
  await releaseDedupeKey('notify', 'same', pool);
  expect(await claimDedupeKey('notify', 'same', -1, pool)).toEqual({ claimed: true });
  expect(await claimDedupeKey('notify', 'same', 60, pool)).toEqual({ claimed: true });
});

it('判官跨日聚合真证据，同日重判幂等且缺成本保真不晋升', async () => {
  await pool.query(`INSERT INTO crystal_run_evidence VALUES
    ('fixture-unit',NULL,'2026-11-14',10,10,12000,10,100,false,true,0,0),
    ('fixture-unit',NULL,'2026-11-15',10,10,12000,10,100,false,true,0,0)`);
  const first = await judgeUnit(pool, 'fixture-unit', '2026-11-16');
  expect(first).toMatchObject({ verdict: 'promote', metrics: { n_runs: 20, success_rate: 1, token_cost: 12000 } });
  await judgeUnit(pool, 'fixture-unit', '2026-11-16');
  expect((await pool.query('SELECT count(*)::int AS count FROM crystal_verdict')).rows[0].count).toBe(1);
  const before = (await pool.query('SELECT * FROM crystal_ledger')).rows[0];
  expect(before.n_runs).toBe(20); expect(before.cost_gap).toBe(false);
  // 只移除成本证据，真实次数及成败不得随之抹零。
  await pool.query('UPDATE crystal_run_evidence SET baseline_tokens=NULL');
  const result = await judgeUnit(pool, 'fixture-unit', '2026-11-16');
  expect(result).toMatchObject({ verdict: 'keep_llm', cost_gap: true, data_gap: false,
    metrics: { n_runs: 20, success_rate: 1 }, basis: { rule: 'cost_evidence_missing' } });
  const stored = (await pool.query('SELECT n_runs,cost_gap,data_gap FROM crystal_ledger')).rows[0];
  expect(stored).toEqual({ n_runs: 20, cost_gap: true, data_gap: false });
  expect((await pool.query('SELECT verdict,basis FROM crystal_verdict')).rows[0])
    .toMatchObject({ verdict: 'keep_llm', basis: { rule: 'cost_evidence_missing' } });
});
