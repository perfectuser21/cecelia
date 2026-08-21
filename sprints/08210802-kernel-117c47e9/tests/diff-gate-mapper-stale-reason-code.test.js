/**
 * Sprint 08210802-kernel-117c47e9 — Diff Impact Gate reason_code 透传 + fail-closed 出口
 *
 * 复现 runs f62c7e87 / d1360a48 的 `deny:impact:mapper_stale` 空转：
 * diff-gate step 3a 把 Mapper 确定性非 fresh 结论折叠成写死 { reason:'mapper_stale', retryable:true }，
 * 丢弃 Mapper 自己的 reason_code，派发层看到 retryable:true 无限重试，任务永不终结。
 *
 * 禁 mock 边：被改的是 evaluateDiffGate 内 step 3a 对 freshness 的纯逻辑判定——
 * 测试调用【真实】 evaluateDiffGate（不 stub/替身被测函数本身），只在合法边界注入
 * mapClient（Mapper 是本 sprint 明确 out-of-scope 的外部依赖，与既有 diff-gate.test.js 一致），
 * 且 db:null（step 3a 在任何 DB 副作用之前返回，无 DB 写路径涉及）。
 */

import { describe, test, expect, vi } from 'vitest';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

// db:null → 跳过 step1（contract_missing 在 if(db) 内），直达 step2 mapper → step3a freshness 判定。
const baseArgs = {
  db: null,
  taskId: 'task-mapper-stale',
  headRevision: 'head-sha',
  repo: 'cecelia',
  changedFiles: ['packages/brain/src/impact-contract/diff-gate.js'],
};

describe('Diff Impact Gate — step 3a 非 fresh 分支 reason_code 透传 + fail-closed', () => {
  test('确定性 stale（带 reason_code）→ 透传 reason_code 且 retryable:false（终态收敛）', async () => {
    const mapClient = vi.fn().mockResolvedValue({
      freshness: { status: 'stale', reason_code: 'projection_revision_mismatch' },
      affected_nodes: [],
      required_assertions: [],
    });

    const result = await evaluateDiffGate({ ...baseArgs, mapClient });

    expect(result.gate).toBe('impact_unknown');
    // 透传 Mapper 真实 reason_code，不再写死 mapper_stale 掩盖来源
    expect(result.reason_code).toBe('projection_revision_mismatch');
    // 确定性结论 fail-closed 终态，派发层不再无限重试
    expect(result.retryable).toBe(false);
  });

  test('确定性 unknown 投影（带未知枚举 reason_code）→ 默认 fail-closed retryable:false', async () => {
    const mapClient = vi.fn().mockResolvedValue({
      freshness: { status: 'unknown', reason_code: 'some_future_reason_code' },
      affected_nodes: [],
      required_assertions: [],
    });

    const result = await evaluateDiffGate({ ...baseArgs, mapClient });

    expect(result.gate).toBe('impact_unknown');
    expect(result.reason_code).toBe('some_future_reason_code');
    expect(result.retryable).toBe(false);
  });

  test('暂时性 stale（无 reason_code）→ 保守 retryable:true，未被误杀', async () => {
    const mapClient = vi.fn().mockResolvedValue({
      freshness: { status: 'stale' },
      affected_nodes: [],
      required_assertions: [],
    });

    const result = await evaluateDiffGate({ ...baseArgs, mapClient });

    expect(result.gate).toBe('impact_unknown');
    // 无确定性来源 → reason_code 不虚构（null/缺省）
    expect(result.reason_code ?? null).toBe(null);
    // 保留暂时抖动的可恢复路径
    expect(result.retryable).toBe(true);
  });
});
