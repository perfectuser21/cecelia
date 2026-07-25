import { describe, expect, it, vi } from 'vitest';

import { createDispatcher } from '../../../packages/brain/src/orchestrator/dispatcher.js';

function fakeSkill(name: string) {
  return Object.freeze({
    name,
    version: '1.0.0',
    digest: `sha256:${'b'.repeat(64)}`,
    content: `${name} instructions`,
  });
}

function buildObserved(payloadOverrides: Record<string, unknown> = {}) {
  return {
    task: {
      id: 'task-12345678-1234-4234-8234-123456789abc',
      title: 'Kernel capability gate',
      description: 'preflight before attempt creation',
      payload: {
        sprint_dir: 'sprints/07251915-kernel-ed561be4',
        worktree_path: '/workspace',
        role_assignments: {
          generator: { provider: 'codex', account: 'team4' },
        },
        logical_cycle: 3,
        ...payloadOverrides,
      },
    },
    run: { id: 'run-12345678-1234-4234-8234-123456789abc' },
  };
}

describe('dispatcher preflight wiring contract [BEHAVIOR]', () => {
  it('dispatcher 在 createAttempt 前执行 preflight 并写 capability_snapshot_id', async () => {
    const order: string[] = [];
    const createAttempt = vi.fn(async (input) => {
      order.push('createAttempt');
      return { id: input.id, ...input, task_bundle: input.bundle };
    });
    const dispatch = createDispatcher({
      attemptStore: {
        createAttempt,
        fail: vi.fn(),
      },
      registry: {
        resolve: vi.fn(() => ({
          name: 'codex',
          start: vi.fn(() => {
            order.push('adapter.start');
            return { provider: 'codex', args: [], stdin: '{}' };
          }),
        })),
      },
      launcher: {
        launch: vi.fn(async () => {
          order.push('launch');
          return { containerId: 'cx-1' };
        }),
      },
      loadSkill: vi.fn(fakeSkill),
      randomUUID: () => 'attempt-12345678-1234-4234-8234-123456789abc',
      createCallbackSecret: () => 'secret',
      machineId: 'us-mac-m4',
      preflightGate: {
        evaluate: vi.fn(async () => {
          order.push('preflight');
          return {
            status: 'ok',
            capability_snapshot_id: 'snap-1',
            snapshot: { capability_snapshot_id: 'snap-1' },
            to_target: { provider: 'codex', account: 'team4', machine: 'us-mac-m4' },
          };
        }),
      },
    });

    await dispatch('spawn:generator', {
      taskId: 'task-12345678-1234-4234-8234-123456789abc',
      runId: 'run-12345678-1234-4234-8234-123456789abc',
      hop: 7,
      observed: buildObserved(),
      decision: { phase: 'generate', reason: 'approved' },
    });

    expect(order).toEqual(['preflight', 'createAttempt', 'adapter.start', 'launch']);
    const created = createAttempt.mock.calls[0][0];
    expect(created.bundle.inputs.capability_snapshot_id).toBe('snap-1');
  });

  it('同签名 transient retry 受 logical_cycle 收敛闸约束', async () => {
    const preflight = vi.fn()
      .mockResolvedValueOnce({
        status: 'blocked',
        failure_class: 'infrastructure_blocked',
        fallback_reason: 'provider_transient_retry_exhausted',
        capability_snapshot_id: 'snap-2',
        should_create_attempt: false,
      })
      .mockResolvedValueOnce({
        status: 'blocked',
        failure_class: 'infrastructure_blocked',
        fallback_reason: 'logical_cycle_retry_exhausted',
        capability_snapshot_id: 'snap-3',
        should_create_attempt: false,
      });
    const createAttempt = vi.fn();
    const dispatch = createDispatcher({
      attemptStore: { createAttempt, fail: vi.fn() },
      registry: {
        resolve: vi.fn(() => ({
          name: 'codex',
          start: vi.fn(() => ({ provider: 'codex', args: [], stdin: '{}' })),
        })),
      },
      launcher: { launch: vi.fn() },
      loadSkill: vi.fn(fakeSkill),
      randomUUID: () => 'attempt-12345678-1234-4234-8234-123456789abc',
      createCallbackSecret: () => 'secret',
      machineId: 'us-mac-m4',
      preflightGate: { evaluate: preflight },
    });

    const ctx = {
      taskId: 'task-12345678-1234-4234-8234-123456789abc',
      runId: 'run-12345678-1234-4234-8234-123456789abc',
      hop: 7,
      observed: buildObserved(),
      decision: { phase: 'generate', reason: 'approved' },
    };

    const first = await dispatch('spawn:generator', ctx);
    const second = await dispatch('spawn:generator', { ...ctx, hop: 8 });

    expect(first.status).toBe('DONE_WITH_CONCERNS');
    expect(second.status).toBe('DONE_WITH_CONCERNS');
    expect(createAttempt).not.toHaveBeenCalled();
    expect(preflight.mock.calls).toHaveLength(2);
    expect(second.detail).toContain('logical_cycle_retry_exhausted');
  });

  it('container hostname 不会污染 attempt machine_id', async () => {
    const createAttempt = vi.fn(async (input) => ({ id: input.id, ...input, task_bundle: input.bundle }));
    const dispatch = createDispatcher({
      attemptStore: { createAttempt, fail: vi.fn() },
      registry: {
        resolve: vi.fn(() => ({
          name: 'codex',
          start: vi.fn(() => ({ provider: 'codex', args: [], stdin: '{}' })),
        })),
      },
      launcher: { launch: vi.fn(async () => ({ containerId: 'cx-2' })) },
      loadSkill: vi.fn(fakeSkill),
      randomUUID: () => 'attempt-22345678-1234-4234-8234-123456789abc',
      createCallbackSecret: () => 'secret',
      machineId: '79f7d974a2ce',
      preflightGate: {
        evaluate: vi.fn(async () => ({
          status: 'ok',
          capability_snapshot_id: 'snap-4',
          snapshot: { capability_snapshot_id: 'snap-4' },
          to_target: { provider: 'codex', account: 'team1', machine: 'us-mac-m4' },
        })),
      },
    });

    await dispatch('spawn:generator', {
      taskId: 'task-12345678-1234-4234-8234-123456789abc',
      runId: 'run-12345678-1234-4234-8234-123456789abc',
      hop: 9,
      observed: buildObserved({
        role_assignments: { generator: { provider: 'codex', account: 'team1' } },
      }),
      decision: { phase: 'generate', reason: 'approved' },
    });

    const created = createAttempt.mock.calls[0][0];
    expect(created.machineId).toBe('us-mac-m4');
    expect(created.machineId).not.toBe('79f7d974a2ce');
  });
});
