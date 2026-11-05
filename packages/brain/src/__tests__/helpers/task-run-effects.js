import { afterEach, beforeEach, expect, vi } from 'vitest';
const effects = vi.hoisted(() => ({ db: vi.fn(), process: vi.fn(), network: vi.fn() }));
vi.mock('../../db.js', () => ({ default: { query: (...args) => {
  effects.db(...args);
  return Promise.reject(Error('task_run_test_forbids_canonical_db'));
} } }));
vi.mock('node:child_process', () => Object.fromEntries(
  ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork'].map(name => [name, (...args) => {
    effects.process(name, ...args); throw Error('task_run_test_forbids_process');
  }]),
));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', (...args) => {
    effects.network(...args); throw Error('task_run_test_forbids_network');
  });
});
afterEach(() => {
  try {
    expect(effects.db).not.toHaveBeenCalled();
    expect(effects.process).not.toHaveBeenCalled();
    expect(effects.network).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

// pool与emit必须一起显式注入；默认event-bus不可成为测试的旁路写库入口。
export const runDeps = pool => ({ pool, emit: pool.emit });
