import { describe, expect, it, vi } from 'vitest';

import {
  createBrainOwnedProductionSeamBuilders,
} from '../kernel-equivalence-production-seam-builders.js';
import { sha256Canonical } from '../kernel-equivalence-receipts.js';

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

function configureProtectedRef(value) {
  const authorityPort = value.authorities.protectedRefGuard;
  const branch = 'equivalence-drill/run-1/attempt-1/protected';
  authorityPort.loadInput.mockResolvedValue({
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
  authorityPort.snapshot
    .mockResolvedValueOnce({ state: 'before' })
    .mockResolvedValueOnce({ state: 'after' });
  authorityPort.confirmSuccess.mockResolvedValue(true);
  return branch;
}

async function invokeProtectedRef(seamBuilders, branch) {
  const seam = seamBuilders['kernel.workspace.protected_ref_guard']({
    effectSigner: {
      signEffectResult: vi.fn(async () => ({ signed: true })),
    },
    createAuthorityBinding: fn(),
  });
  const grant = {
    seam_id: 'kernel.workspace.protected_ref_guard',
    adapter_id: 'kernel.drill.branch_protection.v1',
    run_id: 'run-1',
    attempt_id: 'attempt-1',
    resource_id: 'resource-1',
    resource_ref: `refs/heads/${branch}`,
  };
  return seam.invoke({
    cell: {
      seam_id: grant.seam_id,
      adapter_id: grant.adapter_id,
      scenario: 'normal',
    },
    grant,
    resource: {
      resource_id: grant.resource_id,
      resource_ref: grant.resource_ref,
    },
    predecessor: null,
    signal: new AbortController().signal,
  });
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

  it('rejects accessor functions instead of validating and snapshotting different values', () => {
    const value = fixture();
    let reads = 0;
    Object.defineProperty(value.dependencies.protectedRefGuard, 'execute', {
      configurable: true,
      enumerable: true,
      get() {
        reads += 1;
        return fn();
      },
    });

    expect(() => createBrainOwnedProductionSeamBuilders(value)).toThrowError(
      expect.objectContaining({
        code: 'production_seam_dependency_port_invalid',
      }),
    );
    expect(reads).toBe(0);
  });

  it('materializes a Proxy dependency function once without later get substitution', async () => {
    const value = fixture();
    const branch = configureProtectedRef(value);
    const safeExecute = vi.fn(async () => ({ applied: true }));
    const substitutedExecute = vi.fn(async () => ({ applied: true }));
    let reads = 0;
    const target = { execute: safeExecute };
    value.dependencies.protectedRefGuard = new Proxy(target, {
      get(current, property, receiver) {
        if (property === 'execute') {
          reads += 1;
          return reads === 1 ? safeExecute : substitutedExecute;
        }
        return Reflect.get(current, property, receiver);
      },
    });

    const seamBuilders = createBrainOwnedProductionSeamBuilders(value);

    await expect(invokeProtectedRef(seamBuilders, branch)).resolves.toEqual({
      signed: true,
    });
    expect(safeExecute).toHaveBeenCalledOnce();
    expect(substitutedExecute).not.toHaveBeenCalled();
    expect(reads).toBe(0);
  });

  it('rejects accessor owner_service with the stable authority-port error', () => {
    const value = fixture();
    let reads = 0;
    Object.defineProperty(value.authorities.protectedRefGuard, 'owner_service', {
      configurable: true,
      enumerable: true,
      get() {
        reads += 1;
        return 'kernel.workspace.protected_ref_guard';
      },
    });

    expect(() => createBrainOwnedProductionSeamBuilders(value)).toThrowError(
      expect.objectContaining({
        code: 'production_seam_authority_port_invalid',
      }),
    );
    expect(reads).toBe(0);
  });

  it.each([
    ['pool', (port) => {
      Object.defineProperty(port, 'pool', {
        configurable: true,
        enumerable: true,
        get: () => ({ query: fn() }),
      });
    }],
    ['pool.query', (port) => {
      const pool = {};
      Object.defineProperty(pool, 'query', {
        configurable: true,
        enumerable: true,
        get: () => fn(),
      });
      port.pool = pool;
    }],
  ])('rejects accessor-backed optional liveness %s', (_label, mutate) => {
    const value = fixture();
    mutate(value.authorities.orphanLiveness);

    expect(() => createBrainOwnedProductionSeamBuilders(value)).toThrowError(
      expect.objectContaining({
        code: 'production_seam_authority_port_invalid',
      }),
    );
  });

  it('does not retain the original mutable receiver behind a captured function', async () => {
    const value = fixture();
    const branch = configureProtectedRef(value);
    const safeDelegate = vi.fn(async () => ({ applied: true }));
    const substitutedDelegate = vi.fn(async () => ({ applied: true }));
    value.dependencies.protectedRefGuard = {
      delegate: safeDelegate,
      async execute(input) {
        return this.delegate(input);
      },
    };
    const seamBuilders = createBrainOwnedProductionSeamBuilders(value);

    value.dependencies.protectedRefGuard.delegate = substitutedDelegate;

    await expect(invokeProtectedRef(seamBuilders, branch)).resolves.toEqual({
      signed: true,
    });
    expect(safeDelegate).toHaveBeenCalledOnce();
    expect(substitutedDelegate).not.toHaveBeenCalled();
  });

  it('does not retain the original independentJudge receiver behind judgeGate', async () => {
    const value = fixture();
    const runId = '11111111-1111-4111-8111-111111111111';
    const judgeAttemptId = '22222222-2222-4222-8222-222222222222';
    const evaluatorAttemptId = '33333333-3333-4333-8333-333333333333';
    const headSha = 'a'.repeat(40);
    const evaluatorResult = {
      attempt_id: evaluatorAttemptId,
      decision: {
        outcome: 'PASS',
        reason: 'approved',
        pr_head_sha: headSha,
      },
      transcript: 'trusted transcript',
    };
    const evaluatorVerdict = {
      attempt_id: evaluatorAttemptId,
      executor_kind: 'local-docker',
      result_digest: sha256Canonical(evaluatorResult),
      feedback: 'approved',
      failure_class: null,
      result_receipt_id: null,
      result_sha256: null,
      pr_head_sha: headSha,
      verdict: 'PASS',
    };
    const judgeAttempt = {
      id: judgeAttemptId,
      run_id: runId,
      role: 'judge',
    };
    const evaluatorAttempt = {
      id: evaluatorAttemptId,
      run_id: runId,
      role: 'evaluator',
      status: 'completed',
      execution_transport: 'local-docker',
      lease_owner: 'kernel-evaluator',
      lease_generation: 0,
      completed_at: '2026-07-28T10:00:00.000Z',
      result: evaluatorResult,
      task_bundle: {
        inputs: {
          pull_request: { head_sha: headSha },
        },
      },
      result_receipt_id: null,
      result_sha256: null,
    };
    const safeDelegate = vi.fn(async () => ({
      judged: true,
      verdict: 'PASS',
      feedback: 'approved',
    }));
    const substitutedDelegate = vi.fn(async () => ({
      judged: true,
      verdict: 'FAIL',
      feedback: 'substituted',
    }));
    value.dependencies.independentJudge = {
      pool: {
        query: vi.fn(async () => ({ rows: [], rowCount: 1 })),
      },
      attemptStore: {
        complete: vi.fn(async () => ({})),
        getById: vi.fn(async (attemptId) => (
          attemptId === judgeAttemptId ? judgeAttempt : evaluatorAttempt
        )),
      },
      delegate: safeDelegate,
      async judgeGate(input) {
        return this.delegate(input);
      },
      promptDir: '/var/lib/cecelia/equivalence-prompts',
    };
    const resource = {
      resource_id: 'resource-judge',
      resource_ref: 'equivalence-drill/judge/resource',
    };
    const handlerContext = {
      runId,
      taskId: 'task-judge',
      attempt: judgeAttempt,
      observed: {
        run: { id: runId },
        pr: { head_sha: headSha },
        evaluateVerdict: evaluatorVerdict,
        evaluateResult: evaluatorResult,
      },
      bundle: {
        inputs: {
          worktree_path: '/tmp/equivalence-worktree',
          sprint_dir: '/tmp/equivalence-sprint',
        },
      },
      resource,
    };
    value.authorities.independentJudge.loadContext
      .mockResolvedValue(handlerContext);
    value.authorities.independentJudge.snapshot
      .mockResolvedValueOnce({ state: 'before' })
      .mockResolvedValueOnce({ state: 'after' });
    const seamBuilders = createBrainOwnedProductionSeamBuilders(value);
    value.dependencies.independentJudge.delegate = substitutedDelegate;
    const seam = seamBuilders['kernel.evaluation.independent_judge']({
      effectSigner: {
        signEffectResult: vi.fn(async () => ({ signed: true })),
      },
      createAuthorityBinding: vi.fn(() => ({
        runId,
        attempt: judgeAttempt,
        observed: {
          run: { id: runId },
          pr: { head_sha: headSha },
        },
        resource,
      })),
    });
    const cell = {
      seam_id: 'kernel.evaluation.independent_judge',
      adapter_id: 'kernel.drill.independent_evaluator_judge.v1',
      scenario: 'normal',
    };
    const grant = {
      seam_id: cell.seam_id,
      adapter_id: cell.adapter_id,
      run_id: runId,
      attempt_id: judgeAttemptId,
      artifact_sha: headSha,
      resource_id: resource.resource_id,
      resource_ref: resource.resource_ref,
    };

    await expect(seam.invoke({
      cell,
      grant,
      resource,
      predecessor: null,
      signal: new AbortController().signal,
    })).resolves.toEqual({ signed: true });
    expect(safeDelegate).toHaveBeenCalledOnce();
    expect(substitutedDelegate).not.toHaveBeenCalled();
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -1,
    0,
    1.5,
    '180000',
    24 * 60 * 60 * 1000 + 1,
  ])('rejects invalid optional liveness staleMs=%s', (staleMs) => {
    const value = fixture();
    value.authorities.orphanLiveness.staleMs = staleMs;

    expect(() => createBrainOwnedProductionSeamBuilders(value)).toThrowError(
      expect.objectContaining({
        code: 'production_seam_authority_port_invalid',
      }),
    );
  });

  it.each([null, undefined, 1, 180_000, 24 * 60 * 60 * 1000])(
    'accepts defaultable or bounded optional liveness staleMs=%s',
    (staleMs) => {
      const value = fixture();
      value.authorities.orphanLiveness.staleMs = staleMs;

      expect(() => createBrainOwnedProductionSeamBuilders(value)).not.toThrow();
    },
  );

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
