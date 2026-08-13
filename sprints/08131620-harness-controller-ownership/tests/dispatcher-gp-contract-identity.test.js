/**
 * [BEHAVIOR] 刀一 — gpContractIdentity 触发谓词只看版本化 GP 身份字段，不把通用 journey_id 当触发字段。
 *
 * 真被测边：packages/brain/src/orchestrator/dispatcher.js 的 __test__.buildInputs → gpContractIdentity（纯函数，无 DB）。
 * 禁 mock 边：本用例是纯函数校验，无被改的接缝边（DB/状态机/跨模块）需要真 PG——故不 mock，直接真调 buildInputs。
 *
 * Red 依据（未修复前）：journey-only payload（只有 journey_id）会让 gpContractIdentity 认定"有 GP 字段"→ 走 valid 校验
 * → 抛 GP_CONTRACT_IDENTITY_INVALID，buildInputs 随之抛错 → 用例 1 FAIL。
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { __test__ } from '../../../packages/brain/src/orchestrator/dispatcher.js';

const { buildInputs, ACTION_SPECS } = __test__;

const ACTION = 'spawn:generator-fix';
const SPEC = ACTION_SPECS[ACTION];

function ctxFor(payload) {
  const taskId = randomUUID();
  return {
    taskId,
    worktreePath: '/workspace',
    observed: {
      task: { id: taskId, title: 't', description: 'd', payload },
      contract: null,
    },
  };
}

const META = { logicalCycleId: 'intent:x:1', attemptKind: 'initial', workstreamKey: 'ws1' };

describe('gpContractIdentity 触发谓词（刀一）', () => {
  it('journey-only payload 不触发 GP 校验，不抛 GP_CONTRACT_IDENTITY_INVALID，且无 gp_contract', () => {
    const payload = { journey_id: randomUUID(), sprint_dir: 's' };
    let inputs;
    expect(() => { inputs = buildInputs(ACTION, SPEC, ctxFor(payload), META); }).not.toThrow();
    expect(inputs.gp_contract).toBeUndefined();
  });

  it('部分 GP 身份（有 gp_contract_id 缺 version/hash）仍 fail-closed 抛 GP_CONTRACT_IDENTITY_INVALID', () => {
    const payload = { gp_contract_id: randomUUID(), journey_id: randomUUID() };
    expect(() => buildInputs(ACTION, SPEC, ctxFor(payload), META))
      .toThrow('GP_CONTRACT_IDENTITY_INVALID');
  });

  it('完整版本化 GP 身份继续透传 frozen contract（含 journey_id + 数值 version）', () => {
    const payload = {
      gp_contract_id: randomUUID(),
      gp_contract_version: 3,
      gp_contract_hash: 'a'.repeat(64),
      golden_path_id: randomUUID(),
      journey_id: randomUUID(),
      anchor: JSON.stringify({ step_id: randomUUID() }),
    };
    const inputs = buildInputs(ACTION, SPEC, ctxFor(payload), META);
    expect(inputs.gp_contract).toBeDefined();
    expect(inputs.gp_contract.version).toBe(3);
    expect(inputs.gp_contract.journey_id).toBe(payload.journey_id);
  });
});
