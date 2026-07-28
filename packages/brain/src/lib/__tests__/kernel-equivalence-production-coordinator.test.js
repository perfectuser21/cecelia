import { readFileSync } from 'node:fs';
import { load as loadYaml } from 'js-yaml';
import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { compileDrillPlan } from '../kernel-equivalence-drills.js';
import { computeFleetAuthoritySha256 } from '../../orchestrator/fleet-callback-auth.js';
import {
  createPostgresKernelEquivalenceCoordinator,
} from '../kernel-equivalence-production-coordinator.js';

const contract = loadYaml(readFileSync(
  new URL('../../../../../regression-contract.yaml', import.meta.url),
  'utf8',
));
const plan = compileDrillPlan(contract, {
  now: Date.parse('2026-07-29T00:00:00.000Z'),
});

function grantIssuer() {
  return Object.freeze({
    owner_service: 'brain.kernel_equivalence.grant_issuer',
    capability_id:
      'brain.kernel_equivalence.protected_grant_issuer.v1',
    issueProtectedGrant: async () => {
      throw new Error('not reached without an authoritative case');
    },
    revokeProtectedGrant: async () => {
      throw new Error('not reached without an issued grant');
    },
    cleanupExpiredGrants: async () => ({ removed: 0, retained: 0 }),
  });
}

function emptyPool() {
  const statements = [];
  return {
    statements,
    query: async (text, values = []) => {
      statements.push({ text, values });
      return { rows: [], rowCount: 0 };
    },
  };
}

function coordinator(
  pool = emptyPool(),
  issuer = grantIssuer(),
  randomUUID = () =>
    '11111111-1111-4111-8111-111111111111',
  grantTtlSeconds = 60,
) {
  return createPostgresKernelEquivalenceCoordinator({
    pool,
    grantIssuer: issuer,
    plan,
    socketPath: '/var/run/cecelia/kernel-equivalence.sock',
    brainVersion: '1.268.28',
    engineVersion: '19.7.1',
    grantTtlSeconds,
    randomUUID,
    now: () => Date.parse('2026-07-29T00:00:00.000Z'),
  });
}

function authorityFixture({
  observedAt = '2026-07-29T00:00:00.000Z',
  caseExpiresAt = '2026-07-29T00:10:00.000Z',
  leaseExpiresAt = '2026-07-29T00:00:30.000Z',
} = {}) {
  const caseId = '22222222-2222-4222-8222-222222222222';
  const runId = '33333333-3333-4333-8333-333333333333';
  const attemptId = '44444444-4444-4444-8444-444444444444';
  const cell = plan.cells.find(({ cell_id: cellId }) => (
    cellId
      === 'KERNEL-P1-10-CONTROLLER-SESSION-ISOLATION::codex::normal'
  ));
  const resourcePrefix = cell.isolation.resource_prefix
    .replaceAll('{run_id}', runId)
    .replaceAll('{attempt_id}', attemptId);
  const taskBundle = {
    inputs: {
      workspace_spec: {
        expected_head_sha: 'a'.repeat(40),
      },
    },
  };
  return {
    case_id: caseId,
    cell_id: cell.cell_id,
    behavior_id: cell.behavior_id,
    provider: cell.provider,
    scenario: cell.scenario,
    seam_id: cell.seam_id,
    adapter_id: cell.adapter_id,
    run_id: runId,
    attempt_id: attemptId,
    artifact_sha: 'a'.repeat(40),
    brain_version: '1.268.28',
    engine_version: '19.7.1',
    resource_type: 'ephemeral_run',
    resource_prefix: resourcePrefix,
    resource_id: attemptId,
    resource_ref: `${resourcePrefix}${attemptId}`,
    expires_at: caseExpiresAt,
    case_expires_at: caseExpiresAt,
    production_lease_expires_at: leaseExpiresAt,
    authority_expires_at: new Date(Math.min(
      Date.parse(caseExpiresAt),
      Date.parse(leaseExpiresAt),
    )).toISOString(),
    authority_observed_at: observedAt,
    result_receipt_id:
      '55555555-5555-4555-8555-555555555555',
    provider_session_id: 'codex-session-1',
    actual_machine_id: 'xian-mac-m4',
    execution_transport: 'fleet-worker',
    remote_job_id: 'job-1',
    attempt_status: 'completed',
    receipt_worker_id: 'xian-mac-m4',
    receipt_job_id: 'job-1',
    receipt_terminal_status: 'completed',
    task_bundle_sha256: computeFleetAuthoritySha256(taskBundle),
    task_bundle: taskBundle,
  };
}

describe('production Kernel equivalence coordinator', () => {
  it('rejects a grant TTL that cannot survive authority revalidation', () => {
    expect(() => createPostgresKernelEquivalenceCoordinator({
      pool: emptyPool(),
      grantIssuer: grantIssuer(),
      plan,
      socketPath: '/var/run/cecelia/kernel-equivalence.sock',
      brainVersion: '1.268.28',
      engineVersion: '19.7.1',
      grantTtlSeconds: 1,
      randomUUID: () =>
        '11111111-1111-4111-8111-111111111111',
      now: () => Date.parse('2026-07-29T00:00:00.000Z'),
    })).toThrowError(expect.objectContaining({
      code: 'production_controller_configuration_invalid',
    }));
  });

  it('fails before claim when effective authority is below two seconds', async () => {
    const statements = [];
    const issueProtectedGrant = vi.fn(async () => {
      throw new Error('issuer must not be called');
    });
    const pool = {
      query: async (text, values = []) => {
        statements.push({ text, values });
        if (/WITH authoritative AS/i.test(text)) {
          return {
            rows: [authorityFixture({
              caseExpiresAt: '2026-07-29T00:00:01.999Z',
              leaseExpiresAt: '2026-07-29T00:00:10.000Z',
            })],
            rowCount: 1,
          };
        }
        return {
          rows: [{ generation: values[2], state: values[4] }],
          rowCount: 1,
        };
      },
    };
    const issuer = Object.freeze({
      ...grantIssuer(),
      issueProtectedGrant,
    });
    const value = coordinator(pool, issuer);

    await expect(value.executeCase(
      '22222222-2222-4222-8222-222222222222',
    )).rejects.toMatchObject({
      code: 'production_controller_case_expired',
    });
    expect(statements).toHaveLength(1);
    expect(issueProtectedGrant).not.toHaveBeenCalled();
  });

  it('fails before issuer when revalidated authority falls below two seconds', async () => {
    const statements = [];
    const authorityRows = [
      authorityFixture({
        leaseExpiresAt: '2026-07-29T00:00:02.500Z',
      }),
      authorityFixture({
        leaseExpiresAt: '2026-07-29T00:00:01.999Z',
      }),
    ];
    const issueProtectedGrant = vi.fn(async () => {
      throw new Error('issuer must not be called');
    });
    const pool = {
      query: async (text, values = []) => {
        statements.push({ text, values });
        if (/WITH authoritative AS/i.test(text)) {
          return {
            rows: [authorityRows.shift()],
            rowCount: 1,
          };
        }
        return {
          rows: [{ generation: values[2], state: values[4] }],
          rowCount: 1,
        };
      },
    };
    const issuer = Object.freeze({
      ...grantIssuer(),
      issueProtectedGrant,
    });
    const ids = [
      '11111111-1111-4111-8111-111111111111',
      '66666666-6666-4666-8666-666666666666',
      '77777777-7777-4777-8777-777777777777',
    ];
    const value = coordinator(pool, issuer, () => ids.shift());

    await expect(value.executeCase(
      '22222222-2222-4222-8222-222222222222',
    )).rejects.toMatchObject({
      code: 'production_controller_authority_unavailable',
    });
    expect(issueProtectedGrant).not.toHaveBeenCalled();
    expect(statements.filter(({ text }) => (
      /INSERT INTO kernel_equivalence_production_execution_events/i
        .test(text)
    )).map(({ values }) => values[4])).toEqual([
      'claimed',
      'blocked',
    ]);
  });

  it('issues for an exact two-second configuration with sufficient authority', async () => {
    const statements = [];
    const issueError = new Error('stop after proving issuer input');
    const issueProtectedGrant = vi.fn(async () => {
      throw issueError;
    });
    const pool = {
      query: async (text, values = []) => {
        statements.push({ text, values });
        if (/WITH authoritative AS/i.test(text)) {
          return {
            rows: [authorityFixture({
              leaseExpiresAt: '2026-07-29T00:00:02.500Z',
            })],
            rowCount: 1,
          };
        }
        return {
          rows: [{ generation: values[2], state: values[4] }],
          rowCount: 1,
        };
      },
    };
    const issuer = Object.freeze({
      ...grantIssuer(),
      issueProtectedGrant,
    });
    const ids = [
      '11111111-1111-4111-8111-111111111111',
      '66666666-6666-4666-8666-666666666666',
      '77777777-7777-4777-8777-777777777777',
    ];
    const value = coordinator(
      pool,
      issuer,
      () => ids.shift(),
      2,
    );

    await expect(value.executeCase(
      '22222222-2222-4222-8222-222222222222',
    )).rejects.toBe(issueError);
    expect(issueProtectedGrant).toHaveBeenCalledWith(
      expect.objectContaining({ ttl_seconds: 2 }),
    );
  });

  it('uses returned DB time instead of the process clock for authority', async () => {
    const issueError = new Error('stop after proving DB time authority');
    const issueProtectedGrant = vi.fn(async () => {
      throw issueError;
    });
    const pool = {
      query: async (text, values = []) => {
        if (/WITH authoritative AS/i.test(text)) {
          return {
            rows: [authorityFixture()],
            rowCount: 1,
          };
        }
        return {
          rows: [{ generation: values[2], state: values[4] }],
          rowCount: 1,
        };
      },
    };
    const issuer = Object.freeze({
      ...grantIssuer(),
      issueProtectedGrant,
    });
    const ids = [
      '11111111-1111-4111-8111-111111111111',
      '66666666-6666-4666-8666-666666666666',
      '77777777-7777-4777-8777-777777777777',
    ];
    const value = createPostgresKernelEquivalenceCoordinator({
      pool,
      grantIssuer: issuer,
      plan,
      socketPath: '/var/run/cecelia/kernel-equivalence.sock',
      brainVersion: '1.268.28',
      engineVersion: '19.7.1',
      grantTtlSeconds: 2,
      randomUUID: () => ids.shift(),
      now: () => Date.parse('2036-07-29T00:00:00.000Z'),
    });

    await expect(value.executeCase(
      '22222222-2222-4222-8222-222222222222',
    )).rejects.toBe(issueError);
    expect(issueProtectedGrant).toHaveBeenCalledTimes(1);
  });

  it('exposes only case identity operations and rejects caller-supplied axes', async () => {
    const pool = emptyPool();
    const value = coordinator(pool);

    expect(Object.isFrozen(value)).toBe(true);
    expect(value).toMatchObject({
      owner_service: 'brain.kernel_equivalence.controller',
      capability_id:
        'brain.kernel_equivalence.production_controller.v1',
      schema_version:
        'kernel-equivalence-production-controller/v1',
      executeCase: expect.any(Function),
      reconcileStartup: expect.any(Function),
    });
    expect(Object.keys(value).sort()).toEqual([
      'capability_id',
      'executeCase',
      'owner_service',
      'reconcileStartup',
      'schema_version',
    ]);
    await expect(value.executeCase({
      case_id: '22222222-2222-4222-8222-222222222222',
      provider: 'grok',
      artifact_sha: 'a'.repeat(40),
    })).rejects.toMatchObject({
      code: 'production_controller_case_id_invalid',
    });
    expect(pool.statements).toHaveLength(0);
  });

  it('performs read-only startup settlement reconciliation from durable bindings', async () => {
    const pool = emptyPool();
    const value = coordinator(pool);

    await expect(value.reconcileStartup()).resolves.toEqual({
      inspected: 0,
      settled: 0,
      retained_unknown: 0,
    });
    expect(pool.statements).toHaveLength(1);
    expect(pool.statements[0].text).toMatch(
      /kernel_equivalence_production_case_bindings/i,
    );
    expect(pool.statements[0].text).toMatch(
      /kernel_equivalence_production_execution_events/i,
    );
    expect(pool.statements[0].text).toMatch(
      /kernel_equivalence_receipt_bundles/i,
    );
    expect(pool.statements[0].text).toMatch(
      /WHERE latest\.state IN \(\s*'claimed',\s*'grant_issued',\s*'executing',\s*'reconciling',\s*'settlement_unknown'/is,
    );
    expect(pool.statements[0].text).toMatch(
      /events\.grant_ref/i,
    );
    expect(pool.statements[0].text).toMatch(
      /latest\.grant_ref\s*=\s*'kernel-equivalence-grant:'\s*\|\|\s*bundles\.grant_id::text/i,
    );
    expect(pool.statements[0].text).not.toMatch(
      /WHERE events\.state IN/i,
    );
    expect(pool.statements[0].text).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i,
    );
  });

  it('keyset-pages through every active startup settlement candidate', async () => {
    const pages = [
      Array.from({ length: 100 }, (_, index) => ({
        case_id:
          `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        generation: '4',
        state: 'settlement_unknown',
        controller_instance_id:
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        lease_expired: true,
        bundle_hash: null,
      })),
      [{
        case_id: '00000000-0000-4000-8000-000000000101',
        generation: '4',
        state: 'settlement_unknown',
        controller_instance_id:
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        lease_expired: true,
        bundle_hash: null,
      }],
    ];
    const statements = [];
    const pool = {
      query: async (text, values = []) => {
        statements.push({ text, values });
        return {
          rows: pages.shift() ?? [],
          rowCount: 0,
        };
      },
    };
    const value = coordinator(pool);

    await expect(value.reconcileStartup()).resolves.toEqual({
      inspected: 101,
      settled: 0,
      retained_unknown: 101,
    });
    expect(statements).toHaveLength(2);
    expect(statements[0].values).toEqual([null]);
    expect(statements[1].values).toEqual([
      '00000000-0000-4000-8000-000000000100',
    ]);
    expect(statements[0].text).toMatch(
      /latest\.case_id > \$1::uuid/i,
    );
  });

  it('revalidates current lease and Attempt state for an existing binding', async () => {
    const pool = emptyPool();
    const value = coordinator(pool);

    await expect(
      value.executeCase('22222222-2222-4222-8222-222222222222'),
    ).rejects.toMatchObject({
      code: 'production_controller_authority_unavailable',
    });
    expect(pool.statements).toHaveLength(1);
    expect(pool.statements[0].text).toMatch(
      /JOIN kernel_equivalence_production_case_bindings bindings[\s\S]*JOIN kernel_equivalence_production_case_leases leases[\s\S]*leases\.owner_id[\s\S]*brain\.kernel_equivalence\.production_cases[\s\S]*leases\.state = 'prepared'[\s\S]*leases\.lease_expires_at > clock_timestamp\(\)/i,
    );
    expect(pool.statements[0].text).toMatch(
      /attempts\.machine_attestation_status = 'verified'[\s\S]*attempts\.status IN \('completed', 'completed_with_concerns'\)/i,
    );
    expect(pool.statements[0].text).toMatch(
      /cases\.expires_at AS case_expires_at/i,
    );
    expect(pool.statements[0].text).toMatch(
      /leases\.lease_expires_at AS production_lease_expires_at/i,
    );
    expect(pool.statements[0].text).toMatch(
      /clock_timestamp\(\) AS authority_observed_at/i,
    );
  });

  it('takes over an expired controller lease explicitly before retaining unknown settlement', async () => {
    const statements = [];
    const pool = {
      query: async (text, values = []) => {
        statements.push({ text, values });
        if (statements.length === 1) {
          return {
            rows: [{
              case_id: '22222222-2222-4222-8222-222222222222',
              generation: '3',
              state: 'executing',
              controller_instance_id:
                '88888888-8888-4888-8888-888888888888',
              grant_ref:
                'kernel-equivalence-grant:55555555-5555-4555-8555-555555555555',
              grant_expires_at: '2026-07-29T00:05:00.000Z',
              lease_expired: true,
              authority_observed_at: '2026-07-29T00:00:00.000Z',
              case_expires_at: '2026-07-29T00:10:00.000Z',
              production_lease_expires_at:
                '2026-07-29T00:00:30.000Z',
              bundle_hash: null,
            }],
            rowCount: 1,
          };
        }
        return {
          rows: [{ generation: values[2], state: values[4] }],
          rowCount: 1,
        };
      },
    };
    const ids = [
      '11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
    ];
    const value = coordinator(pool, grantIssuer(), () => ids.shift());

    await expect(value.reconcileStartup()).resolves.toEqual({
      inspected: 1,
      settled: 0,
      retained_unknown: 1,
    });
    expect(statements.slice(1).map(({ values }) => values[4])).toEqual([
      'reconciling',
      'settlement_unknown',
    ]);
    expect(statements[1].values[3]).toBe(
      '11111111-1111-4111-8111-111111111111',
    );
    expect(statements[2].values[3]).toBe(
      '11111111-1111-4111-8111-111111111111',
    );
    expect(statements[1].values[5]).toBeNull();
    expect(statements[2].values[5]).toBe(
      'kernel-equivalence-grant:55555555-5555-4555-8555-555555555555',
    );
  });

  it('caps restart takeover to short production authority', async () => {
    const statements = [];
    const pool = {
      query: async (text, values = []) => {
        statements.push({ text, values });
        if (statements.length === 1) {
          return {
            rows: [{
              case_id: '22222222-2222-4222-8222-222222222222',
              generation: '3',
              state: 'executing',
              controller_instance_id:
                '88888888-8888-4888-8888-888888888888',
              grant_ref:
                'kernel-equivalence-grant:55555555-5555-4555-8555-555555555555',
              grant_expires_at: '2026-07-29T00:05:00.000Z',
              lease_expired: true,
              authority_observed_at: '2026-07-29T00:00:00.000Z',
              case_expires_at: '2026-07-29T00:10:00.000Z',
              production_lease_expires_at:
                '2026-07-29T00:00:01.500Z',
              bundle_hash: null,
            }],
            rowCount: 1,
          };
        }
        return {
          rows: [{ generation: values[2], state: values[4] }],
          rowCount: 1,
        };
      },
    };
    const ids = [
      '11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
    ];
    const value = coordinator(pool, grantIssuer(), () => ids.shift());

    await expect(value.reconcileStartup()).resolves.toEqual({
      inspected: 1,
      settled: 0,
      retained_unknown: 1,
    });
    expect(statements[0].text).toMatch(
      /cases\.expires_at AS case_expires_at/i,
    );
    expect(statements[0].text).toMatch(
      /production_leases\.lease_expires_at\s+AS production_lease_expires_at/i,
    );
    expect(statements[0].text).toMatch(
      /clock_timestamp\(\) AS authority_observed_at/i,
    );
    expect(statements.slice(1).map(({ values }) => values[4])).toEqual([
      'reconciling',
      'settlement_unknown',
    ]);
    expect(statements[1].values[10]).toBe(
      '2026-07-29T00:00:01.500Z',
    );
  });

  it('settles its own expired active lease without a false restart takeover', async () => {
    const statements = [];
    const pool = {
      query: async (text, values = []) => {
        statements.push({ text, values });
        if (statements.length === 1) {
          return {
            rows: [{
              case_id: '22222222-2222-4222-8222-222222222222',
              generation: '3',
              state: 'executing',
              controller_instance_id:
                '11111111-1111-4111-8111-111111111111',
              lease_expired: true,
              bundle_hash: null,
            }],
            rowCount: 1,
          };
        }
        return {
          rows: [{ generation: values[2], state: values[4] }],
          rowCount: 1,
        };
      },
    };
    const ids = [
      '11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
    ];
    const value = coordinator(pool, grantIssuer(), () => ids.shift());

    await expect(value.reconcileStartup()).resolves.toEqual({
      inspected: 1,
      settled: 0,
      retained_unknown: 1,
    });
    expect(statements.slice(1).map(({ values }) => values[4])).toEqual([
      'settlement_unknown',
    ]);
    expect(statements[1].values[8]).toBe(
      'startup_settlement_unresolved',
    );
  });

  it('persists a terminal denial when the protected issuer returns malformed metadata', async () => {
    const caseId = '22222222-2222-4222-8222-222222222222';
    const runId = '33333333-3333-4333-8333-333333333333';
    const attemptId = '44444444-4444-4444-8444-444444444444';
    const cell = plan.cells.find(({ cell_id: cellId }) => (
      cellId
        === 'KERNEL-P1-10-CONTROLLER-SESSION-ISOLATION::codex::normal'
    ));
    const resourcePrefix = cell.isolation.resource_prefix
      .replaceAll('{run_id}', runId)
      .replaceAll('{attempt_id}', attemptId);
    const taskBundle = {
      inputs: {
        workspace_spec: {
          expected_head_sha: 'a'.repeat(40),
        },
      },
    };
    const authorityRow = {
      case_id: caseId,
      cell_id: cell.cell_id,
      behavior_id: cell.behavior_id,
      provider: cell.provider,
      scenario: cell.scenario,
      seam_id: cell.seam_id,
      adapter_id: cell.adapter_id,
      run_id: runId,
      attempt_id: attemptId,
      artifact_sha: 'a'.repeat(40),
      brain_version: '1.268.28',
      engine_version: '19.7.1',
      resource_type: 'ephemeral_run',
      resource_prefix: resourcePrefix,
      resource_id: attemptId,
      resource_ref: `${resourcePrefix}${attemptId}`,
      expires_at: '2026-07-29T00:10:00.000Z',
      case_expires_at: '2026-07-29T00:10:00.000Z',
      production_lease_expires_at: '2026-07-29T00:00:30.000Z',
      authority_expires_at: '2026-07-29T00:00:30.000Z',
      authority_observed_at: '2026-07-29T00:00:00.000Z',
      result_receipt_id:
        '55555555-5555-4555-8555-555555555555',
      provider_session_id: 'codex-session-1',
      actual_machine_id: 'xian-mac-m4',
      execution_transport: 'fleet-worker',
      remote_job_id: 'job-1',
      attempt_status: 'completed',
      receipt_worker_id: 'xian-mac-m4',
      receipt_job_id: 'job-1',
      receipt_terminal_status: 'completed',
      task_bundle_sha256:
        computeFleetAuthoritySha256(taskBundle),
      task_bundle: taskBundle,
    };
    const statements = [];
    const pool = {
      query: async (text, values = []) => {
        statements.push({ text, values });
        if (/WITH authoritative AS/i.test(text)) {
          return {
            rows: [authorityRow],
            rowCount: 1,
          };
        }
        return {
          rows: [{ generation: values[2], state: values[4] }],
          rowCount: 1,
        };
      },
    };
    const issueProtectedGrant = vi.fn(async () => ({
      grant_ref: 'not-an-opaque-grant',
      expires_at: null,
    }));
    const malformedIssuer = Object.freeze({
      ...grantIssuer(),
      issueProtectedGrant,
    });
    const ids = [
      '11111111-1111-4111-8111-111111111111',
      '66666666-6666-4666-8666-666666666666',
      '77777777-7777-4777-8777-777777777777',
    ];
    const value = coordinator(
      pool,
      malformedIssuer,
      () => ids.shift(),
    );

    await expect(value.executeCase(caseId)).rejects.toMatchObject({
      code: 'production_controller_grant_issue_invalid',
    });
    expect(issueProtectedGrant).toHaveBeenCalledWith(
      expect.objectContaining({ ttl_seconds: 30 }),
    );
    expect(statements.at(-1).values[4]).toBe('settlement_unknown');
    expect(statements.at(-1).values[8]).toBe(
      'grant_issue_invalid_unresolved',
    );
    expect(statements.at(-1).values[9]).toBe(true);
  });

  it.each([
    {
      label: 'exactly revokes a published grant before denial',
      revoke: async ({ grant_ref: value }) => ({
        grant_ref: value,
        revoked: true,
      }),
      expectedCode: 'production_controller_authority_unavailable',
      expectedState: 'blocked',
      expectedGrantRef: null,
      expectedLateRisk: false,
    },
    {
      label: 'records unknown settlement when exact revocation fails',
      revoke: async () => {
        throw new Error('fixture revoke failure');
      },
      expectedCode: 'production_controller_grant_revoke_unconfirmed',
      expectedState: 'settlement_unknown',
      expectedGrantRef:
        'kernel-equivalence-grant:55555555-5555-4555-8555-555555555555',
      expectedLateRisk: true,
    },
  ])('$label after authority revalidation fails', async ({
    revoke,
    expectedCode,
    expectedState,
    expectedGrantRef,
    expectedLateRisk,
  }) => {
    const caseId = '22222222-2222-4222-8222-222222222222';
    const runId = '33333333-3333-4333-8333-333333333333';
    const attemptId = '44444444-4444-4444-8444-444444444444';
    const grantRef =
      'kernel-equivalence-grant:55555555-5555-4555-8555-555555555555';
    const cell = plan.cells.find(({ cell_id: cellId }) => (
      cellId
        === 'KERNEL-P1-10-CONTROLLER-SESSION-ISOLATION::codex::normal'
    ));
    const resourcePrefix = cell.isolation.resource_prefix
      .replaceAll('{run_id}', runId)
      .replaceAll('{attempt_id}', attemptId);
    const taskBundle = {
      inputs: {
        workspace_spec: {
          expected_head_sha: 'a'.repeat(40),
        },
      },
    };
    const authorityRow = {
      case_id: caseId,
      cell_id: cell.cell_id,
      behavior_id: cell.behavior_id,
      provider: cell.provider,
      scenario: cell.scenario,
      seam_id: cell.seam_id,
      adapter_id: cell.adapter_id,
      run_id: runId,
      attempt_id: attemptId,
      artifact_sha: 'a'.repeat(40),
      brain_version: '1.268.28',
      engine_version: '19.7.1',
      resource_type: 'ephemeral_run',
      resource_prefix: resourcePrefix,
      resource_id: attemptId,
      resource_ref: `${resourcePrefix}${attemptId}`,
      expires_at: '2026-07-29T00:10:00.000Z',
      case_expires_at: '2026-07-29T00:10:00.000Z',
      production_lease_expires_at: '2026-07-29T00:00:30.000Z',
      authority_expires_at: '2026-07-29T00:00:30.000Z',
      authority_observed_at: '2026-07-29T00:00:00.000Z',
      result_receipt_id:
        '66666666-6666-4666-8666-666666666666',
      provider_session_id: 'codex-session-1',
      actual_machine_id: 'xian-mac-m4',
      execution_transport: 'fleet-worker',
      remote_job_id: 'job-1',
      attempt_status: 'completed',
      receipt_worker_id: 'xian-mac-m4',
      receipt_job_id: 'job-1',
      receipt_terminal_status: 'completed',
      task_bundle_sha256:
        computeFleetAuthoritySha256(taskBundle),
      task_bundle: taskBundle,
    };
    const statements = [];
    let authorityLoads = 0;
    const pool = {
      query: async (text, values = []) => {
        statements.push({ text, values });
        if (/WITH authoritative AS/i.test(text)) {
          authorityLoads += 1;
          if (authorityLoads === 3) {
            return { rows: [], rowCount: 0 };
          }
          return { rows: [authorityRow], rowCount: 1 };
        }
        return {
          rows: [{ generation: values[2], state: values[4] }],
          rowCount: 1,
        };
      },
    };
    const revokeProtectedGrant = vi.fn(revoke);
    const issuer = Object.freeze({
      ...grantIssuer(),
      issueProtectedGrant: vi.fn(async () => ({
        grant_ref: grantRef,
        expires_at: '2026-07-29T00:00:20.000Z',
      })),
      revokeProtectedGrant,
    });
    const ids = [
      '11111111-1111-4111-8111-111111111111',
      '77777777-7777-4777-8777-777777777777',
      '88888888-8888-4888-8888-888888888888',
    ];
    const value = coordinator(pool, issuer, () => ids.shift());

    await expect(value.executeCase(caseId)).rejects.toMatchObject({
      code: expectedCode,
    });
    expect(revokeProtectedGrant).toHaveBeenCalledWith({
      grant_ref: grantRef,
    });
    expect(statements.at(-1).values[4]).toBe(expectedState);
    expect(statements.at(-1).values[5]).toBe(expectedGrantRef);
    expect(statements.at(-1).values[9]).toBe(expectedLateRisk);
  });
});
