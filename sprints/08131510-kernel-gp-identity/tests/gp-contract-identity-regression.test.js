/**
 * 回归测试：Journey-only Harness 被 GP 合同身份误杀修复
 *
 * Sprint: 08131510-kernel-gp-identity
 * Task:   b858a8bb-a5c4-4e84-a975-a6cd79b55be0
 *
 * 覆盖 PRD 要求的三条验收路径：
 *   DoD-1: journey-only → 组包成功，gp_contract 不注入
 *   DoD-2: 部分 GP 身份 → fail-closed，GP_CONTRACT_IDENTITY_INVALID
 *   DoD-3: 完整 GP 路径 → gp_contract 正确注入（回归已有行为）
 *
 * 运行方式（本地，target_environment=local_api）：
 *   npx vitest run sprints/08131510-kernel-gp-identity/tests/gp-contract-identity-regression.test.js
 *
 * 这些断言设计为：修复前（当前代码）DoD-1 红、DoD-2 DoD-3 绿；
 * 修复后全部绿。测试永久保留在 CI 作为回归守护。
 */

import { describe, expect, it, vi } from 'vitest';

import { createDispatcher } from '../../../packages/brain/src/orchestrator/dispatcher.js';

// ── 固定 UUID / SHA256 常量 ───────────────────────────────────────────────────

const TASK_ID      = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RUN_ID       = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID   = '22222222-2222-4222-8222-222222222222';
const JOURNEY_ID   = '33333333-3333-4333-8333-333333333333';
const GP_ID        = '77777777-7777-4777-8777-777777777777';
const CONTRACT_ID  = '66666666-6666-4666-8666-666666666666';
const STEP_ID      = '99999999-9999-4999-8999-999999999999';
const CONTRACT_HASH = 'e'.repeat(64);

// ── 最小 observed 基线 ────────────────────────────────────────────────────────

const baseObserved = {
  task: {
    id: TASK_ID,
    title: 'GP Identity Regression',
    description: 'Test task for gp-contract-identity fix.',
    payload: {
      executor: 'auto',
      sprint_dir: 'sprints/08131510-kernel-gp-identity',
      worktree_path: '/tmp/worktree-regression',
    },
  },
  run: { id: RUN_ID },
  contract: { approved: false, row: { propose_branch: 'cp-regression-r1' } },
  pr: null,
  prdExists: true,
  proposeBranchRn: 1,
  proposeBranch: 'cp-regression-propose-r1',
  proposeBranchSha: 'a'.repeat(40),
  callbackResult: null,
};

// ── 最小 deps 工厂 ────────────────────────────────────────────────────────────

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
        lease_owner: 'regression-test:0',
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
    registry: {
      resolve: vi.fn(() => adapter),
    },
    launcher: {
      launch: vi.fn(async () => ({
        actualMachineId: 'brain-test',
        executionTransport: 'local-docker',
        remoteJobId: null,
        attestationStatus: 'local',
        containerId: 'container-regression',
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
    createCallbackSecret: () => 'regression-secret',
    machineId: 'brain-test',
    leaseOwner: 'regression-test:0',
  };
}

// ── DoD-1: journey-only 路径（主 bug 修复回归）────────────────────────────────

describe('DoD-1: journey-only 路径 — 组包成功，gp_contract 不注入', () => {
  it('payload 仅含 journey_id，dispatch spawn:generator-fix 不抛异常，createAttempt 被调用', async () => {
    const deps = makeDeps();

    // 仅含 journey_id，无任何 GP 合同身份字段
    const journeyOnlyObserved = {
      ...baseObserved,
      task: {
        ...baseObserved.task,
        payload: {
          ...baseObserved.task.payload,
          journey_id: JOURNEY_ID,
          // gp_contract_id / gp_contract_version / gp_contract_hash /
          // golden_path_id / step_id 全部缺失（undefined）
        },
      },
    };

    // 修复前：此行会抛 GP_CONTRACT_IDENTITY_INVALID，导致 assembly_fault
    // 修复后：应正常返回 LAUNCHED
    const result = await createDispatcher(deps)('spawn:generator-fix', {
      taskId: TASK_ID,
      runId: RUN_ID,
      hop: 19,
      observed: journeyOnlyObserved,
      decision: { phase: 'generate', reason: 'journey_only_regression' },
    });

    // 组包成功
    expect(deps.attemptStore.createAttempt).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ status: 'LAUNCHED' });

    // gp_contract 不注入
    const bundle = deps.attemptStore.createAttempt.mock.calls[0][0].bundle;
    expect(bundle.inputs).not.toHaveProperty('gp_contract');
  });

  it('payload 含 journey_id 且 GP 合同字段显式为 null，gp_contract 不注入', async () => {
    const deps = makeDeps();

    const nullGpObserved = {
      ...baseObserved,
      task: {
        ...baseObserved.task,
        payload: {
          ...baseObserved.task.payload,
          journey_id: JOURNEY_ID,
          gp_contract_id: null,
          gp_contract_version: null,
          gp_contract_hash: null,
          golden_path_id: null,
          anchor: { step_id: null },
        },
      },
    };

    const result = await createDispatcher(deps)('spawn:generator-fix', {
      taskId: TASK_ID,
      runId: RUN_ID,
      hop: 20,
      observed: nullGpObserved,
      decision: { phase: 'generate', reason: 'null_gp_fields' },
    });

    expect(result).toMatchObject({ status: 'LAUNCHED' });
    const bundle = deps.attemptStore.createAttempt.mock.calls[0][0].bundle;
    expect(bundle.inputs).not.toHaveProperty('gp_contract');
  });

  it('全字段均为 null/undefined（历史路径），gp_contract 不注入', async () => {
    const deps = makeDeps();

    // 历史路径：所有字段均缺失（原有行为，不得回退）
    const noGpObserved = {
      ...baseObserved,
      task: {
        ...baseObserved.task,
        payload: {
          ...baseObserved.task.payload,
          // 无 journey_id，无任何 GP 字段
        },
      },
    };

    const result = await createDispatcher(deps)('spawn:generator', {
      taskId: TASK_ID,
      runId: RUN_ID,
      hop: 5,
      observed: noGpObserved,
      decision: { phase: 'generate', reason: 'no_gp_at_all' },
    });

    expect(result).toMatchObject({ status: 'LAUNCHED' });
    const bundle = deps.attemptStore.createAttempt.mock.calls[0][0].bundle;
    expect(bundle.inputs).not.toHaveProperty('gp_contract');
  });
});

// ── DoD-2: 部分 GP 身份 fail-closed ──────────────────────────────────────────

describe('DoD-2: 部分 GP 身份 — fail-closed，GP_CONTRACT_IDENTITY_INVALID', () => {
  // Reviewer 提示（DoD-2）：buildInputs 的 throw 被 dispatch() 外层 catch 捕获，
  // 转为 preAttemptAssemblyFault 返回值（status:'DONE_WITH_CONCERNS'），
  // 故断言方式为检查返回值含 assembly_fault + detail 含 GP_CONTRACT_IDENTITY_INVALID，
  // 而非 rejects.toThrow。

  it('payload 含 journey_id + golden_path_id，缺其余 GP 字段 → assembly_fault GP_CONTRACT_IDENTITY_INVALID', async () => {
    const deps = makeDeps();

    const partialGpObserved = {
      ...baseObserved,
      task: {
        ...baseObserved.task,
        payload: {
          ...baseObserved.task.payload,
          journey_id: JOURNEY_ID,
          golden_path_id: GP_ID,
          // 缺 gp_contract_id / gp_contract_version / gp_contract_hash / step_id
        },
      },
    };

    const result = await createDispatcher(deps)('spawn:generator-fix', {
      taskId: TASK_ID,
      runId: RUN_ID,
      hop: 19,
      observed: partialGpObserved,
      decision: { phase: 'generate', reason: 'partial_gp_identity' },
    });

    expect(result).toMatchObject({
      status: 'DONE_WITH_CONCERNS',
      failure_class: 'assembly_fault',
    });
    expect(result.detail).toContain('GP_CONTRACT_IDENTITY_INVALID');
  });

  it('anchor 含 gp_id（golden_path_id 存在），payload 无其余 GP 字段 → assembly_fault', async () => {
    const deps = makeDeps();

    const anchorGpObserved = {
      ...baseObserved,
      task: {
        ...baseObserved.task,
        payload: {
          ...baseObserved.task.payload,
          journey_id: JOURNEY_ID,
          anchor: { gp_id: GP_ID },  // anchor.gp_id 算作 GP 合同字段出现
          // 缺 gp_contract_id / gp_contract_version / gp_contract_hash / step_id
        },
      },
    };

    const result = await createDispatcher(deps)('spawn:generator', {
      taskId: TASK_ID,
      runId: RUN_ID,
      hop: 10,
      observed: anchorGpObserved,
      decision: { phase: 'generate', reason: 'anchor_gp_id_partial' },
    });

    expect(result).toMatchObject({
      status: 'DONE_WITH_CONCERNS',
      failure_class: 'assembly_fault',
    });
    expect(result.detail).toContain('GP_CONTRACT_IDENTITY_INVALID');
  });

  it('payload 含 gp_contract_id（仅一个 GP 字段）→ assembly_fault', async () => {
    const deps = makeDeps();

    const oneFieldGpObserved = {
      ...baseObserved,
      task: {
        ...baseObserved.task,
        payload: {
          ...baseObserved.task.payload,
          journey_id: JOURNEY_ID,
          gp_contract_id: CONTRACT_ID,
          // 缺 version / hash / golden_path_id / step_id
        },
      },
    };

    const result = await createDispatcher(deps)('spawn:generator', {
      taskId: TASK_ID,
      runId: RUN_ID,
      hop: 10,
      observed: oneFieldGpObserved,
      decision: { phase: 'generate', reason: 'single_gp_field' },
    });

    expect(result).toMatchObject({
      status: 'DONE_WITH_CONCERNS',
      failure_class: 'assembly_fault',
    });
    expect(result.detail).toContain('GP_CONTRACT_IDENTITY_INVALID');
  });
});

// ── DoD-3: 完整 GP 路径回归（不得回退）──────────────────────────────────────

describe('DoD-3: 完整 GP 路径 — gp_contract 正确注入（回归已有行为）', () => {
  it('6 字段齐全，gp_contract 注入正确结构，version 转整数', async () => {
    const deps = makeDeps();

    const fullGpObserved = {
      ...baseObserved,
      task: {
        ...baseObserved.task,
        payload: {
          ...baseObserved.task.payload,
          golden_path_id: GP_ID,
          gp_contract_id: CONTRACT_ID,
          gp_contract_version: 1,
          gp_contract_hash: CONTRACT_HASH,
          journey_id: JOURNEY_ID,
          anchor: { step_id: STEP_ID },
        },
      },
    };

    await createDispatcher(deps)('spawn:evaluator', {
      taskId: TASK_ID,
      runId: RUN_ID,
      hop: 9,
      observed: fullGpObserved,
      decision: { phase: 'evaluate', reason: 'gp_identity_full' },
    });

    const bundle = deps.attemptStore.createAttempt.mock.calls[0][0].bundle;
    expect(bundle.inputs.gp_contract).toEqual({
      id: CONTRACT_ID,
      version: 1,                // 整数，非字符串
      hash: CONTRACT_HASH,
      golden_path_id: GP_ID,
      journey_id: JOURNEY_ID,
      step_id: STEP_ID,
    });
  });

  it('gp_contract_version 以字符串传入，version 字段仍转为整数', async () => {
    const deps = makeDeps();

    const stringVersionObserved = {
      ...baseObserved,
      task: {
        ...baseObserved.task,
        payload: {
          ...baseObserved.task.payload,
          golden_path_id: GP_ID,
          gp_contract_id: CONTRACT_ID,
          gp_contract_version: '2',   // 字符串形式
          gp_contract_hash: CONTRACT_HASH,
          journey_id: JOURNEY_ID,
          anchor: { step_id: STEP_ID },
        },
      },
    };

    await createDispatcher(deps)('spawn:generator', {
      taskId: TASK_ID,
      runId: RUN_ID,
      hop: 7,
      observed: stringVersionObserved,
      decision: { phase: 'generate', reason: 'gp_identity_version_string' },
    });

    const bundle = deps.attemptStore.createAttempt.mock.calls[0][0].bundle;
    expect(typeof bundle.inputs.gp_contract.version).toBe('number');
    expect(bundle.inputs.gp_contract.version).toBe(2);
  });
});
