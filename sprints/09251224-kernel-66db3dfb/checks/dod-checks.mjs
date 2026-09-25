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
// 晨报裸跑 AMBER 渲染器（R1-1：需求④ 人可见出口 SSOT）。SUT 未实现时该导出为
// undefined，b06 调用即抛错（预期 Red）；此处顶层 import 仅取引用不执行，无 DB 副作用。
import { renderBareRunSection } from '../../../packages/brain/src/daily-report-generator.js';

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
  // B-06: 晨报裸跑 AMBER 出口 — daily-report 接线 findBareRuns + renderBareRunSection 渲染 AMBER
  // (a) 接线断言（grep）：daily-report-generator 真 import/调用 findBareRuns 且接线 renderBareRunSection（定义+调用≥2 次）
  // (b) 渲染断言（真 PG 真实数据）：renderBareRunSection 对真实裸跑数据产出含 🟡 AMBER + 裸跑 id 的文本，
  //     不含有 run 的 id，空数组不含 AMBER 标记。镜像 B-05 双段（接线 + 真实行为），非仅函数存在。
  async b06() {
    // (a) 接线
    const src = readFileSync('packages/brain/src/daily-report-generator.js', 'utf8');
    assert(
      /from ['"][^'"]*lib\/task-run(\.js)?['"]/.test(src) && /findBareRuns\s*\(/.test(src),
      'daily-report-generator 未 import/调用 findBareRuns（晨报出口未接线检测原语）',
    );
    assert(
      (src.match(/renderBareRunSection\s*\(/g) || []).length >= 2,
      'renderBareRunSection 未定义或未被 generateDailyReport/buildReportText 调用（缺渲染接线）',
    );
    // (b) 渲染：真 PG seed 裸跑 + 有 run 的 task → findBareRuns 真实数据 → 渲染 AMBER 文本
    const bare = await seedTask();
    const ok = await seedTask();
    await pool.query(
      `INSERT INTO dispatch_events (task_id,event_type,reason) VALUES ($1,'dispatched','chk-b06-bare'),($2,'dispatched','chk-b06-ok')`,
      [bare, ok],
    );
    await startRun({ taskId: ok, runId: `b06-${randomUUID()}`, source: 'dispatcher' });
    const bareRuns = await findBareRuns(pool, { windowMinutes: 60 });
    const ids = bareRuns.map((x) => x.task_id);
    assert(ids.includes(bare), 'findBareRuns 未检出裸跑 task（渲染前提不成立）');
    assert(!ids.includes(ok), '有 run 的 task 被 findBareRuns 误报裸跑');
    const text = renderBareRunSection(bareRuns);
    assert(typeof text === 'string', `renderBareRunSection 应返回字符串，实得 ${typeof text}`);
    assert(/🟡\s*AMBER/.test(text), '裸跑 section 未含 🟡 AMBER 标记（人可见出口缺失）');
    assert(text.includes(bare), 'AMBER 文本未列出裸跑 task_id');
    assert(!text.includes(ok), '有 run 的 task_id 被误列入 AMBER 裸跑文本');
    // 无裸跑时不出现 AMBER 标记（不误报）
    const emptyText = renderBareRunSection([]);
    assert(typeof emptyText === 'string', 'renderBareRunSection([]) 应返回字符串');
    assert(!/🟡\s*AMBER/.test(emptyText), '无裸跑时输出不应含 🟡 AMBER 标记（误报）');
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
