/**
 * relay watchdog（重点火循环产品化）+ PATCH phase 白名单扩展（进度条数据源）。
 *
 * 背景（eval-1 实证）：relay session 会在 25-47 turns 后自判完成早退（prompt 拦不住），
 * 根治 = 外部有界重点火——外部真相接续已四次实证，重点火即免费恢复。
 * relay-loop.sh 雏形一轮收敛；本文件将其产品化进 harness watchdog 独立循环。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPool } = vi.hoisted(() => ({ mockPool: { query: vi.fn() } }));
vi.mock('../db.js', () => ({ default: mockPool }));

import { resumeStalledRelayRuns, MAX_RELAY_ATTEMPTS } from '../harness-relay-watchdog.js';

const TASK_ID = 'aaaabbbb-cccc-dddd-eeee-ffff00001111';
const SHORT = 'aaaabbbb';

const PR_URL = 'https://github.com/org/repo/pull/42';

function makeDeps({
  taskStatus = 'in_progress',
  attempts = 2,
  containerRunning = false,
  orchestrator = 'skill-relay',
  prUrl = null,
  taskPrUrl = null,     // tasks.pr_url 列（fallback source 1）
  payloadPrUrl = null,  // tasks.payload.pr_url（fallback source 2）
  prState = null,   // 'MERGED' | 'OPEN' | 'CLOSED' | null（execFn 返回的 gh pr view JSON）
} = {}) {
  const pool = { query: vi.fn() };
  pool.query.mockImplementation(async (sql) => {
    if (/DISTINCT ON \(initiative_id\)/.test(sql)) {
      return { rows: [{ initiative_id: TASK_ID, phase: 'planning', attempts: String(attempts), deadline_at: new Date(Date.now() + 3600e3).toISOString(), pr_url: prUrl }] };
    }
    if (/FROM tasks/.test(sql)) {
      const payload = payloadPrUrl
        ? { orchestrator, pr_url: payloadPrUrl }
        : { orchestrator };
      return { rows: [{ id: TASK_ID, status: taskStatus, title: 't', payload, pr_url: taskPrUrl }] };
    }
    return { rows: [] };
  });
  const execFn = vi.fn().mockImplementation((cmd) => {
    if (/docker ps/.test(cmd)) return containerRunning ? 'abc123\n' : '';
    if (/gh pr view/.test(cmd) && prState) return JSON.stringify({ state: prState });
    return '';
  });
  return {
    pool,
    execFn,
    spawnFn: vi.fn().mockResolvedValue({ ok: true, containerId: 'cecelia-relay-x' }),
  };
}

beforeEach(() => mockPool.query.mockReset());

describe('resumeStalledRelayRuns', () => {
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

  it('payload 非 skill-relay → 跳过（安全护栏，不碰 v1 任务）', async () => {
    const deps = makeDeps({ orchestrator: null });
    const r = await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).not.toHaveBeenCalled();
    expect(r.resumed).toBe(0);
  });

  it('task queued → 跳过（dispatcher 自然路径负责，防双 spawn）', async () => {
    const deps = makeDeps({ taskStatus: 'queued' });
    const r = await resumeStalledRelayRuns(deps);
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

  it('容器消失 + pr_url 存在 + PR OPEN → 正常重点火流程', async () => {
    const deps = makeDeps({ prUrl: PR_URL, prState: 'OPEN' });
    const r = await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).toHaveBeenCalledOnce();
    expect(r.resumed).toBe(1);
    expect(r.mergedPr).toBe(0);
  });

  it('容器消失 + pr_url 存在 + gh pr view 抛错 → 保守跳过（不盲目重点火）', async () => {
    const pool = makeDeps().pool;
    pool.query.mockImplementation(async (sql) => {
      if (/DISTINCT ON \(initiative_id\)/.test(sql)) {
        return { rows: [{ initiative_id: TASK_ID, phase: 'planning', attempts: '2', deadline_at: new Date(Date.now() + 3600e3).toISOString(), pr_url: PR_URL }] };
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
    const r = await resumeStalledRelayRuns(deps);
    const ghCall = deps.execFn.mock.calls.find(c => /gh pr view/.test(c[0]));
    expect(ghCall).toBeFalsy();
    expect(deps.spawnFn).toHaveBeenCalledOnce();
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

describe('pr_url fallback 数据源（watchdog）', () => {
  it('run.pr_url null + task.pr_url 有值 + PR MERGED → 标 completed/done，不重点火', async () => {
    const deps = makeDeps({ prUrl: null, taskPrUrl: PR_URL, prState: 'MERGED' });
    const r = await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).not.toHaveBeenCalled();
    // 必须调用 gh pr view 查状态（fallback 来自 task.pr_url）
    const ghCall = deps.execFn.mock.calls.find(c => /gh pr view/.test(c[0]));
    expect(ghCall).toBeTruthy();
    expect(ghCall[0]).toContain(PR_URL);
    // task → completed, run → done
    const updates = deps.pool.query.mock.calls.map(c => c[0]);
    expect(updates.some(s => /UPDATE tasks/.test(s) && /'completed'/.test(s))).toBe(true);
    expect(updates.some(s => /UPDATE initiative_runs/.test(s) && /'done'/.test(s))).toBe(true);
    expect(r.mergedPr).toBe(1);
  });

  it('run.pr_url null + task.pr_url null + payload.pr_url 有值 + PR MERGED → 标 completed/done', async () => {
    const deps = makeDeps({ prUrl: null, taskPrUrl: null, payloadPrUrl: PR_URL, prState: 'MERGED' });
    const r = await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).not.toHaveBeenCalled();
    const ghCall = deps.execFn.mock.calls.find(c => /gh pr view/.test(c[0]));
    expect(ghCall).toBeTruthy();
    expect(ghCall[0]).toContain(PR_URL);
    const updates = deps.pool.query.mock.calls.map(c => c[0]);
    expect(updates.some(s => /UPDATE tasks/.test(s) && /'completed'/.test(s))).toBe(true);
    expect(updates.some(s => /UPDATE initiative_runs/.test(s) && /'done'/.test(s))).toBe(true);
    expect(r.mergedPr).toBe(1);
  });

  it('taskQ SELECT 含 pr_url 列（源码断言）', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../harness-relay-watchdog.js', import.meta.url), 'utf8');
    // taskQ SELECT 必须包含 pr_url 列
    expect(src).toMatch(/SELECT[^`]*pr_url[^`]*FROM tasks/s);
  });
});

describe('PATCH /relay-runs/:id 接受 pr_url（源码断言）', () => {
  it('PATCH handler 从 req.body 解构 pr_url', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../routes/initiatives.js', import.meta.url), 'utf8');
    // PATCH relay-runs handler 必须包含 pr_url 解构
    expect(src).toMatch(/const\s*\{[^}]*pr_url[^}]*\}\s*=\s*req\.body/);
  });

  it('PATCH handler 校验 pr_url 须以 https://github.com/ 开头', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../routes/initiatives.js', import.meta.url), 'utf8');
    expect(src).toMatch(/https:\/\/github\.com\//);
  });

  it('PATCH handler 用 COALESCE 写 pr_url（只增不清）', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../routes/initiatives.js', import.meta.url), 'utf8');
    // COALESCE(pr_url, ...) 或 COALESCE($N, pr_url) 写法确保 only-set-never-clear
    expect(src).toMatch(/COALESCE.*pr_url|pr_url.*COALESCE/s);
  });
});
