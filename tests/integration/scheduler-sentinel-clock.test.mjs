import { it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

it('注册表故障哨兵测试在北京05:00仍隔离真实结晶判官', () => {
  const directory = mkdtempSync(join(tmpdir(), 'scheduler-sentinel-clock-'));
  const preload = join(directory, 'clock.cjs');
  try {
    writeFileSync(preload, `
const OriginalDate = Date;
const fixed = OriginalDate.parse('2026-10-01T21:00:00Z');
global.Date = class extends OriginalDate {
  constructor(...args) { super(...(args.length ? args : [fixed])); }
  static now() { return fixed; }
};
`);
    const output = execFileSync(process.execPath, [
      fileURLToPath(new URL('../../node_modules/vitest/vitest.mjs', import.meta.url)),
      'run', 'src/__tests__/scheduler-jobs.test.js',
      '--maxWorkers=1', '--minWorkers=1',
    ], {
      cwd: fileURLToPath(new URL('../../packages/brain/', import.meta.url)),
      env: {
        ...process.env,
        TZ: 'UTC',
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--require', preload].filter(Boolean).join(' '),
      },
      encoding: 'utf8', timeout: 20000, maxBuffer: 4 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).replace(/\u001b\[[0-9;]*m/g, '');
    expect(output).toMatch(/Tests\s+[1-9]\d* passed/);
    expect(output).not.toMatch(/\d+ (?:failed|skipped)/);
    expect(output).not.toContain('crystal-judge failed:');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 25000);
