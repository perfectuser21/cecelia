import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  createTask: vi.fn(), updateTask: vi.fn(), query: vi.fn(), finalize: vi.fn(), rca: vi.fn(),
  forbidden: [],
  deny(kind) { this.forbidden.push(kind); throw Error('forbidden ' + kind); },
}));
vi.mock('../db.js', () => ({ default: { query: state.query } }));
vi.mock('../actions.js', () => ({ createTask: state.createTask, updateTask: state.updateTask }));
vi.mock('../lib/task-terminal.js', async original => ({ ...(await original()), finalizeTask: state.finalize }));
vi.mock('../quarantine.js', () => ({ handleTaskFailure: () => state.deny('quarantine') }));
vi.mock('../slot-allocator.js', () => ({ shouldBypassBackpressure: () => state.deny('backpressure') }));
vi.mock('../cortex.js', () => ({ performRCA: state.rca }));
// 实际actions仅执行退休早返；任何写入/广播/其它准入依赖都不能运行。
vi.mock('../task-updater.js', () => ({ broadcastTaskState: () => state.deny('broadcast') }));
vi.mock('../work-routing-store.js', () => ({ createRoutedTask: () => state.deny('routed-write') }));
vi.mock('../workflow-authoring/task-guard.js', () => ({ assertAuthoringCompletion: () => state.deny('authoring') }));
vi.mock('child_process', () => ({
  spawn: () => state.deny('spawn'), execFile: () => state.deny('execFile'),
  execSync: () => state.deny('execSync'), execFileSync: () => state.deny('execFileSync'),
}));
import { autoCreateTasksFromCortex, processCortexTask } from '../dispatch-helpers.js';

const action = title => ({ type: 'create_task', params: { title, task_type: 'research' } });
let log;
let error;
beforeEach(() => {
  state.forbidden.length = 0;
  for (const name of ['createTask', 'updateTask', 'query', 'finalize', 'rca']) state[name].mockReset();
  state.createTask.mockImplementation(() => state.deny('unconfigured-create'));
  state.query.mockImplementation(() => state.deny('db'));
  state.updateTask.mockResolvedValue({ success: true });
  state.finalize.mockResolvedValue({ rowCount: 1 });
  vi.stubGlobal('fetch', () => state.deny('fetch'));
  vi.stubEnv('N8N_API_KEY', 'owned-unused');
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks();
  expect(state.forbidden).toEqual([]);
});

describe('Cortex真实建单回执与成功列表', () => {
  it('真实actions对已退类型success:false，零DB且不记created', async () => {
    const actualActions = await vi.importActual('../actions.js');
    state.createTask.mockImplementation(actualActions.createTask);
    const result = await autoCreateTasksFromCortex({ recommended_actions: [
      { type: 'create_task', params: { title: 'owned retired plan', task_type: 'scope_plan' } },
    ] });
    expect(state.createTask).toHaveReturned();
    expect(result).toEqual([]);
    expect(state.query).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join(' ')).not.toContain('created (dedup=');
    expect(error.mock.calls.flat().join(' ')).toContain('layer_retired');
  });
  it.each([null, undefined, {}, { success: false }, { success: false, deduplicated: true },
    { success: 'true' }])('拒绝或未知返回不计成功：%j', async value => {
    state.createTask.mockResolvedValue(value);
    expect(await autoCreateTasksFromCortex({ recommended_actions: [action('rejected')] })).toEqual([]);
    expect(log.mock.calls.flat().join(' ')).not.toContain('created (dedup=');
  });
  it('混合批次仅保留合法新建/去重，拒绝和throw后仍继续', async () => {
    state.createTask.mockResolvedValueOnce({ success: false, error: 'layer_retired' })
      .mockResolvedValueOnce({ success: true, task: { id: 'new' } })
      .mockRejectedValueOnce(Error('owned failure'))
      .mockResolvedValueOnce({ success: true, deduplicated: true, dedupe_key_hit: true });
    expect(await autoCreateTasksFromCortex({ recommended_actions: [
      action('rejected'), action('new'), action('throw'), action('dedupe'),
    ] })).toEqual([{ title: 'new', deduplicated: false }, { title: 'dedupe', deduplicated: true }]);
    expect(state.createTask).toHaveBeenCalledTimes(4);
    const successLogs = log.mock.calls.flat().filter(x => String(x).includes('created (dedup='));
    expect(successLogs).toHaveLength(2);
    expect(successLogs.join(' ')).not.toContain('rejected');
  });
});

describe('真实processCortexTask统计消费（RCA与写入接缝record-only）', () => {
  it.each([false, true])('只统计成功接受项，全部拒绝时没有created事件：%s', async mixed => {
    state.rca.mockResolvedValue({ analysis: { root_cause: 'owned fixture' }, confidence: 0.75,
      recommended_actions: [action('rejected'), action('accepted')], learnings: [] });
    state.createTask.mockResolvedValueOnce({ success: false, error: 'layer_retired' })
      .mockResolvedValueOnce(mixed ? { success: true, deduplicated: true } : { success: false });
    state.query.mockImplementation(async (sql, params) => {
      expect(sql).toContain('INSERT INTO cecelia_events');
      expect(params[0]).toBe('cortex_rca_complete');
      return { rowCount: 1, rows: [] };
    });
    const actions = [];
    const result = await processCortexTask({ id: 'owned-cortex', title: 'owned RCA', payload: {} }, actions);
    expect(result).toMatchObject({ dispatched: true, reason: 'cortex_processed' });
    expect(actions.filter(x => x.action === 'cortex-tasks-created'))
      .toEqual(mixed ? [{ action: 'cortex-tasks-created', count: 1 }] : []);
    expect(state.updateTask).toHaveBeenCalledWith({ task_id: 'owned-cortex', status: 'in_progress' });
    expect(state.rca).toHaveBeenCalledOnce();
    expect(state.createTask).toHaveBeenCalledTimes(2);
    expect(state.query).toHaveBeenCalledOnce();
    expect(state.finalize).toHaveBeenCalledOnce();
    expect(actions.at(-1)).toMatchObject({ action: 'cortex-complete', task_id: 'owned-cortex' });
  });
});
