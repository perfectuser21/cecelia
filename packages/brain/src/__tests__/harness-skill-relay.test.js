/**
 * N3 skill-relay 最小接线（harness-skill-relay initiative，主理人 2026-07-04 拍板）：
 * task.payload.orchestrator==='skill-relay' → spawn 单 claude session 跑 harness-controller skill，
 * 不 compile / 不 invoke LangGraph 图。双轨：flag 缺省走原图路径，零行为变化。
 *
 * PrepPRD: sprints/07041621-harness-skill-relay-wiring/prep-prd.md
 */
import { describe, it, expect, vi } from 'vitest';
import { spawnSkillRelaySession, isSkillRelayTask } from '../harness-skill-relay.js';

const TASK = {
  id: 'aaaabbbb-cccc-dddd-eeee-ffff00001111',
  title: '测试 initiative',
  payload: {
    orchestrator: 'skill-relay',
    sprint_dir: 'sprints/07049999-test',
    journey_id: 'j-1',
  },
};

function makeDeps(overrides = {}) {
  return {
    pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
    spawnFn: vi.fn().mockResolvedValue({ containerId: 'cid', dockerStdout: 'x' }),
    loadSkill: vi.fn().mockReturnValue('SKILL_CONTENT_MARKER harness-controller 指令全文'),
    ensureWt: vi.fn().mockResolvedValue('/tmp/wt/task-aaaabbbb'),
    resolveAccountFn: vi.fn().mockResolvedValue(undefined),
    tokenFn: vi.fn().mockResolvedValue('gh-token'),
    now: () => new Date('2026-07-04T12:00:00Z'),
    ...overrides,
  };
}

describe('isSkillRelayTask', () => {
  it('payload.orchestrator=skill-relay → true', () => {
    expect(isSkillRelayTask(TASK)).toBe(true);
  });
  it('flag 缺省/其他值 → false（双轨：走原图路径）', () => {
    expect(isSkillRelayTask({ id: 'x', payload: {} })).toBe(false);
    expect(isSkillRelayTask({ id: 'x', payload: { orchestrator: 'langgraph' } })).toBe(false);
    expect(isSkillRelayTask({ id: 'x' })).toBe(false);
  });
});

describe('spawnSkillRelaySession', () => {
  it('happy path：worktree→账号→spawn(prompt 含 skill 内容+上下文头)→initiative_runs 落行', async () => {
    const deps = makeDeps();
    const r = await spawnSkillRelaySession(TASK, deps);

    expect(r.ok).toBe(true);
    expect(r.mode).toBe('skill-relay');
    expect(deps.ensureWt).toHaveBeenCalledOnce();
    expect(deps.resolveAccountFn).toHaveBeenCalledOnce();

    // spawn 参数
    expect(deps.spawnFn).toHaveBeenCalledOnce();
    const spawnOpts = deps.spawnFn.mock.calls[0][0];
    expect(spawnOpts.prompt).toContain('SKILL_CONTENT_MARKER');           // skill 全文 inline
    expect(spawnOpts.prompt).toContain(TASK.id);                          // 上下文头含 task id
    expect(spawnOpts.prompt).toContain('sprints/07049999-test');          // 上下文头含 sprint_dir
    expect(spawnOpts.containerId).toMatch(/^cecelia-relay-aaaabbbb-/);    // 命名规约
    expect(spawnOpts.env.HARNESS_TASK_ID).toBe(TASK.id);
    expect(spawnOpts.env.HARNESS_INITIATIVE_ID).toBe(TASK.id);            // B51: initiative_id=task.id
    expect(spawnOpts.env.HARNESS_SPRINT_DIR).toBe('sprints/07049999-test');
    expect(spawnOpts.env.GITHUB_TOKEN).toBe('gh-token');
    expect(spawnOpts.env.CECELIA_TASK_TYPE).toBe('harness_controller');

    // initiative_runs 落行：A_planning（现有 watchdog 白名单内）+ v2 + 6h deadline
    const insertCall = deps.pool.query.mock.calls.find(
      ([sql]) => /INSERT INTO initiative_runs/.test(sql)
    );
    expect(insertCall, '必须 INSERT initiative_runs').toBeTruthy();
    const [sql] = insertCall;
    expect(sql).toContain('A_planning');
    expect(sql).toMatch(/orchestrator_version/);
    expect(sql).toMatch(/deadline_at/);
  });

  it('spawn 失败 → ok=false 带错误，不落 initiative_runs 成功语义', async () => {
    const deps = makeDeps({ spawnFn: vi.fn().mockRejectedValue(new Error('docker down')) });
    const r = await spawnSkillRelaySession(TASK, deps);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('docker down');
  });

  it('sprint_dir 缺省时自动生成（relay-<task8> 规约），并注入 prompt', async () => {
    const deps = makeDeps();
    const task = { ...TASK, payload: { orchestrator: 'skill-relay' } };
    const r = await spawnSkillRelaySession(task, deps);
    expect(r.ok).toBe(true);
    const spawnOpts = deps.spawnFn.mock.calls[0][0];
    expect(spawnOpts.env.HARNESS_SPRINT_DIR).toMatch(/^sprints\/\d{8}-relay-aaaabbbb$/);
  });

  it('loadSkill 抛错（skill 未部署）→ ok=false，不 spawn', async () => {
    const deps = makeDeps({ loadSkill: vi.fn(() => { throw new Error('skill not found'); }) });
    const r = await spawnSkillRelaySession(TASK, deps);
    expect(r.ok).toBe(false);
    expect(deps.spawnFn).not.toHaveBeenCalled();
  });
});

describe('router 集成：flag 命中不碰图', async () => {
  it('runHarnessInitiativeRouter 对 skill-relay 任务不 compile 图', async () => {
    const { runHarnessInitiativeRouter } = await import('../executor.js');
    const compiled = new Proxy({}, { get() { throw new Error('graph must not be touched'); } });
    const deps = makeDeps();
    const r = await runHarnessInitiativeRouter(TASK, {
      pool: deps.pool,
      compiled,
      skillRelayDeps: deps,
    });
    expect(r.ok).toBe(true);
    expect(r.mode).toBe('skill-relay');
    expect(deps.spawnFn).toHaveBeenCalledOnce();
  });
});

describe('默认 deps 的 import 来源（N4 run-1 实证 bug：resolveGitHubToken 不在 harness-utils）', () => {
  it('源码从 harness-credentials.js 取 resolveGitHubToken', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../harness-skill-relay.js', import.meta.url), 'utf8');
    expect(src).toMatch(/harness-credentials\.js.*resolveGitHubToken|resolveGitHubToken[\s\S]{0,80}harness-credentials\.js/);
    expect(src).not.toMatch(/harness-utils\.js'\)\)\.resolveGitHubToken/);
  });

  it('harness-credentials.js 真的导出 resolveGitHubToken（防再猜错模块）', async () => {
    const mod = await import('../harness-credentials.js');
    expect(typeof mod.resolveGitHubToken).toBe('function');
  });
});
