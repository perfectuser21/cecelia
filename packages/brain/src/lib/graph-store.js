/**
 * graph_edges 写库层(刀A1):按 repo 全量替换。
 * 边无自然键,upsert 会积死边(scan-api-registry 的已知缺陷,此处不复制)。
 */
import { acquireFactSnapshotLock } from './fact-snapshot-lock.js';

const BATCH = 500;

export async function replaceRepoEdges(pool, repo, edges, metadata = {}) {
  const sourceRevision = metadata.sourceRevision || 'legacy-unknown';
  const scannerVersion = metadata.scannerVersion || 'legacy';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await acquireFactSnapshotLock(client, 'graph_edges', repo);
    await client.query('DELETE FROM graph_edges WHERE repo = $1', [repo]);
    let inserted = 0;
    for (let i = 0; i < edges.length; i += BATCH) {
      const chunk = edges.slice(i, i + BATCH);
      const values = [];
      const params = [];
      chunk.forEach((e, j) => {
        const base = j * 7;
        values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`);
        params.push(
          repo, e.src_path, e.dst_path, e.edge_type, JSON.stringify(e.detail || {}),
          sourceRevision, scannerVersion,
        );
      });
      await client.query(
        `INSERT INTO graph_edges
          (repo, src_path, dst_path, edge_type, detail, source_revision, scanner_version)
         VALUES ${values.join(', ')}`,
        params
      );
      inserted += chunk.length;
    }
    await client.query('COMMIT');
    return { inserted };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
