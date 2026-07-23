/**
 * GP2/T2 executor 派发接线（DoD F2）。
 * dispatch 分支/override 排除用源码断言（同 all-features-smoke.test.js 读源模式）——
 * executeTask 全链需重基建 fake，接线正确性由字面量条件保证。
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EXECUTOR_KIND_FOR } from '../executor-contracts.js';
import { routeTaskCreate } from '../task-router.js';
import { spawnSkillRelaySession } from '../harness-skill-relay.js';

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../executor.js'), 'utf8'
);

describe('executor: golden_path_proposal 派发接线', () => {
  it('EXECUTOR_KIND_FOR 打标 relay-container', () => {
    expect(EXECUTOR_KIND_FOR.golden_path_proposal).toBe('relay-container');
  });

  it('dispatch 分支覆盖 golden_path_proposal（复用 runHarnessInitiativeRouter）', () => {
    expect(SRC).toMatch(
      /task\.task_type === 'harness_initiative' \|\| task\.task_type === 'golden_path_proposal'/
    );
  });

  it('显式 machine/executor override 排除 golden_path_proposal（防劫持绕过 relay）', () => {
    expect(SRC).toMatch(
      /task\.task_type !== 'harness_initiative' &&\s*task\.task_type !== 'golden_path_proposal'/
    );
  });
});

const DISPATCHER_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../dispatcher.js'), 'utf8'
);

describe('dispatcher: golden_path_proposal 防线接线', () => {
  it('并发 cap 计数 SQL 口径含 golden_path_proposal', () => {
    expect(DISPATCHER_SRC).toMatch(
      /task_type IN \('harness_initiative', 'golden_path_proposal'\)/
    );
  });
  it('INITIATIVE_LOCK_TASK_TYPES 含 golden_path_proposal', () => {
    const lockBlock = DISPATCHER_SRC.match(/INITIATIVE_LOCK_TASK_TYPES = \[[\s\S]*?\]/)[0];
    expect(lockBlock).toContain("'golden_path_proposal',");
  });
  it('needsBridgeCheck 豁免 golden_path_proposal（relay 不依赖 bridge）', () => {
    expect(DISPATCHER_SRC).toMatch(
      /nextTask\.task_type !== 'harness_initiative'\s*&&\s*nextTask\.task_type !== 'golden_path_proposal'/
    );
  });
  it('绝不在 retired 集合（加了 = 派发即 terminal failed）', () => {
    const retiredBlock = DISPATCHER_SRC.match(/_RETIRED_HARNESS_TYPES_DISPATCH = new Set\(\[[\s\S]*?\]\)/)[0];
    expect(retiredBlock).not.toContain('golden_path_proposal');
  });
});

describe('E2E smoke（DoD F2）：golden_path_proposal 路由→orchestrator校验→loadSkill 全链', () => {
  const gpTask = {
    id: 'aaaabbbb-cccc-dddd-eeee-ffff00000002',
    title: 'GP 提案 smoke',
    task_type: 'golden_path_proposal',
    payload: { orchestrator: 'skill-relay', sprint_dir: 'sprints/gp-smoke' },
  };

  function makeSmokeDeps(overrides = {}) {
    return {
      pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
      spawnFn: vi.fn().mockResolvedValue({ containerId: 'cid', dockerStdout: 'x' }),
      loadSkill: vi.fn().mockReturnValue('SKILL golden-path-controller 全文'),
      ensureWt: vi.fn().mockResolvedValue('/tmp/wt/gp-smoke'),
      resolveAccountFn: vi.fn().mockImplementation(async (o) => { o.env = o.env || {}; o.env.CECELIA_CREDENTIALS = 'account1'; }),  // 新契约（5167ef48）：claude 需已解析账号
      tokenFn: vi.fn().mockResolvedValue('gh-token'),
      now: () => new Date('2026-07-12T04:00:00Z'),
      execFn: vi.fn().mockReturnValue(''),
      ...overrides,
    };
  }

  it('task-router 路由通过（us + /golden-path-controller）', () => {
    const r = routeTaskCreate({ title: gpTask.title, task_type: gpTask.task_type });
    expect(r.location).toBe('us');
    expect(r.skill).toBe('/golden-path-controller');
  });

  it('relay spawn 全链通且 loadSkill 收到 golden-path-controller', async () => {
    const deps = makeSmokeDeps();
    const r = await spawnSkillRelaySession(gpTask, deps);
    expect(r.ok).toBe(true);
    expect(deps.loadSkill).toHaveBeenCalledWith('golden-path-controller');
  });

  it('skill 未部署 → loadSkill throw → 硬失败不 spawn 半截 session（明确报错）', async () => {
    const deps = makeSmokeDeps({
      loadSkill: vi.fn(() => { throw new Error('loadSkillContent: SKILL.md not found for golden-path-controller'); }),
    });
    const r = await spawnSkillRelaySession(gpTask, deps);
    expect(r.ok).toBe(false);
    expect(deps.spawnFn).not.toHaveBeenCalled();
  });
});
