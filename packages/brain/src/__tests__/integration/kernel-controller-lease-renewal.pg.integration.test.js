/**
 * [BEHAVIOR] Controller lease heartbeat 续租 + CAS fail-closed（真 PG，RED-1/2/3/5）
 * sprint 08132021-controller-lease-renewal-r2 —— run 60fa6c43 实证根因：
 *   heartbeat.js 的 UPDATE 从不延长 controller_lease_expires_at，心跳跨过 30m lease
 *   仍被 reconcileOwnerlessKernelRuns 当无主取消（Generator 034b5ca7 被杀）。
 *
 * 本文件是「禁 mock 边清单」的执法测试：代码 ↔ initiative_runs（controller lease 读写）
 * 走真 pg.Pool 连真 PostgreSQL；createKernelRun / writeHeartbeat / reconcileOwnerlessKernelRuns
 * 全真代码路径，禁 vi.mock('pg') / stub 被改的 DB 写边。30m 边界用注入 now 确定性跨越
 * （lease 默认 1800s，注入 now = 建 run + 31min 即已越界），不靠真实等待。
 *
 * TDD 顺序：
 *   Commit A（此文件）: 现网 writeHeartbeat 无 controllerSessionId 入参、不写 lease、
 *                       不返回 rowCount → 全部断言 FAIL（红证据）。
 *   Commit B（修复）:   writeHeartbeat 续租 CAS + GREATEST，测试转绿。
 *
 * 永久回归位（sprint frozen 版在 sprints/08132021-controller-lease-renewal-r2/tests/），
 * 登记进 packages/brain/vitest.config.js 的 POSTGRES_INTEGRATION_TESTS，
 * 由 CI brain-integration job 起真 PG 常驻跑。
 *
 * 禁止：vi.mock('pg') / jest.mock('pg') / stub writeHeartbeat / stub reconciler。
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  finalizeKernelRun,
  CONTROLLER_LEASE_DEFAULT_SECONDS,
} from '../../orchestrator/kernel-run-store.js';
import { writeHeartbeat } from '../../orchestrator/heartbeat.js';
import { reconcileOwnerlessKernelRuns } from '../../orchestrator/kernel-controller-lifecycle.js';
import { runLoop } from '../../orchestrator/loop.js';
import {
  createKernelLeasePgFixture,
  LEASE,
  MIN,
} from './kernel-controller-lease-renewal.pg-fixture.js';

const fixture = createKernelLeasePgFixture();
let testPool;

const {
  auditEvents,
  installRejectingAuditTrigger,
  leaseOf,
  removeRejectingAuditTrigger,
  seedOwnedRun,
  waitForBlockedFinalize,
} = fixture;

beforeAll(async () => {
  await fixture.createIsolatedDatabase();
  testPool = fixture.pool();
}, 60_000);
afterAll(() => fixture.dropIsolatedDatabase(), 30_000);

describe('Controller lease heartbeat 续租 CAS（真 PG）', () => {
  it('RED-1: 正确 session 心跳跨过 30m 边界 → lease 随心跳前移、run 保持 active、reconcile 回收数=0', async () => {
    const session = randomUUID();
    const { runId } = await seedOwnedRun({ controllerSessionId: session });
    const before = await leaseOf(runId);

    // 建 run 31 分钟后（已越过 30m/1800s 原始 lease）心跳一次
    const now1 = new Date(Date.parse(before.controller_lease_expires_at) - LEASE * 1000 + 31 * MIN);
    const res = await writeHeartbeat(testPool, {
      runId, host: 'kernel-v1', pid: 4242, now: now1, controllerSessionId: session,
    });
    expect(res.rowCount).toBe(1); // CAS 命中：正确 session + 活跃 phase

    const after = await leaseOf(runId);
    // GREATEST(existing, now+lease) → lease 前移到 now1 + LEASE，已晚于 now1（未过期）
    expect(Date.parse(after.controller_lease_expires_at)).toBe(now1.getTime() + LEASE * 1000);
    expect(Date.parse(after.controller_lease_expires_at)).toBeGreaterThan(now1.getTime());
    expect(after.phase).not.toBe('done');
    expect(after.phase).not.toBe('failed');

    // 心跳后紧接 reconcile（同一 now 语义）→ 该 run 不被判无主
    const recovered = await reconcileOwnerlessKernelRuns(testPool, { now: new Date(now1.getTime() + 1000) });
    expect(recovered.map((r) => r.runId)).not.toContain(runId);
  });

  it('RED-1b: lease 只增不减（GREATEST）——过去时刻心跳不得缩短已有租约', async () => {
    const session = randomUUID();
    const { runId } = await seedOwnedRun({ controllerSessionId: session });
    const before = await leaseOf(runId);
    const past = new Date(Date.parse(before.controller_lease_expires_at) - LEASE * 1000 - 5 * MIN);
    const res = await writeHeartbeat(testPool, {
      runId, host: 'kernel-v1', pid: 4242, now: past, controllerSessionId: session,
    });
    expect(res.rowCount).toBe(1);
    const after = await leaseOf(runId);
    // now(past)+LEASE < 原 lease → GREATEST 保留原 lease，不回缩
    expect(Date.parse(after.controller_lease_expires_at)).toBe(Date.parse(before.controller_lease_expires_at));
  });

  it('AUDIT-1: 成功续租每个 hop 恰写一条幂等事件，错误 session/终态零假事件且 payload 不泄露 session', async () => {
    const session = `controller-secret-${randomUUID()}`;
    const { runId, taskId } = await seedOwnedRun({ controllerSessionId: session });
    const heartbeatAt = new Date('2026-08-14T01:02:03.456Z');

    const first = await writeHeartbeat(testPool, {
      runId, host: 'kernel-audit', pid: 4242, now: heartbeatAt, controllerSessionId: session,
    });
    const replay = await writeHeartbeat(testPool, {
      runId, host: 'kernel-audit', pid: 4242, now: heartbeatAt, controllerSessionId: session,
    });
    expect(first.rowCount).toBe(1);
    expect(replay.rowCount).toBe(1);

    const events = await auditEvents(runId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event_type: 'kernel_controller_lease_renewed',
      source: 'kernel_orchestrator',
      task_id: taskId,
    });
    expect(events[0].payload).toMatchObject({
      run_id: runId,
      task_id: taskId,
      heartbeat_at: heartbeatAt.toISOString(),
      host: 'kernel-audit',
      pid: 4242,
    });
    expect(JSON.stringify(events[0].payload)).not.toContain(session);

    const forged = await seedOwnedRun({ controllerSessionId: randomUUID() });
    const forgedResult = await writeHeartbeat(testPool, {
      runId: forged.runId,
      host: 'kernel-audit',
      pid: 4242,
      now: heartbeatAt,
      controllerSessionId: 'forged-wrong-session',
    });
    expect(forgedResult.rowCount).toBe(0);
    expect(await auditEvents(forged.runId)).toEqual([]);

    const terminalSession = randomUUID();
    const terminal = await seedOwnedRun({ controllerSessionId: terminalSession });
    await finalizeKernelRun(testPool, {
      runId: terminal.runId,
      expectedTaskId: terminal.taskId,
      outcome: 'failed',
      reason: 'audit-terminal-fixture',
    });
    const terminalResult = await writeHeartbeat(testPool, {
      runId: terminal.runId,
      host: 'kernel-audit',
      pid: 4242,
      now: heartbeatAt,
      controllerSessionId: terminalSession,
    });
    expect(terminalResult.rowCount).toBe(0);
    expect(await auditEvents(terminal.runId)).toEqual([]);
  });

  it('AUDIT-2: ownerless recovery 仅在真实终态改变时写一条事件，重复巡检不重复且 payload 无 session', async () => {
    const session = `controller-secret-${randomUUID()}`;
    const { runId, taskId } = await seedOwnedRun({ controllerSessionId: session });
    const reconcileNow = new Date('2026-08-14T03:00:00.000Z');
    await testPool.query(
      `UPDATE initiative_runs
          SET controller_lease_expires_at = $2
        WHERE id = $1`,
      [runId, new Date(reconcileNow.getTime() - MIN)],
    );

    const first = await reconcileOwnerlessKernelRuns(testPool, { now: reconcileNow });
    const replay = await reconcileOwnerlessKernelRuns(testPool, { now: reconcileNow });
    expect(first.map((row) => row.runId)).toContain(runId);
    expect(replay.map((row) => row.runId)).not.toContain(runId);

    const events = await auditEvents(runId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event_type: 'kernel_ownerless_run_recovered',
      source: 'kernel_controller_lifecycle',
      task_id: taskId,
    });
    expect(events[0].payload).toMatchObject({
      run_id: runId,
      task_id: taskId,
      cause: 'controller_lease_expired',
    });
    expect(JSON.stringify(events[0].payload)).not.toContain(session);
  });

  it('AUDIT-3: 审计 INSERT 失败必须回滚对应续租或 recovery 状态改变', async () => {
    const heartbeatSession = randomUUID();
    const heartbeatRun = await seedOwnedRun({ controllerSessionId: heartbeatSession });
    const heartbeatBefore = await leaseOf(heartbeatRun.runId);
    const heartbeatAt = new Date('2026-08-14T04:00:00.000Z');

    try {
      await installRejectingAuditTrigger('kernel_controller_lease_renewed');
      await expect(writeHeartbeat(testPool, {
        runId: heartbeatRun.runId,
        host: 'kernel-audit-rollback',
        pid: 4242,
        now: heartbeatAt,
        controllerSessionId: heartbeatSession,
      })).rejects.toThrow('forced kernel audit failure');
    } finally {
      await removeRejectingAuditTrigger();
    }
    const heartbeatAfter = await leaseOf(heartbeatRun.runId);
    expect(heartbeatAfter.orchestrator_heartbeat_at).toBeNull();
    expect(Date.parse(heartbeatAfter.controller_lease_expires_at))
      .toBe(Date.parse(heartbeatBefore.controller_lease_expires_at));

    const recoverySession = randomUUID();
    const recoveryRun = await seedOwnedRun({ controllerSessionId: recoverySession });
    const reconcileNow = new Date('2026-08-14T05:00:00.000Z');
    await testPool.query(
      `UPDATE initiative_runs
          SET controller_lease_expires_at = $2
        WHERE id = $1`,
      [recoveryRun.runId, new Date(reconcileNow.getTime() - MIN)],
    );
    try {
      await installRejectingAuditTrigger('kernel_ownerless_run_recovered');
      const recovered = await reconcileOwnerlessKernelRuns(testPool, { now: reconcileNow });
      expect(recovered.map((row) => row.runId)).not.toContain(recoveryRun.runId);
    } finally {
      await removeRejectingAuditTrigger();
    }
    const recoveryAfter = await leaseOf(recoveryRun.runId);
    expect(recoveryAfter.phase).toBe('planning');
    expect(recoveryAfter.task_status).toBe('in_progress');
    expect(await auditEvents(recoveryRun.runId)).toEqual([]);
  });

  it('RED-2 + RED-5(mismatch): 错误 session 心跳 → CAS rowCount=0、lease 不动、无主 run 仍被 reconcile fail-closed 回收', async () => {
    const session = randomUUID();
    const { runId } = await seedOwnedRun({ controllerSessionId: session });
    const before = await leaseOf(runId);
    const now1 = new Date(Date.parse(before.controller_lease_expires_at) - LEASE * 1000 + 31 * MIN);

    const res = await writeHeartbeat(testPool, {
      runId, host: 'kernel-v1', pid: 4242, now: now1, controllerSessionId: 'forged-wrong-session',
    });
    expect(res.rowCount).toBe(0); // 伪造 session 不得续租

    const after = await leaseOf(runId);
    expect(Date.parse(after.controller_lease_expires_at)).toBe(Date.parse(before.controller_lease_expires_at));

    // lease 已过期（now1 越界）且续租失败 → reconcile 仍把该无主 run fail-closed 回收
    const recovered = await reconcileOwnerlessKernelRuns(testPool, { now: new Date(now1.getTime() + 1000) });
    expect(recovered.map((r) => r.runId)).toContain(runId);
    const reclaimed = await leaseOf(runId);
    expect(reclaimed.phase).toBe('failed');
  });

  it('RED-3: phase=failed 的 run 心跳 → rowCount=0，lease 不复活', async () => {
    const session = randomUUID();
    const { runId, taskId } = await seedOwnedRun({ controllerSessionId: session });
    const before = await leaseOf(runId);
    await finalizeKernelRun(testPool, {
      runId, expectedTaskId: taskId, outcome: 'failed', reason: 'test_terminal',
    });

    const now1 = new Date(Date.parse(before.controller_lease_expires_at) - LEASE * 1000 + 31 * MIN);
    const res = await writeHeartbeat(testPool, {
      runId, host: 'kernel-v1', pid: 4242, now: now1, controllerSessionId: session,
    });
    expect(res.rowCount).toBe(0); // 终态 run 不得被心跳复活

    const after = await leaseOf(runId);
    expect(after.phase).toBe('failed');
    expect(Date.parse(after.controller_lease_expires_at)).toBe(Date.parse(before.controller_lease_expires_at));
  });

  it('RED-3b: leaseSeconds 复用单一 SSOT——省略 leaseSeconds 时续租默认用 CONTROLLER_LEASE_DEFAULT_SECONDS', async () => {
    const session = randomUUID();
    const { runId } = await seedOwnedRun({ controllerSessionId: session });
    const before = await leaseOf(runId);
    const now1 = new Date(Date.parse(before.controller_lease_expires_at) - LEASE * 1000 + 31 * MIN);
    const res = await writeHeartbeat(testPool, {
      runId, host: 'kernel-v1', pid: 4242, now: now1, controllerSessionId: session,
    });
    expect(res.rowCount).toBe(1);
    const after = await leaseOf(runId);
    expect(Date.parse(after.controller_lease_expires_at)).toBe(now1.getTime() + CONTROLLER_LEASE_DEFAULT_SECONDS * 1000);
  });

  it('RACE-A: reconcile 旧快照无权终结随后已被正确 heartbeat 续租的 run', async () => {
    const session = randomUUID();
    const { runId, taskId } = await seedOwnedRun({ controllerSessionId: session });
    const reconcileNow = new Date();
    await testPool.query(
      `UPDATE initiative_runs
          SET controller_lease_expires_at = $2
        WHERE id = $1`,
      [runId, new Date(reconcileNow.getTime() - MIN)],
    );

    const blocker = await testPool.connect();
    let reconcilePromise;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM tasks WHERE id = $1 FOR UPDATE', [taskId]);

      reconcilePromise = reconcileOwnerlessKernelRuns(testPool, { now: reconcileNow });
      await waitForBlockedFinalize();

      const heartbeatAt = new Date(reconcileNow.getTime() + MIN);
      const heartbeat = await writeHeartbeat(testPool, {
        runId,
        host: 'kernel-race-heartbeat-wins',
        pid: 4242,
        now: heartbeatAt,
        controllerSessionId: session,
      });
      expect(heartbeat.rowCount).toBe(1);

      await blocker.query('COMMIT');
      const recovered = await reconcilePromise;
      const after = await leaseOf(runId);

      expect(recovered.map((row) => row.runId)).not.toContain(runId);
      expect(Date.parse(after.controller_lease_expires_at)).toBeGreaterThan(reconcileNow.getTime());
      expect(after.phase).toBe('planning');
      expect(after.task_status).toBe('in_progress');
      expect(after.failure_reason).toBeNull();
      const events = await auditEvents(runId);
      expect(events.filter(({ event_type: type }) => type === 'kernel_controller_lease_renewed')).toHaveLength(1);
      expect(events.filter(({ event_type: type }) => type === 'kernel_ownerless_run_recovered')).toHaveLength(0);
    } finally {
      await blocker.query('ROLLBACK').catch(() => {});
      blocker.release();
      await reconcilePromise?.catch(() => {});
    }
  });

  it('RACE-A reverse: reconcile 先终结时随后的正确 heartbeat 不得复活 run', async () => {
    const session = randomUUID();
    const { runId } = await seedOwnedRun({ controllerSessionId: session });
    const reconcileNow = new Date();
    await testPool.query(
      `UPDATE initiative_runs
          SET controller_lease_expires_at = $2
        WHERE id = $1`,
      [runId, new Date(reconcileNow.getTime() - MIN)],
    );

    const recovered = await reconcileOwnerlessKernelRuns(testPool, { now: reconcileNow });
    expect(recovered.map((row) => row.runId)).toContain(runId);

    const heartbeat = await writeHeartbeat(testPool, {
      runId,
      host: 'kernel-race-reconcile-wins',
      pid: 4242,
      now: new Date(reconcileNow.getTime() + MIN),
      controllerSessionId: session,
    });
    const after = await leaseOf(runId);

    expect(heartbeat.rowCount).toBe(0);
    expect(after.phase).toBe('failed');
    expect(after.task_status).toBe('failed');
  });

  it('OWNERSHIP-B: 错误 session 在首次 collect/append/dispatch 前失败并零业务动作', async () => {
    const session = randomUUID();
    const { runId, taskId } = await seedOwnedRun({ controllerSessionId: session });
    const collect = vi.fn(async () => ({
      run: { id: runId, phase: 'planning', cost_usd: 0 },
      task: { id: taskId, status: 'in_progress' },
      prdExists: false,
      contract: { approved: false, id: null },
      pr: null,
      inflight: { containers: [], host_pids: [], attempts: [] },
      lastAgentExit: { code: null, auth_failed: false },
      proposeBranchRn: 0,
      ganLatestRoundVerdict: null,
      generatorSpawned: false,
      evaluateVerdict: null,
      judgeVerdict: null,
      reviewRequired: false,
      reviewApproved: false,
      decisionLog: [],
      authCircuit: [],
      callbackResult: null,
    }));
    const append = vi.fn(async () => {});
    const dispatch = vi.fn(async () => ({ status: 'DONE', detail: 'must-not-run' }));
    let hop = 0;

    const result = await runLoop({
      pool: testPool,
      collectGroundTruth: collect,
      appendHop: append,
      nextHop: vi.fn(async () => ++hop),
      dispatch,
      sleep: vi.fn(async () => {}),
      now: () => new Date(),
      host: 'kernel-wrong-owner',
      pid: 4242,
      log: vi.fn(),
    }, {
      taskId,
      runId,
      controllerSessionId: 'forged-wrong-session',
    });

    const { rows } = await testPool.query(
      `SELECT orchestrator_heartbeat_at, phase
         FROM initiative_runs
        WHERE id = $1`,
      [runId],
    );
    expect(result).toEqual({ exitReason: 'controller_lease_lost', hops: 0 });
    expect(collect).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(rows[0].orchestrator_heartbeat_at).toBeNull();
    expect(rows[0].phase).toBe('planning');
  });

});
