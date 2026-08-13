import { describe, expect, it, vi } from 'vitest';
import { assertMapImpactContract, ensureMapImpactPreflight } from './map-impact-contract.js';

describe('Map Impact Contract preflight', () => {
  it('accepts only fresh same-repo same-revision contracts', () => {
    const input = { repo: 'perfectuser21/cecelia', base_sha: 'abc', map: { repo: 'perfectuser21/cecelia', freshness: 'fresh', source_revision: 'abc', scanner_valid: true }, impact_contract: { status: 'active', source_revision: 'abc' } };
    expect(assertMapImpactContract(input)).toMatchObject({ impact_contract_policy: 'required' });
    expect(() => assertMapImpactContract({ ...input, map: { ...input.map, freshness: 'stale' } })).toThrow('map_stale');
    expect(() => assertMapImpactContract({ ...input, impact_contract: null })).toThrow('impact_contract_missing');
  });

  it('materializes an active contract only from fresh same-revision Map evidence', async () => {
    const baseSha = 'a'.repeat(40);
    const readMap = vi.fn(async () => ({
      manifest_digest: 'b'.repeat(64),
      projection_digest: 'c'.repeat(64),
      fact_revisions: { cecelia: baseSha },
      freshness: {
        status: 'fresh',
        repos: { cecelia: { status: 'fresh', source_revision: baseSha } },
      },
      nodes: [{ key: 'cap-router', type: 'capability', name: 'Router' }],
    }));
    const readRadius = vi.fn(async () => ({
      freshness: {
        status: 'fresh',
        repos: { cecelia: { status: 'fresh', source_revision: baseSha } },
      },
      affected_business_nodes: [{ node_key: 'cap-router', node_type: 'capability', name: 'Router' }],
      must_run_assertions: [{
        node_key: '11111111-1111-4111-8111-111111111111',
        assertion_ref: 'src/router.test.js',
        assertion_revision: 1,
      }],
    }));
    const persistContract = vi.fn(async (_db, input) => ({
      created: true,
      contract: { id: 'contract-1', ...input, status: 'active' },
    }));
    const client = {
      query: vi.fn(async () => ({ rows: [{ scope_key: 'cecelia' }] })),
    };
    const result = await ensureMapImpactPreflight(client, {
      task: { id: '22222222-2222-4222-8222-222222222222' },
      receipt: {
        repo: 'cecelia',
        change_kind: 'bugfix',
        map_scope: ['cap-router'],
        evidence: { base_sha: baseSha },
      },
    }, { readMap, readRadius, persistContract });

    expect(result.contract).toMatchObject({ status: 'active', repo: 'cecelia' });
    expect(persistContract).toHaveBeenCalledOnce();
    expect(persistContract.mock.calls[0][1].contract_body).toMatchObject({
      affected_capabilities: [{ capability_id: 'cap-router' }],
    });
  });

  it('fails before contract persistence for stale Map evidence', async () => {
    const persistContract = vi.fn();
    const client = {
      query: vi.fn(async () => ({ rows: [{ scope_key: 'cecelia' }] })),
    };
    await expect(ensureMapImpactPreflight(client, {
      task: { id: '22222222-2222-4222-8222-222222222222' },
      receipt: {
        repo: 'cecelia', change_kind: 'bugfix', map_scope: ['cap-router'],
        evidence: { base_sha: 'a'.repeat(40) },
      },
    }, {
      readMap: vi.fn(async () => ({ freshness: { status: 'unknown' } })),
      readRadius: vi.fn(),
      persistContract,
    })).rejects.toThrow('map_stale');
    expect(persistContract).not.toHaveBeenCalled();
  });

  it('creates a server-authorized recovery contract from last-known-good evidence only after stable Map failure', async () => {
    const baseSha = 'd'.repeat(40);
    const taskId = '22222222-2222-4222-8222-222222222222';
    const receiptId = '33333333-3333-4333-8333-333333333333';
    const lkgBody = {
      affected_capabilities: [{ capability_id: 'cap-map', capability_name: 'Map', impact_level: 'direct' }],
      required_assertions: [{
        assertion_id: 'src/map.test.js', command: 'npx vitest run src/map.test.js',
        covers_capability_ids: ['cap-map'],
        journey_step_link_id: '11111111-1111-4111-8111-111111111111',
        assertion_revision: 1, assertion_digest: 'e'.repeat(64),
        source_bindings: [{
          journey_step_link_id: '11111111-1111-4111-8111-111111111111',
          assertion_revision: 1, assertion_digest: 'e'.repeat(64),
        }],
      }],
    };
    const client = { query: vi.fn(async (sql) => {
      if (/FROM map_scope_repositories/.test(sql)) return { rows: [{ scope_key: 'cecelia' }] };
      if (/FROM map_recovery_contracts recovery/.test(sql)) return { rows: [] };
      if (/FROM harness_impact_contracts/.test(sql)) return { rows: [{
        id: 'lkg-impact-1', manifest_digest: 'b'.repeat(64),
        projection_digest: 'c'.repeat(64), contract_body: lkgBody,
      }] };
      if (/INSERT INTO map_recovery_contracts/.test(sql)) return { rows: [{
        id: 'recovery-1', receipt_id: receiptId, task_id: taskId, repo: 'cecelia',
        branch: 'cp-map-fix', base_sha: baseSha, reason_code: 'map_unavailable',
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        authorization_evidence: {
          authorized_by: 'brain-map-preflight', observed_reason_code: 'map_unavailable',
        },
        change_kind: 'bugfix', consumed_attempt_id: null,
      }] };
      throw new Error(`unexpected SQL: ${sql}`);
    }) };
    const persistContract = vi.fn(async (_db, input) => ({
      created: true, contract: { id: 'impact-recovery-1', status: 'active', ...input },
    }));

    const result = await ensureMapImpactPreflight(client, {
      task: {
        id: taskId,
        payload: {
          map_recovery: true,
          changed_files: ['packages/brain/src/lib/map-read-service.js'],
        },
      },
      receipt: {
        id: receiptId, task_id: taskId, repo: 'cecelia', change_kind: 'bugfix',
        map_scope: ['cap-map'], evidence: { branch: 'cp-map-fix', base_sha: baseSha },
      },
    }, {
      readMap: vi.fn(async () => { throw Object.assign(new Error('offline'), { code: 'map_unavailable' }); }),
      persistContract,
      now: new Date(),
    });

    expect(result.recovery_contract).toMatchObject({ id: 'recovery-1' });
    expect(result.contract).toMatchObject({ id: 'impact-recovery-1', status: 'active' });
    expect(persistContract.mock.calls[0][1].contract_body).toMatchObject({
      task_id: taskId,
      change_kind: 'bugfix',
      freshness_evidence: { status: 'unknown', reason_code: 'map_unavailable' },
      metadata: { map_recovery_contract_id: 'recovery-1', lkg_impact_contract_id: 'lkg-impact-1' },
    });
  });
});
