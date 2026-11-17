import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ tasks: [], writes: [], query: vi.fn(), cache: vi.fn(), rcaFailure: false }));
vi.mock('../db.js', () => ({ default: { query: state.query } }));
vi.mock('../actions.js', () => ({
  createTask: vi.fn(async data => { state.tasks.push({ id: 'unapproved-dev', ...data }); return 'unapproved-dev'; }),
  updateTask: vi.fn(async data => { Object.assign(state.tasks.find(t => t.id === data.task_id), data); }),
}));
vi.mock('../executor.js', () => ({ getActiveProcessCount: () => 1, MAX_SEATS: 10 }));
vi.mock('../rca-deduplication.js', () => ({
  generateErrorSignature: () => 'real-failure-signature',
  shouldAnalyzeFailure: async () => ({ should_analyze: true }),
  cacheRcaResult: state.cache,
  getRcaCacheStats: async () => ({ total_cached: 1, cached_last_24h: 1 }),
}));
vi.mock('../immune-system.js', () => ({
  findActivePolicy: async () => null, findProbationPolicy: async () => null,
  updateFailureSignature: async (...args) => state.writes.push(args),
  shouldPromoteToProbation: async () => false, promoteDraftToProbation: vi.fn(), recordPolicyEvaluation: vi.fn(),
}));
vi.mock('../cortex.js', () => ({ performRCA: async () => {
  if (state.rcaFailure) throw new Error('diagnostic unavailable');
  return { analysis: '```json\n{"root_cause":"observed timeout","proposed_fix":"Increase executor timeout and verify with regression test","confidence":0.95}\n```',
  };
} }));
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers();
  state.tasks = [{ id: 'stuck-task', status: 'in_progress' }]; state.writes = [];
  state.query.mockImplementation(async sql => {
    if (sql.includes('minutes_since_heartbeat')) return { rows: [{ task_id: 'stuck-task', run_id: 'stuck-run', minutes_since_heartbeat: 8 }] };
    if (sql.includes('SELECT retry_count')) return { rows: [{ retry_count: 0, status: 'in_progress' }] };
    if (sql.includes('failure_rate')) return { rows: [{ failed_count: 1, total_count: 1, failure_rate: 1 }] };
    if (sql.includes("WHERE status = 'failed'") && sql.includes('LIMIT 10')) return { rows: [{ task_id: 'failed-task', run_id: 'failed-run', reason_code: 'TIMEOUT' }] };
    if (sql.includes('total_auto_fixes')) return { rows: [{ total_auto_fixes: 2, completed_fixes: 1, in_progress_fixes: 1, queued_fixes: 0 }] };
    return { rows: [] };
  });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
it.each([false, true])('真实监控周期保留故障记账和卡住恢复，不因RCA结果或失败造单（RCA失败=%s）', async rcaFailure => {
  state.rcaFailure = rcaFailure;
  const { startMonitorLoop, getMonitorStatus } = await import('../monitor-loop.js');
  startMonitorLoop(); await vi.advanceTimersByTimeAsync(100);
  expect(getMonitorStatus().cycle_count).toBe(1);
  expect(state.writes).toEqual([['real-failure-signature', expect.objectContaining({ reason_code: 'TIMEOUT' })]]);
  expect(state.cache).toHaveBeenCalledWith(expect.objectContaining({ run_id: 'failed-run' }), expect.objectContaining({ confidence: rcaFailure ? 0 : 0.95 }));
  expect(state.tasks.find(t => t.id === 'stuck-task').status).toBe('queued');
  expect(state.query.mock.calls.some(([sql]) => sql.includes("reason_code = 'MONITOR_RESTART'"))).toBe(true);
  expect(state.tasks.filter(t => t.task_type === 'dev')).toEqual([]);
});
