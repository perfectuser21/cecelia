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
  prState = null,   // 'MERGED' | 'OPEN' | 'CLOSED' | null（execFn 返回的 gh pr view JSON）
  orchestratorHost = 'skill-relay-session',
} = {}) {
  const pool = { query: vi.fn() };
  pool.query.mockImplementation(async (sql) => {
    if (/DISTINCT ON \(initiative_id\)/.test(sql)) {
      return { rows: [{ initiative_id: TASK_ID, phase: 'planning', attempts: String(attempts), deadline_at: new Date(Date.now() + 3600e3).toISOString(), pr_url: prUrl, orchestrator_host: orchestratorHost }] };
    }
    if (/FROM tasks/.test(sql)) {
      return { rows: [{ id: TASK_ID, status: taskStatus, title: 't', payload: { orchestrator } }] };
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

  it('容器消失 + pr_url 为 null + 无 base_repo → 直接走重点火（不调 gh）', async () => {
    // payload 无 base_repo → 跳过 gh pr list 探查，直接重点火
    const deps = makeDeps({ prUrl: null });
    const r = await resumeStalledRelayRuns(deps);
    const ghCall = deps.execFn.mock.calls.find(c => /gh pr/.test(c[0]));
    expect(ghCall).toBeFalsy();
    expect(deps.spawnFn).toHaveBeenCalledOnce();
  });
});

// ── B_probe：pr_url=null 时 gh pr list 探查已有 PR ───────────────────────────

function makeProbePool({ taskPrUrl = null, baseRepo = 'org/repo', attempts = 2 } = {}) {
  const pool = { query: vi.fn() };
  pool.query.mockImplementation(async (sql) => {
    if (/DISTINCT ON \(initiative_id\)/.test(sql)) {
      return {
        rows: [{
          initiative_id: TASK_ID,
          phase: 'planning',
          attempts: String(attempts),
          deadline_at: new Date(Date.now() + 3600e3).toISOString(),
          pr_url: null,
          orchestrator_host: 'skill-relay-session',
        }],
      };
    }
    if (/FROM tasks/.test(sql)) {
      return {
        rows: [{
          id: TASK_ID,
          status: 'in_progress',
          title: 't',
          pr_url: taskPrUrl,
          payload: { orchestrator: 'skill-relay', base_repo: baseRepo },
        }],
      };
    }
    return { rows: [] };
  });
  return pool;
}

describe('B_probe — pr_url=null 时用 gh pr list 探查已有 PR', () => {
  it('探查到 MERGED PR（分支含 short）→ 标 completed/done，不重点火', async () => {
    const pool = makeProbePool();
    const updates = [];
    pool.query.mockImplementation(async (sql, params) => {
      if (/DISTINCT ON \(initiative_id\)/.test(sql)) {
        return { rows: [{ initiative_id: TASK_ID, phase: 'planning', attempts: '2', deadline_at: new Date(Date.now() + 3600e3).toISOString(), pr_url: null, orchestrator_host: 'skill-relay-session' }] };
      }
      if (/FROM tasks/.test(sql)) {
        return { rows: [{ id: TASK_ID, status: 'in_progress', title: 't', pr_url: null, payload: { orchestrator: 'skill-relay', base_repo: 'org/repo' } }] };
      }
      if (/UPDATE/.test(sql)) { updates.push(sql); return { rows: [] }; }
      return { rows: [] };
    });
    const foundPrUrl = `https://github.com/org/repo/pull/99`;
    const execFn = vi.fn().mockImplementation((cmd) => {
      if (/docker ps/.test(cmd)) return '';
      if (/gh pr list/.test(cmd)) {
        return JSON.stringify([
          { url: foundPrUrl, state: 'MERGED', headRefName: `sprints/0708-relay-${SHORT}` },
        ]);
      }
      return '';
    });
    const spawnFn = vi.fn();
    const out = await resumeStalledRelayRuns({ pool, execFn, spawnFn });

    expect(spawnFn).not.toHaveBeenCalled();
    expect(out.mergedPr).toBe(1);
    const ghCall = execFn.mock.calls.find(c => /gh pr list/.test(c[0]));
    expect(ghCall).toBeTruthy();
    expect(ghCall[0]).toContain('org/repo');
    expect(updates.some(s => /initiative_runs/.test(s) && /'done'/.test(s))).toBe(true);
    expect(updates.some(s => /UPDATE tasks/.test(s) && /'completed'/.test(s))).toBe(true);
  });

  it('探查到 OPEN PR（分支含 short）→ 回写 pr_url，跳过重点火', async () => {
    const updates = [];
    const pool = { query: vi.fn() };
    pool.query.mockImplementation(async (sql, params) => {
      if (/DISTINCT ON \(initiative_id\)/.test(sql)) {
        return { rows: [{ initiative_id: TASK_ID, phase: 'planning', attempts: '2', deadline_at: new Date(Date.now() + 3600e3).toISOString(), pr_url: null, orchestrator_host: 'skill-relay-session' }] };
      }
      if (/FROM tasks/.test(sql)) {
        return { rows: [{ id: TASK_ID, status: 'in_progress', title: 't', pr_url: null, payload: { orchestrator: 'skill-relay', base_repo: 'org/repo' } }] };
      }
      if (/UPDATE/.test(sql)) { updates.push(sql); return { rows: [] }; }
      return { rows: [] };
    });
    const openPrUrl = `https://github.com/org/repo/pull/42`;
    const execFn = vi.fn().mockImplementation((cmd) => {
      if (/docker ps/.test(cmd)) return '';
      if (/gh pr list/.test(cmd)) {
        return JSON.stringify([
          { url: openPrUrl, state: 'OPEN', headRefName: `sprints/0708-relay-${SHORT}` },
        ]);
      }
      return '';
    });
    const spawnFn = vi.fn();
    const out = await resumeStalledRelayRuns({ pool, execFn, spawnFn });

    expect(spawnFn).not.toHaveBeenCalled();
    expect(out.openPrFound).toBe(1);
    expect(updates.some(s => /initiative_runs/.test(s) && /pr_url/.test(s))).toBe(true);
    expect(updates.some(s => /UPDATE tasks/.test(s) && /pr_url/.test(s))).toBe(true);
  });

  it('探查无匹配分支 → 正常重点火', async () => {
    const pool = { query: vi.fn() };
    pool.query.mockImplementation(async (sql) => {
      if (/DISTINCT ON \(initiative_id\)/.test(sql)) {
        return { rows: [{ initiative_id: TASK_ID, phase: 'planning', attempts: '2', deadline_at: new Date(Date.now() + 3600e3).toISOString(), pr_url: null, orchestrator_host: 'skill-relay-session' }] };
      }
      if (/FROM tasks/.test(sql)) {
        return { rows: [{ id: TASK_ID, status: 'in_progress', title: 't', pr_url: null, payload: { orchestrator: 'skill-relay', base_repo: 'org/repo' } }] };
      }
      return { rows: [] };
    });
    const execFn = vi.fn().mockImplementation((cmd) => {
      if (/docker ps/.test(cmd)) return '';
      // PR 存在但分支不含 SHORT（不同任务的 PR）
      if (/gh pr list/.test(cmd)) {
        return JSON.stringify([
          { url: 'https://github.com/org/repo/pull/1', state: 'OPEN', headRefName: 'sprints/0708-relay-xxxxxxxx' },
        ]);
      }
      return '';
    });
    const spawnFn = vi.fn().mockResolvedValue({ ok: true, containerId: 'x' });
    const out = await resumeStalledRelayRuns({ pool, execFn, spawnFn });

    expect(spawnFn).toHaveBeenCalledOnce();
    expect(out.resumed).toBe(1);
  });

  it('gh pr list 抛错 → 保守跳过，不重点火', async () => {
    const pool = { query: vi.fn() };
    pool.query.mockImplementation(async (sql) => {
      if (/DISTINCT ON \(initiative_id\)/.test(sql)) {
        return { rows: [{ initiative_id: TASK_ID, phase: 'planning', attempts: '2', deadline_at: new Date(Date.now() + 3600e3).toISOString(), pr_url: null, orchestrator_host: 'skill-relay-session' }] };
      }
      if (/FROM tasks/.test(sql)) {
        return { rows: [{ id: TASK_ID, status: 'in_progress', title: 't', pr_url: null, payload: { orchestrator: 'skill-relay', base_repo: 'org/repo' } }] };
      }
      return { rows: [] };
    });
    const execFn = vi.fn().mockImplementation((cmd) => {
      if (/docker ps/.test(cmd)) return '';
      if (/gh pr list/.test(cmd)) throw new Error('gh: not found');
      return '';
    });
    const spawnFn = vi.fn();
    const out = await resumeStalledRelayRuns({ pool, execFn, spawnFn });

    expect(spawnFn).not.toHaveBeenCalled();
    expect(out.resumed).toBe(0);
  });
});

describe('foreground 护栏（刀2：前台建档 run 不得被重点火）', () => {
  it('orchestrator_host=foreground 且容器消失 → 跳过，不 spawn', async () => {
    const deps = makeDeps({ orchestratorHost: 'foreground', containerRunning: false });
    const out = await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).not.toHaveBeenCalled();
    expect(out.resumed).toBe(0);
  });

  it('对照：普通 relay run 容器消失仍会重点火（护栏不误伤）', async () => {
    const deps = makeDeps({ orchestratorHost: 'skill-relay-session', containerRunning: false });
    await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).toHaveBeenCalled();
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

// ── 新增：pr_url fallback 链 + PATCH pr_url 写入 ─────────────────────

describe('resumeStalledRelayRuns — pr_url fallback 链（#3560 跟进）', () => {
  it('taskQ SELECT 含 pr_url 列', async () => {
    // run.pr_url=null → 需要从 tasks.pr_url 取，所以 SELECT 必须含该列
    const taskSqls = [];
    const pool = {
      query: vi.fn(async (sql) => {
        if (/DISTINCT ON \(initiative_id\)/.test(sql)) {
          return { rows: [{ initiative_id: TASK_ID, phase: 'generate', attempts: '1', deadline_at: null, pr_url: null }] };
        }
        if (/FROM tasks/.test(sql)) {
          taskSqls.push(sql);
          return { rows: [{ id: TASK_ID, status: 'in_progress', title: 't', pr_url: null, payload: { orchestrator: 'skill-relay' } }] };
        }
        return { rows: [] };
      }),
    };
    const execFn = vi.fn((cmd) => {
      if (/docker ps/.test(cmd)) return '';
      return '';
    });
    await resumeStalledRelayRuns({ pool, execFn, spawnFn: vi.fn().mockResolvedValue({ ok: true }) });
    expect(taskSqls.length).toBeGreaterThan(0);
    expect(taskSqls[0]).toMatch(/\bpr_url\b/);
  });

  it('run.pr_url=null，tasks.pr_url 有值 → MERGED → 标 completed，不重点火', async () => {
    const TASK_PR = 'https://github.com/owner/repo/pull/42';
    const updates = [];
    const pool = {
      query: vi.fn(async (sql, params) => {
        if (/DISTINCT ON \(initiative_id\)/.test(sql)) {
          return { rows: [{ initiative_id: TASK_ID, phase: 'generate', attempts: '1', deadline_at: null, pr_url: null }] };
        }
        if (/FROM tasks/.test(sql)) {
          return { rows: [{ id: TASK_ID, status: 'in_progress', title: 't', pr_url: TASK_PR, payload: { orchestrator: 'skill-relay' } }] };
        }
        if (/UPDATE/.test(sql)) { updates.push(sql); return { rows: [{ id: TASK_ID }] }; }
        return { rows: [] };
      }),
    };
    const ghCalls = [];
    const execFn = vi.fn((cmd) => {
      if (/docker ps/.test(cmd)) return '';
      if (/gh pr view/.test(cmd)) { ghCalls.push(cmd); return JSON.stringify({ state: 'MERGED' }); }
      return '';
    });
    const spawnFn = vi.fn().mockResolvedValue({ ok: true });

    const out = await resumeStalledRelayRuns({ pool, execFn, spawnFn });

    expect(ghCalls.length).toBeGreaterThan(0);
    expect(ghCalls[0]).toContain(TASK_PR);
    expect(spawnFn).not.toHaveBeenCalled();
    expect(out.mergedPr).toBe(1);
    expect(updates.some((s) => /initiative_runs/.test(s) && /'done'/.test(s))).toBe(true);
    expect(updates.some((s) => /UPDATE tasks/.test(s) && /'completed'/.test(s))).toBe(true);
  });

  it('run.pr_url=null, tasks.pr_url=null, payload.pr_url 有值 → MERGED → 标 completed', async () => {
    const PAYLOAD_PR = 'https://github.com/owner/repo/pull/99';
    const updates = [];
    const pool = {
      query: vi.fn(async (sql, params) => {
        if (/DISTINCT ON \(initiative_id\)/.test(sql)) {
          return { rows: [{ initiative_id: TASK_ID, phase: 'generate', attempts: '1', deadline_at: null, pr_url: null }] };
        }
        if (/FROM tasks/.test(sql)) {
          return { rows: [{ id: TASK_ID, status: 'in_progress', title: 't', pr_url: null, payload: { orchestrator: 'skill-relay', pr_url: PAYLOAD_PR } }] };
        }
        if (/UPDATE/.test(sql)) { updates.push(sql); return { rows: [{ id: TASK_ID }] }; }
        return { rows: [] };
      }),
    };
    const ghCalls = [];
    const execFn = vi.fn((cmd) => {
      if (/docker ps/.test(cmd)) return '';
      if (/gh pr view/.test(cmd)) { ghCalls.push(cmd); return JSON.stringify({ state: 'MERGED' }); }
      return '';
    });
    const spawnFn = vi.fn().mockResolvedValue({ ok: true });

    const out = await resumeStalledRelayRuns({ pool, execFn, spawnFn });

    expect(ghCalls.length).toBeGreaterThan(0);
    expect(ghCalls[0]).toContain(PAYLOAD_PR);
    expect(spawnFn).not.toHaveBeenCalled();
    expect(out.mergedPr).toBe(1);
  });
});

describe('PATCH /orchestrator/relay-runs — pr_url 字段写入（#3560 跟进）', () => {
  it('PATCH handler 从 req.body 解构 pr_url', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../routes/initiatives.js', import.meta.url), 'utf8');
    const patchIdx = src.indexOf("router.patch('/relay-runs/");
    expect(patchIdx).toBeGreaterThan(-1);
    const block = src.slice(patchIdx, patchIdx + 1500);
    expect(block).toMatch(/pr_url/);
  });

  it('PATCH handler 校验 pr_url 须以 https://github.com/ 开头（非法时 400）', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../routes/initiatives.js', import.meta.url), 'utf8');
    const patchIdx = src.indexOf("router.patch('/relay-runs/");
    const block = src.slice(patchIdx, patchIdx + 1500);
    expect(block).toMatch(/https:\/\/github\.com\//);
    expect(block).toMatch(/400/);
  });

  it('PATCH UPDATE SQL 用 COALESCE 保护 pr_url（只增不清）', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../routes/initiatives.js', import.meta.url), 'utf8');
    const patchIdx = src.indexOf("router.patch('/relay-runs/");
    const block = src.slice(patchIdx, patchIdx + 1500);
    expect(block).toMatch(/COALESCE/i);
    expect(block).toMatch(/pr_url/);
  });
});
