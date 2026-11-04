// 真实watchdog隔离合同；只验证委托，不宣称旧relay已恢复或DB持久化。
import { describe, it, expect, vi } from 'vitest';
import { store } from './helpers/relay-watchdog-boundary.js';
import { makeDeps, TASK_ID, RUN_ID, SHORT, PR_URL } from './helpers/relay-watchdog-fixture.js';
import { resumeStalledRelayRuns, MAX_RELAY_ATTEMPTS, scanStuckHarness } from '../harness-relay-watchdog.js';
import { sendBark } from '../notifier.js';

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
    expect(store.patch).not.toHaveBeenCalled();
  });

  it('abandoned review whose request SHA no longer matches GitHub is collected', async () => {
    const { pool } = reviewPausePool({ reviewHeadSha: 'a'.repeat(40) });
    const resolvePrHead = vi.fn(async () => 'b'.repeat(40));

    await scanStuckHarness({ pool, resolvePrHead });

    expect(resolvePrHead).toHaveBeenCalledWith(PR_URL);
    expect(store.patch).toHaveBeenCalledWith(pool, expect.objectContaining({ runId: RUN_ID, phase: 'failed' }));
  });

  it('review request without a PR URL cannot pause deadline cleanup', async () => {
    const { pool } = reviewPausePool({ prUrl: null });
    const resolvePrHead = vi.fn();

    await scanStuckHarness({ pool, resolvePrHead });

    expect(resolvePrHead).not.toHaveBeenCalled();
    expect(store.patch).toHaveBeenCalledWith(pool, expect.objectContaining({ runId: RUN_ID, phase: 'failed' }));
  });

  it('GitHub resolver failure defers cleanup until a later watchdog pass', async () => {
    const { pool } = reviewPausePool();
    const resolvePrHead = vi.fn(async () => {
      throw new Error('GitHub rate limited');
    });

    await scanStuckHarness({ pool, resolvePrHead });

    expect(resolvePrHead).toHaveBeenCalledWith(PR_URL);
    expect(store.patch).not.toHaveBeenCalled();
  });
});

describe('resumeStalledRelayRuns', () => {
  it.each([
    ['有 provider session', { provider_session_id: 'thread-retired', status: 'running' }],
    ['Fleet attempt', { execution_transport: 'fleet-worker', status: 'running' }],
    ['过期 lease', { lease_expires_at: new Date(0).toISOString(), status: 'running' }],
    ['已失败 attempt', { status: 'failed' }],
  ])('kernel-v1 %s：退役后不恢复、不重启、不回队', async (_label, latestAttempt) => {
    const deps = makeDeps({ harnessRuntime: 'kernel-v1', orchestratorHost: 'kernel-v1', latestAttempt });
    deps.resumeAttempt = vi.fn();
    deps.launchKernel = vi.fn();
    deps.requeueKernelRunDeferred = vi.fn();
    const result = await resumeStalledRelayRuns(deps);
    expect(result.resumed).toBe(0);
    expect(deps.resumeAttempt).not.toHaveBeenCalled();
    expect(deps.launchKernel).not.toHaveBeenCalled();
    expect(deps.requeueKernelRunDeferred).not.toHaveBeenCalled();
    expect(deps.spawnFn).not.toHaveBeenCalled();
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

  // 2026-08-07 三条 harness_initiative 全灭时,日志刷了 40 分钟的
  // "重点火失败 initiative=xxx: undefined" —— spawnSkillRelaySession 被 spawn-guard 拒绝时
  // 返回的是 {ok:false, deferred:true, reason:'active_run_guard'},没有 error 字段,
  // 日志取 r.error 必然打 undefined,把唯一能指认死锁的线索抹掉了。
  it('spawn 被守卫拒(只有 reason 没有 error)→ 日志必须说出 reason,不能打 undefined', async () => {
    const deps = makeDeps();
    deps.spawnFn = vi.fn().mockResolvedValue({
      ok: false, deferred: true, reason: 'active_run_guard',
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await resumeStalledRelayRuns(deps);
    const lines = warn.mock.calls.map((c) => c.join(' ')).filter((l) => l.includes('重点火失败'));
    warn.mockRestore();
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain('active_run_guard');
    expect(lines[0]).not.toContain('undefined');
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
    expect(store.patch).toHaveBeenCalledWith(deps.pool, expect.objectContaining({ runId: RUN_ID, phase: 'failed' }));
  });

  it('task 已 completed → run 行收敛为 done（house-keeping），不重点火', async () => {
    const deps = makeDeps({ taskStatus: 'completed' });
    const r = await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).not.toHaveBeenCalled();
    expect(store.patch).toHaveBeenCalledWith(deps.pool, { runId: RUN_ID, phase: 'done', failureReason: null, prUrl: null });
    expect(r.housekept).toBe(1);
  });

  it.each(['cancelled', 'canceled'])(
    'task %s → 向store委托failed/task_cancelled（不宣称持久化）',
    async (taskStatus) => {
      const deps = makeDeps({ taskStatus });
      const r = await resumeStalledRelayRuns(deps);
      expect(store.patch).toHaveBeenCalledWith(deps.pool, { runId: RUN_ID, phase: 'failed', failureReason: 'task_cancelled', prUrl: null });
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

  it('容器消失 + pr_url 存在 + PR MERGED → 委托 done，不重点火', async () => {
    const deps = makeDeps({ prUrl: PR_URL, prState: 'MERGED' });
    const r = await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).not.toHaveBeenCalled();
    expect(r.resumed).toBe(0);
    // 必须调用 gh pr view 查状态
    const ghCall = deps.execFn.mock.calls.find(c => /gh pr view/.test(c[0]));
    expect(ghCall).toBeTruthy();
    expect(ghCall[0]).toContain(PR_URL);
    expect(store.patch).toHaveBeenCalledWith(deps.pool, { runId: RUN_ID, phase: 'done', failureReason: null, prUrl: PR_URL });
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
    expect(store.patch).toHaveBeenCalledWith(deps.pool, { runId: RUN_ID, phase: 'done', failureReason: 'merged_without_evaluator_gate', prUrl: PR_URL });
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
