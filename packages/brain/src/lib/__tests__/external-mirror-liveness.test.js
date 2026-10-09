/**
 * external-mirror-liveness.test.js — 外部 run 镜像活性判据单元测试（任务 0004aceb）。
 * 探针接线的行为测试在 src/__tests__/external-run-mirror-liveness.test.js，真库 SQL 在
 * src/__tests__/external-mirror-liveness.pg.integration.test.js；这里只钉纯函数契约。
 */
import { describe, it, expect } from 'vitest';
import {
  isExternalRunMirror,
  externalActivityAgeMs,
  createStaleLedger,
  EXTERNAL_ACTIVITY_AGE_SQL,
  EXTERNAL_HEARTBEAT_STALE_MS,
  EXTERNAL_RUN_MIRROR_TASK_TYPES,
  EXTERNAL_RUN_MIRROR_UNCONDITIONAL_TASK_TYPES,
  EXTERNAL_RUN_MIRROR_DEVICE_TASK_TYPES,
} from '../external-mirror-liveness.js';

describe('EXTERNAL_RUN_MIRROR_*_TASK_TYPES —— 从注册表派生（铁律 76cb816c），与 lost-deadline / commander-watchdog 的 RUN_TYPES_SQL 同义', () => {
  it('无条件镜像 = workflow_run；真机镜像 = device_job；合集恰好两者（注册表漂移立刻可见）', () => {
    expect([...EXTERNAL_RUN_MIRROR_UNCONDITIONAL_TASK_TYPES]).toEqual(['workflow_run']);
    expect([...EXTERNAL_RUN_MIRROR_DEVICE_TASK_TYPES]).toEqual(['device_job']);
    expect([...EXTERNAL_RUN_MIRROR_TASK_TYPES].sort()).toEqual(['device_job', 'workflow_run']);
    expect(Object.isFrozen(EXTERNAL_RUN_MIRROR_TASK_TYPES)).toBe(true);
  });

  it('content-pipeline（workflow+external 但 watchdog=external-worker，ZJ pipeline-worker 管）不纳入', () => {
    expect(EXTERNAL_RUN_MIRROR_TASK_TYPES).not.toContain('content-pipeline');
  });
});

describe('isExternalRunMirror —— 与 lost-deadline / commander-watchdog 的 RUN_TYPES_SQL 同义', () => {
  it('workflow_run → true（不看 payload）', () => {
    expect(isExternalRunMirror({ task_type: 'workflow_run', payload: null })).toBe(true);
    expect(isExternalRunMirror({ task_type: 'workflow_run', payload: { source: 'notion' } })).toBe(true);
  });

  it('device_job 且 payload.source=cron → true（brain-device-job-mirror 建的镜像单）', () => {
    expect(isExternalRunMirror({ task_type: 'device_job', payload: { source: 'cron' } })).toBe(true);
  });

  it('领单器 device_job（非 cron）→ false，保留 0923 认领新鲜度 + 超时回队路径', () => {
    expect(isExternalRunMirror({ task_type: 'device_job', payload: { source: 'worker-claim' } })).toBe(false);
    expect(isExternalRunMirror({ task_type: 'device_job', payload: {} })).toBe(false);
    expect(isExternalRunMirror({ task_type: 'device_job', payload: null })).toBe(false);
  });

  it('其它类型（dev / qiumi_task / content-pipeline）与空输入 → false', () => {
    expect(isExternalRunMirror({ task_type: 'dev', payload: { source: 'cron' } })).toBe(false);
    expect(isExternalRunMirror({ task_type: 'qiumi_task', payload: { source: 'cron' } })).toBe(false);
    expect(isExternalRunMirror({ task_type: 'content-pipeline', payload: {} })).toBe(false);
    expect(isExternalRunMirror(null)).toBe(false);
    expect(isExternalRunMirror(undefined)).toBe(false);
    expect(isExternalRunMirror({})).toBe(false);
  });
});

describe('externalActivityAgeMs —— 读 SQL 判龄列（pg 把 EXTRACT numeric 当字符串返回）', () => {
  it('字符串秒数 → 毫秒', () => {
    expect(externalActivityAgeMs({ external_activity_age_sec: '180' })).toBe(180_000);
    expect(externalActivityAgeMs({ external_activity_age_sec: '2400.731' })).toBeCloseTo(2_400_731, 0);
  });

  it('数字秒数 → 毫秒；负数（时钟回拨）钳到 0', () => {
    expect(externalActivityAgeMs({ external_activity_age_sec: 60 })).toBe(60_000);
    expect(externalActivityAgeMs({ external_activity_age_sec: -5 })).toBe(0);
  });

  it('列缺失 / NULL / 空串 / 不可解析 → null（年龄未知）', () => {
    expect(externalActivityAgeMs({})).toBeNull();
    expect(externalActivityAgeMs({ external_activity_age_sec: null })).toBeNull();
    expect(externalActivityAgeMs({ external_activity_age_sec: '' })).toBeNull();
    expect(externalActivityAgeMs({ external_activity_age_sec: 'abc' })).toBeNull();
    expect(externalActivityAgeMs(null)).toBeNull();
  });
});

describe('createStaleLedger —— 陈旧留痕每窗口一次，心跳恢复即清，离开 in_progress 回收', () => {
  const W = 30 * 60 * 1000;

  it('新鲜（≤ 窗口）→ false 且不登记', () => {
    const ledger = createStaleLedger(W);
    expect(ledger.shouldNote('t1', W, 1000)).toBe(false);
    expect(ledger.noted.has('t1')).toBe(false);
  });

  it('陈旧首次 → true 并登记；同窗口内再问 → false；窗口过后 → 再 true', () => {
    const ledger = createStaleLedger(W);
    expect(ledger.shouldNote('t1', W + 1, 1000)).toBe(true);
    expect(ledger.shouldNote('t1', W + 1, 1000 + W - 1)).toBe(false);
    expect(ledger.shouldNote('t1', W + 1, 1000 + W)).toBe(true);
  });

  it('年龄未知（null）按陈旧处理', () => {
    const ledger = createStaleLedger(W);
    expect(ledger.shouldNote('t1', null, 1000)).toBe(true);
    expect(ledger.shouldNote('t1', null, 2000)).toBe(false);
  });

  it('心跳恢复（变新鲜）清掉登记，下次再陈旧立刻可记', () => {
    const ledger = createStaleLedger(W);
    expect(ledger.shouldNote('t1', W + 1, 1000)).toBe(true);
    expect(ledger.shouldNote('t1', 10, 2000)).toBe(false);
    expect(ledger.noted.has('t1')).toBe(false);
    expect(ledger.shouldNote('t1', W + 1, 3000)).toBe(true);
  });

  it('prune 只保留仍在 in_progress 的任务；clear 全清', () => {
    const ledger = createStaleLedger(W);
    ledger.shouldNote('gone', null, 1000);
    ledger.shouldNote('live', null, 1000);
    ledger.prune(new Set(['live']));
    expect([...ledger.noted.keys()]).toEqual(['live']);
    ledger.clear();
    expect(ledger.noted.size).toBe(0);
  });

  it('默认窗口 = EXTERNAL_HEARTBEAT_STALE_MS（默认 30 分钟）', () => {
    expect(createStaleLedger().windowMs).toBe(EXTERNAL_HEARTBEAT_STALE_MS);
    expect(EXTERNAL_HEARTBEAT_STALE_MS).toBe(30 * 60 * 1000);
  });
});

describe('EXTERNAL_ACTIVITY_AGE_SQL —— 形状契约（真库行为见 pg 集成测试）', () => {
  it('只对 run 类型算龄，覆盖五路来源，payload 串带 ISO 形状守卫', () => {
    expect(EXTERNAL_ACTIVITY_AGE_SQL).toMatch(/task_type IN \('workflow_run', 'device_job'\)/);
    expect(EXTERNAL_ACTIVITY_AGE_SQL).toMatch(/FROM task_runs r WHERE r\.task_id = tasks\.id/);
    expect(EXTERNAL_ACTIVITY_AGE_SQL).toMatch(/commander_heartbeat_at/);
    expect(EXTERNAL_ACTIVITY_AGE_SQL).toMatch(/executed_at/);
    expect(EXTERNAL_ACTIVITY_AGE_SQL).toMatch(/tasks\.updated_at::timestamptz/);
    expect(EXTERNAL_ACTIVITY_AGE_SQL).toMatch(/tasks\.started_at::timestamptz/);
    expect((EXTERNAL_ACTIVITY_AGE_SQL.match(/~ '\^\\d\{4\}/g) || []).length).toBe(2);
  });
});
