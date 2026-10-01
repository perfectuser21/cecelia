import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

const boundary = vi.hoisted(() => ({
  pool: { query: vi.fn() },
  processes: { execSync: vi.fn(), execFileSync: vi.fn(), spawn: vi.fn() },
}));
vi.mock('../db.js', () => ({ default: boundary.pool }));
vi.mock('child_process', () => boundary.processes);
vi.mock('node:child_process', () => boundary.processes);
vi.mock('../task-router.js', () => ({
  getInternalTaskHandler: () => null, getTaskLocation: () => 'us',
}));

let executor;
let contracts;
let task;
beforeAll(async () => {
  executor = await import('../executor.js');
  contracts = await import('../executor-contracts.js');
});
beforeEach(() => {
  vi.clearAllMocks();
  executor.suspectProcesses.clear();
  task = {
    id: randomUUID(), title: '有头会话探活回归', status: 'in_progress', task_type: 'dev',
    executor_kind: 'headed-session', claimed_by: 'session:codex-external',
    claimed_at: new Date(Date.now() - 180 * 60_000).toISOString(),
    updated_at: new Date(Date.now() - 180 * 60_000).toISOString(),
    started_at: null, error_message: 'prior dispatch rejected before spawn', payload: {},
  };
  boundary.processes.execSync.mockImplementation((command) => {
    if (command.startsWith('tmux ')) throw new Error('session is on another host');
    return '0\n';
  });
  boundary.processes.execFileSync.mockImplementation(() => { throw new Error('tmux unavailable'); });
  boundary.pool.query.mockImplementation(async (sql) => {
    if (/SELECT id, title, payload, started_at/.test(sql)
      || /SELECT payload, task_type, project_id, title, started_at/.test(sql)) {
      return { rows: task.status === 'in_progress' ? [task] : [], rowCount: 1 };
    }
    if (/UPDATE tasks SET status = 'queued'/.test(sql)) task.status = 'queued';
    return { rows: [], rowCount: 1 };
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

async function probeTwice() {
  return [...await executor.probeTaskLiveness(), ...await executor.probeTaskLiveness()];
}

describe('本机探针接入既有有头合同', () => {
  it.each(['project', 'dev'])('%s 已认领但远端会话不可探测，不能按本机无PID回队', async (taskType) => {
    task.task_type = taskType;
    executor.suspectProcesses.set(task.id, { firstSeen: new Date().toISOString(), tickCount: 1 });
    expect(await probeTwice()).toEqual([]);
    expect(task.status).toBe('in_progress');
    expect(executor.suspectProcesses.has(task.id)).toBe(false);
    expect(boundary.processes.execFileSync).toHaveBeenCalledWith('tmux',
      ['has-session', '-t', 'codex-external'], expect.objectContaining({ timeout: 3000 }));
    expect(boundary.pool.query.mock.calls.some(([sql]) => /UPDATE tasks/.test(sql))).toBe(false);
  });

  it('已认领且tmux存活，采用真实合同的alive判定', async () => {
    boundary.processes.execFileSync.mockReturnValue('');
    expect(await probeTwice()).toEqual([]);
    expect(task.status).toBe('in_progress');
    expect(boundary.processes.execFileSync).toHaveBeenCalledTimes(2);
  });

  it.each([null, undefined, '', '  \t  '])('claimed_by=%s 不足以启用有头合同', async (claimedBy) => {
    task.claimed_by = claimedBy;
    expect(await probeTwice()).toEqual([expect.objectContaining({ action: 'liveness_auto_requeue' })]);
    expect(task.status).toBe('queued');
    expect(boundary.processes.execFileSync).not.toHaveBeenCalled();
  });

  it.each(['brain-local', null])('payload伪造headed不能覆盖数据库执行体%s', async (kind) => {
    task.executor_kind = kind;
    task.payload = { executor_kind: 'headed-session', claimed_by: 'session:fake', headed_manual: true };
    expect(await probeTwice()).toEqual([expect.objectContaining({ action: 'liveness_auto_requeue' })]);
    expect(boundary.processes.execFileSync).not.toHaveBeenCalled();
  });

  it.each(['dev', 'project'])('无头%s保留never_started双确认与原因留痕', async (taskType) => {
    task.task_type = taskType;
    task.executor_kind = 'brain-local';
    task.claimed_by = 'brain-dispatcher';
    expect(await executor.probeTaskLiveness()).toEqual([]);
    expect(executor.suspectProcesses.has(task.id)).toBe(true);
    expect(await executor.probeTaskLiveness()).toEqual([expect.objectContaining({ action: 'liveness_auto_requeue' })]);
    const update = boundary.pool.query.mock.calls.find(([sql]) => /UPDATE tasks SET status = 'queued'/.test(sql));
    expect(JSON.parse(update[1][1]).watchdog_kill.reason).toBe('never_started');
  });
});

describe('有头合同使用参数化tmux探测', () => {
  it.each(['session:', 'tmux:'])('%s会话元字符只作为字面量argv', async (prefix) => {
    const session = 'name-$(literal)-`literal`; with spaces';
    boundary.processes.execFileSync.mockReturnValue('');
    expect(await contracts.assessTaskLiveness({ ...task, claimed_by: prefix + session }, {}))
      .toMatchObject({ verdict: 'alive', kind: 'headed-session' });
    expect(boundary.processes.execFileSync).toHaveBeenCalledWith('tmux',
      ['has-session', '-t', session], expect.objectContaining({ timeout: 3000 }));
    expect(boundary.processes.execSync).not.toHaveBeenCalled();
  });
});
