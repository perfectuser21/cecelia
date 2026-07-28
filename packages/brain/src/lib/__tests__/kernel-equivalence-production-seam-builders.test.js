import { describe, expect, it, vi } from 'vitest';

import {
  createBrainOwnedProductionSeamBuilders,
} from '../kernel-equivalence-production-seam-builders.js';

const SEAM_IDS = [
  'kernel.closure.report_learning',
  'kernel.controller.attempt_ownership',
  'kernel.credential.attempt_lease',
  'kernel.evaluation.independent_judge',
  'kernel.github.mutation_broker',
  'kernel.liveness.orphan_recovery',
  'kernel.merge.effect_executor',
  'kernel.merge.human_review_authority',
  'kernel.quality.devgate',
  'kernel.workspace.protected_ref_guard',
];

const PURPOSE_BY_SEAM = {
  'kernel.closure.report_learning': 'reportLearning',
  'kernel.controller.attempt_ownership': 'attemptOwnership',
  'kernel.credential.attempt_lease': 'credentialGuard',
  'kernel.evaluation.independent_judge': 'independentJudge',
  'kernel.github.mutation_broker': 'branchPushGuard',
  'kernel.liveness.orphan_recovery': 'orphanLiveness',
  'kernel.merge.effect_executor': 'ciMergeEffect',
  'kernel.merge.human_review_authority': 'humanReview',
  'kernel.quality.devgate': 'devgate',
  'kernel.workspace.protected_ref_guard': 'protectedRefGuard',
};

function fn() {
  return vi.fn();
}

function authority(owner_service, functions) {
  return Object.fromEntries([
    ['owner_service', owner_service],
    ...functions.map((name) => [name, fn()]),
  ]);
}

function fixture() {
  const dependencies = {
    protectedRefGuard: { execute: fn() },
    credentialGuard: { issue: fn() },
    branchPushGuard: { execute: fn() },
    ciMergeEffect: { execute: fn() },
    independentJudge: {
      pool: { query: fn() },
      attemptStore: { complete: fn(), getById: fn() },
      judgeGate: fn(),
      promptDir: '/var/lib/cecelia/equivalence-prompts',
    },
    devgate: { spawnGuarded: fn() },
    attemptOwnership: { complete: fn(), getById: fn() },
    reportLearning: { dbQuery: fn(), learningQuery: fn() },
  };
  const authorities = {
    protectedRefGuard: authority(
      'kernel.workspace.protected_ref_guard',
      [
        'loadInput',
        'snapshot',
        'confirmDenial',
        'confirmSuccess',
        'confirmRecovery',
        'cancel',
        'cleanup',
      ],
    ),
    credentialGuard: authority(
      'kernel.credential.attempt_lease',
      [
        'loadIssueRequest',
        'snapshot',
        'confirmDenial',
        'confirmRefresh',
        'cancel',
        'cleanup',
      ],
    ),
    branchPushGuard: authority(
      'kernel.github.mutation_broker',
      [
        'loadInput',
        'snapshot',
        'confirmDenial',
        'confirmSuccess',
        'confirmRecovery',
        'cancel',
        'cleanup',
      ],
    ),
    ciMergeEffect: authority(
      'kernel.merge.effect_executor',
      [
        'loadExecution',
        'snapshot',
        'confirmDenial',
        'confirmSuccess',
        'confirmRecovery',
        'cancel',
        'cleanup',
      ],
    ),
    humanReview: authority(
      'kernel.merge.human_review_authority',
      [
        'loadEvidence',
        'snapshot',
        'confirmDenial',
        'confirmRenewal',
        'cancel',
        'cleanup',
      ],
    ),
    independentJudge: authority(
      'kernel.evaluation.independent_judge',
      ['loadContext', 'snapshot', 'loadPredecessorActorBinding'],
    ),
    orphanLiveness: {
      ...authority(
        'kernel.liveness.orphan_recovery',
        ['loadTarget', 'snapshot', 'recoverDeadAttempt', 'now', 'hostFn', 'killFn'],
      ),
    },
    devgate: authority(
      'kernel.quality.devgate',
      ['loadTarget'],
    ),
    attemptOwnership: authority(
      'kernel.controller.attempt_ownership',
      ['loadTarget', 'snapshot', 'loadPredecessorOwnershipBinding'],
    ),
    reportLearning: authority(
      'kernel.closure.report_learning',
      ['now', 'loadEvidence', 'snapshot', 'loadPredecessorEvidenceBinding'],
    ),
  };
  authorities.protectedRefGuard.sandbox_repo =
    'perfectuser21/cecelia-kernel-equivalence-drills';
  authorities.branchPushGuard.sandbox_repo =
    'perfectuser21/cecelia-kernel-equivalence-drills';
  return { dependencies, authorities };
}

function signer() {
  return { signEffectResult: fn() };
}

function buildAll(value = fixture()) {
  const seamBuilders = createBrainOwnedProductionSeamBuilders(value);
  const createAuthorityBinding = fn();
  const seams = Object.fromEntries(SEAM_IDS.map((seamId) => [
    seamId,
    seamBuilders[seamId]({
      effectSigner: signer(),
      createAuthorityBinding,
    }),
  ]));
  return { ...value, seamBuilders, seams, createAuthorityBinding };
}

describe('Brain-owned production equivalence seam builders', () => {
  it('exposes the focused production seam-builder factory', async () => {
    const production = await import(
      '../kernel-equivalence-production-seam-builders.js'
    ).catch(() => null);

    expect(
      production?.createBrainOwnedProductionSeamBuilders,
    ).toEqual(expect.any(Function));
  });

  it('returns the exact frozen ten-builder map backed by the actual seam creators', () => {
    const value = buildAll();

    expect(Object.keys(value.seamBuilders).sort()).toEqual(SEAM_IDS);
    expect(Object.isFrozen(value.seamBuilders)).toBe(true);
    for (const seamId of SEAM_IDS) {
      expect(value.seamBuilders[seamId]).toEqual(expect.any(Function));
      expect(value.seams[seamId]).toMatchObject({
        owner_service: seamId,
        invoke: expect.any(Function),
        cancel: expect.any(Function),
        cleanup: expect.any(Function),
      });
      expect(Object.isFrozen(value.seams[seamId])).toBe(true);
    }
  });

  it.each([
    ['extra factory input', (value) => {
      value.callerRegistry = {};
    }, 'production_seam_factory_input_invalid'],
    ['missing dependency', (value) => {
      delete value.dependencies.credentialGuard;
    }, 'production_seam_dependency_set_invalid'],
    ['extra dependency', (value) => {
      value.dependencies.callerBroker = { execute: fn() };
    }, 'production_seam_dependency_set_invalid'],
    ['missing authority', (value) => {
      delete value.authorities.humanReview;
    }, 'production_seam_authority_set_invalid'],
    ['extra authority', (value) => {
      value.authorities.callerAuthority = {
        owner_service: 'caller',
      };
    }, 'production_seam_authority_set_invalid'],
    ['dependency function', (value) => {
      delete value.dependencies.attemptOwnership.complete;
    }, 'production_seam_dependency_port_invalid'],
    ['authority owner', (value) => {
      value.authorities.reportLearning.owner_service = 'caller';
    }, 'production_seam_authority_port_invalid'],
    ['authority function', (value) => {
      delete value.authorities.protectedRefGuard.cleanup;
    }, 'production_seam_authority_port_invalid'],
  ])('fails closed for an inexact production port boundary: %s', (
    _label,
    mutate,
    code,
  ) => {
    const value = fixture();
    mutate(value);

    expect(() => createBrainOwnedProductionSeamBuilders(value)).toThrowError(
      expect.objectContaining({ code }),
    );
  });

  it('lets each builder receive only the trusted assembly ports', () => {
    const seamBuilders = createBrainOwnedProductionSeamBuilders(fixture());
    const input = {
      effectSigner: signer(),
      createAuthorityBinding: fn(),
      callerAuthority: {},
    };

    expect(() => (
      seamBuilders['kernel.credential.attempt_lease'](input)
    )).toThrowError(expect.objectContaining({
      code: 'production_seam_builder_input_invalid',
    }));
  });

  it('snapshots validated production ports before caller mutation can substitute them', async () => {
    const value = fixture();
    const dependency = value.dependencies.protectedRefGuard;
    const authorityPort = value.authorities.protectedRefGuard;
    const originalExecute = dependency.execute.mockResolvedValue({
      applied: true,
    });
    const branch = 'equivalence-drill/run-1/attempt-1/protected';
    const originalLoad = authorityPort.loadInput.mockResolvedValue({
      declarationBytes: Buffer.from('{}'),
      policy: {
        repo: authorityPort.sandbox_repo,
        branch,
      },
      providerResultBytes: Buffer.from('{}'),
      state: {
        run_id: 'run-1',
        attempt_id: 'attempt-1',
        workspace: {
          repo: authorityPort.sandbox_repo,
          branch,
        },
      },
    });
    const originalSnapshot = authorityPort.snapshot
      .mockResolvedValueOnce({ state: 'before' })
      .mockResolvedValueOnce({ state: 'after' });
    authorityPort.confirmSuccess.mockResolvedValue(true);
    const originalSandboxRepo = authorityPort.sandbox_repo;
    const seamBuilders = createBrainOwnedProductionSeamBuilders(value);

    const substitutedBeforeBuild = {
      execute: vi.fn(() => {
        throw new Error('substituted execute');
      }),
      loadInput: vi.fn(() => {
        throw new Error('substituted load');
      }),
      snapshot: vi.fn(() => {
        throw new Error('substituted snapshot');
      }),
    };
    dependency.execute = substitutedBeforeBuild.execute;
    authorityPort.loadInput = substitutedBeforeBuild.loadInput;
    authorityPort.snapshot = substitutedBeforeBuild.snapshot;
    authorityPort.sandbox_repo =
      'perfectuser21/forged-kernel-equivalence-drills';

    const effectSigner = {
      signEffectResult: vi.fn(async () => ({ signed: true })),
    };
    const seam = seamBuilders['kernel.workspace.protected_ref_guard']({
      effectSigner,
      createAuthorityBinding: fn(),
    });

    dependency.execute = fn();
    authorityPort.loadInput = fn();
    authorityPort.snapshot = fn();
    authorityPort.sandbox_repo =
      'perfectuser21/late-kernel-equivalence-drills';
    const grant = {
      seam_id: 'kernel.workspace.protected_ref_guard',
      adapter_id: 'kernel.drill.branch_protection.v1',
      run_id: 'run-1',
      attempt_id: 'attempt-1',
      resource_id: 'resource-1',
      resource_ref: `refs/heads/${branch}`,
    };
    const resource = {
      resource_id: grant.resource_id,
      resource_ref: grant.resource_ref,
    };

    await expect(seam.invoke({
      cell: {
        seam_id: grant.seam_id,
        adapter_id: grant.adapter_id,
        scenario: 'normal',
      },
      grant,
      resource,
      predecessor: null,
      signal: new AbortController().signal,
    })).resolves.toEqual({ signed: true });
    expect(originalExecute).toHaveBeenCalledOnce();
    expect(originalLoad).toHaveBeenCalledOnce();
    expect(originalSnapshot).toHaveBeenCalledTimes(2);
    expect(substitutedBeforeBuild.execute).not.toHaveBeenCalled();
    expect(substitutedBeforeBuild.loadInput).not.toHaveBeenCalled();
    expect(substitutedBeforeBuild.snapshot).not.toHaveBeenCalled();
    expect(originalSandboxRepo).toBe(
      'perfectuser21/cecelia-kernel-equivalence-drills',
    );
  });

  it.each([
    {
      seamId: 'kernel.credential.attempt_lease',
      loader: 'loadIssueRequest',
      binding: {
        runId: 'run-1',
        attemptId: 'attempt-1',
        resourceId: 'resource-1',
        resourceRef: 'resource/ref-1',
      },
      forged: {
        runId: 'forged',
        attemptId: 'attempt-1',
        resourceId: 'resource-1',
        resourceRef: 'resource/ref-1',
      },
    },
    {
      seamId: 'kernel.evaluation.independent_judge',
      loader: 'loadContext',
      binding: {
        runId: 'run-1',
        attempt: { id: 'attempt-1', run_id: 'run-1' },
        observed: {
          run: { id: 'run-1' },
          pr: { head_sha: 'artifact-1' },
        },
        resource: {
          resource_id: 'resource-1',
          resource_ref: 'resource/ref-1',
        },
      },
      forged: {
        runId: 'forged',
        attempt: { id: 'attempt-1', run_id: 'run-1' },
        observed: {
          run: { id: 'run-1' },
          pr: { head_sha: 'artifact-1' },
        },
        resource: {
          resource_id: 'resource-1',
          resource_ref: 'resource/ref-1',
        },
      },
    },
    {
      seamId: 'kernel.liveness.orphan_recovery',
      loader: 'loadTarget',
      binding: {
        attempt: { id: 'attempt-1', run_id: 'run-1' },
        resource: {
          resource_id: 'resource-1',
          resource_ref: 'resource/ref-1',
        },
      },
      forged: {
        task: {},
        run: { id: 'run-1' },
        attempt: { id: 'forged', run_id: 'run-1' },
        resource: {
          resource_id: 'resource-1',
          resource_ref: 'resource/ref-1',
        },
      },
    },
    {
      seamId: 'kernel.quality.devgate',
      loader: 'loadTarget',
      binding: {
        run_id: 'run-1',
        attempt_id: 'attempt-1',
        resource_id: 'resource-1',
        resource_ref: 'resource/ref-1',
      },
      forged: {
        run_id: 'forged',
        attempt_id: 'attempt-1',
        resource_id: 'resource-1',
        resource_ref: 'resource/ref-1',
      },
    },
  ])('rejects forged $seamId loader context without overwriting it', async ({
    seamId,
    loader,
    binding,
    forged,
  }) => {
    const value = fixture();
    const purpose = PURPOSE_BY_SEAM[seamId];
    const forgedBefore = structuredClone(forged);
    value.authorities[purpose][loader].mockResolvedValue(forged);
    const seamBuilders = createBrainOwnedProductionSeamBuilders(value);
    const createAuthorityBinding = vi.fn(() => binding);
    const seam = seamBuilders[seamId]({
      effectSigner: signer(),
      createAuthorityBinding,
    });
    const grant = {
      seam_id: seamId,
      adapter_id: 'adapter-1',
      run_id: 'run-1',
      attempt_id: 'attempt-1',
      artifact_sha: 'artifact-1',
      resource_id: 'resource-1',
      resource_ref: 'resource/ref-1',
    };
    const resource = {
      resource_id: grant.resource_id,
      resource_ref: grant.resource_ref,
    };

    await expect(seam.invoke({
      cell: {
        seam_id: seamId,
        adapter_id: grant.adapter_id,
        scenario: 'normal',
      },
      grant,
      resource,
      predecessor: null,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      code: 'production_seam_authority_binding_invalid',
    });
    expect(createAuthorityBinding).toHaveBeenCalledOnce();
    expect(createAuthorityBinding).toHaveBeenCalledWith({ grant, resource });
    expect(forged).toEqual(forgedBefore);
  });
});
