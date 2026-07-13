/**
 * heartbeat.js 单测（IO 薄层，mock pool）。
 * 原并入 decision-log.test.js，为满足 lint-test-pairing（一实现文件一配对测试）拆出。
 */
import { describe, it, expect, vi } from 'vitest';
import { writeHeartbeat } from '../heartbeat.js';

const RUN_ID = '00000000-0000-0000-0000-000000000312';

function mockPool(result = { rows: [] }) {
  return { query: vi.fn().mockResolvedValue(result) };
}

describe('writeHeartbeat', () => {
  it('UPDATE initiative_runs 三列，now 从参数注入不自取时间', async () => {
    const pool = mockPool();
    const now = new Date('2026-07-04T12:00:00Z');
    await writeHeartbeat(pool, { runId: RUN_ID, host: 'mac-mini-us', pid: 4242, now });

    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('UPDATE initiative_runs');
    for (const col of ['orchestrator_heartbeat_at', 'orchestrator_host', 'orchestrator_pid']) {
      expect(sql).toContain(col);
    }
    expect(sql).toMatch(/WHERE id = \$1/);
    expect(params).toEqual([RUN_ID, now, 'mac-mini-us', 4242]);
  });
});
