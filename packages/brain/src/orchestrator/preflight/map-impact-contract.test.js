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
});
