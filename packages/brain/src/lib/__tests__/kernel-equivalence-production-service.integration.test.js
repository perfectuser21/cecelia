import { generateKeyPairSync } from 'node:crypto';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  compileDrillPlan,
} from '../kernel-equivalence-drills.js';
import {
  createProductionTrustedExecutionServiceFactory,
} from '../kernel-equivalence-production-service-factory.js';
import {
  TRUSTED_NON_RELEASE_EQUIVALENCE_DESCRIPTORS,
} from '../kernel-equivalence-trusted-assembly.js';
import {
  digestTrustedExecutionPlan,
} from '../kernel-equivalence-trusted-execution-service.js';

const NOW = Date.parse('2026-07-28T12:02:00.000Z');
const roots = [];

function fn() {
  return vi.fn();
}

function authority(owner_service, functions) {
  return Object.fromEntries([
    ['owner_service', owner_service],
    ...functions.map((name) => [name, fn()]),
  ]);
}

function seamPorts() {
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
    orphanLiveness: authority(
      'kernel.liveness.orphan_recovery',
      [
        'loadTarget',
        'snapshot',
        'recoverDeadAttempt',
        'now',
        'hostFn',
        'killFn',
      ],
    ),
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
  return { authorities, dependencies };
}

function privateKeyFile(root, keyId, privateKey) {
  const path = join(root, `${keyId}.pem`);
  writeFileSync(
    path,
    privateKey.export({ type: 'pkcs8', format: 'pem' }),
    { mode: 0o600 },
  );
  chmodSync(path, 0o600);
  return path;
}

function keyRecord(keyId, purpose, serviceId, publicKey) {
  return {
    key_id: keyId,
    purpose,
    service_id: serviceId,
    public_key_pem: publicKey.export({ type: 'spki', format: 'pem' }),
    not_before: '2026-07-28T00:00:00.000Z',
    not_after: '2026-08-28T00:00:00.000Z',
    revoked_at: null,
    rotates_key_id: null,
  };
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'kernel-eq-production-'));
  roots.push(root);
  const plan = compileDrillPlan(load(readFileSync(
    new URL('../../../../../regression-contract.yaml', import.meta.url),
    'utf8',
  )));
  const effectSigningKeys = {};
  const registryKeys = [];
  for (
    const [index, descriptor]
    of TRUSTED_NON_RELEASE_EQUIVALENCE_DESCRIPTORS.entries()
  ) {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const keyId = `effect-${String(index + 1).padStart(2, '0')}-2026-07`;
    effectSigningKeys[descriptor.seam_id] = {
      key_id: keyId,
      secret_file: privateKeyFile(root, keyId, privateKey),
    };
    registryKeys.push(keyRecord(
      keyId,
      'effect_receipt',
      descriptor.seam_id,
      publicKey,
    ));
    for (const cell of plan.cells) {
      if (cell.behavior_id !== descriptor.behavior_id) continue;
      cell.effect_signer_status = 'available';
      cell.effect_key_id = keyId;
      cell.blocked_by = null;
      cell.assembly_status = 'assembled';
    }
  }
  const collector = generateKeyPairSync('ed25519');
  const collectorKeyId = 'collector-2026-07';
  registryKeys.push(keyRecord(
    collectorKeyId,
    'collector_bundle',
    'kernel.equivalence.collector',
    collector.publicKey,
  ));
  const trustRegistry = {
    schema_version: 'kernel-equivalence-trust-registry/v1',
    algorithm: 'ed25519',
    grant_max_age_seconds: 900,
    effect_receipt_max_age_seconds: 86_400,
    collector_bundle_max_age_seconds: 86_400,
    replay_nonce: {
      single_use: true,
      atomic_consumer_required: true,
    },
    keys: registryKeys,
  };
  return {
    cleanupInspector: Object.freeze({
      owner_service: 'kernel.equivalence.cleanup_inspector',
      capability_id: 'cleanup-inspector-v1',
      inspect: fn(),
    }),
    effectSigningKeys,
    expectedPlanDigest: digestTrustedExecutionPlan(plan),
    grantAuthority: Object.freeze({
      owner_service: 'brain.kernel_equivalence.grants',
      capability_id: 'protected-grant-reader-v1',
      resolveProtectedGrant: fn(),
    }),
    now: () => NOW,
    plan,
    pool: {
      connect: fn(),
      query: vi.fn(async () => ({
        rows: [{
          genesis_hash: null,
          head_hash: null,
          revision: 0,
        }],
        rowCount: 1,
      })),
    },
    qualityIsolation: Object.freeze({
      owner_service: 'kernel.equivalence.quality_isolation',
      capability_id: 'quality-isolation-v1',
      prepare: fn(),
      cancel: fn(),
      cleanup: fn(),
    }),
    runtimeEnvironment: {
      KERNEL_EQ_COLLECTOR_KEY_FILE: privateKeyFile(
        root,
        collectorKeyId,
        collector.privateKey,
      ),
      KERNEL_EQ_COLLECTOR_KEY_ID: collectorKeyId,
    },
    seamPorts: seamPorts(),
    securityIsolation: Object.freeze({
      owner_service: 'kernel.equivalence.isolation',
      capability_id: 'security-isolation-v1',
      prepare: fn(),
      cancel: fn(),
      cleanup: fn(),
    }),
    trustRegistry,
  };
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop(), { recursive: true, force: true });
  }
});

describe('production trusted service assembly integration', () => {
  it('assembles the canonical 99-cell plan with ten real signer boundaries', async () => {
    const value = fixture();
    const createService =
      createProductionTrustedExecutionServiceFactory(value);
    const service = await createService();

    expect(service).toMatchObject({
      schema_version:
        'kernel-equivalence-trusted-execution-service/v1',
      cell_count: 99,
      adapter_count: 10,
      plan_digest: value.expectedPlanDigest,
      execute: expect.any(Function),
    });
    expect(value.pool.query).toHaveBeenCalledOnce();
    expect(JSON.stringify(service)).not.toMatch(
      /secret_file|private|BEGIN PRIVATE KEY/,
    );
  });
});
