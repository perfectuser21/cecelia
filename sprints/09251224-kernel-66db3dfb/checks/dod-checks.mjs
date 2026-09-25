// DoD BEHAVIOR 可执行 oracle（evaluator 模式 A 逐条跑）— 真 Postgres，禁 mock db.js 边。
// 用法：node sprints/09251224-kernel-66db3dfb/checks/dod-checks.mjs <b01|b02|b03|b04|b05|inv3>
// 从仓库根执行（cwd=repo root）。SUT 未实现时 import 失败即红（预期 Red）。
//
// 直接调 run 原语（startRun/finishRun/findBareRuns）跑真库，是「代码 ↔ task_runs」
// 与「dispatch_events ↔ task_runs」两条禁-mock 边的真验；execution-callback 端到端边
// 由 ## E2E 验收 脚本（真 HTTP + 真 DB）覆盖。

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pool from '../../../packages/brain/src/db.js';
import {
  startRun,
  finishRun,
  findBareRuns,
} from '../../../packages/brain/src/lib/task-run.js';

const created = [];
async function seedTask(status = 'in_progress') {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO tasks (id, task_type, status, payload) VALUES ($1,'harness_initiative',$2,'{}'::jsonb)`,
    [id, status],
  );
  created.push(id);
  return id;
}
async function cleanup() {
  if (created.length) {
    await pool.query(`DELETE FROM dispatch_events WHERE task_id = ANY($1::uuid[])`, [created]);
    await pool.query(`DELETE FROM task_runs WHERE task_id = ANY($1::uuid[])`, [created]);
    await pool.query(`DELETE FROM tasks WHERE id = ANY($1::uuid[])`, [created]);
  }
}
function assert(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); }

const checks = {
  // B-01: startRun 落一行 running（含执行路径 context.source）
  async b01() {
    const t = await seedTask();
    const r = `b01-${randomUUID()}`;
    await startRun({ taskId: t, runId: r, source: 'dispatcher' });
    const { rows } = await pool.query(
      `SELECT status, ended_at, context->>'source' AS source FROM task_runs WHERE run_id=$1`, [r]);
    assert(rows.length === 1, `期望 1 行，实得 ${rows.length}`);
    assert(rows[0].status === 'running', `status=${rows[0].status}`);
    assert(rows[0].ended_at === null, 'ended_at 应为空');
    assert(rows[0].source === 'dispatcher', `source=${rows[0].source}`);
  },
  // B-02: 同 run_id 重复 startRun 幂等，仅一行
  async b02() {
    const t = await seedTask();
    const r = `b02-${randomUUID()}`;
    await startRun({ taskId: t, runId: r, source: 'executor' });
    await startRun({ taskId: t, runId: r, source: 'executor' });
    const { rows } = await pool.query(`SELECT count(*)::int AS c FROM task_runs WHERE run_id=$1`, [r]);
    assert(rows[0].c === 1, `幂等破坏 count=${rows[0].c}`);
  },
  // B-03: finishRun 补齐 ended_at / status=success / exit_code / 产物引用
  async b03() {
    const t = await seedTask();
    const r = `b03-${randomUUID()}`;
    await startRun({ taskId: t, runId: r, source: 'openclaw-agent' });
    await finishRun({ runId: r, status: 'completed', exitCode: 0, artifacts: ['pr:1'] });
    const { rows } = await pool.query(
      `SELECT status, ended_at, result FROM task_runs WHERE run_id=$1`, [r]);
    assert(rows[0].status === 'success', `status=${rows[0].status}`);
    assert(rows[0].ended_at !== null, 'ended_at 应非空');
    assert(String(rows[0].result.exit_code) === '0', `exit_code=${rows[0].result.exit_code}`);
    assert(Array.isArray(rows[0].result.artifacts) && rows[0].result.artifacts[0] === 'pr:1',
      `artifacts=${JSON.stringify(rows[0].result.artifacts)}`);
  },
  // B-04: 裸跑检测命中且无误报（有 dispatch_events 无 task_runs = AMBER）
  async b04() {
    const bare = await seedTask();
    const ok = await seedTask();
    await pool.query(
      `INSERT INTO dispatch_events (task_id,event_type,reason) VALUES ($1,'dispatched','chk-bare'),($2,'dispatched','chk-ok')`,
      [bare, ok]);
    await startRun({ taskId: ok, runId: `b04-${randomUUID()}`, source: 'dispatcher' });
    const rows = await findBareRuns(pool, { windowMinutes: 60 });
    const ids = rows.map((x) => x.task_id);
    assert(ids.includes(bare), '未检出裸跑 task');
    assert(!ids.includes(ok), '有 run 的 task 被误报裸跑');
  },
  // B-05: 投影记账列存在 + runNotionPushSync 已接 pushTaskRuns
  async b05() {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS c FROM information_schema.columns
        WHERE table_name='task_runs' AND column_name IN ('notion_id','notion_synced_at','notion_digest')`);
    assert(rows[0].c === 3, `记账列缺失 count=${rows[0].c}`);
    const src = readFileSync('packages/brain/src/notion-push-sync.js', 'utf8');
    assert(/async function pushTaskRuns/.test(src) && /pushTaskRuns\s*\(/.test(src),
      'notion-push-sync 未定义/未调用 pushTaskRuns');
  },
  // INV-3: DB 为真相源 — 已终态 run 再次 finishRun 不覆盖（防伪造终态）
  async inv3() {
    const t = await seedTask();
    const r = `inv3-${randomUUID()}`;
    await startRun({ taskId: t, runId: r, source: 'bridge' });
    await finishRun({ runId: r, status: 'failed', exitCode: 1, artifacts: [] });
    const a = await pool.query(`SELECT status, ended_at FROM task_runs WHERE run_id=$1`, [r]);
    await finishRun({ runId: r, status: 'success', exitCode: 0, artifacts: ['x'] });
    const b = await pool.query(`SELECT status, ended_at FROM task_runs WHERE run_id=$1`, [r]);
    assert(b.rows[0].status === 'failed', `终态被覆盖 status=${b.rows[0].status}`);
    assert(b.rows[0].ended_at.getTime() === a.rows[0].ended_at.getTime(), 'ended_at 被改写');
  },
};

const name = process.argv[2];
const fn = checks[name];
if (!fn) { console.error(`未知检查: ${name}（可选: ${Object.keys(checks).join('/')}）`); process.exit(2); }
try {
  await fn();
  console.log(`OK: ${name}`);
} catch (err) {
  console.error(err.message || String(err));
  process.exitCode = 1;
} finally {
  await cleanup().catch(() => {});
  await pool.end().catch(() => {});
}
