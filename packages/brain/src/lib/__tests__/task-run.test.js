// run 原语纯逻辑层（Harness 合同 sprints/09251224-kernel-66db3dfb 冻结测试移植）
// 覆盖父路: 独立小路（无父路）—— 链 bf5088a3 第 1 棒 F1 执行基座，无已验收前序 ability
//
// 本文件只测「环境无关的纯逻辑断言」（normalizeRunStatus / buildRunContext /
// buildRunResult / detectBareRuns），从仓库根 vitest（sprints/** include）跑，不碰 DB。
// task_runs 真实写路径（startRun/finishRun 落库这条边）的验证在
// packages/brain/src/__tests__/integration/task-run-primitive.pg.integration.test.js
// （真 Postgres，禁 mock db.js 边），由 brain-integration 跑。
//

import { describe, it, expect } from 'vitest';
import {
  normalizeRunStatus,
  buildRunContext,
  buildRunResult,
  detectBareRuns,
} from '../task-run.js';

describe('normalizeRunStatus — 回调状态映射到 task_runs 状态枚举', () => {
  it('running 保持 running', () => {
    expect(normalizeRunStatus('running')).toBe('running');
  });

  it('completed / completed_no_pr / succeeded 归一到 success', () => {
    expect(normalizeRunStatus('completed')).toBe('success');
    expect(normalizeRunStatus('completed_no_pr')).toBe('success');
    expect(normalizeRunStatus('succeeded')).toBe('success');
  });

  it('failed / quota_exhausted 归一到 failed', () => {
    expect(normalizeRunStatus('failed')).toBe('failed');
    expect(normalizeRunStatus('quota_exhausted')).toBe('failed');
  });

  it('timeout / cancelled 各自保留', () => {
    expect(normalizeRunStatus('timeout')).toBe('timeout');
    expect(normalizeRunStatus('cancelled')).toBe('cancelled');
    expect(normalizeRunStatus('canceled')).toBe('cancelled');
  });

  it('未知状态抛错（禁止静默落入非法枚举）', () => {
    expect(() => normalizeRunStatus('weird')).toThrow();
    expect(() => normalizeRunStatus('')).toThrow();
  });
});

describe('buildRunContext — 执行路径必经留痕（source 必填）', () => {
  it('缺 source 抛错（必经留痕铁律：有执行必带执行路径）', () => {
    expect(() => buildRunContext({})).toThrow();
    expect(() => buildRunContext({ source: '' })).toThrow();
  });

  it('携带 source 与可选上下文，剔除 undefined 字段', () => {
    const ctx = buildRunContext({
      source: 'dispatcher',
      agent: 'claude',
      model: 'opus',
      skill: undefined,
    });
    expect(ctx.source).toBe('dispatcher');
    expect(ctx.agent).toBe('claude');
    expect(ctx.model).toBe('opus');
    expect('skill' in ctx).toBe(false);
  });
});

describe('buildRunResult — exit code + 产物引用落 result jsonb', () => {
  it('整数 exit code 与 artifacts 数组透传', () => {
    const r = buildRunResult({ exitCode: 0, artifacts: ['pr:123', 's3://x'] });
    expect(r.exit_code).toBe(0);
    expect(r.artifacts).toEqual(['pr:123', 's3://x']);
  });

  it('单个产物引用被包装为数组，缺失 exit code 记 null', () => {
    const r = buildRunResult({ artifacts: 'pr:456' });
    expect(r.exit_code).toBeNull();
    expect(r.artifacts).toEqual(['pr:456']);
  });

  it('无产物时 artifacts 为空数组（不产生 undefined）', () => {
    const r = buildRunResult({ exitCode: 1 });
    expect(r.exit_code).toBe(1);
    expect(r.artifacts).toEqual([]);
  });
});

describe('detectBareRuns — 裸跑检测（有 dispatch_events 无 task_runs）', () => {
  it('返回被派发但无 run 记录的 task_id（裸跑 → AMBER）', () => {
    const bare = detectBareRuns(['t1', 't2', 't3'], ['t2']);
    expect(bare.sort()).toEqual(['t1', 't3']);
  });

  it('全部有 run 记录时返回空数组（无裸跑）', () => {
    expect(detectBareRuns(['t1', 't2'], ['t1', 't2', 'tx'])).toEqual([]);
  });

  it('去重：同一 task_id 多次派发只报一次', () => {
    expect(detectBareRuns(['t1', 't1', 't1'], [])).toEqual(['t1']);
  });
});
