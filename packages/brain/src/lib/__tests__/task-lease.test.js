/**
 * task-lease 纯函数（派发总闸 G，任务 c5f6e683）：租约秒数夹紧、过期处置按执行者合同 onStale。
 * 真库行为见 integration/task-lease-device-pool.pg.integration.test.js。
 */
import { describe, it, expect } from 'vitest';
import { clampLeaseSeconds, resolveExpiryAction, LEASE_MIN_SECONDS, LEASE_MAX_SECONDS } from '../task-lease.js';

describe('clampLeaseSeconds', () => {
  it('不带 → null（不落租约，旧 claim 行为）', () => {
    expect(clampLeaseSeconds(undefined)).toBeNull();
    expect(clampLeaseSeconds(null)).toBeNull();
    expect(clampLeaseSeconds('')).toBeNull();
    expect(clampLeaseSeconds('abc')).toBeNull();
  });
  it('越界夹紧到 [30, 14400]，小数取整', () => {
    expect(clampLeaseSeconds(1)).toBe(LEASE_MIN_SECONDS);
    expect(clampLeaseSeconds(10 ** 9)).toBe(LEASE_MAX_SECONDS);
    expect(clampLeaseSeconds('600')).toBe(600);
    expect(clampLeaseSeconds(90.6)).toBe(91);
  });
});

describe('resolveExpiryAction：按任务类型现有语义', () => {
  it('合同 onStale=requeue（bridge）/ release-claim-and-alert（headed-session）→ 回队', () => {
    expect(resolveExpiryAction({ executor_kind: 'bridge' }, {})).toBe('requeue');
    expect(resolveExpiryAction({ executor_kind: 'headed-session' }, {})).toBe('requeue');
    expect(resolveExpiryAction({ executor_kind: null }, {})).toBe('requeue');
  });
  it('外部执行体（openclaw-agent / script / coding-workflow-runner / phone-ssh-controller）→ 判 lost', () => {
    for (const k of ['openclaw-agent', 'script', 'coding-workflow-runner', 'phone-ssh-controller']) {
      expect(resolveExpiryAction({ executor_kind: k }, {})).toBe('fail');
    }
  });
  it('领单方显式 on_expire 优先', () => {
    expect(resolveExpiryAction({ executor_kind: 'openclaw-agent' }, { on_expire: 'requeue' })).toBe('requeue');
    expect(resolveExpiryAction({ executor_kind: 'bridge' }, { on_expire: 'fail' })).toBe('fail');
  });
});

import {reapExpiredLeases} from '../task-lease.js';
import {vi} from 'vitest';
describe('获客跨机controller不能代替实际业务终态',()=>{
 it.each(['dead','unknown','alive'])('MMV探活=%s也不能解锁仍可能在M4运行的业务',async verdict=>{
  const row={id:'task',task_id:'task',status:'in_progress',source:'brain',expired_sec:10000,extend_count:99,payload:{leadgen_run:{machine:'xian-m4'}}};
  const query=vi.fn(async sql=>sql.includes('FROM task_leases l')?{rows:[row]}:sql.includes('RETURNING lease_until')?{rows:[{lease_until:'2026-10-15T12:00:00Z'}]}:{rows:[]});
  const r=await reapExpiredLeases({query},{probe:async()=>verdict});
  expect(r.extended).toBe(1);expect(r.failed).toBe(0);expect(r.requeued).toBe(0);
  expect(query.mock.calls.some(c=>c[0].includes('UPDATE tasks')||c[0].includes('DELETE FROM device_locks'))).toBe(false);
  expect(query.mock.calls.some(c=>c[0].includes('UPDATE device_locks SET expires_at'))).toBe(true);
 });
});
