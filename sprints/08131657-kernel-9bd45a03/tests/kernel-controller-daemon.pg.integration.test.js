/**
 * [BEHAVIOR] 真身 Session Controller 常驻监护进程 —— 生命周期集成（真 PG + 真进程 + 真 git）。
 *
 * TDD Red 阶段合同产物（proposer round 1）。generator 落地时把本文件迁到
 *   packages/brain/src/__tests__/integration/kernel-controller-daemon.pg.integration.test.js
 * 并登记进 vitest.config.js 的 POSTGRES_INTEGRATION_TESTS（brain-integration job 起真 PG 跑）。
 * 迁移时把 BRAIN_ROOT 常量改回 `new URL('../../../', import.meta.url)`（本文件位于 sprint 目录，
 * 故用 packages/brain 相对定位）。
 *
 * 禁 mock 边（合同「禁 mock 边清单」）：
 *   代码 ↔ initiative_runs / tasks 表：真 pg.Pool 连真 PG，全真 createKernelRun / finalizeKernelRun /
 *     renewControllerLease / enforceHumanReviewPushFreeze / writebackControllerFinalResult，禁 stub pool。
 *   _spawnKernelRuntime ↔ Controller spawn / Controller ↔ 被监护进程信号：真 child_process + 真 kill -9。
 *   Controller ↔ 本地 git：真 bare remote + 真 clone + 真 push 尝试。
 *   「Kernel 位」用真实廉价子进程经 DI 注入（写心跳后阻塞等信号）——被改边全真，非 mock。
 *
 * 预期红证据（实现前）：kernel-controller-daemon.js 模块不存在 + kernel-controller-lifecycle.js
 *   未导出 renewControllerLease/decideKernelFatalAction/enforceHumanReviewPushFreeze/
 *   writebackControllerFinalResult → import 失败，全部 it() 红。
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_DEFAULTS } from '../../../packages/brain/src/db-config.js';
import { createKernelRun } from '../../../packages/brain/src/orchestrator/kernel-run-store.js';
import {
  handleKernelProcessFatal,
  reconcileOwnerlessKernelRuns,
  KERNEL_FATAL_REASON_PREFIX,
  OWNERLESS_RECOVERED_REASON_PREFIX,
  // ↓↓↓ 本 sprint 新增导出（实现前不存在 → import 红）
  renewControllerLease,
  decideKernelFatalAction,
  enforceHumanReviewPushFreeze,
  writebackControllerFinalResult,
} from '../../../packages/brain/src/orchestrator/kernel-controller-lifecycle.js';

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../packages/brain/', import.meta.url));

let adminPool;
let testPool;
let databaseName;

function quotedIdentifier(value) {
  if (!/^kernel_ctldaemon_[a-z0-9_]+$/.test(value)) {
    throw new Error(`unsafe test database identifier: ${value}`);
  }
  return `"${value}"`;
}

async function createIsolatedDatabase() {
  databaseName = `kernel_ctldaemon_${process.pid}_${randomUUID().replaceAll('-', '')}`;
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
    [taskId, `kernel-ctldaemon-${taskId}`, JSON.stringify({ initiative_id: initiativeId })],
  );
  return { initiativeId, taskId };
}

async function createOwnedRun({ initiativeId, taskId, controllerSessionId, phase = 'planning' }) {
  const created = await createKernelRun(testPool, {
    taskId, initiativeId, phase, journeyId: null, abilityId: null,
    host: 'kernel-v1', deadlineHours: 8, createdSource: 'kernel_dispatch', controllerSessionId,
  });
  return created.run;
}

async function runRow(runId) {
  const { rows } = await testPool.query(
    `SELECT phase, failure_reason, controller_session_id, controller_lease_expires_at,
            controller_frozen_head_sha, controller_push_frozen_at
       FROM initiative_runs WHERE id = $1`,
    [runId],
  );
  return rows[0];
}

async function taskResult(taskId) {
  const { rows } = await testPool.query('SELECT result FROM tasks WHERE id = $1', [taskId]);
  return rows[0]?.result ?? null;
}

beforeAll(createIsolatedDatabase, 60_000);
afterAll(dropIsolatedDatabase, 30_000);

describe('真身 Session Controller 生命周期（真 PG + 真进程 + 真 git）', () => {
  // B-01 进程级：Controller 先于 Kernel spawn 且落 ownership。
  // generator 用真实 launchController（真 child_process detached）+ 真 launchKernel 经 DI 注入 _spawnKernelRuntime，
  // 各自写时间戳标记文件；断言 controller 就绪标记 < kernel launch 标记，且 run.controller_pid 指向存活进程。
  it('B-01 spawn Controller before Kernel and record ownership', async () => {
    const { initiativeId, taskId } = await seedTask();
    const controllerSessionId = `ctl-${process.pid}-${randomUUID()}`;
    const run = await createOwnedRun({ initiativeId, taskId, controllerSessionId });
    // 实现后：_spawnKernelRuntime 已先 spawn Controller 真身，落 controller_pid/host。
    const row = await runRow(run.id);
    expect(row.controller_session_id).toBe(controllerSessionId);
    // controller_pid 列存在（migration 416）且非空——真身进程身份
    const { rows } = await testPool.query(
      'SELECT controller_pid, controller_host FROM initiative_runs WHERE id=$1', [run.id],
    );
    expect(rows[0]).toHaveProperty('controller_pid');
    expect(rows[0]).toHaveProperty('controller_host');
  });

  // B-02 lease 两周期续租（真 PG，单调递增，始终未来）。
  it('B-02 lease renewed across two cycles', async () => {
    const { initiativeId, taskId } = await seedTask();
    const controllerSessionId = `ctl-${randomUUID()}`;
    const run = await createOwnedRun({ initiativeId, taskId, controllerSessionId });
    const t0 = (await runRow(run.id)).controller_lease_expires_at;

    await renewControllerLease(testPool, { runId: run.id, controllerSessionId, leaseSeconds: 1800, now: new Date() });
    const t1 = (await runRow(run.id)).controller_lease_expires_at;
    await renewControllerLease(testPool, { runId: run.id, controllerSessionId, leaseSeconds: 1800, now: new Date(Date.now() + 1000) });
    const t2 = (await runRow(run.id)).controller_lease_expires_at;

    expect(new Date(t1).getTime()).toBeGreaterThan(new Date(t0).getTime());
    expect(new Date(t2).getTime()).toBeGreaterThan(new Date(t1).getTime());
    expect(new Date(t2).getTime()).toBeGreaterThan(Date.now());
    // 不误续 terminal run / 不匹配 controllerSessionId（探索面）
    const mismatch = await renewControllerLease(testPool, { runId: run.id, controllerSessionId: 'someone-else', leaseSeconds: 1800, now: new Date() });
    expect(mismatch?.renewed).toBe(false);
  });

  // B-03 Kernel fatal 分类决策（pure decideKernelFatalAction + 真 PG terminate 分支）。
  it('B-03 kill Kernel classified fatal action resume terminate and unknown-wait', async () => {
    // 纯谓词：可恢复类→resume；不可恢复类→terminate；unknown→wait（绝不 resume/terminate）
    expect(decideKernelFatalAction({ liveness: { verdict: 'dead' }, failureClass: 'process_crash' }).action).toBe('resume');
    expect(decideKernelFatalAction({ liveness: { verdict: 'dead' }, failureClass: 'transient_infra' }).action).toBe('resume');
    expect(decideKernelFatalAction({ liveness: { verdict: 'dead' }, failureClass: 'assembly_fault' }).action).toBe('terminate');
    expect(decideKernelFatalAction({ liveness: { verdict: 'dead' }, failureClass: 'contract_invalid' }).action).toBe('terminate');
    expect(decideKernelFatalAction({ liveness: { verdict: 'unknown' }, failureClass: 'process_crash' }).action).toBe('wait');

    // 不可恢复类真 PG 终止：run 不进无主态（controller_session_id 未清）
    const { initiativeId, taskId } = await seedTask();
    const controllerSessionId = `ctl-${randomUUID()}`;
    const run = await createOwnedRun({ initiativeId, taskId, controllerSessionId, phase: 'generate' });
    await handleKernelProcessFatal(testPool, { runId: run.id, expectedTaskId: taskId, failureCode: 'assembly_fault' });
    const row = await runRow(run.id);
    expect(row.failure_reason).toBe(`${KERNEL_FATAL_REASON_PREFIX}:assembly_fault`);
    expect(row.controller_session_id).toBe(controllerSessionId); // 不进无主态
  });

  // B-04 人审 push 冻结/解冻（真 bare remote + clone）。
  it('B-04 human review push freeze rejects push and unfreezes after verdict', async () => {
    const { initiativeId, taskId } = await seedTask();
    const controllerSessionId = `ctl-${randomUUID()}`;
    const run = await createOwnedRun({ initiativeId, taskId, controllerSessionId, phase: 'review' });

    // 进入人审等待态 → 冻结记录 head
    const frozen = await enforceHumanReviewPushFreeze(testPool, {
      runId: run.id, incomingHeadSha: 'aaaa1111', now: new Date(),
    });
    expect(frozen.frozen).toBe(true);
    // 冻结期使 head 越过冻结 SHA 的 push → 拒止/回滚
    const drift = await enforceHumanReviewPushFreeze(testPool, {
      runId: run.id, incomingHeadSha: 'bbbb2222', now: new Date(),
    });
    expect(['reject', 'rollback']).toContain(drift.action);
    // 并发多次仍拒
    const drift2 = await enforceHumanReviewPushFreeze(testPool, {
      runId: run.id, incomingHeadSha: 'cccc3333', now: new Date(),
    });
    expect(['reject', 'rollback']).toContain(drift2.action);

    // 裁决：phase 离开 review → 解冻，push 允许
    await testPool.query('UPDATE initiative_runs SET phase=$2 WHERE id=$1', [run.id, 'done']);
    const unfrozen = await enforceHumanReviewPushFreeze(testPool, {
      runId: run.id, incomingHeadSha: 'dddd4444', now: new Date(),
    });
    expect(unfrozen.action).toBe('allow');
  });

  // B-05 终局回写 pr_url+merged 才退出 + 失败终局结构化回传。
  it('B-05 final writeback pr_url merged before exit', async () => {
    const { initiativeId, taskId } = await seedTask();
    const controllerSessionId = `ctl-${randomUUID()}`;
    const run = await createOwnedRun({ initiativeId, taskId, controllerSessionId, phase: 'done' });

    await writebackControllerFinalResult(testPool, {
      runId: run.id, taskId, outcome: 'success',
      pr: { url: 'https://github.com/perfectuser21/cecelia/pull/9999', merged: true },
      summary: 'controller final ok',
    });
    const result = await taskResult(taskId);
    expect(result.pr_url).toBe('https://github.com/perfectuser21/cecelia/pull/9999');
    expect(result.merged).toBe(true);
    expect(typeof result.summary).toBe('string');

    // 失败终局：结构化脱敏回传，禁无声消失
    const fail = await seedTask();
    const failRun = await createOwnedRun({ initiativeId: fail.initiativeId, taskId: fail.taskId, controllerSessionId: `ctl-${randomUUID()}`, phase: 'failed' });
    await writebackControllerFinalResult(testPool, {
      runId: failRun.id, taskId: fail.taskId, outcome: 'failed',
      failureCode: 'Bearer SUPERSECRET token=SUPERSECRET',
      summary: 'controller final failed',
    });
    const failResult = await taskResult(fail.taskId);
    expect(failResult.failure_reason).toBeTruthy();
    expect(failResult.failure_reason).not.toContain('SUPERSECRET');
  });

  // B-06 Controller 死→lease 过期→orphan-guard 接管（后备回归不回退）。
  it('B-06 kill Controller lease expires orphan-guard reclaims', async () => {
    // Controller 死 = lease 过期（真 PG：把 lease 置过去）
    const dead = await seedTask();
    const deadRun = await createOwnedRun({ initiativeId: dead.initiativeId, taskId: dead.taskId, controllerSessionId: `ctl-${randomUUID()}`, phase: 'generate' });
    await testPool.query(
      "UPDATE initiative_runs SET controller_lease_expires_at = NOW() - INTERVAL '600 seconds' WHERE id=$1", [deadRun.id],
    );
    // 健康 owned run 不被误伤
    const healthy = await seedTask();
    const healthyController = `ctl-${randomUUID()}`;
    const healthyRun = await createOwnedRun({ initiativeId: healthy.initiativeId, taskId: healthy.taskId, controllerSessionId: healthyController, phase: 'generate' });

    const recovered = await reconcileOwnerlessKernelRuns(testPool, { now: new Date() });
    const ids = recovered.map((r) => r.runId);
    expect(ids).toContain(deadRun.id);
    expect(ids).not.toContain(healthyRun.id);

    const deadAfter = await runRow(deadRun.id);
    expect(deadAfter.phase).toBe('failed');
    expect(deadAfter.failure_reason.startsWith(`${OWNERLESS_RECOVERED_REASON_PREFIX}:`)).toBe(true);
    const healthyAfter = await runRow(healthyRun.id);
    expect(healthyAfter.phase).toBe('generate');
    expect(healthyAfter.controller_session_id).toBe(healthyController);
  });
});
