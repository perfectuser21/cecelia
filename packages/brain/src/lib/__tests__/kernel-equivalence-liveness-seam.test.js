import { describe, expect, it, vi } from 'vitest';

import {
  createKernelLivenessEquivalenceSeam,
} from '../kernel-liveness.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';

function fixture(scenario) {
  const task = {
    id: '33333333-3333-4333-8333-333333333333',
    status: 'in_progress',
    payload: { harness_runtime: 'kernel-v1' },
  };
  const current = Date.parse('2026-07-28T12:00:00.000Z');
  const run = scenario === 'normal'
    ? {
        id: RUN_ID,
        orchestrator_heartbeat_at: new Date(current - 1_000),
        orchestrator_pid: 123,
        orchestrator_host: 'drill-host',
      }
    : scenario === 'violation'
      ? {
          id: RUN_ID,
          orchestrator_heartbeat_at: new Date(current - 400_000),
          orchestrator_pid: 123,
          orchestrator_host: 'another-host',
        }
      : {
          id: RUN_ID,
          orchestrator_heartbeat_at: new Date(current - 400_000),
          orchestrator_pid: 123,
          orchestrator_host: 'drill-host',
        };
  const livenessInput = {
    task,
    run,
    now: () => current,
    hostFn: () => 'drill-host',
    killFn: () => {
      if (scenario === 'recovery') {
        const error = new Error('gone');
        error.code = 'ESRCH';
        throw error;
      }
    },
  };
  const snapshots = [
    { status: 'in_progress', recoveries: 0 },
    {
      status: scenario === 'recovery' ? 'queued' : 'in_progress',
      recoveries: scenario === 'recovery' ? 1 : 0,
    },
  ];
  const resource = {
    resource_id: `eq-${ATTEMPT_ID}`,
    resource_ref: `equivalence-drill/${RUN_ID}/${ATTEMPT_ID}/liveness/case`,
    liveness_input: livenessInput,
    snapshot: vi.fn(async () => snapshots.shift()),
  };
  const cell = {
    cell_id: `KERNEL-P1-08-STOP-ORPHAN-LIVENESS::codex::${scenario}`,
    behavior_id: 'KERNEL-P1-08-STOP-ORPHAN-LIVENESS',
    provider: 'codex',
    scenario,
    seam_id: 'kernel.liveness.orphan_recovery',
    adapter_id: 'kernel.drill.stop_orphan_liveness.v1',
  };
  const grant = {
    run_id: RUN_ID,
    attempt_id: ATTEMPT_ID,
    resource_id: resource.resource_id,
    resource_ref: resource.resource_ref,
  };
  const effectSigner = {
    signEffectResult: vi.fn(async (effect) => ({
      schema_version: 'kernel-equivalence-effect-receipt/v1',
      ...effect,
      signature: 'test-signature',
    })),
  };
  const recoverDeadAttempt = vi.fn(async () => ({ action: 'requeued' }));
  return {
    task,
    resource,
    cell,
    grant,
    effectSigner,
    recoverDeadAttempt,
    seam: createKernelLivenessEquivalenceSeam({
      effectSigner,
      recoverDeadAttempt,
    }),
  };
}

describe('Kernel liveness equivalence seam', () => {
  it.each([
    ['normal', 'confirmed', 'live_attempt_preserved'],
    ['violation', 'denied', 'uncertain_liveness_cleanup_denied'],
    ['recovery', 'recovered', 'confirmed_dead_attempt_recovered'],
  ])('executes and signs the exact %s liveness behavior', async (
    scenario,
    observedOutcome,
    effectCode,
  ) => {
    const value = fixture(scenario);
    const predecessor = scenario === 'recovery'
      ? { receipt_id: '44444444-4444-4444-8444-444444444444' }
      : null;

    const receipt = await value.seam.invoke({
      cell: value.cell,
      grant: value.grant,
      resource: value.resource,
      predecessor,
      signal: new AbortController().signal,
    });

    expect(receipt).toMatchObject({
      observed_outcome: observedOutcome,
      effect_code: effectCode,
      signature: 'test-signature',
    });
    expect(value.recoverDeadAttempt).toHaveBeenCalledTimes(
      scenario === 'recovery' ? 1 : 0,
    );
    expect(value.effectSigner.signEffectResult).toHaveBeenCalledWith(
      expect.objectContaining({
        service_id: value.cell.seam_id,
        observed_outcome: observedOutcome,
        effect_code: effectCode,
        predecessor,
        before_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        after_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });

  it('does not claim recovery when the actual orphan recovery did not requeue', async () => {
    const value = fixture('recovery');
    value.recoverDeadAttempt.mockResolvedValue({ action: 'noop' });

    await expect(value.seam.invoke({
      cell: value.cell,
      grant: value.grant,
      resource: value.resource,
      predecessor: { receipt_id: 'predecessor' },
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      code: 'liveness_equivalence_recovery_unconfirmed',
    });
    expect(value.effectSigner.signEffectResult).not.toHaveBeenCalled();
  });

  it('requires signer and recovery ports at seam construction', () => {
    expect(() => createKernelLivenessEquivalenceSeam({
      recoverDeadAttempt: vi.fn(),
    })).toThrowError(expect.objectContaining({
      code: 'seam_effect_signer_unavailable',
    }));
    expect(() => createKernelLivenessEquivalenceSeam({
      effectSigner: { signEffectResult: vi.fn() },
    })).toThrowError(expect.objectContaining({
      code: 'liveness_recovery_port_unavailable',
    }));
  });
});
