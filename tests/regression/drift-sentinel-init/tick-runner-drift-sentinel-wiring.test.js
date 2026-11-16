import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../../packages/brain/src/__tests__/helpers/scheduler-jobs-fixture.js';
vi.mock('../../../packages/brain/src/notifier.js', () => ({
  sendFeishu: vi.fn(), sendBark: vi.fn(), notifyTaskCompleted: vi.fn(),
  notifyTaskFailed: vi.fn(), notifyCircuitOpen: vi.fn(), notifyPatrolCleanup: vi.fn(),
  notifyDailySummary: vi.fn(), RATE_LIMIT_MS: 0,
}));
import { sendBark } from '../../../packages/brain/src/notifier.js';
import * as processIo from 'child_process';
import { JOBS } from '../../../packages/brain/src/scheduler-jobs.js';
import { runDriftSentinel } from '../../../packages/brain/src/cron/drift-sentinel.js';

// 取真实调度条目，并将handler边界替身委托回真实实现。
// SHA、数据库均为夹具，非夹具进程会立即失败，禁止运行部署。
afterEach(() => { vi.restoreAllMocks(); });

describe('drift-sentinel 调度条目真实执行与节流', () => {
  it('已注册条目读取SHA，间隔内不访问外部边界，满30min后重新对账', async () => {
    const sha = 'a'.repeat(40);
    const exec = vi.spyOn(processIo, 'exec').mockImplementation((command, options, callback) => {
      const stdout = command.startsWith('git ls-remote ') ? sha
        : command.startsWith('curl -sf ') ? JSON.stringify({ git_sha: sha }) : null;
      if (stdout === null) throw new Error(`禁止执行非夹具进程：${command}`);
      // 对应生产execAsync的结果；这个外部边界替身没有Node原exec的custom-promisify。
      callback(null, { stdout, stderr: '' });
    });
    const actual = await vi.importActual('../../../packages/brain/src/cron/drift-sentinel.js');
    actual._resetLastRunAt();
    runDriftSentinel.mockImplementation(actual.runDriftSentinel);
    let now = Date.parse('2026-11-16T00:00:00Z');
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const job = JOBS.find(row => row.name === 'drift-sentinel');
    expect(job).toBeDefined();
    try {
      expect(await job.handler(db)).toEqual({ verdict: 'ok', sha_main: sha, sha_prod: sha });
      expect(exec).toHaveBeenCalledTimes(2);
      const writes = db.query.mock.calls.length;
      expect(await job.handler(db)).toEqual({ skipped: true, reason: 'interval_not_reached' });
      expect(exec).toHaveBeenCalledTimes(2);
      expect(db.query).toHaveBeenCalledTimes(writes);
      now += 30 * 60 * 1000 + 1;
      expect(await job.handler(db)).toEqual({ verdict: 'ok', sha_main: sha, sha_prod: sha });
      expect(exec).toHaveBeenCalledTimes(4);
      expect(sendBark).not.toHaveBeenCalled();
    } finally { actual._resetLastRunAt(); }
  });
});
