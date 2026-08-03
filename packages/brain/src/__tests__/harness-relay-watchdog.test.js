/**
 * relay watchdog（重点火循环产品化）+ PATCH phase 白名单扩展（进度条数据源）。
 *
 * 背景（eval-1 实证）：relay session 会在 25-47 turns 后自判完成早退（prompt 拦不住），
 * 根治 = 外部有界重点火——外部真相接续已四次实证，重点火即免费恢复。
 * relay-loop.sh 雏形一轮收敛；本文件将其产品化进 harness watchdog 独立循环。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPool, mockRaise } = vi.hoisted(() => ({
  mockPool: { query: vi.fn() },
  mockRaise: vi.fn(),
}));
vi.mock('../db.js', () => ({ default: mockPool }));
vi.mock('../notifier.js', () => ({ sendBark: vi.fn().mockResolvedValue(true) }));
vi.mock('../alerting.js', () => ({ raise: mockRaise }));
vi.mock('../orchestrator/kernel-run-store.js', () => ({
  patchKernelRunById: async (db, input) => {
    await db.query(
      `UPDATE initiative_runs SET phase='${input.phase}',
         ${input.failureReason ? `failure_reason=COALESCE(failure_reason, '${input.failureReason}'),` : ''}
         pr_url=COALESCE(pr_url, $2) WHERE id=$1`,
      [input.runId, input.prUrl],
    );
    await db.query(
      `UPDATE tasks SET status='${input.phase === 'done' ? 'completed' : 'failed'}'`,
    );
    return { id: input.runId, phase: input.phase };
  },
}));

import { resumeStalledRelayRuns, MAX_RELAY_ATTEMPTS, scanStuckHarness } from '../harness-relay-watchdog.js';
import { sendBark } from '../notifier.js';

const TASK_ID = 'aaaabbbb-cccc-dddd-eeee-ffff00001111';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const SHORT = 'aaaabbbb';

const PR_URL = 'https://github.com/org/repo/pull/42';

function makeDeps({
  taskStatus = 'in_progress',
  attempts = 2,
  containerRunning = false,
  orchestrator = 'skill-relay',
  prUrl = null,
  prState = null,   // 'MERGED' | 'OPEN' | 'CLOSED' | null（execFn 返回的 gh pr view JSON）
  orchestratorHost = 'skill-relay-session',
  evaluatorGate = true, // initiative_run_events 是否存在 node='evaluator' AND status='done'
  mergeStateStatus = undefined, // 'BEHIND' | 'CLEAN' | undefined（gh pr view mergeStateStatus）
  ciChecks = undefined,         // CheckRow[] | undefined（gh pr checks --json state）
  harnessRuntime = null,
  latestAttempt = null,
  orchestratorHeartbeatAt = null,
} = {}) {
  const pool = { query: vi.fn() };
  pool.query.mockImplementation(async (sql, params = []) => {
    if (/FROM initiative_runs r/.test(sql)) {
      return { rows: [{ id: RUN_ID, initiative_id: TASK_ID, current_task_id: TASK_ID, phase: 'planning', attempts: String(attempts), deadline_at: new Date(Date.now() + 3600e3).toISOString(), pr_url: prUrl, orchestrator_host: orchestratorHost, orchestrator_heartbeat_at: orchestratorHeartbeatAt }] };
    }
    if (/FROM tasks/.test(sql)) {
      return { rows: [{ id: TASK_ID, status: taskStatus, title: 't', payload: { orchestrator, ...(harnessRuntime ? { harness_runtime: harnessRuntime } : {}) } }] };
    }
    if (/SELECT GREATEST\(/.test(sql)) {
      return { rows: [{ next_hop: Number(latestAttempt?.hop ?? 1) + 1 }] };
    }
    if (/INSERT INTO orchestrator_decision_log/.test(sql)) {
      return { rows: [{ hop: params[1] }] };
    }
    if (
      /WITH guarded_run AS \([\s\S]*inserted AS \(\s*INSERT INTO harness_attempts/.test(sql)
    ) {
      return {
        rows: [{
          id: params[0],
          run_id: params[1],
          hop: params[2],
          status: 'queued',
          local_container_naming: params[9],
          task_bundle: params[13],
          callback_secret_hash: params[14],
          logical_cycle_id: params[15],
          attempt_kind: params[16],
          retry_of_attempt_id: params[17],
        }],
      };
    }
    if (/UPDATE harness_attempts\s+SET callback_secret_hash/.test(sql)) {
      return {
        rows: [{
          ...latestAttempt,
          status: 'starting',
          lease_owner: params[1],
          lease_generation: params[3],
          callback_secret_hash: params[2],
        }],
      };
    }
    if (/UPDATE harness_attempts\s+SET status = 'starting'/.test(sql)) {
      if (/lease_generation = lease_generation \+ 1/.test(sql)) {
        return {
          rows: [{
            ...latestAttempt,
            status: 'starting',
            lease_owner: params[1],
            lease_generation: Number(latestAttempt?.lease_generation ?? 0) + 1,
          }],
        };
      }
      return {
        rows: [{
          id: params[0],
          status: 'starting',
          lease_owner: params[1],
          lease_generation: 0,
        }],
      };
    }
    if (/UPDATE harness_attempts\s+SET status = \$2/.test(sql)) {
      return {
        rows: [{
          ...latestAttempt,
          status: params[1],
          error_code: params[2],
        }],
      };
    }
    if (/FROM harness_attempts/.test(sql)) {
      return { rows: latestAttempt ? [latestAttempt] : [] };
    }
    if (/FROM initiative_run_events/.test(sql)) {
      return { rows: evaluatorGate ? [{ x: 1 }] : [] };
    }
    return { rows: [] };
  });
  const execFn = vi.fn().mockImplementation((cmd) => {
    if (/docker ps/.test(cmd)) return containerRunning ? 'abc123\n' : '';
    if (/gh pr view/.test(cmd) && prState) {
      // 若命令含 mergeStateStatus 字段请求，则回传 mergeStateStatus（如提供）
      if (/mergeStateStatus/.test(cmd) && mergeStateStatus !== undefined) {
        return JSON.stringify({ state: prState, mergeStateStatus });
      }
      return JSON.stringify({ state: prState });
    }
    if (/gh pr checks/.test(cmd)) {
      if (ciChecks !== undefined) return JSON.stringify(ciChecks);
      return JSON.stringify([]);
    }
    return '';
  });
  return {
    pool,
    execFn,
    spawnFn: vi.fn().mockResolvedValue({ ok: true, containerId: 'cecelia-relay-x' }),
  };
}

beforeEach(() => {
  mockPool.query.mockReset();
  mockRaise.mockReset();
  mockRaise.mockResolvedValue(undefined);
  sendBark.mockClear();
});

describe('scanStuckHarness — 逾期收尸 host 覆盖', () => {
  it('SQL host 过滤覆盖所有 skill-relay host(含 claude-headed/session)，非写死 skill-relay-codex = RED', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await scanStuckHarness({ pool });
    const sql = pool.query.mock.calls[0]?.[0] || '';
    // 当前 WHERE orchestrator_host = 'skill-relay-codex' → claude-headed/session 逾期永不收尸
    expect(sql).toMatch(/skill-relay%/);                  // 期望 LIKE 'skill-relay%' 覆盖全部 host
    expect(sql).not.toMatch(/=\s*'skill-relay-codex'/);   // 不应写死单一 codex host
  });

  function reviewPausePool({ prUrl = PR_URL, reviewHeadSha = 'a'.repeat(40) } = {}) {
    const overdueRun = {
      id: '11111111-1111-4111-8111-111111111111',
      initiative_id: TASK_ID,
      current_task_id: TASK_ID,
      orchestrator_host: 'skill-relay-session',
      phase: 'review',
      deadline_at: new Date(Date.now() - 1000).toISOString(),
      pr_url: prUrl,
    };
    const pool = { query: vi.fn(async (sql) => {
      const normalized = String(sql);
      if (/SELECT id, initiative_id, current_task_id, orchestrator_host, phase, deadline_at/.test(normalized)) {
        const sqlHidesOpenReviews = /effect:human_review_requested/.test(normalized);
        return { rows: sqlHidesOpenReviews ? [] : [overdueRun] };
      }
      if (/FROM orchestrator_decision_log review_request/.test(normalized)) {
        return {
          rows: [{
            review_request_hop: 7,
            review_head_sha: reviewHeadSha,
          }],
        };
      }
      if (/UPDATE initiative_runs/.test(normalized)) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }) };
    return { overdueRun, pool };
  }

  it('开放 kernel 人审仅在 request SHA 与 GitHub 当前 head 对账后暂停收尸', async () => {
    const reviewHeadSha = 'a'.repeat(40);
    const { pool } = reviewPausePool({ reviewHeadSha });
    const resolvePrHead = vi.fn(async () => reviewHeadSha);

    await scanStuckHarness({ pool, resolvePrHead });

    expect(resolvePrHead).toHaveBeenCalledWith(PR_URL);
    expect(pool.query.mock.calls.some(
      ([sql]) => /UPDATE initiative_runs/.test(sql) && /phase\s*=\s*'failed'/.test(sql),
    )).toBe(false);
  });

  it('abandoned review whose request SHA no longer matches GitHub is collected', async () => {
    const { pool } = reviewPausePool({ reviewHeadSha: 'a'.repeat(40) });
    const resolvePrHead = vi.fn(async () => 'b'.repeat(40));

    await scanStuckHarness({ pool, resolvePrHead });

    expect(resolvePrHead).toHaveBeenCalledWith(PR_URL);
    expect(pool.query.mock.calls.some(
      ([sql]) => /UPDATE initiative_runs/.test(sql) && /phase\s*=\s*'failed'/.test(sql),
    )).toBe(true);
  });

  it('review request without a PR URL cannot pause deadline cleanup', async () => {
    const { pool } = reviewPausePool({ prUrl: null });
    const resolvePrHead = vi.fn();

    await scanStuckHarness({ pool, resolvePrHead });

    expect(resolvePrHead).not.toHaveBeenCalled();
    expect(pool.query.mock.calls.some(
      ([sql]) => /UPDATE initiative_runs/.test(sql) && /phase\s*=\s*'failed'/.test(sql),
    )).toBe(true);
  });

  it('GitHub resolver failure defers cleanup until a later watchdog pass', async () => {
    const { pool } = reviewPausePool();
    const resolvePrHead = vi.fn(async () => {
      throw new Error('GitHub rate limited');
    });

    await scanStuckHarness({ pool, resolvePrHead });

    expect(resolvePrHead).toHaveBeenCalledWith(PR_URL);
    expect(pool.query.mock.calls.some(
      ([sql]) => /UPDATE initiative_runs/.test(sql) && /phase\s*=\s*'failed'/.test(sql),
    )).toBe(false);
  });
});

describe('resumeStalledRelayRuns', () => {
  it('kernel-v1 有可恢复 session 时启动继承 parent 的新 child attempt', async () => {
    const resumeAttempt = vi.fn(async (_child, context) => {
      await context.onRecoveryAlert({
        kind: 'cleanup_unconfirmed',
        attemptId: 'child-alert-attempt',
        lifecycleCode: 'resume_child_cleanup_unconfirmed',
        cleanupStatus: 'missing',
        diagnostic: 'exact cleanup not confirmed',
      });
      return { ok: true, resumed: true };
    });
    const deps = makeDeps({
      harnessRuntime: 'kernel-v1',
      orchestratorHost: 'kernel-v1',
      latestAttempt: {
        id: '22222222-2222-4222-8222-222222222222',
        run_id: '11111111-1111-4111-8111-111111111111',
        hop: 1,
        phase: 'evaluate',
        role: 'evaluator',
        provider: 'codex',
        task_bundle: {},
        callback_secret_hash: 'old-hash',
        lease_owner: 'dispatcher-parent',
        lease_generation: 0,
        logical_cycle_id: 'intent:11111111-1111-4111-8111-111111111111:1',
        workstream_key: 'ws1',
        provider_session_id: 'thread-1',
        status: 'running',
        lease_expires_at: new Date(Date.now() - 60_000).toISOString(),
      },
    });
    deps.resumeAttempt = resumeAttempt;
    deps.launchKernel = vi.fn();

    const result = await resumeStalledRelayRuns(deps);

    expect(resumeAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.not.stringMatching(/^22222222/),
        retry_of_attempt_id: '22222222-2222-4222-8222-222222222222',
      }),
      expect.objectContaining({
        parentAttempt: expect.objectContaining({
          id: '22222222-2222-4222-8222-222222222222',
          lease_owner: expect.stringMatching(/^watchdog:/),
          lease_generation: 1,
        }),
        originalParentAttempt: expect.objectContaining({
          id: '22222222-2222-4222-8222-222222222222',
          provider_session_id: 'thread-1',
          lease_owner: 'dispatcher-parent',
          lease_generation: 0,
        }),
        reclaimedParentAttempt: expect.objectContaining({
          id: '22222222-2222-4222-8222-222222222222',
          provider_session_id: 'thread-1',
          lease_owner: expect.stringMatching(/^watchdog:/),
          lease_generation: 1,
        }),
        callbackSecret: expect.any(String),
        onRecoveryAlert: expect.any(Function),
      }),
    );
    expect(deps.launchKernel).not.toHaveBeenCalled();
    expect(deps.spawnFn).not.toHaveBeenCalled();
    expect(result.resumed).toBe(1);
    expect(mockRaise).toHaveBeenCalledWith(
      'P1',
      'kernel_recovery_cleanup_unconfirmed',
      expect.stringContaining('attempt=child-alert-attempt'),
    );
  });

  it('Fleet watchdog delegates an expired provider session to the unified controller without remote cleanup or reclaim', async () => {
    const latestAttempt = {
      id: '22222222-2222-4222-8222-222222222222',
      run_id: RUN_ID,
      hop: 1,
      phase: 'generate',
      role: 'generator',
      provider: 'codex',
      provider_session_id: 'thread-fleet-parent',
      execution_transport: 'fleet-worker',
      status: 'running',
      lease_owner: 'dispatcher-parent',
      lease_generation: 0,
      lease_expires_at: new Date(Date.now() - 60_000).toISOString(),
    };
    const deps = makeDeps({
      harnessRuntime: 'kernel-v1',
      orchestratorHost: 'kernel-v1',
      latestAttempt,
    });
    deps.launcher = {
      inspect: vi.fn(),
      cancel: vi.fn(),
    };
    deps.resumeAttempt = vi.fn();
    deps.launchKernel = vi.fn(async () => ({ pid: 7272 }));

    const result = await resumeStalledRelayRuns(deps);

    expect(deps.launcher.inspect).not.toHaveBeenCalled();
    expect(deps.launcher.cancel).not.toHaveBeenCalled();
    expect(deps.resumeAttempt).not.toHaveBeenCalled();
    expect(deps.pool.query.mock.calls.some(([sql]) => (
      /lease_generation = lease_generation \+ 1/.test(String(sql))
    ))).toBe(false);
    expect(deps.launchKernel).toHaveBeenCalledOnce();
    expect(result.resumed).toBe(1);
  });

  it('kernel-v1 无可恢复 session 时重启 reconcile，由外部真相推导新 hop', async () => {
    const deps = makeDeps({
      harnessRuntime: 'kernel-v1',
      orchestratorHost: 'kernel-v1',
      latestAttempt: {
        id: '22222222-2222-4222-8222-222222222222',
        run_id: '11111111-1111-4111-8111-111111111111',
        role: 'planner',
        provider: 'claude',
        provider_session_id: null,
        status: 'failed',
        lease_expires_at: null,
      },
    });
    deps.resumeAttempt = vi.fn();
    deps.launchKernel = vi.fn(async () => ({ pid: 5252 }));

    const result = await resumeStalledRelayRuns(deps);

    expect(deps.resumeAttempt).not.toHaveBeenCalled();
    expect(deps.launchKernel).toHaveBeenCalledWith(expect.objectContaining({
      taskId: TASK_ID,
      runId: '11111111-1111-4111-8111-111111111111',
    }));
    expect(deps.spawnFn).not.toHaveBeenCalled();
    expect(result.resumed).toBe(1);
  });

  it('expired Fleet attempt without a provider session restarts the controller without DB-only failure', async () => {
    const deps = makeDeps({
      harnessRuntime: 'kernel-v1',
      orchestratorHost: 'kernel-v1',
      latestAttempt: {
        id: '22222222-2222-4222-8222-222222222222',
        run_id: RUN_ID,
        role: 'generator',
        provider: 'codex',
        provider_session_id: null,
        execution_transport: 'fleet-worker',
        status: 'running',
        lease_owner: 'dispatcher-parent',
        lease_generation: 0,
        lease_expires_at: new Date(Date.now() - 60_000).toISOString(),
      },
    });
    deps.resumeAttempt = vi.fn();
    deps.launchKernel = vi.fn(async () => ({ pid: 6262 }));

    const result = await resumeStalledRelayRuns(deps);

    expect(deps.resumeAttempt).not.toHaveBeenCalled();
    expect(deps.launchKernel).toHaveBeenCalledOnce();
    expect(deps.pool.query.mock.calls.some(([sql]) => (
      String(sql).includes("error_code='recovery_without_session'")
    ))).toBe(false);
    expect(result.resumed).toBe(1);
  });

  it('kernel-v1 attempt lease 仍有效时不恢复、不重启', async () => {
    const deps = makeDeps({
      harnessRuntime: 'kernel-v1',
      orchestratorHost: 'kernel-v1',
      latestAttempt: {
        id: '22222222-2222-4222-8222-222222222222',
        provider_session_id: 'thread-live',
        status: 'running',
        lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    deps.resumeAttempt = vi.fn();
    deps.launchKernel = vi.fn();

    await resumeStalledRelayRuns(deps);

    expect(deps.resumeAttempt).not.toHaveBeenCalled();
    expect(deps.launchKernel).not.toHaveBeenCalled();
    expect(deps.spawnFn).not.toHaveBeenCalled();
  });

  it('kernel-v1 原 reconcile 心跳仍新鲜时不 resume、不重拉第二个进程', async () => {
    const deps = makeDeps({
      harnessRuntime: 'kernel-v1',
      orchestratorHost: 'kernel-v1',
      orchestratorHeartbeatAt: new Date(Date.now() - 30_000).toISOString(),
      latestAttempt: {
        id: '22222222-2222-4222-8222-222222222222',
        provider_session_id: 'thread-stale-lease',
        status: 'running',
        lease_expires_at: new Date(Date.now() - 60_000).toISOString(),
      },
    });
    deps.resumeAttempt = vi.fn();
    deps.launchKernel = vi.fn();

    await resumeStalledRelayRuns(deps);

    expect(deps.resumeAttempt).not.toHaveBeenCalled();
    expect(deps.launchKernel).not.toHaveBeenCalled();
  });

  it('kernel-v1 resume reclaim 冲突时让位，不并发启动新 reconcile', async () => {
    const deps = makeDeps({
      harnessRuntime: 'kernel-v1',
      orchestratorHost: 'kernel-v1',
      latestAttempt: {
        id: '22222222-2222-4222-8222-222222222222',
        provider_session_id: 'thread-raced',
        provider: 'codex',
        task_bundle: {},
        status: 'running',
        lease_expires_at: new Date(Date.now() - 60_000).toISOString(),
      },
    });
    deps.resumeAttempt = vi.fn(async () => ({ ok: false, reason: 'attempt_lease_conflict' }));
    deps.launchKernel = vi.fn();

    await resumeStalledRelayRuns(deps);

    expect(deps.resumeAttempt).toHaveBeenCalledOnce();
    expect(deps.launchKernel).not.toHaveBeenCalled();
  });

  it('in_progress + 无在跑容器 + attempts < 上限 → 重点火一次', async () => {
    const deps = makeDeps();
    const r = await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).toHaveBeenCalledOnce();
    const [taskArg] = deps.spawnFn.mock.calls[0];
    expect(taskArg.id).toBe(TASK_ID);
    expect(r.resumed).toBe(1);
    // 容器存活检查用 name 前缀过滤（spawn 命名规约 cecelia-relay-<task8去横杠>-）
    const execCall = deps.execFn.mock.calls[0][0];
    expect(execCall).toContain(`cecelia-relay-${SHORT}`);
  });

  it('有在跑容器 → 跳过不重点火', async () => {
    const deps = makeDeps({ containerRunning: true });
    const r = await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).not.toHaveBeenCalled();
    expect(r.resumed).toBe(0);
  });

  it('attempts 达上限 → 标 run failed + task failed，不重点火', async () => {
    const deps = makeDeps({ attempts: MAX_RELAY_ATTEMPTS });
    const r = await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).not.toHaveBeenCalled();
    expect(r.capped).toBe(1);
    const updates = deps.pool.query.mock.calls.map(c => c[0]).filter(s => /UPDATE/.test(s));
    expect(updates.some(s => /initiative_runs/.test(s) && /'failed'/.test(s))).toBe(true);
    expect(updates.some(s => /UPDATE tasks/.test(s))).toBe(true);
  });

  it('task 已 completed → run 行收敛为 done（house-keeping），不重点火', async () => {
    const deps = makeDeps({ taskStatus: 'completed' });
    const r = await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).not.toHaveBeenCalled();
    const updates = deps.pool.query.mock.calls.map(c => c[0]).filter(s => /UPDATE initiative_runs/.test(s));
    expect(updates.some(s => /'done'/.test(s))).toBe(true);
    expect(r.housekept).toBe(1);
  });

  it.each(['cancelled', 'canceled'])(
    'task %s → run 原子收敛 failed/task_cancelled 且保留任务取消态',
    async (taskStatus) => {
      const deps = makeDeps({ taskStatus });
      const r = await resumeStalledRelayRuns(deps);
      const runUpdate = deps.pool.query.mock.calls.find(([sql]) => (
        /UPDATE initiative_runs/.test(sql) && /task_cancelled/.test(sql)
      ));
      expect(runUpdate).toBeTruthy();
      expect(r.housekept).toBe(1);
      expect(deps.spawnFn).not.toHaveBeenCalled();
    },
  );

  it('payload 非 skill-relay → 跳过（安全护栏，不碰 v1 任务）', async () => {
    const deps = makeDeps({ orchestrator: null });
    const r = await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).not.toHaveBeenCalled();
    expect(r.resumed).toBe(0);
  });

  it('task queued → 跳过（dispatcher 自然路径负责，防双 spawn）', async () => {
    const deps = makeDeps({ taskStatus: 'queued' });
    await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).not.toHaveBeenCalled();
  });

  it('容器消失 + pr_url 存在 + PR MERGED → 标 completed/done，不重点火', async () => {
    const deps = makeDeps({ prUrl: PR_URL, prState: 'MERGED' });
    const r = await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).not.toHaveBeenCalled();
    expect(r.resumed).toBe(0);
    // 必须调用 gh pr view 查状态
    const ghCall = deps.execFn.mock.calls.find(c => /gh pr view/.test(c[0]));
    expect(ghCall).toBeTruthy();
    expect(ghCall[0]).toContain(PR_URL);
    // task → completed
    const updates = deps.pool.query.mock.calls.map(c => c[0]);
    expect(updates.some(s => /UPDATE tasks/.test(s) && /'completed'/.test(s))).toBe(true);
    // run → done
    expect(updates.some(s => /UPDATE initiative_runs/.test(s) && /'done'/.test(s))).toBe(true);
    expect(r.mergedPr).toBe(1);
  });

  it('容器消失 + pr_url 存在 + PR OPEN → 跳过不重点火（在途 PR 等 CI/merge）', async () => {
    const deps = makeDeps({ prUrl: PR_URL, prState: 'OPEN' });
    const r = await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).not.toHaveBeenCalled();
    expect(r.resumed).toBe(0);
    expect(r.mergedPr).toBe(0);
  });

  // ── GP-1～GP-4：OPEN PR 死局解除（d3343415）────────────────────────────────

  it('GP-1：容器消失 + PR OPEN + mergeStateStatus=BEHIND → 重点火（resume_ci_red）', async () => {
    const deps = makeDeps({ prUrl: PR_URL, prState: 'OPEN', mergeStateStatus: 'BEHIND', ciChecks: [] });
    const r = await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).toHaveBeenCalledOnce();
    expect(r.resumed).toBe(1);
    const logCalls = deps.execFn.mock.calls.map(c => c[0]);
    // 验证走了 mergeStateStatus 扩展查询
    expect(logCalls.some(c => /mergeStateStatus/.test(c))).toBe(true);
  });

  it('GP-2：容器消失 + PR OPEN + CI FAILURE → 重点火（resume_ci_red）', async () => {
    const deps = makeDeps({ prUrl: PR_URL, prState: 'OPEN', mergeStateStatus: 'CLEAN', ciChecks: [{ state: 'FAILURE' }] });
    const r = await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).toHaveBeenCalledOnce();
    expect(r.resumed).toBe(1);
  });

  it('GP-3：容器消失 + PR OPEN + CI pending → 跳过（wait_ci_running）', async () => {
    const deps = makeDeps({ prUrl: PR_URL, prState: 'OPEN', mergeStateStatus: 'CLEAN', ciChecks: [{ state: 'IN_PROGRESS' }] });
    const r = await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).not.toHaveBeenCalled();
    expect(r.resumed).toBe(0);
  });

  it('GP-4：PR OPEN + BEHIND + attempts >= 上限 → 不重点火（熔断优先）', async () => {
    const deps = makeDeps({ prUrl: PR_URL, prState: 'OPEN', mergeStateStatus: 'BEHIND', ciChecks: [], attempts: MAX_RELAY_ATTEMPTS });
    const r = await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).not.toHaveBeenCalled();
    expect(r.capped).toBe(1);
  });

  // ── end GP-1～GP-4 ───────────────────────────────────────────────────────────

  it('容器消失 + pr_url 存在 + gh pr view 抛错 → 保守跳过（不盲目重点火）', async () => {
    const pool = makeDeps().pool;
    pool.query.mockImplementation(async (sql) => {
      if (/FROM initiative_runs r/.test(sql)) {
        return { rows: [{ id: RUN_ID, initiative_id: TASK_ID, current_task_id: TASK_ID, phase: 'planning', attempts: '2', deadline_at: new Date(Date.now() + 3600e3).toISOString(), pr_url: PR_URL }] };
      }
      if (/FROM tasks/.test(sql)) {
        return { rows: [{ id: TASK_ID, status: 'in_progress', title: 't', payload: { orchestrator: 'skill-relay' } }] };
      }
      return { rows: [] };
    });
    const execFn = vi.fn().mockImplementation((cmd) => {
      if (/docker ps/.test(cmd)) return '';
      if (/gh pr view/.test(cmd)) throw new Error('gh: not found');
    });
    const r = await resumeStalledRelayRuns({ pool, execFn, spawnFn: vi.fn() });
    expect(r.resumed).toBe(0);
    expect(r.mergedPr).toBe(0);
  });

  it('容器消失 + pr_url 为 null → 直接走重点火（不调 gh pr view）', async () => {
    const deps = makeDeps({ prUrl: null });
    await resumeStalledRelayRuns(deps);
    const ghCall = deps.execFn.mock.calls.find(c => /gh pr view/.test(c[0]));
    expect(ghCall).toBeFalsy();
    expect(deps.spawnFn).toHaveBeenCalledOnce();
  });

  it('容器消失 + pr_url 存在 + PR MERGED + evaluator 从未执行 → 标 done 但打 failure_reason，不触发 regression 提升，发告警', async () => {
    const deps = makeDeps({ prUrl: PR_URL, prState: 'MERGED', evaluatorGate: false });
    const r = await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).not.toHaveBeenCalled();
    const updates = deps.pool.query.mock.calls.map(c => c[0]);
    expect(updates.some(s => /UPDATE initiative_runs/.test(s) && /'done'/.test(s) && /failure_reason/.test(s) && /merged_without_evaluator_gate/.test(s))).toBe(true);
    expect(updates.some(s => /UPDATE tasks/.test(s) && /'completed'/.test(s))).toBe(true);
    expect(r.mergedWithoutGate).toBe(1);
    expect(updates.some(s => /INSERT INTO issues/.test(s))).toBe(true);
    expect(sendBark).toHaveBeenCalled();
  });
});

describe('foreground 护栏（刀2：前台建档 run 不得被重点火）', () => {
  it('orchestrator_host=foreground 且容器消失 → 跳过，不 spawn', async () => {
    const deps = makeDeps({ orchestratorHost: 'foreground', containerRunning: false });
    const out = await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).not.toHaveBeenCalled();
    expect(out.resumed).toBe(0);
  });

  it('对照：普通 relay run 容器消失仍会重点火（护栏不误伤）', async () => {
    const deps = makeDeps({ orchestratorHost: 'skill-relay-session', containerRunning: false });
    await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).toHaveBeenCalled();
  });
});

describe('patrol 排除 v2（relay watchdog 独占管辖）', () => {
  it('harness-initiative-patrol 扫描 SQL 排除 orchestrator_version=v2', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../harness-initiative-patrol.js', import.meta.url), 'utf8');
    expect(src).toMatch(/orchestrator_version IS DISTINCT FROM 'v2'/);
  });
});

describe('watchdog loop 接线', () => {
  it('runHarnessWatchdogOnce 调用 relay watchdog 且日志行含 relay=', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../harness-watchdog-loop.js', import.meta.url), 'utf8');
    expect(src).toMatch(/resumeStalledRelayRuns/);
    expect(src).toMatch(/relay=\$\{/);
  });
});

describe('PATCH phase 白名单扩展（进度条数据源）', () => {
  it('中间态 planning/gan/generate/evaluate 可写（不再仅 done/failed）', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../routes/initiatives.js', import.meta.url), 'utf8');
    // 白名单包含 312 枚举中间态 + 终态
    for (const ph of ['planning', 'gan', 'generate', 'evaluate', 'done', 'failed']) {
      expect(src, `PATCH 白名单缺 ${ph}`).toMatch(new RegExp(`ALLOWED[^\\]]*'${ph}'`));
    }
  });
});

// ── 新增：pr_url fallback 链 + PATCH pr_url 写入 ─────────────────────

describe('resumeStalledRelayRuns — pr_url fallback 链（#3560 跟进）', () => {
  it('taskQ SELECT 含 pr_url 列', async () => {
    // run.pr_url=null → 需要从 tasks.pr_url 取，所以 SELECT 必须含该列
    const taskSqls = [];
    const pool = {
      query: vi.fn(async (sql) => {
        if (/FROM initiative_runs r/.test(sql)) {
          return { rows: [{ id: RUN_ID, initiative_id: TASK_ID, current_task_id: TASK_ID, phase: 'generate', attempts: '1', deadline_at: null, pr_url: null }] };
        }
        if (/FROM tasks/.test(sql)) {
          taskSqls.push(sql);
          return { rows: [{ id: TASK_ID, status: 'in_progress', title: 't', pr_url: null, payload: { orchestrator: 'skill-relay' } }] };
        }
        return { rows: [] };
      }),
    };
    const execFn = vi.fn((cmd) => {
      if (/docker ps/.test(cmd)) return '';
      return '';
    });
    await resumeStalledRelayRuns({ pool, execFn, spawnFn: vi.fn().mockResolvedValue({ ok: true }) });
    expect(taskSqls.length).toBeGreaterThan(0);
    expect(taskSqls[0]).toMatch(/\bpr_url\b/);
  });

  it('run.pr_url=null，tasks.pr_url 有值 → MERGED → 标 completed，不重点火', async () => {
    const TASK_PR = 'https://github.com/owner/repo/pull/42';
    const updates = [];
    const pool = {
      query: vi.fn(async (sql, _params) => {
        if (/FROM initiative_runs r/.test(sql)) {
          return { rows: [{ id: RUN_ID, initiative_id: TASK_ID, current_task_id: TASK_ID, phase: 'generate', attempts: '1', deadline_at: null, pr_url: null }] };
        }
        if (/FROM tasks/.test(sql)) {
          return { rows: [{ id: TASK_ID, status: 'in_progress', title: 't', pr_url: TASK_PR, payload: { orchestrator: 'skill-relay' } }] };
        }
        if (/UPDATE/.test(sql)) { updates.push(sql); return { rows: [{ id: TASK_ID }] }; }
        return { rows: [] };
      }),
    };
    const ghCalls = [];
    const execFn = vi.fn((cmd) => {
      if (/docker ps/.test(cmd)) return '';
      if (/gh pr view/.test(cmd)) { ghCalls.push(cmd); return JSON.stringify({ state: 'MERGED' }); }
      return '';
    });
    const spawnFn = vi.fn().mockResolvedValue({ ok: true });

    const out = await resumeStalledRelayRuns({ pool, execFn, spawnFn });

    expect(ghCalls.length).toBeGreaterThan(0);
    expect(ghCalls[0]).toContain(TASK_PR);
    expect(spawnFn).not.toHaveBeenCalled();
    expect(out.mergedPr).toBe(1);
    expect(updates.some((s) => /initiative_runs/.test(s) && /'done'/.test(s))).toBe(true);
    expect(updates.some((s) => /UPDATE tasks/.test(s) && /'completed'/.test(s))).toBe(true);
  });

  it('run.pr_url=null, tasks.pr_url=null, payload.pr_url 有值 → MERGED → 标 completed', async () => {
    const PAYLOAD_PR = 'https://github.com/owner/repo/pull/99';
    const updates = [];
    const pool = {
      query: vi.fn(async (sql, _params) => {
        if (/FROM initiative_runs r/.test(sql)) {
          return { rows: [{ id: RUN_ID, initiative_id: TASK_ID, current_task_id: TASK_ID, phase: 'generate', attempts: '1', deadline_at: null, pr_url: null }] };
        }
        if (/FROM tasks/.test(sql)) {
          return { rows: [{ id: TASK_ID, status: 'in_progress', title: 't', pr_url: null, payload: { orchestrator: 'skill-relay', pr_url: PAYLOAD_PR } }] };
        }
        if (/UPDATE/.test(sql)) { updates.push(sql); return { rows: [{ id: TASK_ID }] }; }
        return { rows: [] };
      }),
    };
    const ghCalls = [];
    const execFn = vi.fn((cmd) => {
      if (/docker ps/.test(cmd)) return '';
      if (/gh pr view/.test(cmd)) { ghCalls.push(cmd); return JSON.stringify({ state: 'MERGED' }); }
      return '';
    });
    const spawnFn = vi.fn().mockResolvedValue({ ok: true });

    const out = await resumeStalledRelayRuns({ pool, execFn, spawnFn });

    expect(ghCalls.length).toBeGreaterThan(0);
    expect(ghCalls[0]).toContain(PAYLOAD_PR);
    expect(spawnFn).not.toHaveBeenCalled();
    expect(out.mergedPr).toBe(1);
  });
});

describe('PATCH /orchestrator/relay-runs — pr_url 字段写入（#3560 跟进）', () => {
  it('PATCH handler 从 req.body 解构 pr_url', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../routes/initiatives.js', import.meta.url), 'utf8');
    const patchIdx = src.indexOf('function validateRunPatchBody');
    expect(patchIdx).toBeGreaterThan(-1);
    const block = src.slice(patchIdx, patchIdx + 1500);
    expect(block).toMatch(/pr_url/);
  });

  it('PATCH handler 校验 pr_url 须以 https://github.com/ 开头（非法时 400）', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../routes/initiatives.js', import.meta.url), 'utf8');
    const patchIdx = src.indexOf('function validateRunPatchBody');
    const block = src.slice(patchIdx, patchIdx + 1500);
    expect(block).toMatch(/https:\/\/github\.com\//);
    expect(block).toMatch(/400/);
  });

  it('PATCH UPDATE SQL 用 COALESCE 保护 pr_url（只增不清）', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../orchestrator/kernel-run-store.js', import.meta.url), 'utf8');
    const patchIdx = src.indexOf('export async function patchKernelRunById');
    const block = src.slice(patchIdx, patchIdx + 3000);
    expect(block).toMatch(/COALESCE/i);
    expect(block).toMatch(/pr_url/);
  });
});

// ── proven-to-fire: evaluator gate 三函数单元测试 ────────────────────────

import { _hasEvaluatorGate, _raiseUngatedMergeAlert, _finalizeMergedRun } from '../harness-relay-watchdog.js';

describe('_hasEvaluatorGate', () => {
  it('initiative_run_events 有 evaluator done 记录 → true', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }) };
    const result = await _hasEvaluatorGate(pool, 'test-id');
    expect(result).toBe(true);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/initiative_run_events/);
    expect(sql).toMatch(/node='evaluator'/);
    expect(sql).toMatch(/status='done'/);
    expect(params[0]).toBe('test-id');
  });

  it('initiative_run_events 无 evaluator done 记录 → false', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const result = await _hasEvaluatorGate(pool, 'test-id');
    expect(result).toBe(false);
  });
});

describe('_raiseUngatedMergeAlert', () => {
  it('写入 issues 表 + 调 sendBark（两路 best-effort）', async () => {
    vi.clearAllMocks();
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await _raiseUngatedMergeAlert(pool, 'initiative-abc', 'https://github.com/x/y/pull/1');
    expect(pool.query).toHaveBeenCalledOnce();
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO issues/);
    expect(params[0]).toMatch(/initiative-abc/);
    expect(sendBark).toHaveBeenCalledOnce();
  });

  it('issues 写入失败 → 仍调 sendBark（fail-open）', async () => {
    vi.clearAllMocks();
    const pool = { query: vi.fn().mockRejectedValue(new Error('DB down')) };
    await expect(_raiseUngatedMergeAlert(pool, 'x', 'https://github.com/x/y/pull/2')).resolves.toBeUndefined();
    expect(sendBark).toHaveBeenCalledOnce();
  });
});

describe('_finalizeMergedRun', () => {
  it('gated=true → UPDATE 不含 failure_reason，调 promoteRegression', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    // evaluatorGate=true: initiative_run_events 有记录
    pool.query.mockImplementation(async (sql) => {
      if (/initiative_run_events/.test(sql)) return { rows: [{ x: 1 }] };
      return { rows: [] };
    });
    const out = { mergedPr: 0, mergedWithoutGate: 0 };
    await _finalizeMergedRun(pool, { id: RUN_ID, initiative_id: 'init-1', current_task_id: 'task-1' }, 'https://github.com/x/y/pull/3', out);
    expect(out.mergedPr).toBe(1);
    const updates = pool.query.mock.calls.map(c => c[0]).filter(s => /UPDATE initiative_runs/.test(s));
    expect(updates.length).toBeGreaterThan(0);
    expect(updates.every(s => !/failure_reason/.test(s))).toBe(true);
    const exactUpdate = pool.query.mock.calls.find(([sql]) => /UPDATE initiative_runs/.test(sql));
    expect(exactUpdate[0]).toMatch(/WHERE\s+id\s*=\s*\$1/);
    expect(exactUpdate[1][0]).toBe(RUN_ID);
  });

  it('gated=false → UPDATE 含 failure_reason=merged_without_evaluator_gate，mergedWithoutGate++', async () => {
    vi.clearAllMocks();
    const pool = { query: vi.fn().mockImplementation(async (sql) => {
      if (/initiative_run_events/.test(sql)) return { rows: [] }; // no evaluator gate
      return { rows: [] };
    })};
    const out = { mergedPr: 0, mergedWithoutGate: 0 };
    await _finalizeMergedRun(pool, { id: RUN_ID, initiative_id: 'init-2', current_task_id: 'task-2' }, 'https://github.com/x/y/pull/4', out);
    expect(out.mergedPr).toBe(1);
    expect(out.mergedWithoutGate).toBe(1);
    const updates = pool.query.mock.calls.map(c => c[0]).filter(s => /UPDATE initiative_runs/.test(s));
    expect(updates.some(s => /failure_reason/.test(s) && /merged_without_evaluator_gate/.test(s))).toBe(true);
    expect(sendBark).toHaveBeenCalled();
  });

  it('setPrUrl=true → pr_url 写进 UPDATE', async () => {
    vi.clearAllMocks();
    const pool = { query: vi.fn().mockImplementation(async (sql) => {
      if (/initiative_run_events/.test(sql)) return { rows: [{ x: 1 }] };
      return { rows: [] };
    })};
    const out = { mergedPr: 0, mergedWithoutGate: 0 };
    const PR = 'https://github.com/x/y/pull/5';
    await _finalizeMergedRun(pool, { id: RUN_ID, initiative_id: 'init-3', current_task_id: 'task-3' }, PR, out, { setPrUrl: true });
    const runUpdates = pool.query.mock.calls.filter(c => /UPDATE initiative_runs/.test(c[0]));
    expect(runUpdates.some(([, params]) => Array.isArray(params) && params.includes(PR))).toBe(true);
  });
});

// ── 刀A5 — execTolerant 兜底路径（GP-A/GP-B/GP-C）────────────────────────────
// 覆盖三条 Golden Path：
//   GP-A (resume_ci_red)      — gh pr checks 非零退出 + err.stdout 含 FAILURE → 重点火
//   GP-B (wait_ci_running)    — gh pr checks 非零退出 + err.stdout 全 pending → 等待不重点火
//   GP-C (skip_query_failure) — gh pr checks 非零退出 + 无 stdout → rethrow → 保守跳过
// Task: b5162377-4012-424a-ba2f-0b33003eb602

describe('刀A5 — execTolerant 兜底路径（GP-A：resume_ci_red）', () => {
  it('GP-A: gh pr checks 非零退出 + err.stdout 含 FAILURE JSON → execTolerant 兜底 → ciStatus=fail → spawnFn 调用一次', async () => {
    const deps = makeDeps({ prUrl: PR_URL, prState: 'OPEN', mergeStateStatus: 'CLEAN' });
    // 覆盖 execFn：让 gh pr checks 抛 err（携带 FAILURE stdout），其余命令正常
    deps.execFn = vi.fn().mockImplementation((cmd) => {
      if (/docker ps/.test(cmd)) return '';
      if (/gh pr view/.test(cmd) && /mergeStateStatus/.test(cmd)) {
        return JSON.stringify({ state: 'OPEN', mergeStateStatus: 'CLEAN' });
      }
      if (/gh pr view/.test(cmd)) {
        return JSON.stringify({ state: 'OPEN' });
      }
      if (/gh pr checks/.test(cmd)) {
        const err = new Error('Command failed: gh pr checks exit code 1');
        err.stdout = JSON.stringify([{ name: 'brain-ci', state: 'FAILURE' }]);
        err.stderr = '';
        err.status = 1;
        throw err;
      }
      return '';
    });

    const r = await resumeStalledRelayRuns(deps);

    expect(deps.spawnFn).toHaveBeenCalledOnce();
    expect(r.resumed).toBe(1);
    const checksCalled = deps.execFn.mock.calls.some(([cmd]) => /gh pr checks/.test(cmd));
    expect(checksCalled).toBe(true);
  });
});

describe('刀A5 — execTolerant 兜底路径（GP-B：wait_ci_running）', () => {
  it('GP-B: gh pr checks 非零退出 + err.stdout 全 pending JSON → execTolerant 兜底 → ciStatus=pending → spawnFn 不调用', async () => {
    const deps = makeDeps({ prUrl: PR_URL, prState: 'OPEN', mergeStateStatus: 'CLEAN' });
    deps.execFn = vi.fn().mockImplementation((cmd) => {
      if (/docker ps/.test(cmd)) return '';
      if (/gh pr view/.test(cmd) && /mergeStateStatus/.test(cmd)) {
        return JSON.stringify({ state: 'OPEN', mergeStateStatus: 'CLEAN' });
      }
      if (/gh pr view/.test(cmd)) {
        return JSON.stringify({ state: 'OPEN' });
      }
      if (/gh pr checks/.test(cmd)) {
        const err = new Error('Command failed: gh pr checks exit code 8');
        err.stdout = JSON.stringify([{ name: 'brain-ci', state: 'IN_PROGRESS' }]);
        err.stderr = '';
        err.status = 8;
        throw err;
      }
      return '';
    });

    const r = await resumeStalledRelayRuns(deps);

    expect(deps.spawnFn).not.toHaveBeenCalled();
    expect(r.resumed).toBe(0);
    const checksCalled = deps.execFn.mock.calls.some(([cmd]) => /gh pr checks/.test(cmd));
    expect(checksCalled).toBe(true);
  });
});

describe('刀A5 — execTolerant 兜底路径（GP-C：skip_query_failure）', () => {
  it('GP-C: gh pr checks 非零退出 + 无 stdout 属性 → execTolerant rethrow → 外层 catch 保守跳过 → spawnFn 不调用', async () => {
    const deps = makeDeps({ prUrl: PR_URL, prState: 'OPEN', mergeStateStatus: 'CLEAN' });
    deps.execFn = vi.fn().mockImplementation((cmd) => {
      if (/docker ps/.test(cmd)) return '';
      if (/gh pr view/.test(cmd) && /mergeStateStatus/.test(cmd)) {
        return JSON.stringify({ state: 'OPEN', mergeStateStatus: 'CLEAN' });
      }
      if (/gh pr view/.test(cmd)) {
        return JSON.stringify({ state: 'OPEN' });
      }
      if (/gh pr checks/.test(cmd)) {
        // 无 stdout：模拟真实网络/auth 失败，execTolerant 应 rethrow
        const err = new Error('gh: authentication token not found');
        err.stdout = '';
        throw err;
      }
      return '';
    });

    const r = await resumeStalledRelayRuns(deps);

    expect(deps.spawnFn).not.toHaveBeenCalled();
    expect(r.resumed).toBe(0);
  });
});

// ── 刀A2 — generator_done + pr_url 空 反查修复 ─────────────────────────────

import { _parseBaseRepo } from '../harness-relay-watchdog.js';

describe('刀A2 — generator_done + pr_url 空 反查修复', () => {
  // ── [BEHAVIOR-2] _parseBaseRepo 路径映射 ────────────────────────────────

  describe('[BEHAVIOR-2] _parseBaseRepo 支持宿主机/容器绝对路径', () => {
    it('TC-2: /Users/administrator/perfect21/cecelia → perfectuser21/cecelia', () => {
      expect(_parseBaseRepo('/Users/administrator/perfect21/cecelia')).toBe('perfectuser21/cecelia');
    });

    it('TC-3: /workspace → perfectuser21/cecelia', () => {
      expect(_parseBaseRepo('/workspace')).toBe('perfectuser21/cecelia');
    });

    it('TC-9: URL 格式 base_repo 优先于路径映射（原逻辑不变）', () => {
      expect(_parseBaseRepo('https://github.com/org/repo')).toBe('org/repo');
    });

    it('null → null（原行为不变）', () => {
      expect(_parseBaseRepo(null)).toBeNull();
    });

    it('TC-4: HARNESS_REPO_MAP env 覆盖', () => {
      const orig = process.env.HARNESS_REPO_MAP;
      try {
        process.env.HARNESS_REPO_MAP = JSON.stringify({ 'custom/path': 'myorg/myrepo' });
        expect(_parseBaseRepo('custom/path')).toBe('myorg/myrepo');
      } finally {
        if (orig === undefined) delete process.env.HARNESS_REPO_MAP;
        else process.env.HARNESS_REPO_MAP = orig;
      }
    });

    it('TC-5: 不识别非映射路径 → null', () => {
      expect(_parseBaseRepo('random-string')).toBeNull();
    });
  });

  // ── [BEHAVIOR-1] generator_done + pr_url 空 + 反查 MERGED ────────────────

  describe('[BEHAVIOR-1] generator_done=true + pr_url=null + 反查 MERGED → _finalizeMergedRun 被调', () => {
    it('TC-1: discovered MERGED → mergedPr=1，不 spawn，日志含 discovered_merged_via_fallback', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const DISCOVERED_PR = 'https://github.com/perfectuser21/cecelia/pull/1';
        const pool = { query: vi.fn() };
        pool.query.mockImplementation(async (sql) => {
          if (/FROM initiative_runs r/.test(sql)) {
            return {
              rows: [{
                id: RUN_ID,
                initiative_id: TASK_ID,
                current_task_id: TASK_ID,
                phase: 'planning',
                attempts: '1',
                deadline_at: new Date(Date.now() + 3600e3).toISOString(),
                pr_url: null,
                orchestrator_host: 'skill-relay-session',
              }],
            };
          }
          if (/FROM tasks/.test(sql)) {
            return {
              rows: [{
                id: TASK_ID,
                status: 'in_progress',
                title: 't',
                pr_url: null,
                payload: {
                  orchestrator: 'skill-relay',
                  generator_done: true,
                  base_repo: '/Users/administrator/perfect21/cecelia',
                },
              }],
            };
          }
          if (/FROM initiative_run_events/.test(sql)) {
            return { rows: [{ x: 1 }] }; // evaluator gated
          }
          return { rows: [] };
        });

        const spawnFn = vi.fn().mockResolvedValue({ ok: true });
        const execFn = vi.fn().mockImplementation((cmd) => {
          if (/docker ps/.test(cmd)) return '';
          // _discoverPrFromGithub → gh pr list
          if (/gh pr list/.test(cmd)) {
            return JSON.stringify([
              { headRefName: `cp-07150000-ws-${SHORT.slice(0, 8)}`, title: 't', url: DISCOVERED_PR, state: 'MERGED' },
            ]);
          }
          return '';
        });

        const out = await resumeStalledRelayRuns({ pool, execFn, spawnFn });

        // spawnFn 不得被调用
        expect(spawnFn).not.toHaveBeenCalled();
        // mergedPr 计数
        expect(out.mergedPr).toBe(1);
        // pool.query 含 UPDATE initiative_runs ... 'done'
        const sqls = pool.query.mock.calls.map(c => c[0]);
        expect(sqls.some(s => /UPDATE initiative_runs/.test(s) && /'done'/.test(s))).toBe(true);
        // pool.query 含 UPDATE tasks ... 'completed'
        expect(sqls.some(s => /UPDATE tasks/.test(s) && /'completed'/.test(s))).toBe(true);
        // console.log 含 discovered_merged_via_fallback
        const logMessages = consoleSpy.mock.calls.map(c => c.join(' '));
        expect(logMessages.some(m => m.includes('discovered_merged_via_fallback'))).toBe(true);
      } finally {
        consoleSpy.mockRestore();
      }
    });
  });

  // ── [BEHAVIOR-3] generator_done + pr_url 空 + 反查 OPEN → 回写 pr_url ─────

  describe('[BEHAVIOR-3] generator_done=true + pr_url=null + 反查 OPEN → 回写 pr_url，不 spawn', () => {
    it('TC-5: discovered OPEN → UPDATE initiative_runs SET pr_url，spawnFn 不调，resumed=0', async () => {
      const OPEN_PR = 'https://github.com/x/y/pull/2';
      const pool = { query: vi.fn() };
      pool.query.mockImplementation(async (sql) => {
        if (/FROM initiative_runs r/.test(sql)) {
          return {
            rows: [{
              id: RUN_ID,
              initiative_id: TASK_ID,
              current_task_id: TASK_ID,
              phase: 'planning',
              attempts: '1',
              deadline_at: new Date(Date.now() + 3600e3).toISOString(),
              pr_url: null,
              orchestrator_host: 'skill-relay-session',
            }],
          };
        }
        if (/FROM tasks/.test(sql)) {
          return {
            rows: [{
              id: TASK_ID,
              status: 'in_progress',
              title: 't',
              pr_url: null,
              payload: {
                orchestrator: 'skill-relay',
                generator_done: true,
                base_repo: '/Users/administrator/perfect21/cecelia',
              },
            }],
          };
        }
        return { rows: [] };
      });

      const spawnFn = vi.fn().mockResolvedValue({ ok: true });
      const execFn = vi.fn().mockImplementation((cmd) => {
        if (/docker ps/.test(cmd)) return '';
        if (/gh pr list/.test(cmd)) {
          return JSON.stringify([
            { headRefName: `cp-07150000-ws-${SHORT.slice(0, 8)}`, title: 't', url: OPEN_PR, state: 'OPEN' },
          ]);
        }
        return '';
      });

      const out = await resumeStalledRelayRuns({ pool, execFn, spawnFn });

      // spawnFn 不得被调用
      expect(spawnFn).not.toHaveBeenCalled();
      // resumed=0
      expect(out.resumed).toBe(0);
      // UPDATE initiative_runs SET pr_url
      const sqls = pool.query.mock.calls.map(c => c[0]);
      expect(sqls.some(s => /UPDATE initiative_runs SET pr_url/.test(s))).toBe(true);
      // 参数含目标 PR URL
      const prUrlUpdateCall = pool.query.mock.calls.find(c => /UPDATE initiative_runs SET pr_url/.test(c[0]));
      expect(prUrlUpdateCall).toBeTruthy();
      expect(prUrlUpdateCall[1]).toContain(OPEN_PR);
    });
  });

  // ── [BEHAVIOR-4] generator_done 超时兜底不变 ──────────────────────────────

  describe('[BEHAVIOR-4] generator_done 超时兜底语义不变', () => {
    it('TC-8: doneAt 超期 + 无 PR → phase=failed, failure_reason=generator_done_timeout，不 spawn', async () => {
      const pool = { query: vi.fn() };
      pool.query.mockImplementation(async (sql) => {
        if (/FROM initiative_runs r/.test(sql)) {
          return {
            rows: [{
              id: RUN_ID,
              initiative_id: TASK_ID,
              current_task_id: TASK_ID,
              phase: 'planning',
              attempts: '1',
              // 已过期 deadline（7h 前）
              deadline_at: new Date(Date.now() + 3600e3).toISOString(),
              pr_url: null,
              orchestrator_host: 'skill-relay-session',
              started_at: new Date(Date.now() - 7 * 3600e3).toISOString(),
            }],
          };
        }
        if (/FROM tasks/.test(sql)) {
          return {
            rows: [{
              id: TASK_ID,
              status: 'in_progress',
              title: 't',
              pr_url: null,
              payload: {
                orchestrator: 'skill-relay',
                generator_done: true,
                // generator_done_at 设为 7h 前
                generator_done_at: new Date(Date.now() - 7 * 3600e3).toISOString(),
                base_repo: '/workspace',
              },
            }],
          };
        }
        return { rows: [] };
      });

      const spawnFn = vi.fn();
      const execFn = vi.fn().mockImplementation((cmd) => {
        if (/docker ps/.test(cmd)) return '';
        if (/gh pr list/.test(cmd)) return JSON.stringify([]);
        return '';
      });

      const out = await resumeStalledRelayRuns({ pool, execFn, spawnFn });

      // 不 spawn
      expect(spawnFn).not.toHaveBeenCalled();
      // capped=1
      expect(out.capped).toBe(1);
      // SQL 含 phase='failed' + failure_reason='generator_done_timeout'
      const sqls = pool.query.mock.calls.map(c => c[0]);
      expect(sqls.some(s => /UPDATE initiative_runs SET phase='failed'/.test(s) && /generator_done_timeout/.test(s))).toBe(true);
    });
  });
});
