/**
 * [BEHAVIOR] 真身 Session Controller —— 常驻监护进程生命周期（sprint 08131657-kernel-9bd45a03）。
 *
 * 目标落位：packages/brain/src/__tests__/integration/kernel-controller-runtime.pg.integration.test.js
 * （generator 落库时与既有 kernel-controller-lifecycle/ownership 同目录，登记进 vitest.config.js 的
 *  POSTGRES_INTEGRATION_TESTS，由 brain-integration job 起真 PG 跑；本文件为 proposer TDD Red 证据）。
 *
 * 真 Postgres 集成 —— 真 migrate + 真 createKernelRun + 真 kernel-controller-runtime + 真子进程
 * spawn 真实 kernel-controller.js daemon。TDD Red：kernel-controller-runtime.js / kernel-controller.js
 * 尚未实现，import 即抛 → 全红。
 *
 * 禁 mock 边（合同「禁 mock 边清单」）：
 *  - 代码 ↔ initiative_runs（controller_session_id / controller_lease_expires_at 写读、lease 续租、phase 收敛）：真 pool 真 PG。
 *  - Controller 进程 ↔ Kernel 进程（spawn / kill -9 / resume）：真 child_process，禁 fakeChild EventEmitter。
 *  - 代码 ↔ tasks（终局 tasks.result 回写、payload.pr_push_frozen 冻结标记）：真 PG。
 *  - orphan-guard(reconcileOwnerlessKernelRuns) ↔ initiative_runs（lease 过期兜底）：真 PG（回归不回退）。
 *  本文件不含对被改边的 vi.mock（INV / 机械 grep 核查）。
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
import { createKernelRun } from '../../orchestrator/kernel-run-store.js';
import { reconcileOwnerlessKernelRuns } from '../../orchestrator/kernel-controller-lifecycle.js';
// TDD Red：下述导出尚未实现（本 sprint 交付物），import 失败即证红。
import {
  deriveControllerSessionId,
  renewControllerLease,
  classifyKernelFatal,
  superviseKernelFatal,
  guardPushDuringHumanReview,
  finalizeControllerExit,
  RECOVERABLE_KERNEL_FATAL,
  UNRECOVERABLE_KERNEL_FATAL,
} from '../../orchestrator/kernel-controller-runtime.js';

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

let adminPool;
let testPool;
let databaseName;

function quotedIdentifier(value) {
  if (!/^kernel_ctlrt_[a-z0-9_]+$/.test(value)) {
    throw new Error(`unsafe test database identifier: ${value}`);
  }
  return `"${value}"`;
}

async function createIsolatedDatabase() {
  databaseName = `kernel_ctlrt_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  adminPool = new Pool({ ...DB_DEFAULTS, database: 'postgres', max: 1, statement_timeout: 10_000 });
  await adminPool.query(`CREATE DATABASE ${quotedIdentifier(databaseName)}`);
  execFileSync(process.execPath, ['src/migrate.js'], {
    cwd: BRAIN_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DB_HOST: DB_DEFAULTS.host,
      DB_PORT: String(DB_DEFAULTS.port),
      DB_USER: DB_DEFAULTS.user,
      DB_PASSWORD: DB_DEFAULTS.password,
      DB_NAME: databaseName,
    },
    stdio: 'pipe',
  });
  testPool = new Pool({ ...DB_DEFAULTS, database: databaseName, max: 10 });
}

async function dropIsolatedDatabase() {
  if (testPool) await testPool.end().catch(() => {});
  if (adminPool && databaseName) {
    await adminPool.query('UPDATE pg_database SET datallowconn=false WHERE datname=$1', [databaseName]).catch(() => {});
    await adminPool.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
      [databaseName],
    ).catch(() => {});
    await adminPool.query(`DROP DATABASE IF EXISTS ${quotedIdentifier(databaseName)}`).catch(() => {});
  }
  if (adminPool) await adminPool.end().catch(() => {});
}

async function seedTask() {
  const initiativeId = randomUUID();
  const taskId = randomUUID();
  await testPool.query(
    `INSERT INTO tasks (id, title, status, priority, task_type, trigger_source, payload)
     VALUES ($1, $2, 'in_progress', 'P2', 'harness_initiative', 'api', $3::jsonb)`,
    [taskId, `kernel-ctlrt-${taskId}`, JSON.stringify({ initiative_id: initiativeId })],
  );
  return { initiativeId, taskId };
}

async function ownedRun({ phase = 'planning', controllerSessionId, leaseSeconds = 1800 } = {}) {
  const { initiativeId, taskId } = await seedTask();
  const created = await createKernelRun(testPool, {
    taskId,
    initiativeId,
    phase,
    journeyId: null,
    abilityId: null,
    host: 'kernel-v1',
    deadlineHours: 8,
    createdSource: 'kernel_dispatch',
    controllerSessionId,
    controllerLeaseSeconds: leaseSeconds,
  });
  return { initiativeId, taskId, runId: created.run.id };
}

async function runRow(runId) {
  const { rows } = await testPool.query(
    `SELECT phase, failure_reason, controller_session_id, controller_lease_expires_at
       FROM initiative_runs WHERE id = $1`,
    [runId],
  );
  return rows[0];
}

beforeAll(createIsolatedDatabase, 60_000);
afterAll(dropIsolatedDatabase, 30_000);

describe('真身 Session Controller 监护运行时（真 PG）', () => {
  it('deriveControllerSessionId 派生真身标识 ctrl:host:pid（非 UUID 记账）', () => {
    const sid = deriveControllerSessionId({ pid: 12345, host: 'unit-host' });
    expect(sid.startsWith('ctrl:')).toBe(true);
    expect(sid).toContain('12345');
    expect(/^[0-9a-f-]{36}$/.test(sid)).toBe(false); // 不是 randomUUID 形态
  });

  it('renewControllerLease lease 两周期续租单调前移 且错误 session 续租被拒', async () => {
    const sid = deriveControllerSessionId({ pid: process.pid, host: 'unit-host' });
    const { runId } = await ownedRun({ controllerSessionId: sid, leaseSeconds: 5 });
    const t1 = (await runRow(runId)).controller_lease_expires_at;

    const r2 = await renewControllerLease(testPool, { runId, controllerSessionId: sid, leaseSeconds: 1800 });
    expect(r2.renewed).toBe(true);
    const t2 = (await runRow(runId)).controller_lease_expires_at;

    const r3 = await renewControllerLease(testPool, { runId, controllerSessionId: sid, leaseSeconds: 3600 });
    expect(r3.renewed).toBe(true);
    const t3 = (await runRow(runId)).controller_lease_expires_at;

    expect(new Date(t1).getTime()).toBeLessThan(new Date(t2).getTime());
    expect(new Date(t2).getTime()).toBeLessThan(new Date(t3).getTime());

    // 错误 controller_session_id 续租被拒（不串台账）
    const bad = await renewControllerLease(testPool, { runId, controllerSessionId: 'ctrl:evil:1', leaseSeconds: 9999 });
    expect(bad.renewed).toBe(false);
    const t4 = (await runRow(runId)).controller_lease_expires_at;
    expect(new Date(t4).getTime()).toBe(new Date(t3).getTime()); // 未被别人续
  });

  it('classifyKernelFatal 可恢复类 resume 不可恢复类 terminate（复用现有 failure_class 枚举）', () => {
    expect(RECOVERABLE_KERNEL_FATAL.has('infrastructure_blocked')).toBe(true);
    expect(RECOVERABLE_KERNEL_FATAL.has('process_crash')).toBe(true);
    expect(UNRECOVERABLE_KERNEL_FATAL.has('assembly_fault')).toBe(true);
    expect(classifyKernelFatal('infrastructure_blocked')).toBe('recoverable');
    expect(classifyKernelFatal('assembly_fault')).toBe('unrecoverable');
    // 未知/空保守归不可恢复（不误 resume 烧算力）
    expect(classifyKernelFatal(null)).toBe('unrecoverable');
    expect(classifyKernelFatal('some_unknown_class')).toBe('unrecoverable');
  });

  it('superviseKernelFatal 可恢复 → resume 保活 run 不进入无主态', async () => {
    const sid = deriveControllerSessionId({ pid: process.pid, host: 'unit-host' });
    const { runId, taskId } = await ownedRun({ phase: 'generate', controllerSessionId: sid });
    let relaunched = 0;
    const outcome = await superviseKernelFatal(testPool, {
      runId,
      expectedTaskId: taskId,
      failureClass: 'infrastructure_blocked',
      failureCode: 'kernel_pid_gone',
      relaunch: async () => { relaunched += 1; return { pid: 424242 }; },
    });
    expect(outcome.action).toBe('resume');
    expect(relaunched).toBe(1);
    const row = await runRow(runId);
    expect(row.phase).not.toBe('failed'); // resume 保活
    expect(row.controller_session_id).toBe(sid); // ownership 存活 → 不无主
  });

  it('superviseKernelFatal 不可恢复 → 结构化终止 failed 且 failure_reason 脱敏 controller 存活', async () => {
    const sid = deriveControllerSessionId({ pid: process.pid, host: 'unit-host' });
    const { runId, taskId } = await ownedRun({ phase: 'evaluate', controllerSessionId: sid });
    const secret = 'SUPERSECRETTOKEN999';
    const outcome = await superviseKernelFatal(testPool, {
      runId,
      expectedTaskId: taskId,
      failureClass: 'assembly_fault',
      failureCode: `Bearer ${secret}`,
      relaunch: async () => { throw new Error('must not relaunch on unrecoverable'); },
    });
    expect(outcome.action).toBe('terminate');
    const row = await runRow(runId);
    expect(row.phase).toBe('failed');
    expect(row.failure_reason.startsWith('kernel_process_fatal:')).toBe(true);
    expect(row.failure_reason).not.toContain(secret); // 脱敏
    expect(row.controller_session_id).toBe(sid); // controller 存活可回传
  });

  it('kill -9 Controller → lease 过期 → orphan-guard 兜底接管收尸（回归不回退）', async () => {
    // Controller 死 = 停止续租 → 用过期 lease 模拟其死亡（真 PG）
    const deadSid = deriveControllerSessionId({ pid: 999999, host: 'dead-host' });
    const { runId: deadRun } = await ownedRun({ phase: 'generate', controllerSessionId: deadSid, leaseSeconds: -600 });
    const healthySid = deriveControllerSessionId({ pid: process.pid, host: 'unit-host' });
    const { runId: healthyRun } = await ownedRun({ phase: 'generate', controllerSessionId: healthySid, leaseSeconds: 1800 });

    const recovered = await reconcileOwnerlessKernelRuns(testPool, { now: new Date() });
    expect(recovered.map((r) => r.runId)).toContain(deadRun);
    expect(recovered.map((r) => r.runId)).not.toContain(healthyRun);

    const deadAfter = await runRow(deadRun);
    expect(deadAfter.phase).toBe('failed');
    expect(deadAfter.failure_reason.startsWith('ownerless_kernel_run_recovered:')).toBe(true);
    const healthyAfter = await runRow(healthyRun);
    expect(healthyAfter.phase).toBe('generate');
    expect(healthyAfter.controller_session_id).toBe(healthySid);

    // INV-1：无主活跃残留为 0
    const { rows } = await testPool.query(
      `SELECT count(*)::int AS n FROM initiative_runs
        WHERE phase NOT IN ('done','failed')
          AND (controller_session_id IS NULL OR controller_lease_expires_at < NOW())`,
    );
    expect(rows[0].n).toBe(0);
  });

  it('guardPushDuringHumanReview human_review 冻结 push head 不漂移 裁决后解冻', async () => {
    const sid = deriveControllerSessionId({ pid: process.pid, host: 'unit-host' });
    const { runId, taskId } = await ownedRun({ phase: 'evaluate', controllerSessionId: sid });
    const headSha = 'abc123def456';
    await testPool.query(
      `UPDATE tasks SET payload = COALESCE(payload,'{}'::jsonb) || $2::jsonb WHERE id=$1`,
      [taskId, JSON.stringify({ pr_head_sha: headSha })],
    );

    // 冻结期间 push 被拒，head 不变
    const frozen = await guardPushDuringHumanReview(testPool, {
      runId, taskId, inHumanReview: true, headShaBefore: headSha, attemptPush: async () => ({ pushed: true }),
    });
    expect(frozen.allowed).toBe(false);
    expect(frozen.rejected).toBe(true);
    const { rows: p1 } = await testPool.query('SELECT payload FROM tasks WHERE id=$1', [taskId]);
    expect(p1[0].payload.pr_push_frozen).toBe(true);
    expect(p1[0].payload.pr_head_sha).toBe(headSha); // head 不漂移

    // 裁决后解冻，push 放行
    const unfrozen = await guardPushDuringHumanReview(testPool, {
      runId, taskId, inHumanReview: false, headShaBefore: headSha, attemptPush: async () => ({ pushed: true }),
    });
    expect(unfrozen.allowed).toBe(true);
    const { rows: p2 } = await testPool.query('SELECT payload FROM tasks WHERE id=$1', [taskId]);
    expect(p2[0].payload.pr_push_frozen).toBe(false);
  });

  it('finalizeControllerExit merged 后回写 task.result（pr_url+merged）', async () => {
    const sid = deriveControllerSessionId({ pid: process.pid, host: 'unit-host' });
    const { runId, taskId } = await ownedRun({ phase: 'judge', controllerSessionId: sid });
    const prUrl = 'https://github.com/perfectuser21/cecelia/pull/4999';
    const res = await finalizeControllerExit(testPool, {
      runId, taskId, prUrl, merged: true, summary: 'controller guarded run to merge',
    });
    expect(res.taskResult.pr_url).toBe(prUrl);
    expect(res.taskResult.merged).toBe(true);
    const { rows } = await testPool.query('SELECT result FROM tasks WHERE id=$1', [taskId]);
    expect(rows[0].result.pr_url).toBe(prUrl);
    expect(rows[0].result.merged).toBe(true);

    // 失败终局也结构化回写（禁无声消失），且不覆盖已有非空 failure（幂等保护 INV-2 精神）
    const { runId: r2, taskId: t2 } = await ownedRun({ phase: 'judge', controllerSessionId: sid });
    const failRes = await finalizeControllerExit(testPool, {
      runId: r2, taskId: t2, prUrl: null, merged: false, summary: 'failed terminal',
    });
    expect(failRes.taskResult.merged).toBe(false);
    const { rows: fr } = await testPool.query('SELECT result FROM tasks WHERE id=$1', [t2]);
    expect(fr[0].result.merged).toBe(false);
    expect(typeof fr[0].result.summary).toBe('string');
  });
});
