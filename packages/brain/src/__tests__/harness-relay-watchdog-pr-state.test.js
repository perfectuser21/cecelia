// 真实watchdog隔离合同；只验证委托，不宣称旧relay已恢复或DB持久化。
import { describe, it, expect, vi } from 'vitest';
import { TASK_ID, RUN_ID, store, resumeStalledRelayRuns, sendBark, _hasEvaluatorGate, _raiseUngatedMergeAlert, _finalizeMergedRun } from './helpers/relay-watchdog-fixture.js';

describe('resumeStalledRelayRuns — pr_url fallback 链（#3560 跟进）', () => {
  it('taskQ SELECT 含 pr_url 列', async () => {
    // run.pr_url=null → 需要从 tasks.pr_url 取，所以 SELECT 必须含该列
    const taskSqls = [];
    const pool = {
      query: vi.fn(async (sql) => {
        if (/FROM initiative_runs r/.test(sql)) {
          return { rows: [{ id: RUN_ID, initiative_id: TASK_ID, current_task_id: TASK_ID, phase: 'generate', attempts: '1', deadline_at: null, pr_url: null }] };
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
      query: vi.fn(async (sql, _params) => {
        if (/FROM initiative_runs r/.test(sql)) {
          return { rows: [{ id: RUN_ID, initiative_id: TASK_ID, current_task_id: TASK_ID, phase: 'generate', attempts: '1', deadline_at: null, pr_url: null }] };
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
      query: vi.fn(async (sql, _params) => {
        if (/FROM initiative_runs r/.test(sql)) {
          return { rows: [{ id: RUN_ID, initiative_id: TASK_ID, current_task_id: TASK_ID, phase: 'generate', attempts: '1', deadline_at: null, pr_url: null }] };
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
    const patchIdx = src.indexOf('function validateRunPatchBody');
    expect(patchIdx).toBeGreaterThan(-1);
    const block = src.slice(patchIdx, patchIdx + 1500);
    expect(block).toMatch(/pr_url/);
  });

  it('PATCH handler 校验 pr_url 须以 https://github.com/ 开头（非法时 400）', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../routes/initiatives.js', import.meta.url), 'utf8');
    const patchIdx = src.indexOf('function validateRunPatchBody');
    const block = src.slice(patchIdx, patchIdx + 1500);
    expect(block).toMatch(/https:\/\/github\.com\//);
    expect(block).toMatch(/400/);
  });

  it('PATCH UPDATE SQL 用 COALESCE 保护 pr_url（只增不清）', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../orchestrator/kernel-run-store.js', import.meta.url), 'utf8');
    const patchIdx = src.indexOf('export async function patchKernelRunById');
    const block = src.slice(patchIdx, patchIdx + 3000);
    expect(block).toMatch(/COALESCE/i);
    expect(block).toMatch(/pr_url/);
  });
});

describe('_hasEvaluatorGate', () => {
  it('initiative_run_events 有 evaluator done 记录 → true', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }) };
    const result = await _hasEvaluatorGate(pool, 'test-id');
    expect(result).toBe(true);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/initiative_run_events/);
    expect(sql).toMatch(/node='evaluator'/);
    expect(sql).toMatch(/status='done'/);
    expect(params[0]).toBe('test-id');
  });

  it('initiative_run_events 无 evaluator done 记录 → false', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const result = await _hasEvaluatorGate(pool, 'test-id');
    expect(result).toBe(false);
  });
});

describe('_raiseUngatedMergeAlert', () => {
  it('写入 issues 表 + 调 sendBark（两路 best-effort）', async () => {
    vi.clearAllMocks();
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await _raiseUngatedMergeAlert(pool, 'initiative-abc', 'https://github.com/x/y/pull/1');
    expect(pool.query).toHaveBeenCalledOnce();
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO issues/);
    expect(params[0]).toMatch(/initiative-abc/);
    expect(sendBark).toHaveBeenCalledOnce();
  });

  it('issues 写入失败 → 仍调 sendBark（fail-open）', async () => {
    vi.clearAllMocks();
    const pool = { query: vi.fn().mockRejectedValue(new Error('DB down')) };
    await expect(_raiseUngatedMergeAlert(pool, 'x', 'https://github.com/x/y/pull/2')).resolves.toBeUndefined();
    expect(sendBark).toHaveBeenCalledOnce();
  });
});

describe('_finalizeMergedRun', () => {
  it('gated=true → UPDATE 不含 failure_reason，调 promoteRegression', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    // evaluatorGate=true: initiative_run_events 有记录
    pool.query.mockImplementation(async (sql) => {
      if (/initiative_run_events/.test(sql)) return { rows: [{ x: 1 }] };
      return { rows: [] };
    });
    const out = { mergedPr: 0, mergedWithoutGate: 0 };
    await _finalizeMergedRun(pool, { id: RUN_ID, initiative_id: 'init-1', current_task_id: 'task-1' }, 'https://github.com/x/y/pull/3', out);
    expect(out.mergedPr).toBe(1);
    const updates = pool.query.mock.calls.map(c => c[0]).filter(s => /UPDATE initiative_runs/.test(s));
    expect(updates.length).toBeGreaterThan(0);
    expect(updates.every(s => !/failure_reason/.test(s))).toBe(true);
    const exactUpdate = pool.query.mock.calls.find(([sql]) => /UPDATE initiative_runs/.test(sql));
    expect(exactUpdate[0]).toMatch(/WHERE\s+id\s*=\s*\$1/);
    expect(exactUpdate[1][0]).toBe(RUN_ID);
  });

  it('gated=false → UPDATE 含 failure_reason=merged_without_evaluator_gate，mergedWithoutGate++', async () => {
    vi.clearAllMocks();
    const pool = { query: vi.fn().mockImplementation(async (sql) => {
      if (/initiative_run_events/.test(sql)) return { rows: [] }; // no evaluator gate
      return { rows: [] };
    })};
    const out = { mergedPr: 0, mergedWithoutGate: 0 };
    await _finalizeMergedRun(pool, { id: RUN_ID, initiative_id: 'init-2', current_task_id: 'task-2' }, 'https://github.com/x/y/pull/4', out);
    expect(out.mergedPr).toBe(1);
    expect(out.mergedWithoutGate).toBe(1);
    const updates = pool.query.mock.calls.map(c => c[0]).filter(s => /UPDATE initiative_runs/.test(s));
    expect(updates.some(s => /failure_reason/.test(s) && /merged_without_evaluator_gate/.test(s))).toBe(true);
    expect(sendBark).toHaveBeenCalled();
  });

  it('setPrUrl=true → pr_url 写进 UPDATE', async () => {
    vi.clearAllMocks();
    const pool = { query: vi.fn().mockImplementation(async (sql) => {
      if (/initiative_run_events/.test(sql)) return { rows: [{ x: 1 }] };
      return { rows: [] };
    })};
    const out = { mergedPr: 0, mergedWithoutGate: 0 };
    const PR = 'https://github.com/x/y/pull/5';
    await _finalizeMergedRun(pool, { id: RUN_ID, initiative_id: 'init-3', current_task_id: 'task-3' }, PR, out, { setPrUrl: true });
    const runUpdates = pool.query.mock.calls.filter(c => /UPDATE initiative_runs/.test(c[0]));
    expect(runUpdates.some(([, params]) => Array.isArray(params) && params.includes(PR))).toBe(true);
  });
});
