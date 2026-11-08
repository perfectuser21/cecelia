import { afterEach, beforeEach, expect, vi } from 'vitest';
const effects = vi.hoisted(() => ({
  db: vi.fn(async () => ({ rows: [], rowCount: 0 })), process: vi.fn(), network: vi.fn(),
  raise: vi.fn(async () => {}),
}));
vi.mock('../../../../packages/brain/src/alerting.js', () => ({ raise: effects.raise }));
// 路径按本helper位置解析，精确覆盖alerting动态import的canonical src/db.js。
vi.mock('../../../../packages/brain/src/db.js', () => ({ default: { query: effects.db } }));
vi.mock('node:child_process', () => Object.fromEntries(
  ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork'].map(name => [name, (...args) => {
    effects.process(name, ...args);
    throw Error('silent_wait_test_forbids_process');
  }]),
));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', (...args) => {
    effects.network(...args);
    throw Error('silent_wait_test_forbids_network');
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
export { effects };
