// Sprint 08131918-kernel-416ce7c0 — 修复 Journey-only 锚触发 GP Contract 身份误判
//
// 永久回归（NFR [回归保留]）：generator 必须把本文件（import 改为 '../dispatcher.js'）
// 落到 CI include 路径 packages/brain/src/orchestrator/__tests__/dispatcher-gp-contract-identity.test.js。
// vitest.config.js include 不扫 sprints/**（invariant [test-include]），本副本仅作 proposer TDD RED 证据。
//
// 禁 mock 被改的边（invariant [禁 mock 边清单]）：本测试真调 gpContractIdentity → buildInputs → buildBundle
// → parseTaskBundle 全链，createDispatcher 只 mock attemptStore/launcher/registry 等更外层持久化/启动依赖，
// 不 mock 被改的装配边。
import { describe, expect, it, vi } from 'vitest';

import {
  createDispatcher,
  resolveAction,
  __test__,
} from '../../../packages/brain/src/orchestrator/dispatcher.js';

const { buildInputs } = __test__;

const taskId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const runId = '11111111-1111-4111-8111-111111111111';
const attemptId = '22222222-2222-4222-8222-222222222222';

// 权威事故 run 8b468cdd 的 journey e6f803f2（合法 F1 journey_id，无任何 gp_contract_* 字段）
const JOURNEY_ID = 'e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29';

const COMPLETE = Object.freeze({
  golden_path_id: '77777777-7777-4777-8777-777777777777',
  gp_contract_id: '66666666-6666-4666-8666-666666666666',
  gp_contract_version: 1,
  gp_contract_hash: 'e'.repeat(64),
  journey_id: '88888888-8888-4888-8888-888888888888',
  anchor: {
    step_id: '99999999-9999-4999-8999-999999999999',
    gp_id: '77777777-7777-4777-8777-777777777777',
  },
});

function fakeSkill(name) {
  return Object.freeze({
    name,
    version: '1.0.0',
    digest: `sha256:${'a'.repeat(64)}`,
    content: `${name} instructions`,
  });
}

function makeDeps() {
  const leaseOwner = 'dispatcher-gpid-test:4242';
  const adapter = {
    name: 'codex',
    start: vi.fn(() => ({ provider: 'codex', command: 'codex', args: ['exec'], stdin: '{}' })),
  };
  return {
    attemptStore: {
      createAttempt: vi.fn(async (input) => ({ id: input.id, ...input, task_bundle: input.bundle })),
      markStarting: vi.fn(async (id) => ({ id, status: 'starting', lease_owner: leaseOwner, lease_generation: 0 })),
      recordLaunchReceipt: vi.fn(async (id, receipt) => ({ id, status: 'starting', ...receipt })),
      fail: vi.fn(),
      listFailedExecutionTargets: vi.fn(async () => []),
    },
    registry: { resolve: vi.fn(() => adapter) },
    launcher: {
      launch: vi.fn(async () => Object.freeze({
        actualMachineId: 'brain-1',
        executionTransport: 'local-docker',
        remoteJobId: null,
        attestationStatus: 'local',
        containerId: 'container-1',
        jobId: null,
      })),
      inspect: vi.fn(),
      cancel: vi.fn(async () => ({ status: 'missing' })),
    },
    loadSkill: vi.fn(fakeSkill),
    randomUUID: () => attemptId,
    createCallbackSecret: () => 'attempt-secret',
    machineId: 'brain-1',
    leaseOwner,
  };
}

function baseObserved(payloadExtra) {
  return {
    task: {
      id: taskId,
      title: 'Fix journey-only GP contract identity',
      description: 'kernel fix',
      payload: {
        executor: 'auto',
        sprint_dir: 'sprints/08131918-kernel-416ce7c0',
        worktree_path: '/tmp/worktree',
        ...payloadExtra,
      },
    },
    run: { id: runId },
    contract: { approved: false, row: { propose_branch: 'cp-x' } },
    pr: null,
    prdExists: true,
    proposeBranchRn: 1,
    proposeBranch: 'cp-x',
    proposeBranchSha: 'a'.repeat(40),
  };
}

async function assembleGenerator(payloadExtra) {
  const deps = makeDeps();
  const result = await createDispatcher(deps)('spawn:generator', {
    taskId,
    runId,
    hop: 11,
    observed: baseObserved(payloadExtra),
    decision: { phase: 'implement', reason: 'gp_identity' },
  });
  const createCalls = deps.attemptStore.createAttempt.mock.calls;
  return { result, bundle: createCalls[0]?.[0]?.bundle ?? null };
}

const generatorSpec = resolveAction('spawn:generator');
const attemptMetadata = Object.freeze({ logicalCycleId: 'lc', attemptKind: 'initial', workstreamKey: 'ws1' });
function buildGeneratorInputs(payloadExtra) {
  return buildInputs('spawn:generator', generatorSpec, {
    taskId,
    worktreePath: '/tmp/worktree',
    observed: {
      task: { id: taskId, title: 't', payload: { sprint_dir: 'sprints/x', worktree_path: '/tmp/worktree', ...payloadExtra } },
      contract: { approved: false },
    },
  }, attemptMetadata);
}

describe('gpContractIdentity journey-only 锚不误判 [BEHAVIOR]', () => {
  it('RED-1 journey-only payload → spawn:generator 成功组装且 gp_contract 未注入、journey_id 保留进 common', async () => {
    const { result, bundle } = await assembleGenerator({ journey_id: JOURNEY_ID });
    expect(result.status).toBe('LAUNCHED');
    expect(bundle).not.toBeNull();
    expect(bundle.inputs.gp_contract).toBeUndefined();
    expect(bundle.inputs.journey_id).toBe(JOURNEY_ID);
  });

  it('RED-2 partial GP 字段（仅 gp_contract_id，非 journey）→ fail-closed 抛 GP_CONTRACT_IDENTITY_INVALID', () => {
    expect(() => buildGeneratorInputs({ gp_contract_id: '66666666-6666-4666-8666-666666666666' }))
      .toThrow(/GP_CONTRACT_IDENTITY_INVALID/);
  });

  it('RED-2b partial（gp_contract_id + version + hash，缺 golden_path_id/step_id）→ fail-closed 抛错', () => {
    expect(() => buildGeneratorInputs({
      gp_contract_id: '66666666-6666-4666-8666-666666666666',
      gp_contract_version: 1,
      gp_contract_hash: 'e'.repeat(64),
    })).toThrow(/GP_CONTRACT_IDENTITY_INVALID/);
  });

  it('RED-3 完整 id/version/hash/golden_path_id/journey_id/step_id 且 anchor.gp_id 一致 → 冻结结构化注入 gp_contract，不回归', async () => {
    const { result, bundle } = await assembleGenerator(COMPLETE);
    expect(result.status).toBe('LAUNCHED');
    expect(bundle.inputs.gp_contract).toEqual({
      id: '66666666-6666-4666-8666-666666666666',
      version: 1,
      hash: 'e'.repeat(64),
      golden_path_id: '77777777-7777-4777-8777-777777777777',
      journey_id: '88888888-8888-4888-8888-888888888888',
      step_id: '99999999-9999-4999-8999-999999999999',
    });
  });

  it('边界：完整合同但 anchor.gp_id 与 golden_path_id 不一致 → 一致性校验不削弱，抛错', () => {
    expect(() => buildGeneratorInputs({
      ...COMPLETE,
      anchor: { step_id: '99999999-9999-4999-8999-999999999999', gp_id: '12121212-1212-4121-8121-121212121212' },
    })).toThrow(/GP_CONTRACT_IDENTITY_INVALID/);
  });

  it('边界：journey_id 存在但非 UUID（无 GP 字段）→ 非法输入 fail-closed 抛错', () => {
    expect(() => buildGeneratorInputs({ journey_id: 'not-a-uuid' }))
      .toThrow(/GP_CONTRACT_IDENTITY_INVALID/);
  });

  it('边界：payload 全空（无 journey_id 无 GP 字段）→ 无 gp_contract 无 journey_id，正常组装', async () => {
    const { result, bundle } = await assembleGenerator({});
    expect(result.status).toBe('LAUNCHED');
    expect(bundle.inputs.gp_contract).toBeUndefined();
    expect(bundle.inputs.journey_id).toBeUndefined();
  });
});
