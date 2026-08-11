#!/usr/bin/env node
import pg from 'pg';

const expectedRevision = process.argv[2];
const repo = process.env.SCAN_REPO || 'cecelia';
const requiredKinds = ['api', 'db_schema', 'test', 'graph'];

if (!/^[0-9a-f]{40}$/.test(expectedRevision || '')) {
  console.error('ERROR: verify-scan-batch requires a 40-hex expected revision');
  process.exit(2);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost/cecelia',
});

try {
  const { rows } = await pool.query(
    `SELECT kind, source_revision, row_count
       FROM fact_snapshot_headers
      WHERE repo = $1 AND kind = ANY($2::text[])`,
    [repo, requiredKinds],
  );
  const byKind = new Map(rows.map(row => [row.kind, row]));
  const invalidKind = requiredKinds.find(kind => (
    byKind.get(kind)?.source_revision !== expectedRevision
  ));
  if (invalidKind) {
    throw new Error(`${invalidKind} header revision mismatch`);
  }
  const graph = byKind.get('graph');
  const snapshot = await pool.query(
    `SELECT row_count FROM graph_snapshot_versions
      WHERE repo = $1 AND source_revision = $2`,
    [repo, expectedRevision],
  );
  if (snapshot.rows.length !== 1
    || Number(snapshot.rows[0].row_count) !== Number(graph.row_count)) {
    throw new Error('graph immutable snapshot missing or row_count mismatch');
  }
  console.log(`OK: scan batch locked repo=${repo} revision=${expectedRevision.slice(0, 8)}`);
} catch (error) {
  console.error(`ERROR: scan batch verification failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
