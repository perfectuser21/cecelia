/**
 * 合同测试 — harness relay grok executor 收编
 * TASK_ID: a598772e-7f74-40f0-a022-d0e8d2b35dc0
 * SPRINT_DIR: sprints/07201315-relay-a598772e
 *
 * TDD 铁律：
 * - commit 1 = 这些测试原样 checkout（Red）
 * - commit 2+ = 实现代码（Green）
 * - 测试文件 commit 1 后不可改
 */
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import {
  spawnSkillRelaySession,
  HEADED_HOSTS,
  HEADED_TMUX_PREFIXES,
  detectQuotaWall,
} from '../../../packages/brain/src/harness-skill-relay.js';

// ──────────────────────────────────────────────────────────────────────────────
// 共享工厂
// ──────────────────────────────────────────────────────────────────────────────
function makeGrokTask(overrides = {}) {
  return {
    id: 'a598772e-7f74-40f0-a022-d0e8d2b35dc0',
    title: 'grok relay test',
    payload: {
      orchestrator: 'skill-relay',
      executor: 'grok',
      sprint_dir: 'sprints/07201315-relay-a598772e',
      journey_id: 'j-grok',
    },
    ...overrides,
  };
}

function makeDeps(overrides = {}) {
  return {
    pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
    spawnFn: vi.fn().mockResolvedValue({ containerId: 'cid-gk', dockerStdout: 'ok' }),
    loadSkill: vi.fn().mockReturnValue('SKILL_CONTENT harness-controller'),
    ensureWt: vi.fn().mockResolvedValue('/tmp/wt/grok-task'),
    resolveAccountFn: vi.fn().mockImplementation(async (o) => { o.env = o.env || {}; o.env.CECELIA_CREDENTIALS = 'account1'; }),  // 新契约（5167ef48）：claude 需已解析账号
    tokenFn: vi.fn().mockResolvedValue('gh-token-grok'),
    now: () => new Date('2026-07-20T12:00:00Z'),
    execFn: vi.fn().mockReturnValue(''),
    // 2026-07-21：isCodex=true 时 spawnSkillRelaySession 会调用 snapshotCodexHome
    // 把 CODEX_RELAY_HOME 快照到临时目录（见 harness-skill-relay.js）。不 mock 会
    // 落到真实 snapshotCodexRelayHome，本文件多处 vi.stubEnv('CODEX_RELAY_HOME',
    // '/tmp/fake-codex-home') 是假路径、没有真实 auth.json，导致 loud-fail 回滚。
    snapshotCodexHome: vi.fn().mockReturnValue('/tmp/fake-snapshot-dir'),
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// [BEHAVIOR-1] isGrok 分支识别单测
// ──────────────────────────────────────────────────────────────────────────────
describe('[BEHAVIOR-1] isGrok 分支识别 — executor=grok 走 grok 路径', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('executor=grok → CECELIA_EXECUTOR=grok 注入 spawnFn env', async () => {
    vi.stubEnv('GROK_RELAY_HOME', '/tmp/fake-grok-home');
    const deps = makeDeps();
    const task = makeGrokTask();
    const r = await spawnSkillRelaySession(task, deps);

    expect(r.ok).toBe(true);
    expect(deps.spawnFn).toHaveBeenCalledOnce();
    const spawnOpts = deps.spawnFn.mock.calls[0][0];
    expect(spawnOpts.env.CECELIA_EXECUTOR).toBe('grok');
  });

  it('executor=grok → containerId 后缀为 -gk（对齐 codex 的 -cx 规约）', async () => {
    vi.stubEnv('GROK_RELAY_HOME', '/tmp/fake-grok-home');
    const deps = makeDeps();
    const task = makeGrokTask();
    await spawnSkillRelaySession(task, deps);

    const spawnOpts = deps.spawnFn.mock.calls[0][0];
    expect(spawnOpts.containerId).toMatch(/^cecelia-relay-a598772e-gk$/);
  });

  it('executor=grok → orchestrator_host=skill-relay-grok（区别 codex 的 skill-relay-codex）', async () => {
    vi.stubEnv('GROK_RELAY_HOME', '/tmp/fake-grok-home');
    const deps = makeDeps();
    const task = makeGrokTask();
    await spawnSkillRelaySession(task, deps);

    const insertCall = deps.pool.query.mock.calls.find(
      ([sql]) => /INSERT INTO initiative_runs/.test(sql)
    );
    expect(insertCall, 'initiative_runs 必须落行').toBeTruthy();
    const [sql] = insertCall;
    expect(sql).toContain('skill-relay-grok');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// [BEHAVIOR-2] GROK_RELAY_HOME='' → loud-fail + task 回滚
// ──────────────────────────────────────────────────────────────────────────────
describe('[BEHAVIOR-2] GROK_RELAY_HOME="" → loud-fail + task 回滚到 queued', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('GROK_RELAY_HOME="" → spawnFn 未被调用', async () => {
    vi.stubEnv('GROK_RELAY_HOME', '');
    const deps = makeDeps();
    const task = makeGrokTask();
    await spawnSkillRelaySession(task, deps);

    expect(deps.spawnFn).not.toHaveBeenCalled();
  });

  it('GROK_RELAY_HOME="" → ok=false', async () => {
    vi.stubEnv('GROK_RELAY_HOME', '');
    const deps = makeDeps();
    const task = makeGrokTask();
    const r = await spawnSkillRelaySession(task, deps);

    expect(r.ok).toBe(false);
  });

  it('GROK_RELAY_HOME="" → pool UPDATE tasks 回滚到 queued', async () => {
    vi.stubEnv('GROK_RELAY_HOME', '');
    const deps = makeDeps();
    const task = makeGrokTask();
    await spawnSkillRelaySession(task, deps);

    const rollbackCall = deps.pool.query.mock.calls.find(
      ([sql]) => /UPDATE tasks/.test(sql) && /queued/.test(sql)
    );
    expect(rollbackCall, 'task 必须回滚到 queued').toBeTruthy();
    const [, params] = rollbackCall;
    expect(params).toContain(task.id);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// [BEHAVIOR-3] GROK_RELAY_HOME=undefined → 放行
// ──────────────────────────────────────────────────────────────────────────────
describe('[BEHAVIOR-3] GROK_RELAY_HOME=undefined → 放行（本地/测试环境）', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('GROK_RELAY_HOME 未设置 → spawnFn 被调用，r.ok===true', async () => {
    // 确保 env 变量未设置（测试环境默认不应有此 env）
    const savedEnv = process.env.GROK_RELAY_HOME;
    delete process.env.GROK_RELAY_HOME;

    const deps = makeDeps();
    const task = makeGrokTask();
    const r = await spawnSkillRelaySession(task, deps);

    if (savedEnv !== undefined) process.env.GROK_RELAY_HOME = savedEnv;

    expect(r.ok).toBe(true);
    expect(deps.spawnFn).toHaveBeenCalledOnce();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// [BEHAVIOR-4] headless spawn 参数正确性
// ──────────────────────────────────────────────────────────────────────────────
describe('[BEHAVIOR-4] headless grok spawn 参数正确性', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('extraMounts 含 GROK_RELAY_HOME:/home/cecelia/.grok:rw', async () => {
    vi.stubEnv('GROK_RELAY_HOME', '/home/user/.grok');
    const deps = makeDeps();
    const task = makeGrokTask();
    await spawnSkillRelaySession(task, deps);

    const spawnOpts = deps.spawnFn.mock.calls[0][0];
    expect(spawnOpts.extraMounts).toBeDefined();
    expect(spawnOpts.extraMounts).toContain('/home/user/.grok:/home/cecelia/.grok:rw');
  });

  it('spawn 命令含 ~/.grok/bin/grok 调用特征（prompt 或 env 中含 grok）', async () => {
    vi.stubEnv('GROK_RELAY_HOME', '/home/user/.grok');
    const deps = makeDeps();
    const task = makeGrokTask();
    await spawnSkillRelaySession(task, deps);

    const spawnOpts = deps.spawnFn.mock.calls[0][0];
    // grok spawn 区别于 claude/codex：env 标记 CECELIA_EXECUTOR=grok
    expect(spawnOpts.env.CECELIA_EXECUTOR).toBe('grok');
  });

  it('orchestrator_host=skill-relay-grok，deadline=8h（对齐 codex 等级）', async () => {
    vi.stubEnv('GROK_RELAY_HOME', '/home/user/.grok');
    const deps = makeDeps();
    const task = makeGrokTask();
    await spawnSkillRelaySession(task, deps);

    const insertCall = deps.pool.query.mock.calls.find(
      ([sql]) => /INSERT INTO initiative_runs/.test(sql)
    );
    expect(insertCall, 'initiative_runs 必须落行').toBeTruthy();
    const [sql] = insertCall;
    expect(sql).toContain('skill-relay-grok');
    expect(sql).toMatch(/8 hours/);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// [BEHAVIOR-5] detectQuotaWall 全 pattern 覆盖
// ──────────────────────────────────────────────────────────────────────────────
describe('[BEHAVIOR-5] detectQuotaWall — 全 6 个 pattern 覆盖', () => {
  it('detectQuotaWall 是导出的函数', () => {
    expect(typeof detectQuotaWall).toBe('function');
  });

  it('"out of credits" → true', () => {
    expect(detectQuotaWall('Error: out of credits')).toBe(true);
  });

  it('"rate limit" → true', () => {
    expect(detectQuotaWall('rate limit exceeded')).toBe(true);
  });

  it('"429" → true', () => {
    expect(detectQuotaWall('HTTP 429 Too Many Requests')).toBe(true);
  });

  it('"quota exceeded" → true', () => {
    expect(detectQuotaWall('quota exceeded for account')).toBe(true);
  });

  it('"quota reached" → true', () => {
    expect(detectQuotaWall('Your quota reached the limit')).toBe(true);
  });

  it('"usage limit" → true', () => {
    expect(detectQuotaWall('usage limit reached')).toBe(true);
  });

  it('正常输出 → false', () => {
    expect(detectQuotaWall('task completed successfully')).toBe(false);
    expect(detectQuotaWall('')).toBe(false);
    expect(detectQuotaWall('some normal error')).toBe(false);
  });

  it('大小写不敏感', () => {
    expect(detectQuotaWall('OUT OF CREDITS')).toBe(true);
    expect(detectQuotaWall('Rate Limit Exceeded')).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// [BEHAVIOR-6] 额度撞墙 fallback 路径
// ──────────────────────────────────────────────────────────────────────────────
describe('[BEHAVIOR-6] 额度撞墙 fallback — grok 撞墙 → claude 重试', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('grok 撞墙 → 第二次 spawnFn 调用使用 CECELIA_EXECUTOR=claude', async () => {
    vi.stubEnv('GROK_RELAY_HOME', '/home/user/.grok');
    // 第一次（grok）spawn 失败且输出含配额撞墙信息
    const quotaError = new Error('out of credits');
    const spawnFn = vi.fn()
      .mockRejectedValueOnce(quotaError)   // grok 第一次失败（配额撞墙）
      .mockResolvedValueOnce({ containerId: 'cid-claude', dockerStdout: 'ok' }); // claude 重试成功

    const deps = makeDeps({ spawnFn });
    const task = makeGrokTask();
    const r = await spawnSkillRelaySession(task, deps);

    expect(r.ok).toBe(true);
    expect(spawnFn).toHaveBeenCalledTimes(2);

    const secondCall = spawnFn.mock.calls[1][0];
    expect(secondCall.env.CECELIA_EXECUTOR).toBe('claude');
  });

  it('非撞墙失败 → 不换 executor，直接回滚返回 ok=false', async () => {
    vi.stubEnv('GROK_RELAY_HOME', '/home/user/.grok');
    const nonQuotaError = new Error('network timeout');
    const spawnFn = vi.fn().mockRejectedValue(nonQuotaError);

    const deps = makeDeps({ spawnFn });
    const task = makeGrokTask();
    const r = await spawnSkillRelaySession(task, deps);

    // 非撞墙：只调一次，不重试
    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// [BEHAVIOR-7] headed grok 入口白名单
// ──────────────────────────────────────────────────────────────────────────────
describe('[BEHAVIOR-7] headed grok 入口白名单', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('HEADED_HOSTS 含 grok 条目', () => {
    expect(HEADED_HOSTS).toHaveProperty('grok');
    expect(typeof HEADED_HOSTS.grok).toBe('string');
  });

  it('HEADED_TMUX_PREFIXES 含 grok 条目，前缀为 grok-relay-', () => {
    expect(HEADED_TMUX_PREFIXES).toHaveProperty('grok');
    expect(HEADED_TMUX_PREFIXES.grok).toBe('grok-relay-');
  });

  it('headed grok session：headedExecutor=grok，tmuxSession 前缀 grok-relay-', async () => {
    vi.stubEnv('GROK_RELAY_HOME', '/home/user/.grok');
    const execCallArgs = [];
    const execFn = vi.fn((cmd, _opts) => {
      execCallArgs.push(String(cmd));
      if (String(cmd).includes('tmux has-session')) return 'TMUX_DEAD';
      return '';
    });

    const task = makeGrokTask({
      id: 'a598772e-7f74-40f0-a022-d0e8d2b35dc0',
      payload: {
        orchestrator: 'skill-relay',
        executor: 'grok',
        mode: 'headed',
        sprint_dir: 'sprints/07201315-relay-a598772e',
      },
    });

    const deps = {
      pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
      execFn,
      loadSkill: vi.fn().mockReturnValue('SKILL_CONTENT'),
      ensureWt: vi.fn().mockResolvedValue('/tmp/wt/headed-grok'),
      resolveAccountFn: vi.fn().mockImplementation(async (o) => { o.env = o.env || {}; o.env.CECELIA_CREDENTIALS = 'account1'; }),  // 新契约（5167ef48）：claude 需已解析账号
      tokenFn: vi.fn().mockResolvedValue('gh-token'),
      now: () => new Date('2026-07-20T12:00:00Z'),
      inDockerFn: () => false,
      sshKeyFn: () => null,
      sshSpawnFn: vi.fn().mockResolvedValue({}),
    };

    const r = await spawnSkillRelaySession(task, deps);
    expect(r.ok).toBe(true);

    // tmuxSession 含 grok-relay- 前缀
    const tmuxCalls = execCallArgs.filter(cmd => cmd.includes('tmux has-session'));
    expect(tmuxCalls.length).toBeGreaterThan(0);
    expect(tmuxCalls[0]).toMatch(/grok-relay-/);
  });

  it('headed grok GROK_RELAY_HOME="" → 同样 loud-fail（对齐 codex headed 门禁）', async () => {
    vi.stubEnv('GROK_RELAY_HOME', '');

    const execFn = vi.fn((cmd) => {
      if (String(cmd).includes('tmux has-session')) return 'TMUX_DEAD';
      return '';
    });

    const task = makeGrokTask({
      payload: {
        orchestrator: 'skill-relay',
        executor: 'grok',
        mode: 'headed',
        sprint_dir: 'sprints/07201315-relay-a598772e',
      },
    });

    const deps = {
      pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
      execFn,
      loadSkill: vi.fn().mockReturnValue('SKILL'),
      ensureWt: vi.fn().mockResolvedValue('/tmp/wt'),
      resolveAccountFn: vi.fn().mockImplementation(async (o) => { o.env = o.env || {}; o.env.CECELIA_CREDENTIALS = 'account1'; }),  // 新契约（5167ef48）：claude 需已解析账号
      tokenFn: vi.fn().mockResolvedValue('t'),
      now: () => new Date(),
      inDockerFn: () => false,
      sshKeyFn: () => null,
      sshSpawnFn: vi.fn().mockResolvedValue({}),
    };

    const r = await spawnSkillRelaySession(task, deps);
    expect(r.ok).toBe(false);
    expect(deps.sshSpawnFn).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// [BEHAVIOR-8] 回归：现有 isCodex/claude 全量逻辑不变
// ──────────────────────────────────────────────────────────────────────────────
describe('[BEHAVIOR-8] 回归：isCodex/claude 路径零影响', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('executor=codex（CODEX_RELAY_HOME 配置）→ orchestrator_host=skill-relay-codex（不变）', async () => {
    vi.stubEnv('CODEX_RELAY_HOME', '/tmp/fake-codex-home');
    const deps = makeDeps();
    const task = {
      id: 'aaaabbbb-cccc-dddd-eeee-ffff00009999',
      title: 'codex task',
      payload: {
        orchestrator: 'skill-relay',
        executor: 'codex',
        sprint_dir: 'sprints/test-codex',
      },
    };
    await spawnSkillRelaySession(task, deps);

    const insertCall = deps.pool.query.mock.calls.find(
      ([sql]) => /INSERT INTO initiative_runs/.test(sql)
    );
    expect(insertCall).toBeTruthy();
    const [sql] = insertCall;
    expect(sql).toContain('skill-relay-codex');
    expect(sql).not.toContain('skill-relay-grok');
  });

  it('executor 缺省（claude）→ CECELIA_EXECUTOR=claude，containerId 无 -gk 后缀', async () => {
    const deps = makeDeps();
    const task = {
      id: 'aaaabbbb-cccc-dddd-eeee-ffff00008888',
      title: 'claude task',
      payload: {
        orchestrator: 'skill-relay',
        sprint_dir: 'sprints/test-claude',
      },
    };
    await spawnSkillRelaySession(task, deps);

    const spawnOpts = deps.spawnFn.mock.calls[0][0];
    expect(spawnOpts.env.CECELIA_EXECUTOR).toBe('claude');
    expect(spawnOpts.containerId).not.toMatch(/-gk$/);
  });

  it('_activeCodexRelays 守门在 grok 路径无效（grok 初版不限并发）', async () => {
    vi.stubEnv('GROK_RELAY_HOME', '/tmp/fake-grok-home');
    // 模拟 codex 守卫已有活跃任务（只影响 codex 路径，grok 不受影响）
    const { _setActiveCodexRelays } = await import('../../../packages/brain/src/harness-skill-relay.js');
    _setActiveCodexRelays(1);

    const deps = makeDeps();
    const task = makeGrokTask();
    const r = await spawnSkillRelaySession(task, deps);

    _setActiveCodexRelays(0); // 清理

    expect(r.ok).toBe(true);
    expect(deps.spawnFn).toHaveBeenCalledOnce();
  });
});
