import { describe, it, expect, vi } from 'vitest';
import {
  resolveStagingTarget,
  buildStagingE2eTaskInsert,
  runStagingE2e,
  STAGING_PORT,
} from '../staging-e2e-runner.js';

// ──────────────────────────────────────────────────────────────────────────
// Slice 1 皇冠断言 + 幂等 + verdict 落库 单测
// 设计：staging-e2e-runner.js 是 Brain 内部 handler（不派 agent、不碰 langgraph interrupt）。
// staging_e2e 任务由 mergePrNode merge 成功后 best-effort INSERT 创建，executor 同步执行本 runner。
// ──────────────────────────────────────────────────────────────────────────

describe('resolveStagingTarget — 皇冠断言：E2E 真打到 :5222 staging', () => {
  it('staging 端口固定 5222（不是 production 5221）', () => {
    expect(STAGING_PORT).toBe(5222);
  });

  it('target 解析为 staging 实例 localhost:5222，不是活宿主/PR分支/production', () => {
    const t = resolveStagingTarget({ id: 'task-1', payload: { pr_url: 'https://github.com/x/y/pull/1' } });
    // 皇冠断言：BRAIN_URL/DB 必须指向 staging:5222，绝不能退回 5221 production 或 PR 分支活宿主
    expect(t.stagingPort).toBe(5222);
    expect(t.brainUrl).toContain(':5222');
    expect(t.brainUrl).not.toContain(':5221');
    expect(t.targetEnv).toMatch(/staging/);
    // E2E 容器/host 拿到的目标 DB 必须是 staging 库
    expect(t.dbUrl).toContain('cecelia_staging');
  });
});

describe('buildStagingE2eTaskInsert — merge 后建任务（DB 级幂等）', () => {
  const state = {
    task: { id: 'sub-1', title: 'feat X', payload: { sprint_dir: 'sprints', journey_id: 'line-01', feature_id: 'f1' } },
    initiativeId: 'init-9',
    pr_url: 'https://github.com/x/y/pull/42',
    pr_branch: 'cp-x',
  };

  it('生成 INSERT INTO tasks，task_type=staging_e2e、status=queued', () => {
    const { sql } = buildStagingE2eTaskInsert(state);
    expect(sql).toMatch(/INSERT INTO tasks/i);
    expect(sql).toMatch(/staging_e2e/);
    expect(sql).toMatch(/queued/);
  });

  it('payload 带 pr_url / pr_branch / initiative_id / sprint_dir（供 runner 复用）', () => {
    const { params } = buildStagingE2eTaskInsert(state);
    const payloadStr = params.find((p) => typeof p === 'string' && p.includes('pr_url'));
    expect(payloadStr).toBeTruthy();
    const payload = JSON.parse(payloadStr);
    expect(payload.pr_url).toBe('https://github.com/x/y/pull/42');
    expect(payload.pr_branch).toBe('cp-x');
    expect(payload.initiative_id).toBe('init-9');
    expect(payload.sprint_dir).toBe('sprints');
  });

  it('幂等：SQL 含 pr_url 去重，避免 tick 重入重复建 staging_e2e 任务', () => {
    const { sql } = buildStagingE2eTaskInsert(state);
    // 用 WHERE NOT EXISTS 按 payload->>'pr_url' 去重（tasks 表无 UNIQUE(pr_url)）
    expect(sql).toMatch(/NOT EXISTS|ON CONFLICT/i);
    expect(sql).toMatch(/pr_url/);
  });

  it('无 pr_url → 返回 null（不建任务，防脏数据）', () => {
    const r = buildStagingE2eTaskInsert({ ...state, pr_url: null });
    expect(r).toBeNull();
  });
});

describe('runStagingE2e — 部署 staging + E2E + verdict 落库', () => {
  function makeDeps(overrides = {}) {
    const queries = [];
    return {
      queries,
      deps: {
        deployStaging: vi.fn(async () => ({ ok: true, skipReason: null })),
        runE2eOnStaging: vi.fn(async () => ({ verdict: 'PASS', feedback: 'all green', targetEnv: 'staging' })),
        dbQuery: vi.fn(async (sql, params) => { queries.push({ sql, params }); return { rows: [] }; }),
        ...overrides,
      },
    };
  }
  const task = {
    id: 'se2e-1',
    payload: { pr_url: 'https://github.com/x/y/pull/7', pr_branch: 'cp-y', initiative_id: 'init-1', sprint_dir: 'sprints' },
  };

  it('部署 staging → 跑 E2E → verdict=pass 落 staging_e2e_results（ON CONFLICT DO NOTHING）', async () => {
    const { deps, queries } = makeDeps();
    const res = await runStagingE2e(task, deps);
    expect(deps.deployStaging).toHaveBeenCalled();
    expect(deps.runE2eOnStaging).toHaveBeenCalled();
    const insert = queries.find((q) => /staging_e2e_results/i.test(q.sql));
    expect(insert).toBeTruthy();
    expect(insert.sql).toMatch(/ON CONFLICT.*pr_url.*DO NOTHING/is);
    expect(res.verdict).toBe('pass');
  });

  it('E2E 跑在 staging：runE2eOnStaging 收到的 target 指向 :5222', async () => {
    const { deps } = makeDeps();
    await runStagingE2e(task, deps);
    const e2eArg = deps.runE2eOnStaging.mock.calls[0][0];
    // 皇冠断言（运行时）：E2E runner 拿到的 target 是 staging:5222
    expect(e2eArg.brainUrl).toContain(':5222');
    expect(e2eArg.brainUrl).not.toContain(':5221');
  });

  it('staging 不可用（no_docker）→ verdict=skipped 落库，不抛错（优雅降级）', async () => {
    const { deps, queries } = makeDeps({
      deployStaging: vi.fn(async () => ({ ok: false, skipReason: 'no_docker' })),
    });
    const res = await runStagingE2e(task, deps);
    expect(res.verdict).toBe('skipped');
    expect(deps.runE2eOnStaging).not.toHaveBeenCalled();
    const insert = queries.find((q) => /staging_e2e_results/i.test(q.sql));
    expect(insert.params).toContain('skipped');
    expect(insert.params).toContain('no_docker');
  });

  it('E2E 失败 → verdict=fail 落库（silent-success 被挡住）', async () => {
    const { deps } = makeDeps({
      runE2eOnStaging: vi.fn(async () => ({ verdict: 'FAIL', feedback: 'db row missing', targetEnv: 'staging' })),
    });
    const res = await runStagingE2e(task, deps);
    expect(res.verdict).toBe('fail');
  });
});
