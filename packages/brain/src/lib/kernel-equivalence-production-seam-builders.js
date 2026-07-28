import { createRequire } from 'node:module';

import {
  createDevGateEquivalenceSeam,
} from '../../../engine/scripts/devgate/kernel-equivalence-devgate-sidecar.mjs';
import {
  createReportLearningEquivalenceSeam,
} from '../auto-learning.js';
import {
  createKernelLivenessEquivalenceSeam,
} from './kernel-liveness.js';
import {
  createAttemptOwnershipEquivalenceSeam,
} from '../orchestrator/attempt-store.js';
import {
  createCredentialGuardEquivalenceSeam,
} from '../orchestrator/credential-broker.js';
import {
  createIndependentJudgeEquivalenceSeam,
} from '../orchestrator/kernel-handlers.js';
import {
  createHumanReviewEquivalenceSeam,
} from '../orchestrator/merge-authority.js';
import {
  createCiMergeAuthorityEquivalenceSeam,
} from '../orchestrator/merge-effect-executor.js';

const require = createRequire(import.meta.url);
const {
  createBranchProtectionEquivalenceSeam,
  createBranchPushEquivalenceSeam,
} = require('../../scripts/fleet-worker/github-mutation-broker.cjs');

const DEPENDENCY_KEYS = Object.freeze([
  'attemptOwnership',
  'branchPushGuard',
  'ciMergeEffect',
  'credentialGuard',
  'devgate',
  'independentJudge',
  'protectedRefGuard',
  'reportLearning',
]);
const AUTHORITY_PORTS = Object.freeze({
  protectedRefGuard: Object.freeze({
    owner: 'kernel.workspace.protected_ref_guard',
    functions: Object.freeze([
      'loadInput',
      'snapshot',
      'confirmDenial',
      'confirmSuccess',
      'confirmRecovery',
      'cancel',
      'cleanup',
    ]),
  }),
  credentialGuard: Object.freeze({
    owner: 'kernel.credential.attempt_lease',
    functions: Object.freeze([
      'loadIssueRequest',
      'snapshot',
      'confirmDenial',
      'confirmRefresh',
      'cancel',
      'cleanup',
    ]),
  }),
  branchPushGuard: Object.freeze({
    owner: 'kernel.github.mutation_broker',
    functions: Object.freeze([
      'loadInput',
      'snapshot',
      'confirmDenial',
      'confirmSuccess',
      'confirmRecovery',
      'cancel',
      'cleanup',
    ]),
  }),
  ciMergeEffect: Object.freeze({
    owner: 'kernel.merge.effect_executor',
    functions: Object.freeze([
      'loadExecution',
      'snapshot',
      'confirmDenial',
      'confirmSuccess',
      'confirmRecovery',
      'cancel',
      'cleanup',
    ]),
  }),
  humanReview: Object.freeze({
    owner: 'kernel.merge.human_review_authority',
    functions: Object.freeze([
      'loadEvidence',
      'snapshot',
      'confirmDenial',
      'confirmRenewal',
      'cancel',
      'cleanup',
    ]),
  }),
  independentJudge: Object.freeze({
    owner: 'kernel.evaluation.independent_judge',
    functions: Object.freeze([
      'loadContext',
      'snapshot',
      'loadPredecessorActorBinding',
    ]),
  }),
  orphanLiveness: Object.freeze({
    owner: 'kernel.liveness.orphan_recovery',
    functions: Object.freeze([
      'loadTarget',
      'snapshot',
      'recoverDeadAttempt',
      'now',
      'hostFn',
      'killFn',
    ]),
  }),
  devgate: Object.freeze({
    owner: 'kernel.quality.devgate',
    functions: Object.freeze(['loadTarget']),
  }),
  attemptOwnership: Object.freeze({
    owner: 'kernel.controller.attempt_ownership',
    functions: Object.freeze([
      'loadTarget',
      'snapshot',
      'loadPredecessorOwnershipBinding',
    ]),
  }),
  reportLearning: Object.freeze({
    owner: 'kernel.closure.report_learning',
    functions: Object.freeze([
      'now',
      'loadEvidence',
      'snapshot',
      'loadPredecessorEvidenceBinding',
    ]),
  }),
});
const AUTHORITY_KEYS = Object.freeze(Object.keys(AUTHORITY_PORTS).sort());
const BUILDER_INPUT_KEYS = Object.freeze([
  'createAuthorityBinding',
  'effectSigner',
]);

export class KernelProductionSeamBuilderError extends Error {
  constructor(code) {
    super(code);
    this.name = 'KernelProductionSeamBuilderError';
    this.code = code;
  }
}

function fail(code) {
  throw new KernelProductionSeamBuilderError(code);
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length
    && actual.every((key, index) => key === expected[index])
  );
}

function hasFunctions(value, names) {
  return names.every((name) => typeof value?.[name] === 'function');
}

function validateDependencies(dependencies) {
  if (!exactKeys(dependencies, DEPENDENCY_KEYS)) {
    fail('production_seam_dependency_set_invalid');
  }
  if (
    !hasFunctions(dependencies.protectedRefGuard, ['execute'])
    || !hasFunctions(dependencies.credentialGuard, ['issue'])
    || !hasFunctions(dependencies.branchPushGuard, ['execute'])
    || !hasFunctions(dependencies.ciMergeEffect, ['execute'])
    || !hasFunctions(
      dependencies.independentJudge?.pool,
      ['query'],
    )
    || !hasFunctions(
      dependencies.independentJudge?.attemptStore,
      ['complete', 'getById'],
    )
    || typeof dependencies.independentJudge?.judgeGate !== 'function'
    || typeof dependencies.independentJudge?.promptDir !== 'string'
    || dependencies.independentJudge.promptDir.length === 0
    || !hasFunctions(dependencies.devgate, ['spawnGuarded'])
    || !hasFunctions(
      dependencies.attemptOwnership,
      ['complete', 'getById'],
    )
    || !hasFunctions(
      dependencies.reportLearning,
      ['dbQuery', 'learningQuery'],
    )
  ) {
    fail('production_seam_dependency_port_invalid');
  }
}

function validateAuthorities(authorities) {
  if (!exactKeys(authorities, AUTHORITY_KEYS)) {
    fail('production_seam_authority_set_invalid');
  }
  for (const [purpose, descriptor] of Object.entries(AUTHORITY_PORTS)) {
    const port = authorities[purpose];
    if (
      port?.owner_service !== descriptor.owner
      || !hasFunctions(port, descriptor.functions)
    ) {
      fail('production_seam_authority_port_invalid');
    }
  }
}

function snapshotFunctions(port, names, scalars = []) {
  const snapshot = Object.fromEntries([
    ...scalars.map((name) => [name, port[name]]),
    ...names.map((name) => [name, port[name].bind(port)]),
  ]);
  return Object.freeze(snapshot);
}

function snapshotDependencies(dependencies) {
  return Object.freeze({
    protectedRefGuard: snapshotFunctions(
      dependencies.protectedRefGuard,
      ['execute'],
    ),
    credentialGuard: snapshotFunctions(
      dependencies.credentialGuard,
      ['issue'],
    ),
    branchPushGuard: snapshotFunctions(
      dependencies.branchPushGuard,
      ['execute'],
    ),
    ciMergeEffect: snapshotFunctions(
      dependencies.ciMergeEffect,
      ['execute'],
    ),
    independentJudge: Object.freeze({
      pool: snapshotFunctions(
        dependencies.independentJudge.pool,
        ['query'],
      ),
      attemptStore: snapshotFunctions(
        dependencies.independentJudge.attemptStore,
        ['complete', 'getById'],
      ),
      judgeGate: dependencies.independentJudge.judgeGate.bind(
        dependencies.independentJudge,
      ),
      promptDir: dependencies.independentJudge.promptDir,
    }),
    devgate: snapshotFunctions(
      dependencies.devgate,
      ['spawnGuarded'],
    ),
    attemptOwnership: snapshotFunctions(
      dependencies.attemptOwnership,
      ['complete', 'getById'],
    ),
    reportLearning: snapshotFunctions(
      dependencies.reportLearning,
      ['dbQuery', 'learningQuery'],
    ),
  });
}

function snapshotAuthorities(authorities) {
  return Object.freeze(Object.fromEntries(
    Object.entries(AUTHORITY_PORTS).map(([purpose, descriptor]) => {
      const port = authorities[purpose];
      const scalars = ['owner_service'];
      if (
        purpose === 'protectedRefGuard'
        || purpose === 'branchPushGuard'
      ) {
        scalars.push('sandbox_repo');
      }
      if (purpose === 'orphanLiveness') {
        scalars.push('staleMs');
      }
      const snapshot = {
        ...snapshotFunctions(port, descriptor.functions, scalars),
      };
      if (purpose === 'orphanLiveness' && port.pool != null) {
        if (typeof port.pool?.query !== 'function') {
          fail('production_seam_authority_port_invalid');
        }
        snapshot.pool = snapshotFunctions(port.pool, ['query']);
      }
      return [purpose, Object.freeze(snapshot)];
    }),
  ));
}

function validateBuilderInput(value) {
  if (
    !exactKeys(value, BUILDER_INPUT_KEYS)
    || typeof value.effectSigner?.signEffectResult !== 'function'
    || typeof value.createAuthorityBinding !== 'function'
  ) {
    fail('production_seam_builder_input_invalid');
  }
}

function sameResource(actual, expected) {
  return (
    actual?.resource_id === expected?.resource_id
    && actual?.resource_ref === expected?.resource_ref
  );
}

const BINDING_MATCHERS = Object.freeze({
  credentialGuard: (actual, expected) => (
    actual?.runId === expected?.runId
    && actual?.attemptId === expected?.attemptId
    && actual?.resourceId === expected?.resourceId
    && actual?.resourceRef === expected?.resourceRef
  ),
  independentJudge: (actual, expected) => (
    actual?.runId === expected?.runId
    && actual?.attempt?.id === expected?.attempt?.id
    && actual?.attempt?.run_id === expected?.attempt?.run_id
    && actual?.observed?.run?.id === expected?.observed?.run?.id
    && actual?.observed?.pr?.head_sha
      === expected?.observed?.pr?.head_sha
    && sameResource(actual?.resource, expected?.resource)
  ),
  orphanLiveness: (actual, expected) => (
    actual?.attempt?.id === expected?.attempt?.id
    && actual?.attempt?.run_id === expected?.attempt?.run_id
    && sameResource(actual?.resource, expected?.resource)
  ),
  devgate: (actual, expected) => (
    actual?.run_id === expected?.run_id
    && actual?.attempt_id === expected?.attempt_id
    && actual?.resource_id === expected?.resource_id
    && actual?.resource_ref === expected?.resource_ref
  ),
});

function bindLoader({
  authority,
  loader,
  matcher,
  createAuthorityBinding,
}) {
  return Object.freeze({
    ...authority,
    async [loader](context = {}) {
      const actual = await authority[loader](context);
      const expected = createAuthorityBinding({
        grant: context.grant,
        resource: context.resource,
      });
      if (!matcher(actual, expected)) {
        fail('production_seam_authority_binding_invalid');
      }
      return actual;
    },
  });
}

function builder(createSeam) {
  return (input = {}) => {
    validateBuilderInput(input);
    return createSeam(input);
  };
}

export function createBrainOwnedProductionSeamBuilders(input = {}) {
  if (!exactKeys(input, ['authorities', 'dependencies'])) {
    fail('production_seam_factory_input_invalid');
  }
  const { dependencies, authorities } = input;
  validateDependencies(dependencies);
  validateAuthorities(authorities);
  const productionDependencies = snapshotDependencies(dependencies);
  const productionAuthorities = snapshotAuthorities(authorities);

  return Object.freeze({
    'kernel.workspace.protected_ref_guard': builder(({
      effectSigner,
    }) => createBranchProtectionEquivalenceSeam({
      mutationBroker: productionDependencies.protectedRefGuard,
      mutationAuthority: productionAuthorities.protectedRefGuard,
      effectSigner,
    })),
    'kernel.credential.attempt_lease': builder(({
      effectSigner,
      createAuthorityBinding,
    }) => createCredentialGuardEquivalenceSeam({
      credentialBroker: productionDependencies.credentialGuard,
      credentialAuthority: bindLoader({
        authority: productionAuthorities.credentialGuard,
        loader: 'loadIssueRequest',
        matcher: BINDING_MATCHERS.credentialGuard,
        createAuthorityBinding,
      }),
      effectSigner,
    })),
    'kernel.github.mutation_broker': builder(({
      effectSigner,
    }) => createBranchPushEquivalenceSeam({
      mutationBroker: productionDependencies.branchPushGuard,
      mutationAuthority: productionAuthorities.branchPushGuard,
      effectSigner,
    })),
    'kernel.merge.effect_executor': builder(({
      effectSigner,
    }) => createCiMergeAuthorityEquivalenceSeam({
      mergeEffectExecutor:
        productionDependencies.ciMergeEffect.execute,
      mergeDrillAuthority: productionAuthorities.ciMergeEffect,
      effectSigner,
    })),
    'kernel.merge.human_review_authority': builder(({
      effectSigner,
    }) => createHumanReviewEquivalenceSeam({
      reviewAuthority: productionAuthorities.humanReview,
      effectSigner,
    })),
    'kernel.evaluation.independent_judge': builder(({
      effectSigner,
      createAuthorityBinding,
    }) => createIndependentJudgeEquivalenceSeam({
      handlerDeps: productionDependencies.independentJudge,
      judgeAuthority: bindLoader({
        authority: productionAuthorities.independentJudge,
        loader: 'loadContext',
        matcher: BINDING_MATCHERS.independentJudge,
        createAuthorityBinding,
      }),
      effectSigner,
    })),
    'kernel.liveness.orphan_recovery': builder(({
      effectSigner,
      createAuthorityBinding,
    }) => createKernelLivenessEquivalenceSeam({
      livenessAuthority: bindLoader({
        authority: productionAuthorities.orphanLiveness,
        loader: 'loadTarget',
        matcher: BINDING_MATCHERS.orphanLiveness,
        createAuthorityBinding,
      }),
      effectSigner,
    })),
    'kernel.quality.devgate': builder(({
      effectSigner,
      createAuthorityBinding,
    }) => createDevGateEquivalenceSeam({
      devgateAuthority: bindLoader({
        authority: productionAuthorities.devgate,
        loader: 'loadTarget',
        matcher: BINDING_MATCHERS.devgate,
        createAuthorityBinding,
      }),
      spawnGuarded: productionDependencies.devgate.spawnGuarded,
      effectSigner,
    })),
    'kernel.controller.attempt_ownership': builder(({
      effectSigner,
    }) => createAttemptOwnershipEquivalenceSeam({
      attemptStore: productionDependencies.attemptOwnership,
      ownershipAuthority: productionAuthorities.attemptOwnership,
      effectSigner,
    })),
    'kernel.closure.report_learning': builder(({
      effectSigner,
    }) => createReportLearningEquivalenceSeam({
      reportDeps: {
        dbQuery: productionDependencies.reportLearning.dbQuery,
      },
      learningPool: {
        query: productionDependencies.reportLearning.learningQuery,
      },
      closureAuthority: productionAuthorities.reportLearning,
      effectSigner,
    })),
  });
}
