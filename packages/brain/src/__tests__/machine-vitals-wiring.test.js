import { describe, it, expect, vi } from 'vitest';

const execFileMock = vi.hoisted(() => vi.fn((cmd, args, opts, cb) => {
  const done = typeof opts === 'function' ? opts : cb;
  done(null, cmd === 'docker' && args[0] === 'info' ? String(8 * 1024 ** 3) : '', '');
}));
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, execFile: execFileMock };
});
vi.mock('../db.js', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));

import { JOBS } from '../scheduler-jobs.js';
import { getMachineVitals, _resetVitalsCacheForTest } from '../machine-vitals.js';

describe('machine-vitals 接线', () => {
  it('JOBS 注册了 machine-vitals 采样 job', () => {
    const job = JOBS.find(j => j.name === 'machine-vitals');
    expect(job).toBeDefined();
    expect(job.needsPool).toBe(false);
  });

  it('job handler 执行后缓存被填充', async () => {
    _resetVitalsCacheForTest();
    const job = JOBS.find(j => j.name === 'machine-vitals');
    await job.handler();
    expect(getMachineVitals().error).toBeNull();
    expect(getMachineVitals().stale).toBe(false);
  });
});
