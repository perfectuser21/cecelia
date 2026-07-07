/**
 * codex 有头 tmux 派发（Sprint 1/3）
 * 合同 B-01~B-05 的单测覆盖（vitest，mock spawnFn/execFn/sshFn 依赖注入）
 *
 * TDD Red commit：此时实现未改，所有测试必须红（失败）。
 * 改动后（Green commit）：全绿。
 *
 * NFR 覆盖矩阵：
 * | 测试场景 | 对应 BEHAVIOR |
 * | mode=headed → ssh+tmux 路径，无 docker extraMounts | B-03 |
 * | mode 缺省/headless → docker 路径零回归 | B-02 |
 * | claude+headed → 400（路由层拒绝） | B-01 |
 * | watchdog headed：ssh 失败 → fail-open 不重点火 | B-04 |
 * | 收窗幂等：已收终态 run 不再触发 kill | B-05 |
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── module state reset between tests ───────────────────────────────────────
// _activeCodexRelays 是模块级变量，每次 spawnFn happy-path 后 +1，测试间必须重置
beforeEach(async () => {
  const mod = await import('../harness-skill-relay.js');
  if (typeof mod._setActiveCodexRelays === 'function') {
    mod._setActiveCodexRelays(0);
  }
  vi.unstubAllEnvs();
});

// ─── B-01 / B-02: 入队路由校验 ─────────────────────────────────────────────

describe('B-01: 入队路由校验 — claude+headed → 400', () => {
  it('validateHeadedMode(executor=claude, mode=headed) → { ok: false, status: 400 }', async () => {
    const { validateHeadedMode } = await import('../harness-skill-relay.js');
    const result = validateHeadedMode({ executor: 'claude', mode: 'headed' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/claude.*headed|headed.*claude|not supported/i);
  });

  it('validateHeadedMode(executor=codex, mode=headed) → { ok: true }', async () => {
    const { validateHeadedMode } = await import('../harness-skill-relay.js');
    const result = validateHeadedMode({ executor: 'codex', mode: 'headed' });
    expect(result.ok).toBe(true);
  });

  it('validateHeadedMode(executor=codex, mode=undefined) → { ok: true }（不带 mode 不影响）', async () => {
    const { validateHeadedMode } = await import('../harness-skill-relay.js');
    const result = validateHeadedMode({ executor: 'codex', mode: undefined });
    expect(result.ok).toBe(true);
  });

  it('validateHeadedMode(executor=codex, mode=headless) → { ok: true }', async () => {
    const { validateHeadedMode } = await import('../harness-skill-relay.js');
    const result = validateHeadedMode({ executor: 'codex', mode: 'headless' });
    expect(result.ok).toBe(true);
  });
});

// ─── B-02: mode 缺省/headless 走 docker 路径零回归 ──────────────────────────

describe('B-02: mode 缺省/headless → docker 路径零回归', () => {
  const TASK_HEADLESS = {
    id: 'aaaabbbb-cccc-dddd-eeee-ffff00001111',
    title: 'headless regression test',
    payload: {
      orchestrator: 'skill-relay',
      executor: 'codex',
      journey_id: 'j-test',
      sprint_dir: 'sprints/test-headless',
      // mode 故意不设，默认 headless
    },
  };

  it('mode 缺省 → spawnFn 被调用（docker 路径），无 sshFn 调用', async () => {
    vi.stubEnv('CODEX_RELAY_HOME', '/tmp/fake-codex-home');
    const { spawnSkillRelaySession } = await import('../harness-skill-relay.js');
    const sshFn = vi.fn();
    const deps = {
      pool: { query: vi.fn().mockResolvedValue({ rows: [{ count: '0' }] }) },
      spawnFn: vi.fn().mockResolvedValue({ containerId: 'cid' }),
      loadSkill: vi.fn().mockReturnValue('SKILL'),
      ensureWt: vi.fn().mockResolvedValue('/tmp/wt'),
      resolveAccountFn: vi.fn().mockResolvedValue(undefined),
      tokenFn: vi.fn().mockResolvedValue('gh-token'),
      sshFn,
      now: () => new Date('2026-07-07T10:00:00Z'),
    };
    const r = await spawnSkillRelaySession(TASK_HEADLESS, deps);
    expect(r.ok).toBe(true);
    expect(deps.spawnFn).toHaveBeenCalledOnce(); // docker path called
    expect(sshFn).not.toHaveBeenCalled();        // ssh NOT called
  });

  it('mode=headless → spawnFn 被调用，无 sshFn 调用', async () => {
    vi.stubEnv('CODEX_RELAY_HOME', '/tmp/fake-codex-home');
    const { spawnSkillRelaySession } = await import('../harness-skill-relay.js');
    const sshFn = vi.fn();
    const task = { ...TASK_HEADLESS, payload: { ...TASK_HEADLESS.payload, mode: 'headless' } };
    const deps = {
      pool: { query: vi.fn().mockResolvedValue({ rows: [{ count: '0' }] }) },
      spawnFn: vi.fn().mockResolvedValue({ containerId: 'cid' }),
      loadSkill: vi.fn().mockReturnValue('SKILL'),
      ensureWt: vi.fn().mockResolvedValue('/tmp/wt'),
      resolveAccountFn: vi.fn().mockResolvedValue(undefined),
      tokenFn: vi.fn().mockResolvedValue('gh-token'),
      sshFn,
      now: () => new Date('2026-07-07T10:00:00Z'),
    };
    const r = await spawnSkillRelaySession(task, deps);
    expect(r.ok).toBe(true);
    expect(deps.spawnFn).toHaveBeenCalledOnce();
    expect(sshFn).not.toHaveBeenCalled();
  });
});

// ─── B-03: mode=headed → ssh+tmux 路径，无 docker extraMounts ───────────────

describe('B-03: mode=headed → ssh+tmux 路径', () => {
  const TASK_HEADED = {
    id: 'ccccdddd-eeee-ffff-0000-111122223333',
    title: 'headed dry-run test',
    payload: {
      orchestrator: 'skill-relay',
      executor: 'codex',
      mode: 'headed',
      journey_id: 'j-test',
      sprint_dir: 'sprints/07071654-codex-headed-dispatch',
      prompt: 'echo headed-dry-run-test',
    },
  };

  function makeHeadedDeps(overrides = {}) {
    return {
      pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
      spawnFn: vi.fn().mockResolvedValue({ containerId: 'cid' }),
      sshFn: vi.fn().mockResolvedValue({ stdout: '', exitCode: 0 }),
      loadSkill: vi.fn().mockReturnValue('SKILL'),
      ensureWt: vi.fn().mockResolvedValue('/tmp/wt-host'),
      resolveAccountFn: vi.fn().mockResolvedValue(undefined),
      tokenFn: vi.fn().mockResolvedValue('gh-token'),
      now: () => new Date('2026-07-07T10:00:00Z'),
      ...overrides,
    };
  }

  it('mode=headed → sshFn 被调用（tmux new-session），spawnFn（docker）不被调用', async () => {
    vi.stubEnv('CODEX_RELAY_HOME', '/tmp/fake-codex-home');
    const { spawnSkillRelaySession } = await import('../harness-skill-relay.js');
    const deps = makeHeadedDeps();
    const r = await spawnSkillRelaySession(TASK_HEADED, deps);
    expect(r.ok).toBe(true);
    expect(deps.sshFn).toHaveBeenCalled();
    expect(deps.spawnFn).not.toHaveBeenCalled(); // docker NOT called
  });

  it('mode=headed → sshFn 调用参数含 tmux new-session + codex-relay-<short>', async () => {
    vi.stubEnv('CODEX_RELAY_HOME', '/tmp/fake-codex-home');
    const { spawnSkillRelaySession } = await import('../harness-skill-relay.js');
    const deps = makeHeadedDeps();
    await spawnSkillRelaySession(TASK_HEADED, deps);
    // sshFn 第二次调用（第一次是 mkdir+write prompt，第二次是 tmux new-session）
    const allCalls = deps.sshFn.mock.calls.map(c => String(c[0])).join(' ');
    expect(allCalls).toMatch(/tmux.*new-session|new-session.*tmux/i);
    expect(allCalls).toContain('codex-relay-ccccdddd');
  });

  it('mode=headed → initiative_runs 落行 orchestrator_host=skill-relay-codex-headed', async () => {
    vi.stubEnv('CODEX_RELAY_HOME', '/tmp/fake-codex-home');
    const { spawnSkillRelaySession } = await import('../harness-skill-relay.js');
    const deps = makeHeadedDeps();
    await spawnSkillRelaySession(TASK_HEADED, deps);
    const insertCall = deps.pool.query.mock.calls.find(([sql]) => /INSERT INTO initiative_runs/.test(sql));
    expect(insertCall, '必须 INSERT initiative_runs').toBeTruthy();
    // orchestrator_host 应为 skill-relay-codex-headed（区别于 headless 的 skill-relay-codex）
    const [sql, params] = insertCall;
    const allText = sql + JSON.stringify(params ?? []);
    expect(allText).toContain('skill-relay-codex-headed');
  });

  it('mode=headed → deadline=8h（initiative_runs INSERT SQL 含 8 hours）', async () => {
    vi.stubEnv('CODEX_RELAY_HOME', '/tmp/fake-codex-home');
    const { spawnSkillRelaySession } = await import('../harness-skill-relay.js');
    const deps = makeHeadedDeps();
    await spawnSkillRelaySession(TASK_HEADED, deps);
    const insertCall = deps.pool.query.mock.calls.find(([sql]) => /INSERT INTO initiative_runs/.test(sql));
    expect(insertCall, '必须 INSERT initiative_runs').toBeTruthy();
    expect(insertCall[0]).toMatch(/8 hours/);
  });

  it('mode=headed → prompt 通过文件方式传递（不含 $(cat) 内联）', async () => {
    vi.stubEnv('CODEX_RELAY_HOME', '/tmp/fake-codex-home');
    const { spawnSkillRelaySession } = await import('../harness-skill-relay.js');
    const deps = makeHeadedDeps();
    await spawnSkillRelaySession(TASK_HEADED, deps);
    // 验证 sshFn 调用中不含 $(cat) 内联
    const allCalls = deps.sshFn.mock.calls.map(c => JSON.stringify(c)).join(' ');
    expect(allCalls).not.toMatch(/\$\(cat/);
  });
});

// ─── B-04: watchdog headed 分支 — ssh 失败 fail-open ────────────────────────

describe('B-04: watchdog headed 分支 — ssh 失败 → fail-open 不重点火', () => {
  it('ssh 命令失败（exitCode!=0）→ watchdog 不递增 attempts，不重点火，不标 failed', async () => {
    const { resumeHeadedRelayRuns } = await import('../harness-relay-watchdog.js');

    const RUN_ID = 'run-id-0001';
    const INITIATIVE_ID = 'ccccdddd-eeee-ffff-0000-111122223333';

    const pool = { query: vi.fn() };
    // 返回一个 headed in-progress run
    pool.query.mockImplementation(async (sql) => {
      if (/initiative_runs/.test(sql) && /orchestrator_host.*skill-relay-codex-headed|skill-relay-codex-headed.*orchestrator_host|DISTINCT ON/.test(sql)) {
        return {
          rows: [{
            id: RUN_ID,
            initiative_id: INITIATIVE_ID,
            orchestrator_host: 'skill-relay-codex-headed',
            phase: 'A_planning',
            deadline_at: new Date(Date.now() + 3600e3).toISOString(),
            tmux_killed_at: null,
            attempts: '1',
          }],
        };
      }
      if (/FROM tasks/.test(sql)) {
        return { rows: [{ id: INITIATIVE_ID, status: 'in_progress', payload: { orchestrator: 'skill-relay', executor: 'codex', mode: 'headed' } }] };
      }
      return { rows: [] };
    });

    // ssh 命令失败（模拟网络问题）
    const sshFn = vi.fn().mockRejectedValue(new Error('ssh: connection refused'));
    const spawnFn = vi.fn();

    const r = await resumeHeadedRelayRuns({ pool, sshFn, spawnFn });

    // fail-open：不重点火
    expect(spawnFn).not.toHaveBeenCalled();
    // attempts 不变（DB 没有 UPDATE initiative_runs 递增 attempts）
    const attemptUpdates = pool.query.mock.calls
      .map(c => c[0])
      .filter(s => /UPDATE initiative_runs/.test(s) && /attempts/.test(s));
    expect(attemptUpdates).toHaveLength(0);
    // 不标 failed
    const failedUpdates = pool.query.mock.calls
      .map(c => c[0])
      .filter(s => /UPDATE initiative_runs/.test(s) && /'failed'/.test(s));
    expect(failedUpdates).toHaveLength(0);
    expect(r.failOpen).toBeGreaterThanOrEqual(1);
  });
});

// ─── B-05: 收窗幂等 — tmux_killed_at 标记后不重复 kill ──────────────────────

describe('B-05: 收窗幂等 — tmux_killed_at 已设 → 不重复 kill', () => {
  it('tmux_killed_at 已有值 → 不再调用 sshFn kill-session', async () => {
    const { cleanupHeadedRun } = await import('../harness-relay-watchdog.js');

    const RUN_ID = 'run-id-done-0001';
    const KILLED_AT = '2026-07-07T08:00:00Z';

    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const sshFn = vi.fn();

    // 调用收窗：tmux_killed_at 已有值
    const r = await cleanupHeadedRun(
      { id: RUN_ID, initiative_id: 'some-task', tmux_killed_at: KILLED_AT, phase: 'done' },
      { pool, sshFn }
    );

    expect(sshFn).not.toHaveBeenCalled();
    expect(r.skipped).toBe(true);
    expect(r.reason).toMatch(/already.*killed|tmux_killed_at|idempotent/i);
  });

  it('tmux_killed_at 为 null → sshFn kill-session 被调用，并更新 DB tmux_killed_at', async () => {
    const { cleanupHeadedRun } = await import('../harness-relay-watchdog.js');

    const RUN_ID = 'run-id-done-0002';
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const sshFn = vi.fn().mockResolvedValue({ stdout: '', exitCode: 0 });

    const r = await cleanupHeadedRun(
      { id: RUN_ID, initiative_id: 'some-task', tmux_killed_at: null, phase: 'done', short_id: 'aabbccdd' },
      { pool, sshFn }
    );

    expect(sshFn).toHaveBeenCalled();
    // 验证 sshFn 调用含 kill-session
    const sshCall = sshFn.mock.calls[0][0];
    expect(typeof sshCall === 'string' ? sshCall : JSON.stringify(sshCall)).toMatch(/kill-session/);
    // 验证 DB 更新 tmux_killed_at
    const dbUpdates = pool.query.mock.calls.map(c => c[0]).filter(s => /UPDATE initiative_runs/.test(s) && /tmux_killed_at/.test(s));
    expect(dbUpdates).toHaveLength(1);
    expect(r.killed).toBe(true);
  });
});
