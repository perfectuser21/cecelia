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

function makeDeps({ taskStatus = 'in_progress', attempts = 2, containerRunning = false, orchestrator = 'skill-relay' } = {}) {
  const pool = { query: vi.fn() };
  pool.query.mockImplementation(async (sql) => {
    if (/FROM initiative_runs/.test(sql) && /orchestrator_version\s*=\s*'v2'/.test(sql) && /COUNT/.test(sql) === false && /GROUP BY/.test(sql) === false) {
      return { rows: [{ initiative_id: TASK_ID, phase: 'planning', attempts: String(attempts), deadline_at: new Date(Date.now() + 3600e3).toISOString() }] };
    }
    if (/FROM tasks/.test(sql)) {
      return { rows: [{ id: TASK_ID, status: taskStatus, title: 't', payload: { orchestrator } }] };
    }
    return { rows: [] };
  });
  return {
    pool,
    execFn: vi.fn().mockReturnValue(containerRunning ? 'abc123\n' : ''),
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
    const deps = makeDeps({ orchestrator: undefined });
    const r = await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).not.toHaveBeenCalled();
    expect(r.resumed).toBe(0);
  });

  it('task queued → 跳过（dispatcher 自然路径负责，防双 spawn）', async () => {
    const deps = makeDeps({ taskStatus: 'queued' });
    const r = await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).not.toHaveBeenCalled();
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
