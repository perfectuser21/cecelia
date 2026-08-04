#!/usr/bin/env node
/**
 * m7-e2e-runner.mjs — evaluator 真 Postgres 场景 oracle（sprint 08040913-relay-a6e6afc7）
 *
 * 用法: node sprints/08040913-relay-a6e6afc7/tests/m7-e2e-runner.mjs <scenario>
 * scenario ∈ organic-self | only-self | boundary | drift | no-table
 *
 * 连接 $DB（默认 postgresql://localhost/cecelia），在一次性独立 schema 内建最小
 * capture_atoms / design_docs 表、种 atom、跑【真实实现】computeMetrics，断言 m7
 * 分解结果，最后 DROP SCHEMA。exit 0 = PASS，非 0 = FAIL。
 * 防造假：断言对象是 packages/brain/src/ledger-hygiene.js 的真实执行结果；
 * 窗口期望由本 runner 按北京日历日独立推导（不复用实现的窗口函数做期望值）。
 */
import { createRequire } from 'node:module';

const scenario = process.argv[2];
const VALID = ['organic-self', 'only-self', 'boundary', 'drift', 'no-table'];
if (!VALID.includes(scenario)) {
  console.error(`FAIL: 未知场景 "${scenario}"，可选: ${VALID.join(' | ')}`);
  process.exit(2);
}

const require = createRequire(new URL('../../../packages/brain/package.json', import.meta.url));
const { Pool } = require('pg');
const mod = await import(new URL('../../../packages/brain/src/ledger-hygiene.js', import.meta.url));
const { computeMetrics, getM7CaptureWindow } = mod;
if (typeof computeMetrics !== 'function' || typeof getM7CaptureWindow !== 'function') {
  console.error('FAIL: ledger-hygiene.js 未导出 computeMetrics/getM7CaptureWindow');
  process.exit(1);
}

const SELF_PREFIX = 'issue: [ledger-hygiene]';
const connectionString = process.env.DB || process.env.DATABASE_URL || 'postgresql://localhost/cecelia';
const schema = `e2e_m7_${Date.now()}_${process.pid}`;
const pool = new Pool({ connectionString, options: `-csearch_path=${schema}` });

/** 独立 oracle：按北京日历日推导昨日自然日窗口（不复用实现） */
function beijingYesterdayWindow(now) {
  const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(now);
  const todayMidnight = new Date(`${day}T00:00:00+08:00`);
  return { start: new Date(todayMidnight.getTime() - 86400000), end: todayMidnight };
}

// 固定判定时刻 = 今日北京 05:10:21（镜像真实调度窗口，避免午夜边界干扰 drift 场景）
const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
const T = new Date(`${day}T05:10:21+08:00`);
const { start, end } = beijingYesterdayWindow(T);
const mid = new Date(start.getTime() + 12 * 3600 * 1000);

let failed = false;
function assertEq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error(`FAIL: ${label} actual=${a} expected=${e}`);
    failed = true;
  }
}

async function seed(content, createdAt) {
  await pool.query('INSERT INTO capture_atoms (content, created_at) VALUES ($1, $2)', [
    content,
    createdAt.toISOString(),
  ]);
}

try {
  await pool.query(`CREATE SCHEMA "${schema}"`);
  await pool.query(
    'CREATE TABLE design_docs (id serial PRIMARY KEY, type text, created_at timestamptz NOT NULL DEFAULT now())'
  );
  if (scenario !== 'no-table') {
    await pool.query(
      'CREATE TABLE capture_atoms (id serial PRIMARY KEY, content text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())'
    );
  }

  if (scenario === 'organic-self') {
    await seed('e2e-m7 有机产出 atom', mid);
    await seed(`${SELF_PREFIX} 自主循环零产出 欠账上升 0→1（e2e）`, mid);
    const m = await computeMetrics(pool, T);
    console.log('RESULT', JSON.stringify(m.m7));
    assertEq(Object.keys(m.m7.value).sort(), ['captureDebt', 'organic', 'self', 'stratDebt'], 'value keys');
    assertEq(m.m7.value.organic, 1, 'organic');
    assertEq(m.m7.value.self, 1, 'self');
    assertEq(m.m7.value.captureDebt, 0, 'captureDebt');
    assertEq(m.m7.debt, 0, 'debt');
  } else if (scenario === 'only-self') {
    await seed(`${SELF_PREFIX} 知识保质期 欠账上升 2→3（e2e）`, mid);
    const m = await computeMetrics(pool, T);
    console.log('RESULT', JSON.stringify(m.m7));
    assertEq(m.m7.value.organic, 0, 'organic');
    assertEq(m.m7.value.self, 1, 'self');
    assertEq(m.m7.value.captureDebt, 1, 'captureDebt');
    assertEq(m.m7.debt, 1, 'debt');
    assertEq(m.m7.absolute, true, 'absolute');
  } else if (scenario === 'boundary') {
    await seed('e2e-m7 边界内 昨日 23:59:59', new Date(end.getTime() - 1000));
    await seed('e2e-m7 边界外 今日 00:00:00', end);
    await seed('e2e-m7 边界内 昨日 00:00:00', start);
    await seed('e2e-m7 边界外 前日 23:59:59', new Date(start.getTime() - 1000));
    const m = await computeMetrics(pool, T);
    console.log('RESULT', JSON.stringify(m.m7));
    assertEq(m.m7.value.organic, 2, 'organic(边界 4 枚只计 2)');
    assertEq(m.m7.value.captureDebt, 0, 'captureDebt');
  } else if (scenario === 'drift') {
    await seed('e2e-m7 漂移场景有机 atom', mid);
    const r0 = await computeMetrics(pool, T);
    const rPlus = await computeMetrics(pool, new Date(T.getTime() + 60000));
    const rMinus = await computeMetrics(pool, new Date(T.getTime() - 60000));
    console.log('RESULT', JSON.stringify(r0.m7));
    assertEq(rPlus.m7, r0.m7, 'm7(T+60s) === m7(T)');
    assertEq(rMinus.m7, r0.m7, 'm7(T-60s) === m7(T)');
    const w = getM7CaptureWindow(T);
    assertEq(w.startUtc.toISOString(), start.toISOString(), 'getM7CaptureWindow.startUtc');
    assertEq(w.endUtc.toISOString(), end.toISOString(), 'getM7CaptureWindow.endUtc');
    const w2 = getM7CaptureWindow(new Date(T.getTime() + 60000));
    assertEq(w2.startUtc.toISOString(), start.toISOString(), 'window(T+60s).startUtc 不变');
  } else if (scenario === 'no-table') {
    // error path：capture_atoms 表不存在且 strategist 无记录 → m7 保持未激活降级，不 throw
    const m = await computeMetrics(pool, T);
    console.log('RESULT', JSON.stringify(m.m7));
    assertEq(m.m7.enabled, false, 'enabled(双未激活)');
    assertEq(m.m7.debt, 0, 'debt');
  }
} catch (err) {
  console.error(`FAIL: 场景 ${scenario} 异常:`, err.message);
  failed = true;
} finally {
  try {
    await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
  } catch {
    /* schema 可能未建成 */
  }
  await pool.end();
}

if (failed) {
  process.exit(1);
}
console.log(`OK scenario=${scenario}`);
