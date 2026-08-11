/**
 * graph_edges 写库层(刀A1):按 repo 全量替换。
 * 边无自然键,upsert 会积死边(scan-api-registry 的已知缺陷,此处不复制)。
 * 刀0扩展：支持 source_revision + scanner_version 字段
 */
const BATCH = 500;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  return value;
}

function canonicalEdges(edges) {
  return edges.map(edge => JSON.stringify([
    edge.src_path, edge.dst_path, edge.edge_type, stableValue(edge.detail || {}),
  ])).sort();
}

function immutableSnapshotError(repo, revision) {
  return Object.assign(
    new Error(`graph snapshot drift: ${repo}@${revision}`),
    { code: 'GRAPH_SNAPSHOT_IMMUTABILITY_VIOLATION' },
  );
}

export async function replaceRepoEdges(pool, repo, edges, { sourceRevision, scannerVersion } = {}) {
  const rev = sourceRevision || 'legacy-unknown';
  const ver = scannerVersion || 'legacy';
  const lockKey = `fact-snapshot:graph_edges:${repo}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey]);
    const existingVersion = await client.query(
      `SELECT row_count FROM graph_snapshot_versions
        WHERE repo = $1 AND source_revision = $2 FOR UPDATE`,
      [repo, rev],
    );
    if (existingVersion.rows.length > 0) {
      const existingEdges = await client.query(
        `SELECT src_path, dst_path, edge_type, detail
           FROM graph_edge_snapshots
          WHERE repo = $1 AND source_revision = $2`,
        [repo, rev],
      );
      if (Number(existingVersion.rows[0].row_count) !== edges.length
        || JSON.stringify(canonicalEdges(existingEdges.rows)) !== JSON.stringify(canonicalEdges(edges))) {
        throw immutableSnapshotError(repo, rev);
      }
    } else {
      await client.query(
        `INSERT INTO graph_snapshot_versions
           (repo, source_revision, scanner_version, scanned_at, row_count)
         VALUES ($1, $2, $3, NOW(), $4)`,
        [repo, rev, ver, edges.length],
      );
      for (let i = 0; i < edges.length; i += BATCH) {
        const chunk = edges.slice(i, i + BATCH);
        const values = [];
        const params = [];
        chunk.forEach((edge, index) => {
          const base = index * 6;
          values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`);
          params.push(repo, rev, edge.src_path, edge.dst_path, edge.edge_type, JSON.stringify(edge.detail || {}));
        });
        await client.query(
          `INSERT INTO graph_edge_snapshots
             (repo, source_revision, src_path, dst_path, edge_type, detail)
           VALUES ${values.join(', ')}`,
          params,
        );
      }
    }
    await client.query('DELETE FROM graph_edges WHERE repo = $1', [repo]);
    let inserted = 0;
    for (let i = 0; i < edges.length; i += BATCH) {
      const chunk = edges.slice(i, i + BATCH);
      const values = [];
      const params = [];
      chunk.forEach((e, j) => {
        const base = j * 7;
        values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`);
        params.push(repo, e.src_path, e.dst_path, e.edge_type, JSON.stringify(e.detail || {}), rev, ver);
      });
      await client.query(
        `INSERT INTO graph_edges (repo, src_path, dst_path, edge_type, detail, source_revision, scanner_version)
         VALUES ${values.join(', ')}`,
        params
      );
      inserted += chunk.length;
    }
    await client.query(
      `INSERT INTO fact_snapshot_headers (kind, repo, source_revision, scanner_version, scanned_at, row_count)
       VALUES ($1, $2, $3, $4, NOW(), $5)
       ON CONFLICT (kind, repo) DO UPDATE
         SET source_revision = EXCLUDED.source_revision,
             scanner_version = EXCLUDED.scanner_version,
             scanned_at = EXCLUDED.scanned_at,
             row_count = EXCLUDED.row_count`,
      ['graph', repo, rev, ver, inserted]
    );
    await client.query('COMMIT');
    return { inserted };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
