/**
 * Sprint 合同 Red 测试 — Diff Impact Gate 确定性 Map 结论透传 reason_code + fail-closed 出口
 *
 * 锚定 Golden Path：
 *   [Gate 收到确定性 stale 结论] → [透传 reason_code + 判定确定性] → [fail-closed 终止（retryable:false），不空转]
 *
 * 禁 mock 被改的边：真调 evaluateDiffGate / evaluateStructureGate（裁决状态机本体），
 * 只注入更外层的 mapClient（Mapper HTTP 边界，本单不改其算法）。db:null 使 contract=null，
 * 步骤 3a stale 分支在无 Postgres 环境下即可真实进入（runtime_resources.postgres=false）。
 *
 * 基线（d5dcfcd0b）行为：两类 stale 一律折叠成 {reason:'mapper_stale', retryable:true} —— 本测试必红。
 */

import { describe, it, expect } from 'vitest';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';
import { evaluateStructureGate } from '../../../packages/brain/src/impact-contract/structure-gate.js';

const DETERMINISTIC_REASON = 'projection_revision_mismatch';

// Mapper 返回确定性 stale（携带固定 reason_code —— Map 已判定，重试不会改变）
const deterministicStaleMapper = async () => ({
  freshness: { status: 'stale', reason_code: DETERMINISTIC_REASON },
});

// Mapper 返回真·瞬态（status=unknown 且无 reason_code —— 投影延迟/尚未算出）
const transientUnknownMapper = async () => ({
  freshness: { status: 'unknown' },
});

function structureCtx(mapClient) {
  return {
    db: null,
    task: { id: 'task-struct', change_kind: 'bugfix' },
    contract: {
      repo: 'cecelia',
      base_revision: 'base',
      change_kind: 'bugfix',
      affected_capabilities: [],
      contract_body: { affected_capabilities: [], required_assertions: [] },
    },
    mapClient,
  };
}

describe('Diff Impact Gate 确定性 stale reason_code 透传 + fail-closed [BEHAVIOR]', () => {
  it('确定性 stale 结论 diff gate 返回体透传 reason_code 且 retryable false', async () => {
    const r = await evaluateDiffGate({
      db: null, taskId: 'task-det', repo: 'cecelia', headRevision: 'head',
      mapClient: deterministicStaleMapper,
    });
    expect(r.gate).toBe('impact_unknown'); // 仍 blocked，不假绿（fail-closed）
    expect(r.reason_code).toBe(DETERMINISTIC_REASON); // 透传具体原因
    expect(r.retryable).toBe(false); // 确定性 → 不再无限 backoff
  });

  it('确定性 stale 结论 diff gate 不再折叠成通用 mapper_stale reason 遮蔽回执', async () => {
    // gateReceipt.reason = result.reason ?? result.reason_code；只有当 reason 不为通用
    // 'mapper_stale' 时，具体 reason_code 才能在回执 / failRun(impact_gate_deterministic:<code>) 中显现。
    const r = await evaluateDiffGate({
      db: null, taskId: 'task-det2', repo: 'cecelia', headRevision: 'head',
      mapClient: deterministicStaleMapper,
    });
    expect(r.reason).not.toBe('mapper_stale');
    const surfaced = r.reason ?? r.reason_code ?? null; // 复刻 harness-gates gateReceipt 规则
    expect(surfaced).toBe(DETERMINISTIC_REASON);
  });

  it('真瞬态 unknown 无 reason_code 时 diff gate 保留 retryable true 刷新窗口', async () => {
    const r = await evaluateDiffGate({
      db: null, taskId: 'task-transient', repo: 'cecelia', headRevision: 'head',
      mapClient: transientUnknownMapper,
    });
    expect(r.gate).toBe('impact_unknown');
    expect(r.retryable).toBe(true); // 未被误判 fail-closed
  });

  it('Mapper 不可达抛错时 diff gate 保持 mapper_unavailable retryable true', async () => {
    const r = await evaluateDiffGate({
      db: null, taskId: 'task-throw', repo: 'cecelia', headRevision: 'head',
      mapClient: async () => { throw new Error('ETIMEDOUT'); },
    });
    expect(r.gate).toBe('impact_unknown');
    expect(r.reason).toBe('mapper_unavailable');
    expect(r.retryable).toBe(true); // 真不可达属瞬态，不 fail-closed
  });

  it('确定性 stale 结论 structure gate 透传 reason_code 且 retryable false', async () => {
    const r = await evaluateStructureGate(structureCtx(deterministicStaleMapper));
    expect(r.gate).toBe('blocked'); // structure gate 自身 blocked 约定，仍 fail-closed
    expect(r.reason_code).toBe(DETERMINISTIC_REASON);
    expect(r.retryable).toBe(false); // 语义一致：与 diff gate 同处理策略
  });

  it('真瞬态 unknown structure gate 保留 mapper_stale retryable true', async () => {
    const r = await evaluateStructureGate(structureCtx(transientUnknownMapper));
    expect(r.gate).toBe('blocked');
    expect(r.retryable).toBe(true);
  });
});
