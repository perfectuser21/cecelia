// Frozen contract test (TDD RED) — Sprint 08160155-kernel-ff2b0fa9
// Generator/Publisher 权限边界生产回归：
//   1) Dispatcher 必须为 role=generator 注入 server-owned runtime_resources.postgres===true
//   2) caller payload runtime_resources.postgres=false 不得降权（server-owned，caller 不可覆盖）
//   3) generator objective 边界（只产本地已提交候选，不 push/建 PR）+ publisher 唯一远端发布角色
//
// 消费 Dispatcher 真实组装出的 generator TaskBundle（createDispatcher → attemptStore.createAttempt）。
// 无 DB 依赖：deps 全部 mock，buildInputs 是纯装配。
//
// 永久回归归属：packages/brain/src/orchestrator/__tests__/（与 dispatcher.test.js 同层，
// 由 brain-ci 的 vitest job 跑）。本文件为冻结合同副本，Generator 落库时同步到该目录。
import { describe, expect, it, vi } from 'vitest';

import { createDispatcher } from '../../../packages/brain/src/orchestrator/dispatcher.js';

const taskId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const runId = '11111111-1111-4111-8111-111111111111';
const attemptId = '22222222-2222-4222-8222-222222222222';

function fakeSkill(name) {
  return Object.freeze({
    name,
    version: '1.0.0',
    digest: `sha256:${'a'.repeat(64)}`,
    content: `${name} instructions`,
  });
}

function makeDeps(order = []) {
  const leaseOwner = 'dispatcher-test:4242';
  const adapter = {
    name: 'codex',
    start: vi.fn(() => ({ provider: 'codex', command: 'codex', args: ['exec'], stdin: '{}' })),
  };
  return {
    attemptStore: {
      createAttempt: vi.fn(async (input) => {
        order.push('attempt.create');
        return { id: input.id, ...input, task_bundle: input.bundle };
      }),
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

function baseObserved(extraPayload = {}) {
  return {
    task: {
      id: taskId,
      title: 'Provider-neutral Harness',
      description: 'Build the shared execution kernel.',
      payload: {
        executor: 'auto',
        sprint_dir: 'sprints/provider-neutral',
        worktree_path: '/tmp/worktree',
        ...extraPayload,
      },
    },
    run: { id: runId },
    // 已批准合同 → spawn:generator 走导出 contract_branch 分支（与既有 generator 测试同形）
    contract: { approved: true, row: { propose_branch: 'cp-harness-propose-r2-aaaaaaaa-a6' } },
    pr: null,
    prdExists: true,
    proposeBranchRn: 1,
    proposeBranch: 'cp-harness-propose-r1-aaaaaaaa-a3',
    proposeBranchSha: 'a'.repeat(40),
    callbackResult: { transcript: 'private proposer chain of thought' },
  };
}

async function generatorBundle(extraPayload = {}) {
  const deps = makeDeps();
  await createDispatcher(deps)('spawn:generator', {
    taskId,
    runId,
    hop: 9,
    observed: baseObserved(extraPayload),
    decision: { phase: 'implement', reason: 'contract_approved' },
  });
  return deps.attemptStore.createAttempt.mock.calls[0][0].bundle;
}

describe('Generator/Publisher 权限边界生产回归 [BEHAVIOR]', () => {
  it('generator TaskBundle 获得 server-owned runtime_resources.postgres===true', async () => {
    const bundle = await generatorBundle();
    expect(bundle.inputs.runtime_resources).toEqual({ postgres: true, node_deps: true });
  });

  it('caller postgres:false 不降权 — server-owned postgres 仍为 true', async () => {
    const bundle = await generatorBundle({ runtime_resources: { postgres: false } });
    expect(bundle.inputs.runtime_resources.postgres).toBe(true);
    expect(bundle.inputs.runtime_resources).toEqual({ postgres: true, node_deps: true });
  });

  it('generator objective 只产本地候选、不 push/建 PR，且 Publisher 是唯一远端发布角色', async () => {
    const bundle = await generatorBundle();
    expect(bundle.objective).toMatch(/committed local candidate/i);
    expect(bundle.objective).toMatch(/Do not push or create a pull request/i);
    expect(bundle.objective).toMatch(/Publisher owns remote publication/i);
  });
});
