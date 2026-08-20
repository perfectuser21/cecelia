/**
 * TDD Red — Diff Impact Gate 非 fresh 分支透传 reason_code + 确定性 unknown fail-closed
 *
 * 直接调用真实 evaluateDiffGate（禁 mock 被改的边：不 stub diff-gate 本体，只经 mapClient 注入
 * mapperResult.freshness 作为输入）。非 fresh 分支在任何 DB 访问之前早返回，故省略 db 入参、无需真库。
 *
 * 修复前（现状 diff-gate.js:202-208 无条件 mapper_stale/retryable:true）：unknown/缺失场景全红。
 * 修复后：stale→retryable:true 透传码；unknown/缺失→retryable:false（fail-closed）透传码，绝不 mapper_stale。
 *
 * sprint: 08201044-kernel-425c5279
 */

import { describe, it, expect } from 'vitest';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

const gate = (freshness: unknown) =>
  evaluateDiffGate({ mapClient: async () => ({ freshness }) as any });

describe('Diff Impact Gate 非 fresh 分支 [BEHAVIOR]', () => {
  it('确定性 unknown 返回 retryable false 且透传具体 reason_code 非 mapper_stale', async () => {
    const r = await gate({ status: 'unknown', reason_code: 'graph_projection_revision_mismatch' });
    expect(r.gate).toBe('impact_unknown');
    expect(r.retryable).toBe(false);
    expect(r.reason).toBe('graph_projection_revision_mismatch');
    expect(r.reason_code).toBe('graph_projection_revision_mismatch');
    expect(r.reason).not.toBe('mapper_stale');
  });

  it('瞬态 stale 返回 retryable true 且透传具体 reason_code', async () => {
    const r = await gate({ status: 'stale', reason_code: 'fact_snapshot_stale' });
    expect(r.gate).toBe('impact_unknown');
    expect(r.retryable).toBe(true);
    expect(r.reason).toBe('fact_snapshot_stale');
    expect(r.reason_code).toBe('fact_snapshot_stale');
  });

  it('unknown 缺 reason_code 用确定性兜底码 mapper_unknown 且 retryable false', async () => {
    const r = await gate({ status: 'unknown' });
    expect(r.retryable).toBe(false);
    expect(r.reason).toBe('mapper_unknown');
    expect(r.reason).not.toBe('mapper_stale');
  });

  it('freshness 缺失维持 fail-closed retryable false 绝不 mapper_stale 绝不 pass', async () => {
    const r = await gate(null);
    expect(r.gate).toBe('impact_unknown');
    expect(r.retryable).toBe(false);
    expect(r.reason).not.toBe('mapper_stale');
    expect(r.gate).not.toBe('pass');
  });

  it('stale 缺 reason_code 用瞬态兜底码 mapper_stale 且 retryable true', async () => {
    const r = await gate({ status: 'stale' });
    expect(r.retryable).toBe(true);
    expect(r.reason).toBe('mapper_stale');
  });
});
