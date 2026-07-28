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
const MAX_LIVENESS_STALE_MS = 24 * 60 * 60 * 1000;
const SANDBOX_REPO_PATTERN =
  /^[a-z0-9_.-]+\/[a-z0-9_.-]+-kernel-equivalence-drills$/;

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

function objectValue(value) {
  return (
    value != null
    && typeof value === 'object'
    && !Array.isArray(value)
  );
}

function descriptorsFor(value, code) {
  if (!objectValue(value)) fail(code);
  try {
    return Object.getOwnPropertyDescriptors(value);
  } catch {
    fail(code);
  }
}

function materializeExact(value, expected, code) {
  const descriptors = descriptorsFor(value, code);
  const actual = Reflect.ownKeys(descriptors);
  if (
    actual.some((key) => typeof key !== 'string')
    || actual.length !== expected.length
    || actual.sort().some((key, index) => key !== expected[index])
  ) {
    fail(code);
  }
  const entries = expected.map((name) => {
    const descriptor = descriptors[name];
    if (
      descriptor == null
      || !Object.hasOwn(descriptor, 'value')
      || descriptor.enumerable !== true
    ) {
      fail(code);
    }
    return [name, descriptor.value];
  });
  return Object.freeze(Object.fromEntries(entries));
}

function hasFunctions(value, names) {
  return names.every((name) => typeof value?.[name] === 'function');
}

function scalarValue(value) {
  return (
    value == null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
    || typeof value === 'bigint'
  );
}

function receiverValues(port, {
  functions,
  scalars,
  nested,
  code,
}) {
  const allowed = new Set([
    ...functions,
    ...scalars,
    ...Object.keys(nested),
  ]);
  const values = new Map();
  let cursor = port;
  let own = true;
  if (!objectValue(port)) fail(code);
  while (cursor != null && cursor !== Object.prototype) {
    let descriptors;
    let prototype;
    try {
      descriptors = Object.getOwnPropertyDescriptors(cursor);
      prototype = Object.getPrototypeOf(cursor);
    } catch {
      fail(code);
    }
    for (const key of Reflect.ownKeys(descriptors)) {
      if (key === 'constructor' && !own) continue;
      const descriptor = descriptors[key];
      if (
        typeof key !== 'string'
        || !allowed.has(key)
        || !Object.hasOwn(descriptor, 'value')
      ) fail(code);
      if (values.has(key)) continue;
      values.set(key, descriptor.value);
    }
    cursor = prototype;
    own = false;
  }
  return values;
}

function snapshotPort(port, {
  functions,
  scalars = [],
  nested = {},
  code,
}) {
  const values = receiverValues(port, {
    functions,
    scalars,
    nested,
    code,
  });
  if (scalars.some((name) => !scalarValue(values.get(name)))) fail(code);
  const nestedSnapshots = {};
  for (const [name, specification] of Object.entries(nested)) {
    const nestedPort = values.get(name);
    if (nestedPort == null && specification.optional === true) continue;
    nestedSnapshots[name] = snapshotPort(nestedPort, {
      ...specification,
      code,
    });
  }
  const rawFunctions = Object.fromEntries(functions.map((name) => [
    name,
    values.get(name),
  ]));
  if (!hasFunctions(rawFunctions, functions)) fail(code);

  const receiver = Object.create(null);
  for (const [name, value] of values.entries()) {
    Object.defineProperty(receiver, name, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }
  Object.assign(receiver, nestedSnapshots);
  const wrappers = Object.fromEntries(functions.map((name) => [
    name,
    (...args) => Reflect.apply(rawFunctions[name], receiver, args),
  ]));
  Object.assign(receiver, wrappers);
  Object.freeze(receiver);

  return Object.freeze({
    ...Object.fromEntries(scalars.map((name) => [name, values.get(name)])),
    ...nestedSnapshots,
    ...wrappers,
  });
}

function snapshotDependencies(input) {
  const dependencies = materializeExact(
    input,
    DEPENDENCY_KEYS,
    'production_seam_dependency_set_invalid',
  );
  const code = 'production_seam_dependency_port_invalid';
  const independentJudge = snapshotPort(dependencies.independentJudge, {
    functions: ['judgeGate'],
    scalars: ['promptDir'],
    nested: {
      pool: { functions: ['query'] },
      attemptStore: { functions: ['complete', 'getById'] },
    },
    code,
  });
  if (
    typeof independentJudge.promptDir !== 'string'
    || independentJudge.promptDir.length === 0
  ) {
    fail(code);
  }
  return Object.freeze({
    protectedRefGuard: snapshotPort(dependencies.protectedRefGuard, {
      functions: ['execute'],
      code,
    }),
    credentialGuard: snapshotPort(dependencies.credentialGuard, {
      functions: ['issue'],
      code,
    }),
    branchPushGuard: snapshotPort(dependencies.branchPushGuard, {
      functions: ['execute'],
      code,
    }),
    ciMergeEffect: snapshotPort(dependencies.ciMergeEffect, {
      functions: ['execute'],
      code,
    }),
    independentJudge,
    devgate: snapshotPort(dependencies.devgate, {
      functions: ['spawnGuarded'],
      code,
    }),
    attemptOwnership: snapshotPort(dependencies.attemptOwnership, {
      functions: ['complete', 'getById'],
      code,
    }),
    reportLearning: snapshotPort(dependencies.reportLearning, {
      functions: ['dbQuery', 'learningQuery'],
      code,
    }),
  });
}

function snapshotAuthorities(input) {
  const authorities = materializeExact(
    input,
    AUTHORITY_KEYS,
    'production_seam_authority_set_invalid',
  );
  const code = 'production_seam_authority_port_invalid';
  const snapshots = Object.fromEntries(
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
      const snapshot = snapshotPort(port, {
        functions: descriptor.functions,
        scalars,
        nested: purpose === 'orphanLiveness'
          ? {
              pool: {
                functions: ['query'],
                optional: true,
              },
            }
          : {},
        code,
      });
      if (snapshot.owner_service !== descriptor.owner) fail(code);
      if (
        (
          purpose === 'protectedRefGuard'
          || purpose === 'branchPushGuard'
        )
        && (
          snapshot.sandbox_repo === 'perfectuser21/cecelia'
          || typeof snapshot.sandbox_repo !== 'string'
          || !SANDBOX_REPO_PATTERN.test(snapshot.sandbox_repo)
        )
      ) {
        fail(code);
      }
      if (
        purpose === 'orphanLiveness'
        && snapshot.staleMs != null
        && (
          !Number.isInteger(snapshot.staleMs)
          || snapshot.staleMs < 1
          || snapshot.staleMs > MAX_LIVENESS_STALE_MS
        )
      ) {
        fail(code);
      }
      return [purpose, snapshot];
    }),
  );
  return Object.freeze(snapshots);
}

function validateBuilderInput(value) {
  const code = 'production_seam_builder_input_invalid';
  const input = materializeExact(value, BUILDER_INPUT_KEYS, code);
  const effectSigner = snapshotPort(input.effectSigner, {
    functions: ['signEffectResult'],
    scalars: ['key_id', 'purpose', 'service_id'],
    code,
  });
  if (typeof input.createAuthorityBinding !== 'function') fail(code);
  return Object.freeze({
    createAuthorityBinding: input.createAuthorityBinding,
    effectSigner,
  });
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
    return createSeam(validateBuilderInput(input));
  };
}

export function createBrainOwnedProductionSeamBuilders(input = {}) {
  const factoryInput = materializeExact(
    input,
    ['authorities', 'dependencies'],
    'production_seam_factory_input_invalid',
  );
  const productionDependencies = snapshotDependencies(
    factoryInput.dependencies,
  );
  const productionAuthorities = snapshotAuthorities(
    factoryInput.authorities,
  );

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
