#!/usr/bin/env node
/**
 * behavior.mjs — evaluator DoD [BEHAVIOR] oracle（sprint 08131657-kernel-9bd45a03）。
 *
 * 连 $DB_URL（Fleet 注入的 attempt 级空库，已由 ## E2E 验收 脚本 migrate），导入**真实**
 * orchestrator 模块，跑 Golden Path Step 1-6 场景：真 PG 断言 + 真 child_process spawn 真实
 * kernel-controller.js daemon（禁 mock 被改的边）。任一断言失败 → 打印 FAIL:<msg> 并 exit 1。
 *
 * 用法：node behavior.mjs <B-01|B-02|B-03|B-04|B-05|B-06|B-07|INV-1|all>
 *
 * TDD 阶段（proposer 交付时）：kernel-controller-runtime.js / kernel-controller.js 尚未实现，
 * 顶层 import / daemon spawn 即失败 → 红。generator 实现后转绿。
 */
import os from 'node:os';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import {
  deriveControllerSessionId,
  renewControllerLease,
  classifyKernelFatal,
  superviseKernelFatal,
  guardPushDuringHumanReview,
  finalizeControllerExit,
} from '../../../packages/brain/src/orchestrator/kernel-controller-runtime.js';
import { createKernelRun } from '../../../packages/brain/src/orchestrator/kernel-run-store.js';
import { reconcileOwnerlessKernelRuns } from '../../../packages/brain/src/orchestrator/kernel-controller-lifecycle.js';

const { Pool } = pg;
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '../../../');
const CONTROLLER_JS = join(REPO_ROOT, 'packages/brain/src/orchestrator/kernel-controller.js');
const HOST = os.hostname();

const DB_URL = process.env.DB_URL;
if (!DB_URL) fail('DB_URL 未注入（Fleet must inject an attempt-scoped DB_URL）');
const pool = new Pool({ connectionString: DB_URL, max: 8 });

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function seedTask() {
  const initiativeId = randomUUID();
  const taskId = randomUUID();
  await pool.query(
    `INSERT INTO tasks (id, title, status, priority, task_type, trigger_source, payload)
     VALUES ($1,$2,'in_progress','P2','harness_initiative','api',$3::jsonb)`,
    [taskId, `ctlrt-e2e-${taskId}`, JSON.stringify({ initiative_id: initiativeId })],
  );
  return { initiativeId, taskId };
}

async function ownedRun({ phase = 'planning', sid, leaseSeconds = 1800 }) {
  const { initiativeId, taskId } = await seedTask();
  const created = await createKernelRun(pool, {
    taskId, initiativeId, phase, journeyId: null, abilityId: null,
    host: 'kernel-v1', deadlineHours: 8, createdSource: 'kernel_dispatch',
    controllerSessionId: sid, controllerLeaseSeconds: leaseSeconds,
  });
  return { initiativeId, taskId, runId: created.run.id };
}

async function row(runId) {
  const { rows } = await pool.query(
    `SELECT phase, failure_reason, controller_session_id, controller_lease_expires_at,
            orchestrator_pid FROM initiative_runs WHERE id=$1`, [runId]);
  return rows[0];
}

async function spawnDaemon({ taskId, initiativeId }) {
  const daemon = spawn(process.execPath, [
    CONTROLLER_JS, '--task-id', taskId, '--initiative-id', initiativeId,
    '--test-kernel', '--renew-interval-ms', '500', '--lease-seconds', '6',
  ], { cwd: REPO_ROOT, stdio: 'inherit', env: process.env });
  return daemon;
}
async function waitFor(fn, budgetMs, label) {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`within ${budgetMs}ms 未观察到：${label}`);
    await sleep(300);
  }
}

// ── B-01: 存在活 Controller 进程 + controller_session_id 指向真身 ──────────────
async function b01() {
  const { taskId, initiativeId } = await seedTask();
  const daemon = await spawnDaemon({ taskId, initiativeId });
  try {
    const expectSid = deriveControllerSessionId({ pid: daemon.pid, host: HOST });
    const r = await waitFor(async () => {
      const { rows } = await pool.query(
        `SELECT id, controller_session_id, orchestrator_pid FROM initiative_runs
          WHERE current_task_id=$1 ORDER BY created_at DESC LIMIT 1`, [taskId]);
      const run = rows[0];
      return run && run.controller_session_id === expectSid && run.orchestrator_pid ? run : null;
    }, 30_000, 'controller_session_id 指向真身且 Kernel orchestrator_pid 落库');
    assert(r.controller_session_id.startsWith('ctrl:'), 'controller_session_id 非真身派生（应 ctrl:host:pid）');
    assert(pidAlive(daemon.pid), 'Controller 进程未存活');
    console.log(`OK: controller alive sid=${r.controller_session_id}`);
  } finally {
    try { process.kill(daemon.pid, 'SIGTERM'); } catch { /* noop */ }
  }
}

// ── B-02: lease 两周期续租单调前移 + 错误 session 续租被拒 ──────────────────────
async function b02() {
  const sid = deriveControllerSessionId({ pid: process.pid, host: HOST });
  const { runId } = await ownedRun({ sid, leaseSeconds: 5 });
  const t1 = (await row(runId)).controller_lease_expires_at;
  assert((await renewControllerLease(pool, { runId, controllerSessionId: sid, leaseSeconds: 1800 })).renewed, '第一次续租未生效');
  const t2 = (await row(runId)).controller_lease_expires_at;
  assert((await renewControllerLease(pool, { runId, controllerSessionId: sid, leaseSeconds: 3600 })).renewed, '第二次续租未生效');
  const t3 = (await row(runId)).controller_lease_expires_at;
  assert(new Date(t1) < new Date(t2) && new Date(t2) < new Date(t3), `lease 未单调前移 t1=${t1} t2=${t2} t3=${t3}`);
  const bad = await renewControllerLease(pool, { runId, controllerSessionId: 'ctrl:evil:1', leaseSeconds: 9999 });
  assert(bad.renewed === false, '错误 session 续租未被拒');
  console.log('OK: lease renewed twice t1<t2<t3');
}

// ── B-03: kill -9 Kernel（可恢复类）→ Controller resume，run 不无主 ────────────
async function b03() {
  const { taskId, initiativeId } = await seedTask();
  const daemon = await spawnDaemon({ taskId, initiativeId });
  try {
    const first = await waitFor(async () => {
      const { rows } = await pool.query(
        `SELECT id, orchestrator_pid FROM initiative_runs WHERE current_task_id=$1
          ORDER BY created_at DESC LIMIT 1`, [taskId]);
      return rows[0]?.orchestrator_pid ? rows[0] : null;
    }, 30_000, 'Kernel 首次 orchestrator_pid 落库');
    const kpid = Number(first.orchestrator_pid);
    process.kill(kpid, 9); // 真 kill -9 Kernel（可恢复类）
    const revived = await waitFor(async () => {
      const r = await row(first.id);
      const np = Number(r.orchestrator_pid);
      return (np && np !== kpid && pidAlive(np) && r.phase !== 'failed') ? r : null;
    }, 30_000, 'Controller resume 后新 Kernel pid 且 run 未 failed');
    assert(revived.controller_session_id && new Date(revived.controller_lease_expires_at) > new Date(),
      'resume 后 run 进入无主态');
    console.log('OK: recoverable resume run-not-ownerless');
  } finally {
    try { process.kill(daemon.pid, 'SIGTERM'); } catch { /* noop */ }
  }
}

// ── B-04: 不可恢复类 assembly_fault → 结构化终止 ───────────────────────────────
async function b04() {
  const sid = deriveControllerSessionId({ pid: process.pid, host: HOST });
  const { runId, taskId } = await ownedRun({ phase: 'evaluate', sid });
  assert(classifyKernelFatal('assembly_fault') === 'unrecoverable', 'assembly_fault 应归不可恢复');
  const secret = 'SECRETTOKEN424242';
  const outcome = await superviseKernelFatal(pool, {
    runId, expectedTaskId: taskId, failureClass: 'assembly_fault', failureCode: `Bearer ${secret}`,
    relaunch: async () => { throw new Error('must not relaunch'); },
  });
  assert(outcome.action === 'terminate', `不可恢复应 terminate，实际 ${outcome.action}`);
  const r = await row(runId);
  assert(r.phase === 'failed', `phase 应 failed，实际 ${r.phase}`);
  assert(r.failure_reason.startsWith('kernel_process_fatal:'), `failure_reason 前缀不符：${r.failure_reason}`);
  assert(!r.failure_reason.includes(secret), 'failure_reason 泄漏凭据明文');
  console.log('OK: unrecoverable terminate failure_reason=kernel_process_fatal:assembly_fault');
}

// ── B-05: kill -9 Controller → lease 过期 → orphan-guard 兜底接管 ──────────────
async function b05() {
  const deadSid = deriveControllerSessionId({ pid: 999999, host: 'dead-host' });
  const { runId: deadRun } = await ownedRun({ phase: 'generate', sid: deadSid, leaseSeconds: -600 });
  const healthySid = deriveControllerSessionId({ pid: process.pid, host: HOST });
  const { runId: healthyRun } = await ownedRun({ phase: 'generate', sid: healthySid, leaseSeconds: 1800 });
  const recovered = await reconcileOwnerlessKernelRuns(pool, { now: new Date() });
  const ids = recovered.map((x) => x.runId);
  assert(ids.includes(deadRun), '无主 run 未被 orphan-guard 接管');
  assert(!ids.includes(healthyRun), '健康 run 被误伤');
  const d = await row(deadRun);
  assert(d.phase === 'failed' && d.failure_reason.startsWith('ownerless_kernel_run_recovered:'), '无主 run 未 fail-closed 收敛');
  const h = await row(healthyRun);
  assert(h.phase === 'generate' && h.controller_session_id === healthySid, '健康 run 回归回退');
  console.log('OK: controller-dead lease-expired orphan-guard-reclaimed');
}

// ── B-06: human_review 冻结 push head 不漂移，裁决后解冻 ───────────────────────
async function b06() {
  const sid = deriveControllerSessionId({ pid: process.pid, host: HOST });
  const { runId, taskId } = await ownedRun({ phase: 'evaluate', sid });
  const head = 'abc123def456';
  await pool.query(`UPDATE tasks SET payload=COALESCE(payload,'{}'::jsonb)||$2::jsonb WHERE id=$1`,
    [taskId, JSON.stringify({ pr_head_sha: head })]);
  const frozen = await guardPushDuringHumanReview(pool, {
    runId, taskId, inHumanReview: true, headShaBefore: head, attemptPush: async () => ({ pushed: true }),
  });
  assert(frozen.allowed === false && frozen.rejected === true, 'human_review 期间 push 未被拒');
  const { rows: p1 } = await pool.query('SELECT payload FROM tasks WHERE id=$1', [taskId]);
  assert(p1[0].payload.pr_push_frozen === true, 'pr_push_frozen 未置 true');
  assert(p1[0].payload.pr_head_sha === head, 'head 漂移');
  const unfrozen = await guardPushDuringHumanReview(pool, {
    runId, taskId, inHumanReview: false, headShaBefore: head, attemptPush: async () => ({ pushed: true }),
  });
  assert(unfrozen.allowed === true, '裁决后 push 未放行');
  const { rows: p2 } = await pool.query('SELECT payload FROM tasks WHERE id=$1', [taskId]);
  assert(p2[0].payload.pr_push_frozen === false, '裁决后未解冻');
  console.log('OK: push-frozen-in-review head-unchanged unfrozen-after-verdict');
}

// ── B-07: merged 后回写 task.result（pr_url+merged）才退出 ─────────────────────
async function b07() {
  const sid = deriveControllerSessionId({ pid: process.pid, host: HOST });
  const { runId, taskId } = await ownedRun({ phase: 'judge', sid });
  const prUrl = 'https://github.com/perfectuser21/cecelia/pull/4999';
  const res = await finalizeControllerExit(pool, { runId, taskId, prUrl, merged: true, summary: 'guarded to merge' });
  assert(res.taskResult.pr_url === prUrl && res.taskResult.merged === true, 'finalize 返回值缺 pr_url/merged');
  const { rows } = await pool.query('SELECT result FROM tasks WHERE id=$1', [taskId]);
  assert(rows[0].result.pr_url === prUrl, 'tasks.result.pr_url 未回写');
  assert(rows[0].result.merged === true, 'tasks.result.merged 未回写');
  // 失败终局也结构化回写（禁无声消失）
  const { runId: r2, taskId: t2 } = await ownedRun({ phase: 'judge', sid });
  const fres = await finalizeControllerExit(pool, { runId: r2, taskId: t2, prUrl: null, merged: false, summary: 'failed terminal' });
  assert(fres.taskResult.merged === false, '失败终局未结构化回写');
  console.log('OK: task-result-written pr_url+merged controller-exited');
}

// ── INV-1: 无主活跃残留为 0 ──────────────────────────────────────────────────
async function inv1() {
  await b05(); // 先制造并收敛无主 run
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM initiative_runs
      WHERE phase NOT IN ('done','failed')
        AND (controller_session_id IS NULL OR controller_lease_expires_at < NOW())`);
  assert(rows[0].n === 0, `无主活跃残留 count=${rows[0].n}（应 0）`);
  console.log('OK: no-ownerless-residual count=0');
}

const SCENARIOS = { 'B-01': b01, 'B-02': b02, 'B-03': b03, 'B-04': b04, 'B-05': b05, 'B-06': b06, 'B-07': b07, 'INV-1': inv1 };

async function main() {
  const which = process.argv[2];
  if (!which) fail('用法：node behavior.mjs <B-01|...|INV-1|all>');
  const list = which === 'all' ? Object.keys(SCENARIOS) : [which];
  for (const key of list) {
    const fn = SCENARIOS[key];
    if (!fn) fail(`未知场景：${key}`);
    await fn();
  }
}

main()
  .then(async () => { await pool.end(); process.exit(0); })
  .catch(async (err) => { await pool.end().catch(() => {}); fail(err.message); });
