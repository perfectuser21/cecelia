const SNAPSHOT_KINDS = new Set(['api', 'db_schema', 'test', 'graph']);

export async function upsertFactSnapshotHeader(client, kind, {
  repo, sourceRevision, scannerVersion, rowCount,
}) {
  if (!SNAPSHOT_KINDS.has(kind)) throw new TypeError(`unsupported snapshot header kind: ${kind}`);
  return client.query(
    `INSERT INTO fact_snapshot_headers
       (kind, repo, source_revision, scanner_version, scanned_at, row_count)
     VALUES ($1, $2, $3, $4, NOW(), $5)
     ON CONFLICT (kind, repo) DO UPDATE SET
       source_revision = EXCLUDED.source_revision,
       scanner_version = EXCLUDED.scanner_version,
       scanned_at = EXCLUDED.scanned_at,
       row_count = EXCLUDED.row_count`,
    [kind, repo, sourceRevision, scannerVersion, rowCount],
  );
}

export async function readFactSnapshotHeader(client, kind, repo) {
  const { rows } = await client.query(
    `SELECT kind, repo, source_revision, scanner_version, scanned_at, row_count
       FROM fact_snapshot_headers
      WHERE kind = $1 AND repo = $2`,
    [kind, repo],
  );
  return rows[0] ?? null;
}
