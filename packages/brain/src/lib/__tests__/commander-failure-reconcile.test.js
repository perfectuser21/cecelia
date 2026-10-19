import { it, expect, vi } from 'vitest';
import { reconcileFailedCommander } from '../commander-failure-reconcile.js';
import { digest } from '../commander-v2-contract.js';
import { failureFixture } from './fixtures/commander-failure-fixture.js';

function setup() {
 const f = failureFixture();
 const input = { ...f.verifier.payload.commander_failure_verification_of,
  verification_task_id: f.verifier.id, expected_control_sha256: digest(f.task.result.workflow_control),
  expected_attestation_sha256: digest(f.verifier.result.commander_failure_verification),
  actor: 'codex:operator', reason: '独立原失败核验' };
 f.task.result.commander_failure_reconciliation = { ...f.verifier.payload.commander_failure_verification_of,
  verification_task_id: f.verifier.id, operator_actor: input.actor };
 const pool = { query: vi.fn(async (sql, [id]) => ({ rows: sql.includes('task_leases')
  ? [f.verifier.verification_lease] : id === f.task.id ? [f.task] : [f.verifier] })) };
 return { ...f, input, pool, probe: vi.fn() };
}

it('未知请求字段在任何数据库或远端读取前拒绝', async () => {
 const f = setup();
 await expect(reconcileFailedCommander(f.pool, f.task.id, { ...f.input, stopped: true }, { probe: f.probe })).rejects.toThrow('请求字段');
 expect(f.pool.query).not.toHaveBeenCalled(); expect(f.probe).not.toHaveBeenCalled();
});
it('原控制摘要漂移时只读原任务且不启动远端探针或事务', async () => {
 const f = setup(); f.input.expected_control_sha256 = 'f'.repeat(64);
 await expect(reconcileFailedCommander(f.pool, f.task.id, f.input, { probe: f.probe })).rejects.toThrow('控制状态CAS');
 expect(f.pool.query).toHaveBeenCalledTimes(1); expect(f.probe).not.toHaveBeenCalled();
 expect(f.pool.query.mock.calls[0][0]).toBe('SELECT * FROM tasks WHERE id=$1');
});
it('操作者授权不匹配时拒绝，无远端读取和任何SQL写入', async () => {
 const f = setup(); f.input.actor = 'codex:someone-else';
 await expect(reconcileFailedCommander(f.pool, f.task.id, f.input, { probe: f.probe })).rejects.toThrow('原任务授权签收');
 expect(f.probe).not.toHaveBeenCalled();
 expect(f.pool.query.mock.calls.every(([sql]) => sql.startsWith('SELECT '))).toBe(true);
});
it('独立签收摘要漂移时拒绝且不获取资源锁或打开事务', async () => {
 const f = setup(); f.input.expected_attestation_sha256 = 'f'.repeat(64);
 await expect(reconcileFailedCommander(f.pool, f.task.id, f.input, { probe: f.probe })).rejects.toThrow('独审摘要CAS');
 expect(f.probe).not.toHaveBeenCalled();
 expect(f.pool.query.mock.calls.every(([sql]) => sql.startsWith('SELECT ') && !sql.includes('FOR UPDATE'))).toBe(true);
});
