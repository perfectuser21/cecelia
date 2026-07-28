import { generateKeyPairSync } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { load } from 'js-yaml';
import pg from 'pg';
import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';
import * as productionWiring
  from '../kernel-equivalence-production-wiring.js';
import * as readinessConfiguration
  from '../kernel-equivalence-readiness-configuration.js';
import * as trustedExecutionBoot
  from '../kernel-equivalence-trusted-execution-boot.js';
import {
  compileDrillPlan,
} from '../kernel-equivalence-drills.js';
import {
  TRUSTED_NON_RELEASE_EQUIVALENCE_DESCRIPTORS,
} from '../kernel-equivalence-trusted-assembly.js';
import {
  digestTrustedExecutionPlan,
} from '../kernel-equivalence-trusted-execution-service.js';

const NOW = Date.parse('2026-07-28T12:02:00.000Z');
const roots = [];

function keyRecord(keyId, purpose, serviceId, publicKey) {
  return {
    key_id: keyId,
    purpose,
    service_id: serviceId,
    public_key_pem: publicKey.export({
      type: 'spki',
      format: 'pem',
    }),
    not_before: '2026-07-28T00:00:00.000Z',
    not_after: '2026-08-28T00:00:00.000Z',
    revoked_at: null,
    rotates_key_id: null,
  };
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

function fixture() {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), 'kernel-eq-production-wiring-')),
  );
  roots.push(root);
  const socketRoot = realpathSync(
    mkdtempSync('/tmp/keq-socket-'),
  );
  roots.push(socketRoot);
  chmodSync(socketRoot, 0o700);
  const grantRoot = join(root, 'grants');
  mkdirSync(grantRoot, { mode: 0o700 });
  chmodSync(grantRoot, 0o700);
  const contract = load(readFileSync(
    new URL('../../../../../regression-contract.yaml', import.meta.url),
    'utf8',
  ));
  const plan = compileDrillPlan(contract, { now: NOW });
  const registryKeys = [];
  const effectSigningKeys = {};
  for (
    const [index, descriptor]
    of TRUSTED_NON_RELEASE_EQUIVALENCE_DESCRIPTORS.entries()
  ) {
    const pair = generateKeyPairSync('ed25519');
    const keyId = `effect-${String(index + 1).padStart(2, '0')}`;
    effectSigningKeys[descriptor.seam_id] = {
      key_id: keyId,
      secret_file: privateKeyFile(root, keyId, pair.privateKey),
    };
    registryKeys.push(keyRecord(
      keyId,
      'effect_receipt',
      descriptor.seam_id,
      pair.publicKey,
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
  const collectorSecretFile = privateKeyFile(
    root,
    collectorKeyId,
    collector.privateKey,
  );
  registryKeys.push(keyRecord(
    collectorKeyId,
    'collector_bundle',
    'kernel.equivalence.collector',
    collector.publicKey,
  ));
  const executionGrant = generateKeyPairSync('ed25519');
  const executionGrantKeyId = 'grant-authority-2026-07';
  const executionGrantSecretFile = privateKeyFile(
    root,
    executionGrantKeyId,
    executionGrant.privateKey,
  );
  registryKeys.push(keyRecord(
    executionGrantKeyId,
    'execution_grant',
    'brain.authority',
    executionGrant.publicKey,
  ));
  const readiness = generateKeyPairSync('ed25519');
  const readinessKeyId = 'trusted-readiness-2026-07';
  const readinessSecretFile = privateKeyFile(
    root,
    readinessKeyId,
    readiness.privateKey,
  );
  registryKeys.push(keyRecord(
    readinessKeyId,
    'trusted_execution_readiness',
    'brain.kernel_equivalence.trusted_execution',
    readiness.publicKey,
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
  const manifest = {
    schema_version:
      'kernel-equivalence-production-wiring/v1',
    expected_plan_digest: digestTrustedExecutionPlan(plan),
    trust_registry: trustRegistry,
    collector_key: {
      key_id: collectorKeyId,
      secret_file: collectorSecretFile,
    },
    execution_grant_key: {
      key_id: executionGrantKeyId,
      secret_file: executionGrantSecretFile,
    },
    readiness_signing_key: {
      key_id: readinessKeyId,
      secret_file: readinessSecretFile,
    },
    effect_signing_keys: effectSigningKeys,
    grant_root: grantRoot,
    grant_ttl_seconds: 300,
    socket_path: join(socketRoot, 'trusted-execution.sock'),
    resource_ports: {
      schema_version:
        'kernel-equivalence-resource-ports/v1',
      profile_id: 'local-isolated-test',
    },
  };
  const configFile = join(root, 'production-wiring.json');
  writeFileSync(
    configFile,
    `${JSON.stringify(manifest)}\n`,
    { mode: 0o600 },
  );
  chmodSync(configFile, 0o600);
  return {
    configFile,
    env: {
      KERNEL_EQ_PRODUCTION_CONFIG_FILE: configFile,
    },
    manifest,
    plan,
  };
}

function operation() {
  return async () => undefined;
}

function authority(owner_service, functions) {
  return Object.fromEntries([
    ['owner_service', owner_service],
    ...functions.map((name) => [name, operation()]),
  ]);
}

function seamPorts() {
  const dependencies = {
    protectedRefGuard: { execute: operation() },
    credentialGuard: { issue: operation() },
    branchPushGuard: { execute: operation() },
    ciMergeEffect: { execute: operation() },
    independentJudge: {
      pool: { query: operation() },
      attemptStore: {
        complete: operation(),
        getById: operation(),
      },
      judgeGate: operation(),
      promptDir: '/var/lib/cecelia/equivalence-prompts',
    },
    devgate: { spawnGuarded: operation() },
    attemptOwnership: {
      complete: operation(),
      getById: operation(),
    },
    reportLearning: {
      dbQuery: operation(),
      learningQuery: operation(),
    },
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
      [
        'loadTarget',
        'snapshot',
        'loadPredecessorOwnershipBinding',
      ],
    ),
    reportLearning: authority(
      'kernel.closure.report_learning',
      [
        'now',
        'loadEvidence',
        'snapshot',
        'loadPredecessorEvidenceBinding',
      ],
    ),
  };
  authorities.protectedRefGuard.sandbox_repo =
    'perfectuser21/cecelia-kernel-equivalence-drills';
  authorities.branchPushGuard.sandbox_repo =
    'perfectuser21/cecelia-kernel-equivalence-drills';
  return { authorities, dependencies };
}

function assemblyPorts(profileId = 'local-isolated-test') {
  return {
    cleanupInspector: Object.freeze({
      owner_service: 'kernel.equivalence.cleanup_inspector',
      capability_id: 'local-cleanup-inspector-v1',
      inspect: operation(),
    }),
    profile_id: profileId,
    qualityIsolation: Object.freeze({
      owner_service: 'kernel.equivalence.quality_isolation',
      capability_id: 'local-quality-isolation-v1',
      prepare: operation(),
      cancel: operation(),
      cleanup: operation(),
    }),
    seamPorts: seamPorts(),
    securityIsolation: Object.freeze({
      owner_service: 'kernel.equivalence.isolation',
      capability_id: 'local-security-isolation-v1',
      prepare: operation(),
      cancel: operation(),
      cleanup: operation(),
    }),
  };
}

function databasePort() {
  return {
    connect: operation(),
    query: async () => ({
      rows: [{
        genesis_hash: null,
        head_hash: null,
        revision: 0,
      }],
      rowCount: 1,
    }),
  };
}

function rewriteManifest(value) {
  writeFileSync(
    value.configFile,
    `${JSON.stringify(value.manifest)}\n`,
    { mode: 0o600 },
  );
  chmodSync(value.configFile, 0o600);
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop(), { recursive: true, force: true });
  }
});

describe('kernel equivalence production wiring', () => {
  it('wraps a real pg.Pool as a frozen two-method Brain capability', async () => {
    const value = fixture();
    const pool = new pg.Pool({
      connectionString:
        'postgresql://kernel-equivalence.invalid/unused',
      connectionTimeoutMillis: 10,
    });
    try {
      expect(Object.hasOwn(pool, 'connect')).toBe(false);
      expect(Object.hasOwn(pool, 'query')).toBe(false);
      expect(Object.keys(pool).length).toBeGreaterThan(2);

      const database =
        productionWiring.createBrainOwnedDatabasePort(pool);

      expect(Object.isFrozen(database)).toBe(true);
      expect(Object.keys(database).sort()).toEqual([
        'connect',
        'query',
      ]);
      expect(Object.hasOwn(database, 'connect')).toBe(true);
      expect(Object.hasOwn(database, 'query')).toBe(true);

      const wiring =
        productionWiring.loadProductionTrustedExecutionWiring({
          env: value.env,
          pool,
          assemblyPorts: assemblyPorts(),
          now: () => NOW,
        });
      expect(wiring).toMatchObject({
        createService: expect.any(Function),
        grantIssuer: expect.any(Object),
        resource_port_profile_id: 'local-isolated-test',
      });
    } finally {
      await pool.end();
    }
  });

  it('binds prototype database methods to the original Brain receiver', async () => {
    class PoolLike {
      constructor() {
        this.marker = 'brain-owned';
        this.internal = { secret: 'not-exported' };
      }

      async connect() {
        return this.marker;
      }

      async query() {
        return this.internal.secret;
      }
    }
    const database =
      productionWiring.createBrainOwnedDatabasePort(new PoolLike());

    await expect(database.connect()).resolves.toBe('brain-owned');
    await expect(database.query()).resolves.toBe('not-exported');
    expect(Object.keys(database).sort()).toEqual(['connect', 'query']);
    expect(JSON.stringify(database)).not.toContain('not-exported');
  });

  it('provides one dedicated production wiring boundary', () => {
    expect(existsSync(new URL(
      '../kernel-equivalence-production-wiring.js',
      import.meta.url,
    ))).toBe(true);
  });

  it('fails closed with an exact code when the protected manifest is not configured', () => {
    expect(
      typeof productionWiring.loadProductionTrustedExecutionWiring,
    ).toBe('function');
    expect(() => (
      productionWiring.loadProductionTrustedExecutionWiring({
        env: {},
      })
    )).toThrowError(expect.objectContaining({
      code: 'trusted_execution_config_file_missing',
    }));
  });

  it('rejects raw Kernel private-key material before opening a manifest', () => {
    expect(() => (
      productionWiring.loadProductionTrustedExecutionWiring({
        env: {
          KERNEL_EQ_PRODUCTION_CONFIG_FILE:
            '/does/not/exist.json',
          KERNEL_EQ_EXECUTION_PRIVATE_KEY:
            '-----BEGIN PRIVATE KEY-----',
        },
      })
    )).toThrowError(expect.objectContaining({
      code: 'trusted_execution_raw_secret_forbidden',
    }));
  });

  it('validates and pins a complete manifest before reporting missing Phase 5 B ports', () => {
    const value = fixture();

    expect(() => (
      productionWiring.loadProductionTrustedExecutionWiring({
        env: value.env,
        now: () => NOW,
      })
    )).toThrowError(expect.objectContaining({
      code: 'trusted_execution_ports_unconfigured',
    }));
  });

  it('assembles one service and separate grant issuer from a complete isolated outer port set', async () => {
    const value = fixture();
    const wiring =
      productionWiring.loadProductionTrustedExecutionWiring({
        env: value.env,
        pool: databasePort(),
        assemblyPorts: assemblyPorts(),
        now: () => NOW,
      });
    value.manifest.expected_plan_digest = 'f'.repeat(64);
    rewriteManifest(value);

    const service = await wiring.createService();

    expect(service).toMatchObject({
      schema_version:
        'kernel-equivalence-trusted-execution-service/v1',
      cell_count: 99,
      adapter_count: 10,
      plan_digest: digestTrustedExecutionPlan(value.plan),
    });
    expect(wiring).toMatchObject({
      socket_path: expect.stringMatching(
        /trusted-execution\.sock$/,
      ),
      resource_port_profile_id: 'local-isolated-test',
      createService: expect.any(Function),
      grantIssuer: expect.objectContaining({
        owner_service: 'brain.kernel_equivalence.grant_issuer',
      }),
      readinessSigner: expect.objectContaining({
        owner_service: 'brain.kernel_equivalence.readiness_signer',
        key_id: 'trusted-readiness-2026-07',
      }),
      readinessTrustAnchor: expect.objectContaining({
        purpose: 'trusted_execution_readiness',
        service_id:
          'brain.kernel_equivalence.trusted_execution',
      }),
    });
    expect(Object.isFrozen(wiring)).toBe(true);
    expect(JSON.stringify(wiring)).not.toMatch(
      /secret_file|BEGIN PRIVATE KEY|production-wiring\.json/,
    );
  });

  it('loads only the pinned public readiness configuration for unprivileged clients', () => {
    const value = fixture();

    const readiness = readinessConfiguration
      .loadProductionTrustedExecutionReadinessConfiguration({
        env: value.env,
        now: () => NOW,
      });

    expect(Object.isFrozen(readiness)).toBe(true);
    expect(Object.keys(readiness).sort()).toEqual([
      'expected_plan_digest',
      'readiness_trust_anchor',
      'socket_path',
    ]);
    expect(readiness).toMatchObject({
      expected_plan_digest: value.manifest.expected_plan_digest,
      readiness_trust_anchor: {
        key_id:
          value.manifest.readiness_signing_key.key_id,
        purpose: 'trusted_execution_readiness',
        service_id:
          'brain.kernel_equivalence.trusted_execution',
      },
      socket_path: value.manifest.socket_path,
    });
    expect(Object.isFrozen(
      readiness.readiness_trust_anchor,
    )).toBe(true);
    expect(JSON.stringify(readiness)).not.toContain('secret_file');
  });

  it.each([
    ['plan digest drift', (value) => {
      value.manifest.expected_plan_digest = 'f'.repeat(64);
    }, 'trusted_execution_plan_digest_mismatch'],
    ['extra manifest field', (value) => {
      value.manifest.private_key = 'forbidden';
    }, 'trusted_execution_config_invalid'],
    ['wrong port profile', () => {}, 'trusted_execution_ports_profile_mismatch'],
  ])('rejects %s before listener creation', (
    _label,
    mutate,
    code,
  ) => {
    const value = fixture();
    mutate(value);
    rewriteManifest(value);

    expect(() => (
      productionWiring.loadProductionTrustedExecutionWiring({
        env: value.env,
        pool: databasePort(),
        assemblyPorts: assemblyPorts(
          code === 'trusted_execution_ports_profile_mismatch'
            ? 'wrong-profile'
            : 'local-isolated-test',
        ),
        now: () => NOW,
      })
    )).toThrowError(expect.objectContaining({ code }));
  });

  it.each([
    ['world-readable manifest', (value) => {
      chmodSync(value.configFile, 0o644);
    }],
    ['symlink manifest', (value) => {
      const target = join(
        dirname(value.configFile),
        'manifest-target.json',
      );
      writeFileSync(
        target,
        `${JSON.stringify(value.manifest)}\n`,
        { mode: 0o600 },
      );
      rmSync(value.configFile);
      symlinkSync(target, value.configFile);
    }],
    ['hard-linked manifest', (value) => {
      linkSync(
        value.configFile,
        `${value.configFile}.second-link`,
      );
    }],
  ])('rejects a %s before key or port loading', (
    _label,
    mutate,
  ) => {
    const value = fixture();
    mutate(value);

    expect(() => (
      productionWiring.loadProductionTrustedExecutionWiring({
        env: value.env,
        pool: databasePort(),
        assemblyPorts: assemblyPorts(),
        now: () => NOW,
      })
    )).toThrowError(expect.objectContaining({
      code: 'trusted_execution_config_file_unsafe',
    }));
  });

  it.runIf(process.platform === 'darwin')(
    'rejects a production manifest bearing both an xattr and ACL even when mode is 0600',
    () => {
      const value = fixture();
      execFileSync('/usr/bin/xattr', [
        '-w',
        'com.cecelia.kernel-equivalence-test',
        'present',
        value.configFile,
      ]);
      execFileSync('/bin/chmod', [
        '+a',
        'everyone allow read',
        value.configFile,
      ]);

      expect(() => (
        productionWiring.loadProductionTrustedExecutionWiring({
          env: value.env,
          pool: databasePort(),
          assemblyPorts: assemblyPorts(),
          now: () => NOW,
        })
      )).toThrowError(expect.objectContaining({
        code: 'trusted_execution_config_file_unsafe',
      }));
    },
  );

  it.runIf(
    process.platform === 'linux'
    && (
      existsSync('/usr/bin/setfacl')
      || existsSync('/bin/setfacl')
    ),
  )(
    'rejects a Linux ACL-bearing production manifest when setfacl is available',
    () => {
      const value = fixture();
      const setfacl = existsSync('/usr/bin/setfacl')
        ? '/usr/bin/setfacl'
        : '/bin/setfacl';
      execFileSync(setfacl, ['-m', 'u:nobody:r', value.configFile]);

      expect(() => (
        productionWiring.loadProductionTrustedExecutionWiring({
          env: value.env,
          pool: databasePort(),
          assemblyPorts: assemblyPorts(),
          now: () => NOW,
        })
      )).toThrowError(expect.objectContaining({
        code: 'trusted_execution_config_file_unsafe',
      }));
    },
  );

  it('boots fail closed from production configuration without creating a socket', async () => {
    expect(
      typeof trustedExecutionBoot
        .bootProductionBrainTrustedExecution,
    ).toBe('function');
    const boot = await trustedExecutionBoot
      .bootProductionBrainTrustedExecution({
        env: {},
        pool: databasePort(),
      });

    expect(boot.getReadiness()).toEqual({
      ready: false,
      code: 'trusted_execution_config_file_missing',
      socket_path: null,
    });
    await expect(boot.close()).resolves.toBeUndefined();
  });

  it('boots a complete isolated production assembly through a mode-0600 Unix listener', async () => {
    const value = fixture();
    const boot = await trustedExecutionBoot
      .bootProductionBrainTrustedExecution({
        env: value.env,
        pool: databasePort(),
        assemblyPorts: assemblyPorts(),
        now: () => NOW,
      });

    expect(boot.getReadiness()).toEqual({
      ready: true,
      code: null,
      socket_path: value.manifest.socket_path,
    });
    const status = lstatSync(value.manifest.socket_path);
    expect(status.isSocket()).toBe(true);
    expect(status.mode & 0o777).toBe(0o600);
    await boot.close();
    expect(existsSync(value.manifest.socket_path)).toBe(false);
  });

  it('wires server boot through the production loader and shared pool', () => {
    const serverSource = readFileSync(
      new URL('../../../server.js', import.meta.url),
      'utf8',
    );

    expect(serverSource).toMatch(
      /bootProductionBrainTrustedExecution/,
    );
    expect(serverSource).toMatch(
      /bootProductionBrainTrustedExecution\(\{\s*env:\s*process\.env,\s*pool,/s,
    );
    expect(serverSource).not.toMatch(
      /__trustedExecutionBoot\s*=\s*await\s+bootBrainTrustedExecution\(\)/,
    );
  });

  it('rejects accessor-backed outer ports without invoking the accessor', () => {
    const value = fixture();
    const ports = assemblyPorts();
    let reads = 0;
    Object.defineProperty(ports, 'profile_id', {
      enumerable: true,
      get() {
        reads += 1;
        return 'local-isolated-test';
      },
    });

    expect(() => (
      productionWiring.loadProductionTrustedExecutionWiring({
        env: value.env,
        pool: databasePort(),
        assemblyPorts: ports,
        now: () => NOW,
      })
    )).toThrowError(expect.objectContaining({
      code: 'trusted_execution_ports_invalid',
    }));
    expect(reads).toBe(0);
  });
});
