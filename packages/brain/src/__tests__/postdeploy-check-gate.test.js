/**
 * postdeploy-check-gate.test.js
 * 五环第 5 环机器化：proven-to-fire 后部署验证成为 completed 的强制前置。
 *
 * 覆盖：
 * A. _runPostdeployCheck（纯函数）
 * B. _finalizeWithPostdeployGate（DB 路径，使用 fake pool，非纯 mock）
 * C. resumeStalledRelayRuns MERGED 路径集成（含 postdeploy_check）
 * D. routes/tasks.js PATCH completed gate（routes 层，使用 fake pool）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── A: _runPostdeployCheck 纯函数 ──────────────────────────────────────────────

const { _runPostdeployCheck, _finalizeWithPostdeployGate, _getPrCiStatus } =
  await import('../harness-relay-watchdog.js');

describe('_runPostdeployCheck', () => {
  it('payload 无 postdeploy_check → skipped=true', () => {
    const task = { payload: { orchestrator: 'skill-relay' } };
    const execFn = vi.fn();
    const r = _runPostdeployCheck(task, execFn);
    expect(r.skipped).toBe(true);
    expect(execFn).not.toHaveBeenCalled();
  });

  it('payload 有 postdeploy_exemption → skipped=true，不执行命令', () => {
    const task = {
      payload: {
        postdeploy_check: 'curl -sf http://localhost:5221/health',
        postdeploy_exemption: 'docs-only',
      },
    };
    const execFn = vi.fn();
    const r = _runPostdeployCheck(task, execFn);
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe('docs-only');
    expect(execFn).not.toHaveBeenCalled();
  });

  it('postdeploy_check 命令执行成功 → passed=true', () => {
    const task = {
      payload: { postdeploy_check: 'echo ok' },
    };
    const execFn = vi.fn().mockReturnValue('ok\n');
    const r = _runPostdeployCheck(task, execFn);
    expect(r.passed).toBe(true);
    expect(execFn).toHaveBeenCalledWith('echo ok');
    expect(r.output).toContain('ok');
  });

  it('postdeploy_check 命令执行失败（抛错）→ passed=false，含 error', () => {
    const task = {
      payload: { postdeploy_check: 'exit 1' },
    };
    const execFn = vi.fn().mockImplementation(() => { throw new Error('Command failed: exit code 1'); });
    const r = _runPostdeployCheck(task, execFn);
    expect(r.passed).toBe(false);
    expect(r.error).toContain('failed');
  });

  it('postdeploy_check 为非字符串 → skipped=true', () => {
    const task = { payload: { postdeploy_check: 42 } };
    const execFn = vi.fn();
    const r = _runPostdeployCheck(task, execFn);
    expect(r.skipped).toBe(true);
  });
});

// ── B: _finalizeWithPostdeployGate（fake pool 路径） ──────────────────────────

function makeFakePool(taskPayload = {}) {
  const updates = [];
  return {
    query: vi.fn().mockImplementation(async (sql, params) => {
      updates.push({ sql, params });
      return { rows: [], rowCount: 1 };
    }),
    _updates: updates,
  };
}

describe('_finalizeWithPostdeployGate', () => {
  it('无 postdeploy_check → 直接标 completed（原行为）', async () => {
    const pool = makeFakePool();
    const out = { mergedPr: 0 };
    const task = { id: 'task-1', payload: { orchestrator: 'skill-relay' }, result: {} };
    const execFn = vi.fn();

    const status = await _finalizeWithPostdeployGate(pool, 'task-1', 'https://github.com/org/repo/pull/1', task, out, execFn);
    expect(status).toBe('completed');
    expect(out.mergedPr).toBe(1);
    // initiative_runs → done
    expect(pool._updates.some(u => /phase='done'/.test(u.sql))).toBe(true);
    // tasks → completed
    expect(pool._updates.some(u => /status='completed'/.test(u.sql))).toBe(true);
    expect(execFn).not.toHaveBeenCalled();
  });

  it('postdeploy_check 通过 → 标 completed，写 result.postdeploy_check_passed=true', async () => {
    const pool = makeFakePool();
    const out = { mergedPr: 0 };
    const task = {
      id: 'task-2',
      payload: { postdeploy_check: 'curl http://localhost:5221/health' },
      result: {},
    };
    const execFn = vi.fn().mockReturnValue('{"status":"healthy"}');

    const status = await _finalizeWithPostdeployGate(pool, 'task-2', 'https://github.com/org/repo/pull/2', task, out, execFn);
    expect(status).toBe('completed');
    expect(out.mergedPr).toBe(1);

    const taskUpdate = pool._updates.find(u => /status='completed'/.test(u.sql));
    expect(taskUpdate).toBeTruthy();
    const resultJson = JSON.parse(taskUpdate.params.find(p => typeof p === 'string' && p.includes('postdeploy')));
    expect(resultJson.postdeploy_check_passed).toBe(true);
  });

  it('postdeploy_check 失败 → 标 failed，写 postdeploy_check_passed=false，NOT completed', async () => {
    vi.mock('../alerting.js', () => ({ raise: vi.fn().mockResolvedValue(undefined) }));
    const pool = makeFakePool();
    const out = { mergedPr: 0 };
    const task = {
      id: 'task-3',
      payload: { postdeploy_check: 'exit 1' },
      result: {},
    };
    const execFn = vi.fn().mockImplementation(() => { throw new Error('exit code 1'); });

    const status = await _finalizeWithPostdeployGate(pool, 'task-3', 'https://github.com/org/repo/pull/3', task, out, execFn);
    expect(status).toBe('failed');
    expect(out.mergedPr).toBe(0);
    // tasks → failed（NOT completed）
    expect(pool._updates.some(u => /status='failed'/.test(u.sql))).toBe(true);
    expect(pool._updates.some(u => /status='completed'/.test(u.sql))).toBe(false);
    // initiative_runs → failed
    expect(pool._updates.some(u => /phase='failed'/.test(u.sql))).toBe(true);
    const taskUpdate = pool._updates.find(u => /status='failed'/.test(u.sql));
    // result は JSON 文字列として渡される（error_message は非 JSON テキスト）
    const resultParam = taskUpdate.params.find(p => typeof p === 'string' && p.startsWith('{'));
    const resultJson = JSON.parse(resultParam);
    expect(resultJson.postdeploy_check_passed).toBe(false);
  });

  it('postdeploy_exemption 声明豁免 → 跳过检查，标 completed', async () => {
    const pool = makeFakePool();
    const out = { mergedPr: 0 };
    const task = {
      id: 'task-4',
      payload: {
        postdeploy_check: 'curl http://localhost:5221/health',
        postdeploy_exemption: 'refactor-only',
      },
      result: {},
    };
    const execFn = vi.fn();

    const status = await _finalizeWithPostdeployGate(pool, 'task-4', 'https://github.com/org/repo/pull/4', task, out, execFn);
    expect(status).toBe('completed');
    expect(execFn).not.toHaveBeenCalled();
  });
});

// ── C: resumeStalledRelayRuns MERGED 路径集成 ─────────────────────────────────

const { resumeStalledRelayRuns, MAX_RELAY_ATTEMPTS } = await import('../harness-relay-watchdog.js');

const TASK_ID = 'aaaabbbb-cccc-dddd-eeee-ffff00001111';
const PR_URL = 'https://github.com/org/repo/pull/42';

function makeDeps({ taskPayload = { orchestrator: 'skill-relay' }, postdeployCheck = null, postdeployExemption = null, prState = 'MERGED' } = {}) {
  const payload = { ...taskPayload };
  if (postdeployCheck) payload.postdeploy_check = postdeployCheck;
  if (postdeployExemption) payload.postdeploy_exemption = postdeployExemption;

  const pool = { query: vi.fn() };
  pool.query.mockImplementation(async (sql) => {
    if (/DISTINCT ON/.test(sql)) {
      return { rows: [{ initiative_id: TASK_ID, phase: 'planning', attempts: '2', deadline_at: new Date(Date.now() + 3600e3).toISOString(), pr_url: PR_URL, orchestrator_host: 'skill-relay-session' }] };
    }
    if (/FROM tasks/.test(sql)) {
      return { rows: [{ id: TASK_ID, status: 'in_progress', title: 't', payload, pr_url: null, result: {} }] };
    }
    return { rows: [], rowCount: 1 };
  });

  const execFn = vi.fn().mockImplementation((cmd) => {
    if (/docker ps/.test(cmd)) return ''; // 容器消失
    if (/gh pr view/.test(cmd) && /statusCheckRollup/.test(cmd)) return JSON.stringify({ statusCheckRollup: [] });
    if (/gh pr view/.test(cmd)) return JSON.stringify({ state: prState });
    if (postdeployCheck && cmd === postdeployCheck) return 'ok'; // postdeploy_check 默认成功
    return '';
  });

  return { pool, execFn, spawnFn: vi.fn().mockResolvedValue({ ok: true }) };
}

describe('resumeStalledRelayRuns + postdeploy_check 集成', () => {
  beforeEach(() => vi.clearAllMocks());

  it('PR MERGED + 无 postdeploy_check → 标 completed（原行为不变）', async () => {
    const deps = makeDeps();
    const r = await resumeStalledRelayRuns(deps);
    const updates = deps.pool.query.mock.calls.map(c => c[0]);
    expect(updates.some(s => /UPDATE tasks/.test(s) && /'completed'/.test(s))).toBe(true);
    expect(r.mergedPr).toBe(1);
  });

  it('PR MERGED + postdeploy_check 成功 → 标 completed，result.postdeploy_check_passed=true', async () => {
    const checkCmd = 'curl -sf http://localhost:5221/health';
    const deps = makeDeps({ postdeployCheck: checkCmd });
    const r = await resumeStalledRelayRuns(deps);

    // 命令被执行
    expect(deps.execFn).toHaveBeenCalledWith(checkCmd);
    // task 被标 completed
    const updates = deps.pool.query.mock.calls.map(c => c[0]);
    expect(updates.some(s => /UPDATE tasks/.test(s) && /'completed'/.test(s))).toBe(true);
    expect(r.mergedPr).toBe(1);
  });

  it('PR MERGED + postdeploy_check 失败 → 标 failed，NOT completed', async () => {
    const checkCmd = 'exit 1';
    const deps = makeDeps({ postdeployCheck: checkCmd });
    // 覆盖 execFn：postdeploy_check 抛错
    deps.execFn.mockImplementation((cmd) => {
      if (/docker ps/.test(cmd)) return '';
      if (/gh pr view/.test(cmd)) return JSON.stringify({ state: 'MERGED' });
      if (cmd === checkCmd) throw new Error('Command failed');
      return '';
    });

    const r = await resumeStalledRelayRuns(deps);

    const updates = deps.pool.query.mock.calls.map(c => c[0]);
    expect(updates.some(s => /UPDATE tasks/.test(s) && /'failed'/.test(s))).toBe(true);
    expect(updates.some(s => /UPDATE tasks/.test(s) && /'completed'/.test(s))).toBe(false);
    expect(r.mergedPr).toBe(0);
  });

  it('PR MERGED + postdeploy_exemption → 跳过检查，标 completed', async () => {
    const deps = makeDeps({
      postdeployCheck: 'curl -sf http://localhost:5221/health',
      postdeployExemption: 'docs-only',
    });
    const r = await resumeStalledRelayRuns(deps);

    const updates = deps.pool.query.mock.calls.map(c => c[0]);
    expect(updates.some(s => /UPDATE tasks/.test(s) && /'completed'/.test(s))).toBe(true);
    // postdeploy_check 命令未被调用（豁免）
    expect(deps.execFn).not.toHaveBeenCalledWith('curl -sf http://localhost:5221/health');
    expect(r.mergedPr).toBe(1);
  });
});
