/**
 * heartbeat.js 单测（IO 薄层，mock pool）。
 * 原并入 decision-log.test.js，为满足 lint-test-pairing（一实现文件一配对测试）拆出。
 */
import { describe, it, expect, vi } from 'vitest';
import { writeHeartbeat } from '../heartbeat.js';

const RUN_ID = '00000000-0000-0000-0000-000000000312';

function mockPool() {
  const client={query:vi.fn(async(sql)=>{
    if (/SELECT current_task_id/.test(sql)) return {rows:[{current_task_id:'task-1'}]};
    if (/SELECT controller_session_id/.test(sql)) return {rows:[{controller_session_id:'11111111-1111-4111-8111-111111111111',controller_generation:'1'}]};
    if (/UPDATE kernel_controller_sessions/.test(sql)) return {rows:[{lease_expires_at:new Date()}]};
    return {rows:[]};
  }),release:vi.fn()};
  return {connect:vi.fn(async()=>client),client};
}

describe('writeHeartbeat', () => {
  it('同一权威 heartbeat 以 generation CAS 续租 session 与 run', async () => {
    const pool = mockPool();
    const now = new Date('2026-07-04T12:00:00Z');
    await writeHeartbeat(pool, { runId: RUN_ID, controllerSessionId:'11111111-1111-4111-8111-111111111111',controllerGeneration:1,host: 'mac-mini-us', pid: 4242, now });

    const sessionCall=pool.client.query.mock.calls.find(([sql])=>/UPDATE kernel_controller_sessions/.test(sql));
    const runCall=pool.client.query.mock.calls.find(([sql])=>/UPDATE initiative_runs/.test(sql));
    const [sql, params] = sessionCall;
    expect(sql).toContain('kernel_controller_sessions');
    expect(sql).toContain('generation=$4');
    expect(runCall[0]).toContain('controller_lease_expires_at');
    for (const col of ['orchestrator_heartbeat_at', 'orchestrator_host', 'orchestrator_pid']) {
      expect(runCall[0]).toContain(col);
    }
    expect(params).toEqual(['11111111-1111-4111-8111-111111111111',now,1800,1,RUN_ID]);
  });
});
