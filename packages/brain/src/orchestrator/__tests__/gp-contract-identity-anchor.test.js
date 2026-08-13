/**
 * 回归测试：GP 合同身份闸触发集缩到合同三件套——锚点字段不连坐
 *
 * 根因（决策 2026-08-13「gpContractIdentity 触发集缩到合同三件套」）：
 * S2 锚点执法强制任务带 payload.anchor{journey_id, gp_id, step_id}，而
 * gpContractIdentity 的短路谓词把 golden_path_id(=anchor.gp_id)/step_id 列入
 * 触发集——两道闸打架：所有守规矩带锚、但尚未签署 GP 合同的任务，在
 * generator/evaluator 派发时必炸 GP_CONTRACT_IDENTITY_INVALID → assembly_fault
 * （2026-08-13 晚 run 8b468cdd / 01eeb2a0 / 52e9241a 等 5 条全灭实证）。
 *
 * 正确语义：
 * - 触发集 = 合同三件套（gp_contract_id / gp_contract_version / gp_contract_hash）。
 *   三件套全空 → 本次派发不携带合同身份，返回 null 放行（锚点字段有无均不触发）。
 * - 三件套任一非空 → 全套校验 fail-closed（含锚点配套字段），安全红线不变。
 *
 * 本文件断言设计：修复前「anchor-only 放行」两条为 RED；修复后全绿。
 * 永久保留 CI 作为回归守护。
 */

import { describe, expect, it, vi } from 'vitest';

import { createDispatcher } from '../dispatcher.js';

const TASK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const JOURNEY_ID = '33333333-3333-4333-8333-333333333333';
const GP_ID = '77777777-7777-4777-8777-777777777777';
const CONTRACT_ID = '66666666-6666-4666-8666-666666666666';
const STEP_ID = '99999999-9999-4999-8999-999999999999';
const CONTRACT_HASH = 'e'.repeat(64);

const baseObserved = {
  task: {
    id: TASK_ID,
    title: 'GP Identity Anchor Regression',
    description: 'Anchor fields must not trigger contract identity validation.',
    payload: {
      executor: 'auto',
      sprint_dir: 'sprints/08131921-gp-identity-anchor',
      worktree_path: '/tmp/worktree-anchor-regression',
    },
  },
  run: { id: RUN_ID },
  contract: { approved: false, row: { propose_branch: 'cp-anchor-regression-r1' } },
  pr: null,
  prdExists: true,
  proposeBranchRn: 1,
  proposeBranch: 'cp-anchor-regression-propose-r1',
  proposeBranchSha: 'a'.repeat(40),
  callbackResult: null,
};

function makeDeps() {
  const adapter = {
    name: 'codex',
    start: vi.fn(() => ({
      provider: 'codex',
      command: 'codex',
      args: ['exec'],
      stdin: '{}',
    })),
  };
  return {
    attemptStore: {
      createAttempt: vi.fn(async (input) => ({
        id: input.id,
        ...input,
        task_bundle: input.bundle,
      })),
      markStarting: vi.fn(async (id) => ({
        id,
        status: 'starting',
        lease_owner: 'anchor-regression:0',
        lease_generation: 0,
      })),
      recordLaunchReceipt: vi.fn(async (id, receipt) => ({
        id,
        status: 'starting',
        ...receipt,
      })),
      fail: vi.fn(),
      listFailedExecutionTargets: vi.fn(async () => []),
    },
    registry: { resolve: vi.fn(() => adapter) },
    launcher: {
      launch: vi.fn(async () => ({
        actualMachineId: 'brain-test',
        executionTransport: 'local-docker',
        remoteJobId: null,
        attestationStatus: 'local',
        containerId: 'container-anchor-regression',
        jobId: null,
      })),
      inspect: vi.fn(),
      cancel: vi.fn(async () => ({ status: 'missing' })),
    },
    loadSkill: vi.fn((name) => ({
      name,
      version: '1.0.0',
      digest: `sha256:${'a'.repeat(64)}`,
      content: `${name} instructions`,
    })),
    randomUUID: () => ATTEMPT_ID,
    createCallbackSecret: () => 'anchor-regression-secret',
    machineId: 'brain-test',
    leaseOwner: 'anchor-regression:0',
  };
}

function payloadObserved(payloadExtra) {
  return {
    ...baseObserved,
    task: {
      ...baseObserved.task,
      payload: { ...baseObserved.task.payload, ...payloadExtra },
    },
  };
}

// ── 主修复：anchor 锚点字段不触发合同身份校验（修复前 RED）────────────────────

describe('anchor 三件套锚点 — 无合同三件套时放行，不触发 GP 身份校验', () => {
  it('anchor{journey_id, gp_id, step_id} 齐 + journey_id，无 gp_contract_* → LAUNCHED，gp_contract 不注入', async () => {
    const deps = makeDeps();
    const observed = payloadObserved({
      journey_id: JOURNEY_ID,
      anchor: { journey_id: JOURNEY_ID, gp_id: GP_ID, step_id: STEP_ID },
    });

    const result = await createDispatcher(deps)('spawn:generator', {
      taskId: TASK_ID,
      runId: RUN_ID,
      hop: 11,
      observed,
      decision: { phase: 'generate', reason: 'anchor_full_no_contract' },
    });

    expect(deps.attemptStore.createAttempt).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ status: 'LAUNCHED' });
    const bundle = deps.attemptStore.createAttempt.mock.calls[0][0].bundle;
    expect(bundle.inputs).not.toHaveProperty('gp_contract');
  });

  it('仅 anchor.gp_id（golden_path_id 非空），无 gp_contract_* → LAUNCHED 放行', async () => {
    const deps = makeDeps();
    const observed = payloadObserved({
      journey_id: JOURNEY_ID,
      anchor: { gp_id: GP_ID },
    });

    const result = await createDispatcher(deps)('spawn:generator', {
      taskId: TASK_ID,
      runId: RUN_ID,
      hop: 12,
      observed,
      decision: { phase: 'generate', reason: 'anchor_gp_only_no_contract' },
    });

    expect(result).toMatchObject({ status: 'LAUNCHED' });
    const bundle = deps.attemptStore.createAttempt.mock.calls[0][0].bundle;
    expect(bundle.inputs).not.toHaveProperty('gp_contract');
  });

  it('journey-only（仅 journey_id）→ LAUNCHED 放行（吸收 #4868 DoD-1，不得回退）', async () => {
    const deps = makeDeps();
    const observed = payloadObserved({ journey_id: JOURNEY_ID });

    const result = await createDispatcher(deps)('spawn:generator', {
      taskId: TASK_ID,
      runId: RUN_ID,
      hop: 13,
      observed,
      decision: { phase: 'generate', reason: 'journey_only' },
    });

    expect(result).toMatchObject({ status: 'LAUNCHED' });
    const bundle = deps.attemptStore.createAttempt.mock.calls[0][0].bundle;
    expect(bundle.inputs).not.toHaveProperty('gp_contract');
  });
});

// ── 安全红线：合同三件套任一非空 → 全套 fail-closed（不得回退）────────────────

describe('合同三件套触发 — fail-closed 安全红线不变', () => {
  it('仅 gp_contract_id（缺 version/hash）→ assembly_fault GP_CONTRACT_IDENTITY_INVALID', async () => {
    const deps = makeDeps();
    const observed = payloadObserved({
      journey_id: JOURNEY_ID,
      gp_contract_id: CONTRACT_ID,
      anchor: { gp_id: GP_ID, step_id: STEP_ID },
    });

    const result = await createDispatcher(deps)('spawn:generator', {
      taskId: TASK_ID,
      runId: RUN_ID,
      hop: 14,
      observed,
      decision: { phase: 'generate', reason: 'contract_id_only' },
    });

    expect(result).toMatchObject({
      status: 'DONE_WITH_CONCERNS',
      failure_class: 'assembly_fault',
    });
    expect(result.detail).toContain('GP_CONTRACT_IDENTITY_INVALID');
  });

  it('三件套齐但锚点配套缺（无 step_id）→ assembly_fault（三件套触发全套校验）', async () => {
    const deps = makeDeps();
    const observed = payloadObserved({
      journey_id: JOURNEY_ID,
      golden_path_id: GP_ID,
      gp_contract_id: CONTRACT_ID,
      gp_contract_version: 1,
      gp_contract_hash: CONTRACT_HASH,
      // 缺 anchor.step_id
    });

    const result = await createDispatcher(deps)('spawn:generator', {
      taskId: TASK_ID,
      runId: RUN_ID,
      hop: 15,
      observed,
      decision: { phase: 'generate', reason: 'contract_full_step_missing' },
    });

    expect(result).toMatchObject({
      status: 'DONE_WITH_CONCERNS',
      failure_class: 'assembly_fault',
    });
    expect(result.detail).toContain('GP_CONTRACT_IDENTITY_INVALID');
  });
});

// ── 完整合同路径回归（吸收 #4868 DoD-3，不得回退）────────────────────────────

describe('完整 GP 合同路径 — gp_contract 正确注入', () => {
  it('三件套 + 锚点配套齐全 → gp_contract 注入，version 转整数', async () => {
    const deps = makeDeps();
    const observed = payloadObserved({
      golden_path_id: GP_ID,
      gp_contract_id: CONTRACT_ID,
      gp_contract_version: '2',
      gp_contract_hash: CONTRACT_HASH,
      journey_id: JOURNEY_ID,
      anchor: { step_id: STEP_ID },
    });

    await createDispatcher(deps)('spawn:evaluator', {
      taskId: TASK_ID,
      runId: RUN_ID,
      hop: 16,
      observed,
      decision: { phase: 'evaluate', reason: 'contract_full' },
    });

    const bundle = deps.attemptStore.createAttempt.mock.calls[0][0].bundle;
    expect(bundle.inputs.gp_contract).toEqual({
      id: CONTRACT_ID,
      version: 2,
      hash: CONTRACT_HASH,
      golden_path_id: GP_ID,
      journey_id: JOURNEY_ID,
      step_id: STEP_ID,
    });
    expect(typeof bundle.inputs.gp_contract.version).toBe('number');
  });
});
