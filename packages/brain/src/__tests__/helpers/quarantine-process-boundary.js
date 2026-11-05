import { afterEach, beforeEach, expect, vi } from 'vitest';
const effects = vi.hoisted(() => ({
  exec: vi.fn(async () => ({ stdout: '', stderr: '' })), unexpected: vi.fn(), db: vi.fn(), network: vi.fn(),
}));
vi.mock('child_process', () => {
  const api = Object.fromEntries(['exec', 'execSync', 'execFileSync', 'spawn', 'spawnSync', 'fork'].map(name => [name, (...args) => {
    effects.unexpected(name, ...args); throw Error('quarantine_test_forbids_process');
  }]));
  const execFile = (file, args, options, callback) => {
    effects.exec(file, args, options).then(result => callback(null, result.stdout, result.stderr), callback);
  };
  // 与Node原生execFile相同：promisify返回{stdout,stderr}，不是普通回调的首个stdout字符串。
  Object.defineProperty(execFile, Symbol.for('nodejs.util.promisify.custom'), { value: effects.exec });
  api.execFile = execFile;
  return { ...api, default: api };
});
// 已有测试mock canonical db；原生驱动后盾防止未来其它入口漏接。
vi.mock('pg', () => ({ default: {
  Pool: class { query(...args) { effects.db(...args); return Promise.reject(Error('quarantine_test_forbids_pg')); } },
  types: { setTypeParser: vi.fn() },
} }));
beforeEach(() => {
  effects.exec.mockReset().mockResolvedValue({ stdout: '', stderr: '' });
  vi.stubGlobal('fetch', (...args) => { effects.network(...args); throw Error('quarantine_test_forbids_network'); });
});
afterEach(() => {
  try {
    for (const call of effects.exec.mock.calls) {
      expect(call).toEqual(['docker', ['ps', '--format', '{{.Names}}'], { timeout: 3000 }]);
    }
    expect(effects.unexpected).not.toHaveBeenCalled();
    expect(effects.db).not.toHaveBeenCalled();
    expect(effects.network).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
export { effects };
