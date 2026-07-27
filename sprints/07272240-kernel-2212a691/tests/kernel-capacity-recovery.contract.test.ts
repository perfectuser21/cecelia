import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

vi.mock('../../../packages/brain/src/db.js', () => ({
  default: { query: (...args: unknown[]) => queryMock(...args) },
}));

vi.mock('../../../packages/brain/src/quota-guard.js', () => ({
  checkQuotaGuard: vi.fn(async () => ({ allow: true, priorityFilter: null, reason: 'ok', bestPct: 10 })),
}));

vi.mock('../../../packages/brain/src/account-usage.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../packages/brain/src/account-usage.js')>();
  return {
    ...real,
    getAvailableAccountCount: vi.fn(() => 2),
  };
});

import { _resetVitalsCacheForTest, _setVitalsCacheForTest } from '../../../packages/brain/src/machine-vitals.js';
import { harnessSlotCheck } from '../../../packages/brain/src/slot-allocator.js';
import { createDispatcher } from '../../../packages/brain/src/orchestrator/dispatcher.js';

function vitals() {
  return {
    sampled_at: Date.now(),
    error: null,
    stale: false,
    relay_containers: [],
    relay_count: 0,
    vm_total_mb: 13600,
    vm_used_mb: 5200,
    host_disk_pct: 50,
    docker_disk_pct: 50,
  };
}

beforeEach(() => {
  _resetVitalsCacheForTest();
  _setVitalsCacheForTest(vitals());
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [{ n: 0 }] });
});

describe('Kernel provider-neutral capacity contract', () => {
  it('unknown selected provider/account 只拒绝当前 pinned 任务', async () => {
    const denied = await harnessSlotCheck({
      candidate: {
        priority: 'P1',
        payload: {
          role_assignments: {
            generator: { provider: 'ghost', account: 'phantom', machine: 'us-mac-m4' },
          },
        },
      },
    });

    expect(denied).toMatchObject({
      allow: false,
      reason: 'selected_target_unknown',
      selected_target: { provider: 'ghost', account: 'phantom', machine: 'us-mac-m4' },
    });

    const healthy = await harnessSlotCheck({
      candidate: {
        priority: 'P1',
        payload: {
          role_assignments: {
            generator: { provider: 'codex', account: 'team5', machine: 'us-mac-m4' },
          },
        },
      },
    });

    expect(healthy.allow).toBe(true);
  });

  it('total=4 active=2 free=2 的 selected target 必须 allow', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ n: 1 }] })
      .mockResolvedValueOnce({ rows: [{ n: 1 }] });

    const result = await harnessSlotCheck({
      candidate: {
        priority: 'P1',
        payload: {
          role_assignments: {
            generator: { provider: 'codex', account: 'team5', machine: 'us-mac-m4' },
          },
        },
      },
    });

    expect(result).toMatchObject({
      allow: true,
      reason: 'ok',
      provider_account_free: 2,
      selected_target: { provider: 'codex', account: 'team5', machine: 'us-mac-m4' },
    });
  });

  it('harnessSlotCheck 不得 double debit 同一 dedup key', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ n: 1 }] })
      .mockResolvedValueOnce({ rows: [{ n: 1 }] });

    const result = await harnessSlotCheck({
      candidate: {
        priority: 'P1',
        payload: {
          dedup_key: 'run-1:hop-2:generator',
          role_assignments: {
            generator: { provider: 'codex', account: 'team5', machine: 'us-mac-m4' },
          },
        },
      },
    });

    expect(result).toMatchObject({
      allow: true,
      dedup: {
        key: 'run-1:hop-2:generator',
        relay: 1,
        inflight: 0,
        kernel: 0,
        total_debited: 1,
      },
    });
  });

  it('dispatcher 只能使用 role_assignments 冻结 target', async () => {
    const observed = {
      task: {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        title: 'Kernel capacity recovery',
        description: 'provider-neutral',
        payload: {
          sprint_dir: 'sprints/07272240-kernel-2212a691',
          worktree_path: '/tmp/kernel-capacity',
          role_assignments: {
            generator: { provider: 'codex', account: 'team5', machine: 'xian-mac-m4' },
          },
          provider: 'claude',
          executor_account: 'account1',
        },
      },
      run: { phase: 'generate' },
      contract: { row: { propose_branch: 'cp-old' } },
      proposeBranchRn: 0,
      proposeBranch: 'cp-old',
      proposeBranchSha: 'a'.repeat(40),
      pr: null,
    };

    const evaluate = vi.fn(async ({ preferred_target }) => ({
      status: 'ok',
      snapshot: {
        provider: preferred_target.provider,
        account: preferred_target.account,
        machine: preferred_target.machine,
        capability_snapshot_id: 'snapshot-1',
      },
      evidence: {},
      to_target: preferred_target,
    }));

    const deps = {
      loadSkill: () => ({ name: 'harness-generator', version: '1.0.0', digest: `sha256:${'a'.repeat(64)}`, content: 'skill' }),
      registry: {
        resolve: vi.fn(() => ({ name: 'codex', start: vi.fn(() => ({ provider: 'codex', command: 'codex', args: [], stdin: '{}' })) })),
      },
      preflightGate: {
        evaluate,
        validateSnapshotForDispatch: vi.fn(async () => ({ status: 'ok' })),
      },
      attemptStore: {
        createAttempt: vi.fn(async (input) => ({ id: input.id })),
        markStarting: vi.fn(async (id) => ({ id, status: 'starting', lease_owner: 'lease-owner', lease_generation: 0 })),
        recordLaunchReceipt: vi.fn(async (id) => ({ id, status: 'starting' })),
        fail: vi.fn(),
        listFailedExecutionTargets: vi.fn(async () => []),
      },
      launcher: {
        launch: vi.fn(async () => ({
          actualMachineId: 'xian-mac-m4',
          executionTransport: 'remote-bridge',
          remoteJobId: 'job-1',
          attestationStatus: 'verified',
          containerId: null,
          jobId: 'job-1',
        })),
      },
      randomUUID: () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      createCallbackSecret: () => 'secret',
      machineId: 'brain-1',
      leaseOwner: 'brain-1:1',
    };

    const dispatch = createDispatcher(deps as never);
    await dispatch('spawn:generator', {
      taskId: observed.task.id,
      runId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      hop: 2,
      observed,
      decision: { phase: 'generate' },
    });

    expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({
      preferred_target: { provider: 'codex', account: 'team5', machine: 'xian-mac-m4' },
    }));
    expect(evaluate).not.toHaveBeenCalledWith(expect.objectContaining({
      preferred_target: expect.objectContaining({ provider: 'claude' }),
    }));
  });
});
