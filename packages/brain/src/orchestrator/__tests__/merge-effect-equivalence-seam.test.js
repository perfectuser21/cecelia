import { describe, expect, it, vi } from 'vitest';
import {
  createCiMergeAuthorityEquivalenceSeam,
} from '../merge-effect-executor.js';
import { sha256Canonical } from '../../lib/kernel-equivalence-receipts.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';
const RESOURCE_ID = '33333333-3333-4333-8333-333333333333';
const SEAM_ID = 'kernel.merge.effect_executor';
const ADAPTER_ID = 'kernel.drill.ci_merge_authority.v1';
const HEAD_SHA = 'a'.repeat(40);

const EFFECTS = {
  normal: ['confirmed', 'exact_sha_merge_confirmed'],
  violation: ['denied', 'stale_sha_merge_denied'],
  recovery: ['recovered', 'renewed_authority_merge_confirmed'],
};

function cell(scenario) {
  return {
    cell_id: `KERNEL-P0-04-CI-MERGE-AUTHORITY::codex::${scenario}`,
    behavior_id: 'KERNEL-P0-04-CI-MERGE-AUTHORITY',
    provider: 'codex',
    scenario,
    seam_id: SEAM_ID,
    adapter_id: ADAPTER_ID,
  };
}

function grant() {
  return {
    grant_id: '44444444-4444-4444-8444-444444444444',
    nonce: '55555555-5555-4555-8555-555555555555',
    run_id: RUN_ID,
    attempt_id: '66666666-6666-4666-8666-666666666666',
    resource_id: RESOURCE_ID,
    resource_ref: `equivalence-drill/${RUN_ID}/merge`,
    seam_id: SEAM_ID,
    adapter_id: ADAPTER_ID,
  };
}

function predecessor() {
  return Object.freeze({
    grant: Object.freeze({ ...grant() }),
    receipt: Object.freeze({
      schema_version: 'kernel-equivalence-effect-receipt/v1',
      receipt_id: '77777777-7777-4777-8777-777777777777',
      effect_code: 'stale_sha_merge_denied',
    }),
  });
}

function fixture(scenario) {
  const execution = { runId: RUN_ID, taskId: TASK_ID };
  const outcome = scenario === 'violation'
    ? { status: 'BLOCKED', detail: 'stale merge authority denied' }
    : { status: 'DONE', detail: 'merge confirmed' };
  const mergeEffectExecutor = vi.fn(async () => outcome);
  const snapshots = [
    { head_sha: HEAD_SHA, merged: false, receipt_status: null },
    {
      head_sha: HEAD_SHA,
      merged: scenario !== 'violation',
      receipt_status: scenario === 'violation' ? 'observed_unconfirmed' : 'confirmed',
    },
  ];
  const mergeDrillAuthority = {
    owner_service: SEAM_ID,
    loadExecution: vi.fn(async () => execution),
    snapshot: vi.fn(async () => snapshots.shift()),
    confirmDenial: vi.fn(async ({ result }) => result.status === 'BLOCKED'),
    confirmSuccess: vi.fn(async ({ result, after }) => (
      ['DONE', 'DONE_WITH_CONCERNS'].includes(result.status)
      && after.receipt_status === 'confirmed'
      && after.merged === true
    )),
    confirmRecovery: vi.fn(async ({ result, predecessor: previous }) => (
      result.status === 'DONE'
      && previous?.receipt?.effect_code === 'stale_sha_merge_denied'
    )),
    cancel: vi.fn(async () => ({ confirmed: true })),
    cleanup: vi.fn(async () => ({ confirmed: true })),
  };
  const effectSigner = {
    signEffectResult: vi.fn(async (input) => ({
      schema_version: 'kernel-equivalence-effect-receipt/v1',
      receipt_id: '88888888-8888-4888-8888-888888888888',
      ...input.observation,
      signature: 'signed',
    })),
  };
  return {
    mergeEffectExecutor,
    mergeDrillAuthority,
    effectSigner,
    seam: createCiMergeAuthorityEquivalenceSeam({
      mergeEffectExecutor,
      mergeDrillAuthority,
      effectSigner,
    }),
  };
}

describe('Kernel CI merge authority equivalence seam', () => {
  it.each(['normal', 'violation', 'recovery'])(
    'binds %s to the durable exact-SHA merge executor result',
    async (scenario) => {
      const value = fixture(scenario);
      const targetGrant = grant();
      const previous = scenario === 'recovery' ? predecessor() : null;
      const receipt = await value.seam.invoke({
        cell: cell(scenario),
        grant: targetGrant,
        resource: {
          resource_id: RESOURCE_ID,
          resource_ref: targetGrant.resource_ref,
          runId: 'caller-controlled',
        },
        predecessor: previous,
        signal: AbortSignal.timeout(1_000),
      });

      expect(value.mergeEffectExecutor).toHaveBeenCalledWith({
        runId: RUN_ID,
        taskId: TASK_ID,
      });
      expect(receipt).toMatchObject({
        observed_outcome: EFFECTS[scenario][0],
        effect_code: EFFECTS[scenario][1],
      });
      expect(value.effectSigner.signEffectResult).toHaveBeenCalledWith({
        cell: cell(scenario),
        grant: targetGrant,
        observation: {
          observed_outcome: EFFECTS[scenario][0],
          effect_code: EFFECTS[scenario][1],
          before_hash: sha256Canonical({
            head_sha: HEAD_SHA,
            merged: false,
            receipt_status: null,
          }),
          after_hash: sha256Canonical({
            head_sha: HEAD_SHA,
            merged: scenario !== 'violation',
            receipt_status:
              scenario === 'violation' ? 'observed_unconfirmed' : 'confirmed',
          }),
        },
        predecessor: previous,
      });
    },
  );

  it('does not accept a BLOCKED result unless denial is durably confirmed', async () => {
    const value = fixture('violation');
    value.mergeDrillAuthority.confirmDenial.mockResolvedValue(false);
    await expect(value.seam.invoke({
      cell: cell('violation'),
      grant: grant(),
      resource: {
        resource_id: RESOURCE_ID,
        resource_ref: grant().resource_ref,
      },
      signal: AbortSignal.timeout(1_000),
    })).rejects.toMatchObject({ code: 'ci_merge_denial_unconfirmed' });
    expect(value.effectSigner.signEffectResult).not.toHaveBeenCalled();
  });

  it('requires a server-owned authority and exact resource binding', async () => {
    const value = fixture('normal');
    expect(() => createCiMergeAuthorityEquivalenceSeam({
      mergeEffectExecutor: value.mergeEffectExecutor,
      effectSigner: value.effectSigner,
      mergeDrillAuthority: {
        ...value.mergeDrillAuthority,
        owner_service: 'caller',
      },
    })).toThrow('ci_merge_equivalence_authority_unavailable');
    await expect(value.seam.invoke({
      cell: cell('normal'),
      grant: grant(),
      resource: {
        resource_id: RESOURCE_ID,
        resource_ref: 'equivalence-drill/other',
      },
      signal: AbortSignal.timeout(1_000),
    })).rejects.toMatchObject({ code: 'ci_merge_equivalence_resource_invalid' });
    expect(value.mergeEffectExecutor).not.toHaveBeenCalled();
  });
});
