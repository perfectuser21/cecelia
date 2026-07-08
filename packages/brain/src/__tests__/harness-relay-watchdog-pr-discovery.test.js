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

import {
  resumeStalledRelayRuns,
  _parseBaseRepo,
  _discoverPrFromGithub,
} from '../harness-relay-watchdog.js';

const TASK_ID = 'aaaabbbb-cccc-dddd-eeee-ffff00001111';
const SHORT = 'aaaabbbb';
const BASE_REPO = 'https://github.com/org/repo.git';
const OPEN_PR = { headRefName: `cp-07081025-ws-${SHORT}`, url: 'https://github.com/org/repo/pull/7', state: 'OPEN' };
const MERGED_PR = { headRefName: `cp-07080901-${SHORT}`, url: 'https://github.com/org/repo/pull/6', state: 'MERGED' };

function makeDeps({ baseRepo = BASE_REPO, ghList = null, ghListThrows = false } = {}) {
  const pool = { query: vi.fn() };
  pool.query.mockImplementation(async (sql) => {
    if (/DISTINCT ON \(initiative_id\)/.test(sql)) {
      return { rows: [{ initiative_id: TASK_ID, phase: 'planning', attempts: '2', deadline_at: new Date(Date.now() + 3600e3).toISOString(), pr_url: null, orchestrator_host: 'skill-relay-session' }] };
    }
    if (/FROM tasks/.test(sql)) {
      return { rows: [{ id: TASK_ID, status: 'in_progress', title: 't', pr_url: null, payload: { orchestrator: 'skill-relay', base_repo: baseRepo } }] };
    }
    return { rows: [] };
  });
  const execFn = vi.fn().mockImplementation((cmd) => {
    if (/docker ps/.test(cmd)) return ''; // 容器已消失
    if (/gh pr list/.test(cmd)) {
      if (ghListThrows) throw new Error('gh boom');
      return JSON.stringify(ghList ?? []);
    }
    return '';
  });
  return { pool, execFn, spawnFn: vi.fn().mockResolvedValue({ ok: true, containerId: 'x' }) };
}

beforeEach(() => mockPool.query.mockReset());

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
