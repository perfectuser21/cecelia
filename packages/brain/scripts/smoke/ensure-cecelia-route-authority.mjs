import { readFile } from 'node:fs/promises';

import pg from 'pg';

import { activateMapManifest, submitMapManifest } from '../../src/lib/map-manifest-store.js';
import { projectMapManifest } from '../../src/lib/map-projection-store.js';

const databaseUrl = process.env.DATABASE_URL ?? process.env.DB_URL ?? (() => {
  const host = process.env.DB_HOST ?? 'localhost';
  const port = process.env.DB_PORT ?? '5432';
  const user = encodeURIComponent(process.env.DB_USER ?? 'cecelia');
  const password = encodeURIComponent(process.env.DB_PASSWORD ?? '');
  const database = process.env.DB_NAME ?? 'cecelia_test';
  return `postgresql://${user}:${password}@${host}:${port}/${database}`;
})();
const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
if (!/(_test|_scratch)$/.test(databaseName)) {
  throw new Error(`route authority fixture refuses non-test database: ${databaseName}`);
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
try {
  const manifest = JSON.parse(await readFile(
    new URL('../../config/map-manifests/cecelia.v1.json', import.meta.url),
    'utf8',
  ));
  const mapping = await pool.query(
    'SELECT scope_key FROM map_scope_repositories WHERE repo=$1',
    ['cecelia'],
  );
  if (mapping.rows[0] && mapping.rows[0].scope_key !== manifest.scope_key) {
    throw new Error(`cecelia repo already belongs to scope ${mapping.rows[0].scope_key}`);
  }
  await pool.query(
    `INSERT INTO decisions
      (id,category,topic,decision,reason,status,author,made_by,priority)
     VALUES ($1,'architecture','universal-map','activate cecelia smoke authority',
       'real smoke Work Router authority','active','cecelia','system','P1')
     ON CONFLICT (id) DO NOTHING`,
    [manifest.source_decision_id],
  );
  await pool.query(
    `INSERT INTO map_scope_repositories
      (scope_key,repo,adapter_key,adapter_config)
     VALUES ($1,'cecelia','legacy-ledger-v1','{"ledger_partition":"cecelia"}'::jsonb)
     ON CONFLICT (repo) DO NOTHING`,
    [manifest.scope_key],
  );

  const submitted = await submitMapManifest(pool, manifest);
  if (submitted.manifest_version.status === 'draft') {
    await activateMapManifest(pool, submitted.manifest_version.id);
  } else {
    const active = await pool.query(
      `SELECT id FROM map_projection_runs
        WHERE scope_key=$1 AND status='active' AND manifest_version_id=$2`,
      [manifest.scope_key, submitted.manifest_version.id],
    );
    if (!active.rows[0]) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await projectMapManifest({
          client,
          manifestVersion: submitted.manifest_version,
          mode: 'rebuild',
        });
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
  }

  const authority = await pool.query(
    `SELECT run.id
       FROM map_projection_runs AS run
       JOIN map_projection_nodes AS node ON node.run_id=run.id
      WHERE run.scope_key=$1 AND run.status='active'
        AND node.node_key='F1' AND node.node_type='capability'`,
    [manifest.scope_key],
  );
  if (!authority.rows[0]) throw new Error('active Cecelia F1 route authority was not created');
  console.log(`CECelia route authority ready: ${authority.rows[0].id}`);
} finally {
  await pool.end();
}
