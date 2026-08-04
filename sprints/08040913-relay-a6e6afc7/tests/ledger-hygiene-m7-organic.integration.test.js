/**
 * ledger-hygiene-m7-organic.integration.test.js — m7 organic/self 分解真 Postgres 集成测试
 *
 * 禁 mock 边（合同 ## 禁 mock 边清单）：代码 ↔ DB 表 capture_atoms。
 * 本单改的就是 m7 capture 计数 SQL 的窗口与分类语义（时区窗口 + LIKE 前缀 FILTER），
 * mock pool 结构性验不到 SQL 语义（08-03 事故正是 SQL 窗口语义翻车），必须真 PG。
 *
 * 隔离方式：独立 schema（search_path 只含本 schema，不含 public），内建最小
 * capture_atoms / design_docs 表；m1-m6 查询因表缺失走 safeMetric 降级，不影响 m7 断言。
 *
 * 由 generator 从合同 tests/ 原样复制到 packages/brain/src/__tests__/integration/，
 * 并登记进 vitest.config.js 的 POSTGRES_INTEGRATION_TESTS（brain-unit 排除、brain-integration 真 PG 跑）。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import pg from 'pg';
import { computeMetrics } from '../../ledger-hygiene.js';

const SELF_PREFIX = 'issue: [ledger-hygiene]';
const connectionString =
  process.env.DATABASE_URL || process.env.DB || 'postgresql://localhost/cecelia';
const schema = `it_m7_${Date.now()}_${process.pid}`;

/** 独立 oracle：不复用实现的窗口函数，按北京日历日自行推导昨日自然日窗口 */
function beijingYesterdayWindow(now) {
  const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(now);
  const todayMidnight = new Date(`${day}T00:00:00+08:00`);
  return { start: new Date(todayMidnight.getTime() - 86400000), end: todayMidnight };
}

// 固定判定时刻 = 今日北京 05:10:21（镜像真实调度窗口，避免午夜边界干扰）
const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
const T = new Date(`${day}T05:10:21+08:00`);
const { start, end } = beijingYesterdayWindow(T);

let pool;

async function seed(content, createdAt) {
  await pool.query('INSERT INTO capture_atoms (content, created_at) VALUES ($1, $2)', [
    content,
    createdAt.toISOString(),
  ]);
}

beforeAll(async () => {
  pool = new pg.Pool({ connectionString, options: `-csearch_path=${schema}` });
  await pool.query(`CREATE SCHEMA "${schema}"`);
  await pool.query(
    'CREATE TABLE design_docs (id serial PRIMARY KEY, type text, created_at timestamptz NOT NULL DEFAULT now())'
  );
  await pool.query(
    'CREATE TABLE capture_atoms (id serial PRIMARY KEY, content text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())'
  );
});

afterAll(async () => {
  try {
    await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
  } finally {
    await pool.end();
  }
});

beforeEach(async () => {
  await pool.query('TRUNCATE capture_atoms');
});

describe('m7 organic/self 分解 — 真 Postgres SQL 语义', () => {
  it('真库：organic 与 self 分解且自产不计入有机', async () => {
    const mid = new Date(start.getTime() + 12 * 3600 * 1000); // 昨日北京正午
    await seed('it-m7 有机产出 atom（learnings 路由）', mid);
    await seed(`${SELF_PREFIX} 自主循环零产出 欠账上升 0→1（it）`, mid);
    const metrics = await computeMetrics(pool, T);
    expect(metrics.m7.value.organic).toBe(1);
    expect(metrics.m7.value.self).toBe(1);
    expect(metrics.m7.value.captureDebt).toBe(0);
  });

  it('真库：仅自产 atom 时 organic=0 仍击穿', async () => {
    const mid = new Date(start.getTime() + 12 * 3600 * 1000);
    await seed(`${SELF_PREFIX} 知识保质期 欠账上升 2→3（it）`, mid);
    const metrics = await computeMetrics(pool, T);
    expect(metrics.m7.value.organic).toBe(0);
    expect(metrics.m7.value.self).toBe(1);
    expect(metrics.m7.value.captureDebt).toBe(1);
  });

  it('真库：窗口边界昨日 23:59:59 计入且今日 00:00:00 不计入', async () => {
    await seed('it-m7 边界内 昨日 23:59:59', new Date(end.getTime() - 1000));
    await seed('it-m7 边界外 今日 00:00:00', end);
    await seed('it-m7 边界内 昨日 00:00:00', start);
    await seed('it-m7 边界外 前日 23:59:59', new Date(start.getTime() - 1000));
    const metrics = await computeMetrics(pool, T);
    expect(metrics.m7.value.organic).toBe(2);
    expect(metrics.m7.value.captureDebt).toBe(0);
  });

  it('真库：运行时刻偏移 ±60 秒 m7 结果不变', async () => {
    const mid = new Date(start.getTime() + 12 * 3600 * 1000);
    await seed('it-m7 漂移场景有机 atom', mid);
    const r0 = await computeMetrics(pool, T);
    const rPlus = await computeMetrics(pool, new Date(T.getTime() + 60000));
    const rMinus = await computeMetrics(pool, new Date(T.getTime() - 60000));
    expect(JSON.stringify(rPlus.m7)).toBe(JSON.stringify(r0.m7));
    expect(JSON.stringify(rMinus.m7)).toBe(JSON.stringify(r0.m7));
  });
});
