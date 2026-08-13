/**
 * heartbeat.js 单测（IO 薄层，mock pool）。
 * 原并入 decision-log.test.js，为满足 lint-test-pairing（一实现文件一配对测试）拆出。
 *
 * sprint 08132021：writeHeartbeat 在同一条 UPDATE 里续租 Controller lease（CAS +
 * GREATEST），单测校验 SQL 形状与参数装配（真 PG 续租行为由
 * kernel-controller-lease-renewal.pg.integration.test.js 在真 Postgres 上验证）。
 */
import { describe, it, expect, vi } from 'vitest';
import { writeHeartbeat } from '../heartbeat.js';
import { CONTROLLER_LEASE_DEFAULT_SECONDS } from '../kernel-run-store.js';

const RUN_ID = '00000000-0000-0000-0000-000000000312';
const SESSION = 'sess-controller-abc';

function mockPool(result = { rowCount: 1, rows: [] }) {
  return { query: vi.fn().mockResolvedValue(result) };
}

describe('writeHeartbeat', () => {
  it('UPDATE initiative_runs 三列心跳 + 续租 lease（CAS + GREATEST），now 从参数注入不自取时间', async () => {
    const pool = mockPool();
    const now = new Date('2026-07-04T12:00:00Z');
    const res = await writeHeartbeat(pool, {
      runId: RUN_ID, host: 'mac-mini-us', pid: 4242, now, controllerSessionId: SESSION,
    });

    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('UPDATE initiative_runs');
    for (const col of ['orchestrator_heartbeat_at', 'orchestrator_host', 'orchestrator_pid']) {
      expect(sql).toContain(col);
    }
    // 续租：GREATEST(existing, now + lease) 只增不减；CAS WHERE 含 session + 活跃 phase。
    expect(sql).toContain('controller_lease_expires_at');
    expect(sql).toContain('GREATEST');
    expect(sql).toMatch(/WHERE id = \$1/);
    expect(sql).toContain('controller_session_id = $5');
    expect(sql).toMatch(/phase\s+NOT\s+IN\s*\('done',\s*'failed'\)/);
    // 缺省 leaseSeconds 复用单一 SSOT（INV-2，禁止另写死秒数）。
    expect(params).toEqual([RUN_ID, now, 'mac-mini-us', 4242, SESSION, CONTROLLER_LEASE_DEFAULT_SECONDS]);
    // 返回 pg 结果供调用方读取 rowCount 做 CAS fail-closed 判定。
    expect(res.rowCount).toBe(1);
  });

  it('显式 leaseSeconds 覆盖默认续租时长', async () => {
    const pool = mockPool();
    const now = new Date('2026-07-04T12:00:00Z');
    await writeHeartbeat(pool, {
      runId: RUN_ID, host: 'mac-mini-us', pid: 4242, now, controllerSessionId: SESSION, leaseSeconds: 900,
    });
    const [, params] = pool.query.mock.calls[0];
    expect(params[5]).toBe(900);
  });
});
