// TDD Red — journey-only GP 合同身份误杀回归。
// 真调 createDispatcher（被改的 gpContractIdentity 判定边不 mock），只替身 attemptStore/launcher/registry。
// 修复前：journey-only / journey-illegal 两条 red（assembly_fault）；修复后全绿。
// 生产复现: task ad9f3a01 仅带 journey_id → hop17 spawn:generator-fix → GP_CONTRACT_IDENTITY_INVALID → assembly_fault。
import { describe, expect, it, vi } from 'vitest';

import { createDispatcher } from '../../../packages/brain/src/orchestrator/dispatcher.js';

const taskId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const runId = '11111111-1111-4111-8111-111111111111';
const attemptId = '22222222-2222-4222-8222-222222222222';
const JOURNEY_ID = '88888888-8888-4888-8888-888888888888';
const GP_ID = '77777777-7777-4777-8777-777777777777';
const CONTRACT_ID = '66666666-6666-4666-8666-666666666666';
const STEP_ID = '99999999-9999-4999-8999-999999999999';

function makeDeps() {
  const createAttempt = vi.fn(async (input) => ({ id: input.id, ...input, task_bundle: input.bundle }));
  return {
    createAttempt,
    deps: {
      attemptStore: {
        createAttempt,
        markStarting: vi.fn(async (id) => ({ id, status: 'starting', lease_owner: 'x:1', lease_generation: 0 })),
        recordLaunchReceipt: vi.fn(async (id, r) => ({ id, status: 'starting', ...r })),
        fail: vi.fn(),
        listFailedExecutionTargets: vi.fn(async () => []),
      },
      registry: { resolve: vi.fn(() => ({ name: 'codex', start: vi.fn(() => ({ provider: 'codex', command: 'codex', args: ['exec'], stdin: '{}' })) })) },
      launcher: {
        launch: vi.fn(async () => ({ actualMachineId: 'brain-1', executionTransport: 'local-docker', remoteJobId: null, attestationStatus: 'local', containerId: 'c1', jobId: null })),
        inspect: vi.fn(),
        cancel: vi.fn(async () => ({ status: 'missing' })),
      },
      loadSkill: vi.fn((name) => ({ name, version: '1.0.0', digest: `sha256:${'a'.repeat(64)}`, content: 'x' })),
      randomUUID: () => attemptId,
      createCallbackSecret: () => 's',
      machineId: 'brain-1',
      leaseOwner: 'x:1',
    },
  };
}

function baseObserved(payload) {
  return {
    task: { id: taskId, title: 'T', description: 'd', payload: { executor: 'auto', sprint_dir: 'sprints/08131510-kernel-gp-identity', worktree_path: '/tmp/w', ...payload } },
    run: { id: runId },
    contract: { approved: false, row: { propose_branch: 'cp-propose-r1' } },
    pr: { head_ref: 'cp-fix', head_sha: 'b'.repeat(40) },
    prdExists: true,
    proposeBranchRn: 1,
    proposeBranch: 'cp-x',
    proposeBranchSha: 'a'.repeat(40),
    callbackResult: { transcript: 't' },
  };
}

async function dispatch(payload, action = 'spawn:generator-fix') {
  const { createAttempt, deps } = makeDeps();
  const res = await createDispatcher(deps)(action, {
    taskId, runId, hop: 17, observed: baseObserved(payload), decision: { phase: 'generate', reason: 'x' },
  });
  const bundle = createAttempt.mock.calls[0]?.[0]?.bundle ?? null;
  return { res, bundle, createAttempt };
}

describe('gpContractIdentity — journey-only 不触发 GP 全字段校验 [BEHAVIOR]', () => {
  it('journey-only spawn:generator-fix 组包成功且不注入 gp_contract', async () => {
    const { res, bundle } = await dispatch({ journey_id: JOURNEY_ID });
    expect(res.failure_class).not.toBe('assembly_fault');
    expect(res.detail).not.toBe('GP_CONTRACT_IDENTITY_INVALID');
    expect(res.fallback_reason).not.toBe('TASK_BUNDLE_ASSEMBLY_FAILED');
    expect(bundle).not.toBeNull();
    expect(bundle.inputs.gp_contract).toBeUndefined();
  });

  it('仅 journey_id 且非法格式仍旁路 GP 全字段校验', async () => {
    const { res, bundle } = await dispatch({ journey_id: 'not-a-uuid' });
    expect(res.failure_class).not.toBe('assembly_fault');
    expect(bundle).not.toBeNull();
    expect(bundle.inputs.gp_contract).toBeUndefined();
  });

  it('出现任一 GP 身份字段但不全 → 继续 fail-closed', async () => {
    const { res, createAttempt } = await dispatch({ journey_id: JOURNEY_ID, golden_path_id: GP_ID });
    expect(res.failure_class).toBe('assembly_fault');
    expect(res.detail).toBe('GP_CONTRACT_IDENTITY_INVALID');
    expect(createAttempt).not.toHaveBeenCalled();
  });

  it('完整 GP 身份 → gp_contract 结构化透传不变', async () => {
    const { res, bundle } = await dispatch({
      journey_id: JOURNEY_ID, gp_contract_id: CONTRACT_ID, gp_contract_version: 1,
      gp_contract_hash: 'e'.repeat(64), golden_path_id: GP_ID, anchor: { step_id: STEP_ID },
    });
    expect(res.failure_class).not.toBe('assembly_fault');
    expect(bundle.inputs.gp_contract).toEqual({
      id: CONTRACT_ID, version: 1, hash: 'e'.repeat(64), golden_path_id: GP_ID, journey_id: JOURNEY_ID, step_id: STEP_ID,
    });
  });

  it('空 payload → 返回 null（组包成功、无 gp_contract）', async () => {
    const { res, bundle } = await dispatch({});
    expect(res.failure_class).not.toBe('assembly_fault');
    expect(bundle).not.toBeNull();
    expect(bundle.inputs.gp_contract).toBeUndefined();
  });
});
