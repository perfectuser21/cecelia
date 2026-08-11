import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pool from '../../db.js';
import { resolveImpactRadius } from '../../map/radius.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describePg = testDatabaseUrl ? describe : describe.skip;
const headRevision = 'b'.repeat(40);
const manifestDigest = '1'.repeat(64);
const projectionDigest = '2'.repeat(64);
const capabilityJourneyId = 'e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29';
const changedFile = 'packages/brain/src/routes/map.js';
const assertionRef = 'packages/brain/src/impact-contract/__tests__/diff-gate.test.js';

describePg('Map radius × Impact Contract [PostgreSQL]', () => {
  let client;
  let linkId;

  beforeAll(async () => {
    client = await pool.connect();
    await client.query('BEGIN');
    const featureId = randomUUID();
    const stepId = randomUUID();
    linkId = randomUUID();
    await client.query(
      `INSERT INTO journey_steps (id, journey_id, name, step_number, status)
       VALUES ($1, $2, $3, $4, 'planned')`,
      [stepId, capabilityJourneyId, `map-radius-${process.pid}`, 900_000 + (process.pid % 90_000)],
    );
    await client.query(
      `INSERT INTO journey_features (
         id, journey_id, step_id, name, status, unit_test_path
       ) VALUES ($1, $2, $3, 'Impact radius fixture', 'building', $4)`,
      [featureId, capabilityJourneyId, stepId, assertionRef],
    );
    await client.query(
      `INSERT INTO journey_step_links (
         id, journey_id, step_id, cell_kind, cell_key, cell_status,
         feature_id, assertion_ref, status
       ) VALUES ($1, $2, $3, 'capability', 'F1', 'green', $4, $5, 'planned')`,
      [linkId, capabilityJourneyId, stepId, featureId, assertionRef],
    );
    await client.query(
      `INSERT INTO graph_edges (
         repo, src_path, dst_path, edge_type, source_revision, scanner_version, scanned_at
       ) VALUES ('cecelia', $1, $2, 'import', $3, 'integration-test', NOW())`,
      [assertionRef, changedFile, headRevision],
    );
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK');
      client.release();
    }
    await pool.end();
  });

  function dependencies(revision = headRevision) {
    return {
      db: client,
      activeManifest: async () => ({ version: 1, digest: manifestDigest }),
      activeProjection: async () => ({
        manifest_digest: manifestDigest,
        projection_digest: projectionDigest,
        fact_revisions: { cecelia: revision },
      }),
      factHealth: async () => ({ overall: 'fresh' }),
    };
  }

  it('把真实 graph anchor 投影成 revision-locked capability 与 assertion', async () => {
    const result = await resolveImpactRadius({
      repo: 'perfectuser21/cecelia',
      base_revision: 'a'.repeat(40),
      head_revision: headRevision,
      changed_files: [changedFile],
    }, dependencies());

    expect(result).toMatchObject({
      scope_key: 'cecelia',
      manifest_digest: manifestDigest,
      projection_digest: projectionDigest,
      fact_revisions: { 'perfectuser21/cecelia': headRevision },
      freshness: { status: 'fresh', reason_code: null },
      affected_nodes: [{ capability_id: 'F1', owner: 'F1' }],
      required_assertions: [{
        assertion_id: assertionRef,
        journey_step_link_id: linkId,
        assertion_revision: 1,
        covers_capability_ids: ['F1'],
      }],
    });
  });

  it('未归位文件与旧 projection revision 都不能被解释为空影响', async () => {
    const unclaimed = await resolveImpactRadius({
      repo: 'perfectuser21/cecelia',
      head_revision: headRevision,
      changed_files: ['unclaimed/new-module.js'],
    }, dependencies());
    expect(unclaimed.freshness).toMatchObject({
      status: 'unknown', reason_code: 'impact_anchor_missing',
    });
    expect(unclaimed.unclaimed_files).toEqual(['unclaimed/new-module.js']);

    const stale = await resolveImpactRadius({
      repo: 'perfectuser21/cecelia',
      head_revision: headRevision,
      changed_files: [],
    }, dependencies('a'.repeat(40)));
    expect(stale.freshness).toMatchObject({
      status: 'stale', reason_code: 'projection_revision_mismatch',
    });

    const mismatchedManifest = dependencies();
    mismatchedManifest.activeProjection = async () => ({
      manifest_digest: '3'.repeat(64),
      projection_digest: projectionDigest,
      fact_revisions: { cecelia: headRevision },
    });
    const splitBrain = await resolveImpactRadius({
      repo: 'perfectuser21/cecelia',
      head_revision: headRevision,
      changed_files: [],
    }, mismatchedManifest);
    expect(splitBrain.freshness).toMatchObject({
      status: 'stale', reason_code: 'manifest_projection_mismatch',
    });
  });
});
