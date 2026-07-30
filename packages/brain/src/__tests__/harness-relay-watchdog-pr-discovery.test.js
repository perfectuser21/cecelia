/**
 * relay watchdog PR 发现护栏（Issue 198ba8db）：
 * relay session 不回写 pr_url → 既有 MERGED 护栏（读 DB 三处 pr_url）失明 →
 * 容器消失被误判死跑 → 重复点火 → 同任务重复产出多个 PR
 * （5d090237 实证：5 attempt / 4 个重复 open PR）。
 * 本文件锁定：容器消失且 DB 无 pr_url 时，先从 GitHub 按分支名含 task short 反查 PR。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPool } = vi.hoisted(() => ({ mockPool: { query: vi.fn() } }));
vi.mock('../db.js', () => ({ default: mockPool }));
vi.mock('../notifier.js', () => ({ sendBark: vi.fn().mockResolvedValue(true) }));
vi.mock('../orchestrator/kernel-run-store.js', () => ({
  patchKernelRunById: async (db, input) => {
    await db.query(
      `UPDATE initiative_runs SET phase='${input.phase}',
         failure_reason=COALESCE(failure_reason, '${input.failureReason ?? ''}'),
         pr_url=COALESCE(pr_url, $2) WHERE id=$1`,
      [input.runId, input.prUrl],
    );
    await db.query(`UPDATE tasks SET status='${input.phase === 'done' ? 'completed' : 'failed'}'`);
    return { id: input.runId, phase: input.phase };
  },
}));

import {
  resumeStalledRelayRuns,
  _parseBaseRepo,
  _discoverPrFromGithub,
} from '../harness-relay-watchdog.js';
import { sendBark } from '../notifier.js';

const TASK_ID = 'aaaabbbb-cccc-dddd-eeee-ffff00001111';
const SHORT = 'aaaabbbb';
const BASE_REPO = 'https://github.com/org/repo.git';
const OPEN_PR = { headRefName: `cp-07081025-ws-${SHORT}`, url: 'https://github.com/org/repo/pull/7', state: 'OPEN' };
const MERGED_PR = { headRefName: `cp-07080901-${SHORT}`, url: 'https://github.com/org/repo/pull/6', state: 'MERGED' };

function makeDeps({
  baseRepo = BASE_REPO,
  ghList = null,
  ghListThrows = false,
  runPrUrl = null,     // 第二轮回归：模拟 DB 里 run.pr_url 已非空（第一轮已发现并回写）
  prViewState = null,  // 配合 runPrUrl：execFn 对 `gh pr view` 的返回 state
  evaluatorGate = true, // initiative_run_events 是否存在 node='evaluator' AND status='done'
} = {}) {
  const pool = { query: vi.fn() };
  pool.query.mockImplementation(async (sql) => {
    if (/FROM initiative_runs r/.test(sql)) {
      return { rows: [{ id: '11111111-1111-4111-8111-111111111111', initiative_id: TASK_ID, current_task_id: TASK_ID, phase: 'planning', attempts: '2', deadline_at: new Date(Date.now() + 3600e3).toISOString(), pr_url: runPrUrl, orchestrator_host: 'skill-relay-session' }] };
    }
    if (/FROM tasks/.test(sql)) {
      return { rows: [{ id: TASK_ID, status: 'in_progress', title: 't', pr_url: null, payload: { orchestrator: 'skill-relay', base_repo: baseRepo } }] };
    }
    if (/FROM initiative_run_events/.test(sql)) {
      return { rows: evaluatorGate ? [{ x: 1 }] : [] };
    }
    return { rows: [] };
  });
  const execFn = vi.fn().mockImplementation((cmd) => {
    if (/docker ps/.test(cmd)) return ''; // 容器已消失
    if (/gh pr view/.test(cmd) && prViewState) return JSON.stringify({ state: prViewState });
    if (/gh pr list/.test(cmd)) {
      if (ghListThrows) throw new Error('gh boom');
      return JSON.stringify(ghList ?? []);
    }
    return '';
  });
  return { pool, execFn, spawnFn: vi.fn().mockResolvedValue({ ok: true, containerId: 'x' }) };
}

beforeEach(() => {
  mockPool.query.mockReset();
  sendBark.mockClear();
});

describe('watchdog PR 发现护栏', () => {
  it('gh 发现含 short 的 OPEN PR → 不重点火 + 回写 pr_url 到 run 与 task', async () => {
    const deps = makeDeps({ ghList: [{ headRefName: 'cp-other-11112222', url: 'u', state: 'OPEN' }, OPEN_PR] });
    const r = await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).not.toHaveBeenCalled();
    expect(r.resumed).toBe(0);
    const updates = deps.pool.query.mock.calls.filter((c) => /UPDATE/.test(c[0]));
    expect(updates.some((c) => /initiative_runs/.test(c[0]) && /pr_url/.test(c[0]) && c[1][1] === OPEN_PR.url)).toBe(true);
    expect(updates.some((c) => /UPDATE tasks/.test(c[0]) && /pr_url/.test(c[0]) && c[1][1] === OPEN_PR.url)).toBe(true);
  });

  it('gh 发现含 short 的 MERGED PR → 收敛：run 标 done + task 标 completed，不重点火', async () => {
    const deps = makeDeps({ ghList: [MERGED_PR] });
    const r = await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).not.toHaveBeenCalled();
    expect(r.mergedPr).toBe(1);
    const updates = deps.pool.query.mock.calls.filter((c) => /UPDATE/.test(c[0]));
    expect(updates.some((c) => /initiative_runs/.test(c[0]) && /'done'/.test(c[0]))).toBe(true);
    expect(updates.some((c) => /UPDATE tasks/.test(c[0]) && /'completed'/.test(c[0]))).toBe(true);
  });

  it('gh 发现含 short 的 MERGED PR 但 evaluator 从未执行 → 标 done 打 failure_reason，不重点火', async () => {
    const deps = makeDeps({ ghList: [MERGED_PR], evaluatorGate: false });
    const r = await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).not.toHaveBeenCalled();
    const allCalls = deps.pool.query.mock.calls;
    const updates = allCalls.filter((c) => /UPDATE/.test(c[0]));
    expect(updates.some((c) => /initiative_runs/.test(c[0]) && /'done'/.test(c[0]) && /merged_without_evaluator_gate/.test(c[0]))).toBe(true);
    expect(updates.some((c) => /UPDATE tasks/.test(c[0]) && /'completed'/.test(c[0]))).toBe(true);
    expect(r.mergedWithoutGate).toBe(1);
    expect(allCalls.some((c) => /INSERT INTO issues/.test(c[0]))).toBe(true);
    expect(sendBark).toHaveBeenCalled();
  });

  it('无匹配分支（含 CLOSED 命中不算）→ 原行为：重点火', async () => {
    const deps = makeDeps({ ghList: [
      { headRefName: 'cp-unrelated-99998888', url: 'u1', state: 'OPEN' },
      { headRefName: `cp-07080800-${SHORT}`, url: 'u2', state: 'CLOSED' },
    ] });
    const r = await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).toHaveBeenCalledOnce();
    expect(r.resumed).toBe(1);
  });

  it('base_repo 缺失 → 不调 gh pr list，原行为重点火', async () => {
    const deps = makeDeps({ baseRepo: null });
    const r = await resumeStalledRelayRuns(deps);
    expect(deps.execFn.mock.calls.every((c) => !/gh pr list/.test(c[0]))).toBe(true);
    expect(deps.spawnFn).toHaveBeenCalledOnce();
    expect(r.resumed).toBe(1);
  });

  it('跨轮回归：run.pr_url 第二轮已非空（第一轮已回写）+ PR 仍 OPEN → 不重点火（终审 Critical 修复）', async () => {
    const deps = makeDeps({ runPrUrl: 'https://github.com/org/repo/pull/7', prViewState: 'OPEN' });
    const r = await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).not.toHaveBeenCalled();
    expect(r.resumed).toBe(0);
    // 走的是既有 effectivePrUrl 护栏（gh pr view），不应再落到 gh pr list 反查分支
    const ghCall = deps.execFn.mock.calls.find((c) => /gh pr view/.test(c[0]));
    expect(ghCall).toBeTruthy();
  });

  it('gh pr list 抛错 → 保守跳过：不重点火、不标 failed', async () => {
    const deps = makeDeps({ ghListThrows: true });
    const r = await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).not.toHaveBeenCalled();
    expect(r.resumed).toBe(0);
    expect(r.capped).toBe(0);
    const updates = deps.pool.query.mock.calls.filter((c) => /UPDATE/.test(c[0]));
    expect(updates.some((c) => /'failed'/.test(c[0]))).toBe(false);
  });
});

describe('_parseBaseRepo', () => {
  it('github https URL（带/不带 .git、尾斜杠）→ owner/repo', () => {
    expect(_parseBaseRepo('https://github.com/org/repo.git')).toBe('org/repo');
    expect(_parseBaseRepo('https://github.com/org/repo')).toBe('org/repo');
    expect(_parseBaseRepo('https://github.com/org/repo/')).toBe('org/repo');
  });
  it('本地路径 / 非 github / 含非法字符 → null', () => {
    expect(_parseBaseRepo('/Users/x/repo')).toBe(null);
    expect(_parseBaseRepo('https://gitlab.com/org/repo')).toBe(null);
    expect(_parseBaseRepo('https://github.com/org/re;po')).toBe(null);
    expect(_parseBaseRepo(null)).toBe(null);
  });
});

describe('_discoverPrFromGithub', () => {
  it('MERGED 优先于 OPEN', () => {
    const execFn = () => JSON.stringify([
      { headRefName: `cp-a-${SHORT}`, url: 'u-open', state: 'OPEN' },
      { headRefName: `cp-b-${SHORT}`, url: 'u-merged', state: 'MERGED' },
    ]);
    const task = { payload: { base_repo: BASE_REPO } };
    expect(_discoverPrFromGithub(task, SHORT, execFn)).toMatchObject({ url: 'u-merged', state: 'MERGED' });
  });
});

describe('_discoverPrFromGithub — 标题 [短号] 匹配（FR-2/3/4）', () => {

  // [BEHAVIOR-1] 核心 bug fix：标题命中，分支名不含 short → 修复前 failing
  it('[BEHAVIOR-1] 标题含 [short]、分支名不含 short → 返回该 PR（修复前 failing）', () => {
    const short = 'abcd1234';
    const pr = {
      headRefName: 'cp-xxx-no-short',
      title: 'fix(ci-poll): some description [abcd1234]',
      url: 'https://github.com/org/repo/pull/9',
      state: 'OPEN',
    };
    const execFn = () => JSON.stringify([pr]);
    const task = { payload: { base_repo: BASE_REPO } };
    // 修复前：_discoverPrFromGithub 只匹配 headRefName，返回 null → 测试 FAIL
    // 修复后：增加 title.includes('[abcd1234]') 判断 → 返回 pr → 测试 PASS
    expect(_discoverPrFromGithub(task, short, execFn)).toMatchObject({
      url: 'https://github.com/org/repo/pull/9',
      state: 'OPEN',
    });
  });

  // [BEHAVIOR-2] 分支名命中既有路径不回归
  it('[BEHAVIOR-2] 分支名含 short → 仍然命中（回归保护）', () => {
    const execFn = () => JSON.stringify([
      { headRefName: `cp-${SHORT}-ws`, title: 'some unrelated title', url: 'u-branch', state: 'OPEN' },
    ]);
    const task = { payload: { base_repo: BASE_REPO } };
    const result = _discoverPrFromGithub(task, SHORT, execFn);
    expect(result).not.toBeNull();
    expect(result.headRefName).toContain(SHORT);
  });

  // [BEHAVIOR-3] MERGED（标题命中）优先于 OPEN（分支名命中）
  it('[BEHAVIOR-3] MERGED（标题命中）优先于 OPEN（分支名命中）', () => {
    const execFn = () => JSON.stringify([
      { headRefName: `cp-${SHORT}-ws`, title: 'no', url: 'u-open', state: 'OPEN' },
      { headRefName: 'other-branch', title: `fix [${SHORT}]`, url: 'u-merged', state: 'MERGED' },
    ]);
    const task = { payload: { base_repo: BASE_REPO } };
    expect(_discoverPrFromGithub(task, SHORT, execFn)).toMatchObject({
      url: 'u-merged',
      state: 'MERGED',
    });
  });

  // [BEHAVIOR-4] 松散子串（无方括号）不命中 → 返回 null
  it('[BEHAVIOR-4] 标题含 short 但无方括号 → 返回 null（防御松散匹配）', () => {
    const execFn = () => JSON.stringify([
      { headRefName: 'other-branch', title: `fix ${SHORT} issue`, url: 'u', state: 'OPEN' },
    ]);
    const task = { payload: { base_repo: BASE_REPO } };
    expect(_discoverPrFromGithub(task, SHORT, execFn)).toBeNull();
  });

});
