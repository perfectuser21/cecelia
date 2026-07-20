/**
 * TDD Red 基线 — grok executor relay 合同测试
 *
 * Sprint: sprints/07201315-relay-a598772e
 * 任务: a598772e — harness relay 收编 grok executor
 * 状态: RED（实现前跑这些测试必须失败，实现后全部变绿）
 *
 * 覆盖的 FR：
 *   FR-1: executor 白名单扩展（task-tasks.js）
 *   FR-2~4: isGrok 分支 + 凭据挂载 + initiative_runs 落行
 *   FR-5: 单 slot 串行守门
 *   FR-6: 撞墙 fallback → 降级 claude 重试一次
 *   FR-7: headed 模式 grok 映射
 *
 * 铁律覆盖：
 *   - 禁止写死环境假设值（GROK_RELAY_HOME 从 env 读）
 *   - 凭据安全（仅 extraMounts，不复制）
 *   - 单 slot 串行（_activeGrokRelays + DB 守门）
 *   - headed relay 点火必须写 base_repo/pr_url
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { spawnSkillRelaySession, HEADED_HOSTS, HEADED_TMUX_PREFIXES } from '../../../packages/brain/src/harness-skill-relay.js';
import { detectQuotaWall } from '../../../scripts/dispatch-worker.mjs';

// ─── 公共 makeDeps ────────────────────────────────────────────────────────────

function makeDeps(overrides = {}) {
  return {
    pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
    spawnFn: vi.fn().mockResolvedValue({ containerId: 'cid', dockerStdout: 'x' }),
    loadSkill: vi.fn().mockReturnValue('SKILL_CONTENT_MARKER harness-controller 指令全文'),
    ensureWt: vi.fn().mockResolvedValue('/tmp/wt/task-groktest1'),
    resolveAccountFn: vi.fn().mockResolvedValue(undefined),
    tokenFn: vi.fn().mockResolvedValue('gh-token'),
    now: () => new Date('2026-07-20T12:00:00Z'),
    execFn: vi.fn().mockReturnValue(''), // docker ps 无存活容器
    ...overrides,
  };
}

const GROK_TASK = {
  id: 'grok1111-2222-3333-4444-555566667777',
  title: 'grok-relay-e2e-验收',
  payload: {
    orchestrator: 'skill-relay',
    executor: 'grok',
    sprint_dir: 'sprints/07201315-relay-a598772e',
    journey_id: 'j-grok-test',
  },
};

afterEach(() => {
  vi.unstubAllEnvs();
});

// ─── FR-1: executor 白名单 ────────────────────────────────────────────────────

describe('FR-1: task-tasks.js executor 白名单扩展（grok）', () => {
  it('harness-skill-relay.js 源码: executor===grok 分支存在', async () => {
    // 静态断言：实现后此正则必须命中
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../../../packages/brain/src/harness-skill-relay.js', import.meta.url),
      'utf8'
    );
    expect(src).toMatch(/executor\s*===?\s*['"]grok['"]/);
  });

  it('task-tasks.js 源码: grok 加入 executor 白名单', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../../../packages/brain/src/routes/task-tasks.js', import.meta.url),
      'utf8'
    );
    // 白名单行必须含 grok
    expect(src).toMatch(/executor.*grok|grok.*executor/);
    // 旧的错误文案不再把 grok 挡在外面
    expect(src).not.toMatch(/executor must be claude or codex(?!'.*grok)/);
  });
});

// ─── FR-2: isGrok 分支 + 凭据挂载 ────────────────────────────────────────────

describe('FR-2: isGrok happy path — 凭据挂载 + 容器命名 + env 注入', () => {
  it('executor=grok + GROK_RELAY_HOME 已配置 → extraMounts 含 grok 凭据挂载', async () => {
    vi.stubEnv('GROK_RELAY_HOME', '/tmp/fake-grok-home');
    const deps = makeDeps();

    const r = await spawnSkillRelaySession(GROK_TASK, deps);

    expect(r.ok).toBe(true);
    expect(deps.spawnFn).toHaveBeenCalledOnce();
    const spawnOpts = deps.spawnFn.mock.calls[0][0];
    // 铁律：凭据安全 — 只挂载，不复制
    expect(spawnOpts.extraMounts).toContain('/tmp/fake-grok-home:/home/cecelia/.grok:rw');
  });

  it('executor=grok → 容器命名后缀为 -gk（对齐 codex 的 -cx）', async () => {
    vi.stubEnv('GROK_RELAY_HOME', '/tmp/fake-grok-home');
    const deps = makeDeps();

    await spawnSkillRelaySession(GROK_TASK, deps);

    const spawnOpts = deps.spawnFn.mock.calls[0][0];
    expect(spawnOpts.containerId).toMatch(/^cecelia-relay-grok1111-gk$/);
  });

  it('executor=grok → CECELIA_EXECUTOR=grok 注入 env', async () => {
    vi.stubEnv('GROK_RELAY_HOME', '/tmp/fake-grok-home');
    const deps = makeDeps();

    await spawnSkillRelaySession(GROK_TASK, deps);

    const spawnOpts = deps.spawnFn.mock.calls[0][0];
    expect(spawnOpts.env.CECELIA_EXECUTOR).toBe('grok');
  });

  it('executor 缺省（claude）→ extraMounts 不含 grok 路径（零回归）', async () => {
    vi.stubEnv('GROK_RELAY_HOME', '/tmp/fake-grok-home');
    const nonGrokTask = {
      id: 'claude111-2222-3333-4444-555566667777',
      title: 'claude task',
      payload: { orchestrator: 'skill-relay', sprint_dir: 'sprints/test' },
    };
    const deps = makeDeps();

    const r = await spawnSkillRelaySession(nonGrokTask, deps);

    expect(r.ok).toBe(true);
    const spawnOpts = deps.spawnFn.mock.calls[0][0];
    const mounts = spawnOpts.extraMounts ?? [];
    expect(mounts.some((m) => m.includes('.grok'))).toBe(false);
  });
});

// ─── FR-3: GROK_RELAY_HOME 门禁 ──────────────────────────────────────────────

describe('FR-3: GROK_RELAY_HOME 凭据门禁', () => {
  it('GROK_RELAY_HOME="" → 不 spawn，ok=false，task 回滚（铁律：禁止写死环境假设值）', async () => {
    vi.stubEnv('GROK_RELAY_HOME', '');
    const deps = makeDeps();

    const r = await spawnSkillRelaySession(GROK_TASK, deps);

    expect(r.ok).toBe(false);
    expect(deps.spawnFn).not.toHaveBeenCalled();
    // task 回滚到 queued
    const rollback = deps.pool.query.mock.calls.find(
      ([sql]) => /UPDATE tasks.*queued/.test(sql) || (/UPDATE tasks/.test(sql) && /claimed_by.*NULL/.test(sql))
    );
    expect(rollback, 'GROK_RELAY_HOME="" 必须回滚 task').toBeTruthy();
  });

  it('GROK_RELAY_HOME 未定义（undefined）→ 允许继续 spawn（测试/本地 env 免配）', async () => {
    // 确保 GROK_RELAY_HOME 未设
    const deps = makeDeps();

    const r = await spawnSkillRelaySession(GROK_TASK, deps);

    // 允许继续——spawnFn 被调用（未配置不强制失败，对齐 codex 语义）
    expect(deps.spawnFn).toHaveBeenCalledOnce();
    expect(r.ok).toBe(true);
  });
});

// ─── FR-4: initiative_runs 落行 ───────────────────────────────────────────────

describe('FR-4: initiative_runs 落行 orchestrator_host=skill-relay-grok', () => {
  it('executor=grok → initiative_runs INSERT 用 skill-relay-grok + 8h deadline', async () => {
    vi.stubEnv('GROK_RELAY_HOME', '/tmp/fake-grok-home');
    const deps = makeDeps();

    await spawnSkillRelaySession(GROK_TASK, deps);

    const insertCall = deps.pool.query.mock.calls.find(
      ([sql]) => /INSERT INTO initiative_runs/.test(sql)
    );
    expect(insertCall, '必须 INSERT initiative_runs').toBeTruthy();
    const [sql, params] = insertCall;
    expect(sql).toMatch(/skill-relay-grok/);
    expect(sql).toMatch(/8 hours/);
    expect(params).toContain(GROK_TASK.id);
  });

  it('executor=codex → initiative_runs 仍用 skill-relay-codex（零回归）', async () => {
    vi.stubEnv('CODEX_RELAY_HOME', '/tmp/fake-codex-home');
    const codexTask = {
      id: 'codex111-2222-3333-4444-555566667777',
      title: 'codex task',
      payload: { orchestrator: 'skill-relay', executor: 'codex', sprint_dir: 'sprints/test' },
    };
    const deps = makeDeps();

    await spawnSkillRelaySession(codexTask, deps);

    const insertCall = deps.pool.query.mock.calls.find(
      ([sql]) => /INSERT INTO initiative_runs/.test(sql)
    );
    expect(insertCall).toBeTruthy();
    const [sql] = insertCall;
    expect(sql).toMatch(/skill-relay-codex/);
    expect(sql).not.toMatch(/skill-relay-grok/);
  });
});

// ─── FR-5: 单 slot 串行守门 ───────────────────────────────────────────────────

describe('FR-5: grok 并发守门（铁律：单 slot 串行）', () => {
  it('DB 层：活跃 skill-relay-grok 行存在 → deferred, reason=grok_concurrent_limit', async () => {
    vi.stubEnv('GROK_RELAY_HOME', '/tmp/fake-grok-home');
    const deps = makeDeps({
      pool: {
        query: vi.fn().mockImplementation((sql) => {
          // DB 守门查询：orchestrator_host='skill-relay-grok' → count=1
          if (/skill-relay-grok/.test(sql) && /COUNT/.test(sql)) {
            return Promise.resolve({ rows: [{ count: '1' }] });
          }
          return Promise.resolve({ rows: [] });
        }),
      },
    });

    const r = await spawnSkillRelaySession(GROK_TASK, deps);

    expect(r.ok).toBe(false);
    expect(r.deferred).toBe(true);
    expect(r.reason).toBe('grok_concurrent_limit');
    expect(deps.spawnFn).not.toHaveBeenCalled();
  });

  it('DB 层：无活跃 skill-relay-grok 行 → 正常 spawn', async () => {
    vi.stubEnv('GROK_RELAY_HOME', '/tmp/fake-grok-home');
    const deps = makeDeps({
      pool: {
        query: vi.fn().mockResolvedValue({ rows: [{ count: '0' }] }),
      },
    });

    const r = await spawnSkillRelaySession(GROK_TASK, deps);

    expect(r.ok).toBe(true);
    expect(deps.spawnFn).toHaveBeenCalledOnce();
  });

  it('DB 守门查询失败（网络故障）→ 保守通过（fail-open），继续 spawn', async () => {
    vi.stubEnv('GROK_RELAY_HOME', '/tmp/fake-grok-home');
    let callCount = 0;
    const deps = makeDeps({
      pool: {
        query: vi.fn().mockImplementation((sql) => {
          if (/skill-relay-grok/.test(sql) && /COUNT/.test(sql)) {
            callCount++;
            return Promise.reject(new Error('db connection lost'));
          }
          return Promise.resolve({ rows: [] });
        }),
      },
    });

    const r = await spawnSkillRelaySession(GROK_TASK, deps);

    expect(r.ok).toBe(true);
    expect(deps.spawnFn).toHaveBeenCalledOnce();
  });
});

// ─── FR-6: 撞墙 fallback ──────────────────────────────────────────────────────

describe('FR-6: 撞墙 fallback — detectQuotaWall + 降级 claude 重试一次', () => {
  it('detectQuotaWall: QUOTA_WALL_PATTERNS 各模式命中', () => {
    expect(detectQuotaWall('out of credits, please upgrade')).toBe(true);
    expect(detectQuotaWall('Error: rate limit exceeded')).toBe(true);
    expect(detectQuotaWall('HTTP 429 Too Many Requests')).toBe(true);
    expect(detectQuotaWall('quota exceeded for this period')).toBe(true);
    expect(detectQuotaWall('usage limit reached')).toBe(true);
  });

  it('detectQuotaWall: 正常输出不触发', () => {
    expect(detectQuotaWall('task completed successfully')).toBe(false);
    expect(detectQuotaWall('PR created: https://github.com/...')).toBe(false);
    expect(detectQuotaWall('')).toBe(false);
    expect(detectQuotaWall(null)).toBe(false);
  });

  it('grok 撞墙时 spawnSkillRelaySession 降级 claude 重试一次', async () => {
    // 模拟：grok spawn 成功但 stdout 含撞墙信号
    vi.stubEnv('GROK_RELAY_HOME', '/tmp/fake-grok-home');
    const quotaOutput = 'Error: out of credits. Please upgrade your plan.';
    const deps = makeDeps({
      spawnFn: vi.fn()
        .mockResolvedValueOnce({ containerId: 'gk-cid', dockerStdout: quotaOutput }) // grok 撞墙
        .mockResolvedValueOnce({ containerId: 'cl-cid', dockerStdout: 'success' }),   // claude 重试
    });

    const r = await spawnSkillRelaySession(GROK_TASK, deps);

    // 期望：ok=true（降级成功），并且 spawnFn 被调用两次（grok + claude 重试）
    expect(deps.spawnFn).toHaveBeenCalledTimes(2);
    const secondCall = deps.spawnFn.mock.calls[1][0];
    // 第二次调用应为 claude executor（降级）
    expect(secondCall.env.CECELIA_EXECUTOR).toBe('claude');
    expect(r.ok).toBe(true);
    expect(r.fallback).toBe('claude');
  });

  it('grok 撞墙后降级 claude 也失败 → ok=false', async () => {
    vi.stubEnv('GROK_RELAY_HOME', '/tmp/fake-grok-home');
    const deps = makeDeps({
      spawnFn: vi.fn()
        .mockResolvedValueOnce({ containerId: 'gk-cid', dockerStdout: 'out of credits' })
        .mockRejectedValueOnce(new Error('claude spawn also failed')),
    });

    const r = await spawnSkillRelaySession(GROK_TASK, deps);

    expect(r.ok).toBe(false);
  });
});

// ─── FR-7: headed 模式 grok 映射 ─────────────────────────────────────────────

describe('FR-7: headed 模式 grok 映射（铁律：headed relay 点火必须写 base_repo/pr_url）', () => {
  it('HEADED_HOSTS 含 grok: skill-relay-grok-headed', () => {
    expect(HEADED_HOSTS).toHaveProperty('grok');
    expect(HEADED_HOSTS.grok).toBe('skill-relay-grok-headed');
  });

  it('HEADED_TMUX_PREFIXES 含 grok: grok-relay-', () => {
    expect(HEADED_TMUX_PREFIXES).toHaveProperty('grok');
    expect(HEADED_TMUX_PREFIXES.grok).toBe('grok-relay-');
  });

  it('headed + executor=grok → orchestrator_host=skill-relay-grok-headed 落行', async () => {
    const headedGrokTask = {
      id: 'grokhead-2222-3333-4444-555566667777',
      title: 'grok headed test',
      payload: {
        orchestrator: 'skill-relay',
        executor: 'grok',
        mode: 'headed',
        sprint_dir: 'sprints/07201315-relay-a598772e',
        base_repo: 'cecelia',   // 铁律：headed relay 必须写 base_repo
      },
    };
    const deps = makeDeps({
      // 雷11 tmux 探活：返回 TMUX_DEAD 放行 spawn
      execFn: vi.fn().mockReturnValue('TMUX_DEAD'),
      sshSpawnFn: vi.fn().mockResolvedValue({}),
    });

    const r = await spawnSkillRelaySession(headedGrokTask, deps);

    expect(r.ok).toBe(true);
    // initiative_runs INSERT 必须用 skill-relay-grok-headed
    const insertCall = deps.pool.query.mock.calls.find(
      ([sql]) => /INSERT INTO initiative_runs/.test(sql)
    );
    expect(insertCall).toBeTruthy();
    const [sql] = insertCall;
    expect(sql).toMatch(/skill-relay-grok-headed/);
  });

  it('headed + executor=codex → HEADED_HOSTS.codex 不变（零回归）', () => {
    expect(HEADED_HOSTS.codex).toBe('skill-relay-codex-headed');
    expect(HEADED_TMUX_PREFIXES.codex).toBe('codex-relay-');
  });

  it('headed + executor=claude → HEADED_HOSTS.claude 不变（零回归）', () => {
    expect(HEADED_HOSTS.claude).toBe('skill-relay-claude-headed');
    expect(HEADED_TMUX_PREFIXES.claude).toBe('claude-relay-');
  });
});

// ─── 日志脱敏验证（铁律）────────────────────────────────────────────────────

describe('日志脱敏（铁律：容器日志不打印 grok auth token）', () => {
  it('harness-skill-relay.js 源码：日志行不打印 GROK_RELAY_HOME 变量内容', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../../../packages/brain/src/harness-skill-relay.js', import.meta.url),
      'utf8'
    );
    // 日志行不应该 log grokRelayHome 变量的值（防 auth token 泄露）
    // 合法：console.log('[skill-relay] session spawned: ... executor=grok')
    // 违规：console.log(`... grokRelayHome=${grokRelayHome}`)
    const logLines = src.split('\n').filter((l) => /console\.(log|warn|error)/.test(l) && /grokRelayHome/.test(l));
    const leakLines = logLines.filter((l) => /grokRelayHome\s*}/.test(l) || /\${grokRelayHome}/.test(l));
    expect(leakLines, '日志行不得打印 grokRelayHome 值').toHaveLength(0);
  });
});

// ─── smoke 脚本存在性验证 ─────────────────────────────────────────────────────

describe('smoke 登记纪律（铁律）', () => {
  it('relay-grok-executor-smoke.sh 存在（与 PR 同批产出）', async () => {
    const { existsSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { resolve, dirname } = await import('node:path');
    const dir = dirname(fileURLToPath(import.meta.url));
    const smokeScript = resolve(dir, '../../../packages/brain/scripts/smoke/relay-grok-executor-smoke.sh');
    expect(existsSync(smokeScript), 'relay-grok-executor-smoke.sh 必须存在').toBe(true);
  });

  it('relay-grok-executor-smoke.sh 已登记进 smoke-allowlist.txt', async () => {
    const { readFileSync, existsSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { resolve, dirname } = await import('node:path');
    const dir = dirname(fileURLToPath(import.meta.url));
    const allowlist = resolve(dir, '../../../packages/brain/scripts/smoke/smoke-allowlist.txt');
    if (!existsSync(allowlist)) {
      throw new Error('smoke-allowlist.txt 不存在，铁律：smoke 登记纪律违反');
    }
    const content = readFileSync(allowlist, 'utf8');
    expect(content).toMatch(/relay-grok-executor-smoke\.sh/);
  });
});
