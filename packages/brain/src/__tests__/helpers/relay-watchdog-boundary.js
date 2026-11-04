// 只封系统副作用与store委托；不复制store SQL或watchdog实现。
import { vi, expect, beforeEach, afterEach } from 'vitest';
const state = vi.hoisted(() => ({ db: vi.fn(), process: vi.fn(), network: vi.fn(), patch: vi.fn(async (_db, input) => ({ id: input.runId, phase: input.phase })) }));
export const store = { patch: state.patch };
vi.mock('../../db.js', () => ({ default: { query: (...args) => { state.db(...args); throw Error('禁止默认DB'); } } }));
vi.mock('../../notifier.js', () => ({ sendBark: vi.fn(async () => true) }));
vi.mock('node:child_process', () => Object.fromEntries(['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync'].map(name => [name, (...args) => { state.process(name, ...args); throw Error('禁止宿主进程'); }])));
vi.mock('../../orchestrator/kernel-run-store.js', () => ({ patchKernelRunById: state.patch }));
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', (...args) => { state.network(...args); throw Error('禁止外联'); }); });
afterEach(() => {
  expect(state.db).not.toHaveBeenCalled();
  expect(state.process).not.toHaveBeenCalled();
  expect(state.network).not.toHaveBeenCalled();
  for (const [db] of state.patch.mock.calls) {
    const copiedWrites = db.query.mock.calls.filter(([sql]) => /UPDATE\s+initiative_runs\s+SET\s+phase|UPDATE\s+tasks\s+SET\s+status/i.test(String(sql)));
    expect(copiedWrites).toEqual([]);
  }
  vi.unstubAllGlobals();
});
