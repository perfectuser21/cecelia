import { buildMapProjection, MAP_PROJECTOR_VERSION } from './map-projector.js';

export class MapProjectionStoreError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'MapProjectionStoreError';
    this.code = code;
    this.details = details;
  }
}

async function lockScope(client, lockNamespace, scopeKey) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtext($1::text))',
    [`${lockNamespace}:${scopeKey}`],
  );
}

function assertManifestVersion(manifestVersion) {
  if (!manifestVersion?.id || !manifestVersion.scope_key
    || !manifestVersion.manifest || !manifestVersion.digest) {
    throw new MapProjectionStoreError(
      'MAP_PROJECTION_MANIFEST_VERSION_INVALID',
      'Projector requires a persisted manifest version with id, scope, manifest, and digest',
    );
  }
}

async function readAuthoritativeManifest(client, manifestVersion, mode) {
  if (mode === 'activation') {
    const { rows } = await client.query(
      `SELECT id, scope_key, version, source_decision_id, manifest, digest,
              status, created_at, activated_at
         FROM map_manifest_versions
        WHERE id = $1 AND scope_key = $2 AND digest = $3
        FOR KEY SHARE`,
      [manifestVersion.id, manifestVersion.scope_key, manifestVersion.digest],
    );
    if (!rows[0] || rows[0].status !== 'draft') {
      throw new MapProjectionStoreError(
        'MAP_PROJECTION_MANIFEST_STALE',
        'Activation projection requires the authoritative draft manifest version',
        { manifest_version_id: manifestVersion.id, scope_key: manifestVersion.scope_key },
      );
    }
    return rows[0];
  }
  if (mode !== 'rebuild') {
    throw new MapProjectionStoreError(
      'MAP_PROJECTION_MODE_INVALID',
      `Unsupported projection mode: ${mode}`,
    );
  }

  const { rows } = await client.query(
    `SELECT id, scope_key, version, source_decision_id, manifest, digest,
            status, created_at, activated_at
       FROM map_manifest_versions
      WHERE scope_key = $1 AND status = 'active'
      FOR KEY SHARE`,
    [manifestVersion.scope_key],
  );
  const active = rows[0];
  if (!active || active.id !== manifestVersion.id || active.digest !== manifestVersion.digest) {
    throw new MapProjectionStoreError(
      'MAP_PROJECTION_MANIFEST_STALE',
      'Rebuild projection requires the current active manifest version',
      {
        requested_manifest_version_id: manifestVersion.id,
        active_manifest_version_id: active?.id ?? null,
        scope_key: manifestVersion.scope_key,
      },
    );
  }
  return active;
}

async function insertRun(client, manifestVersion, projection) {
  const { rows } = await client.query(
    `INSERT INTO map_projection_runs
      (scope_key, manifest_version_id, manifest_digest, fact_revisions,
       projector_version, projection_digest, status)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, 'building')
     RETURNING id`,
    [
      manifestVersion.scope_key,
      manifestVersion.id,
      manifestVersion.digest,
      JSON.stringify(projection.fact_revisions),
      projection.projector_version,
      projection.projection_digest,
    ],
  );
  if (!rows[0]?.id) {
    throw new MapProjectionStoreError(
      'MAP_PROJECTION_WRITE_INCOMPLETE',
      'Projection run insert did not return an id',
    );
  }
  return rows[0].id;
}

async function insertNodes(client, runId, nodes) {
  const result = await client.query(
    `INSERT INTO map_projection_nodes
      (run_id, node_id, node_type, node_key, name, source_refs, attributes)
     SELECT $1::uuid, item.node_id, item.node_type, item.node_key, item.name,
            item.source_refs, item.attributes
       FROM jsonb_to_recordset($2::jsonb) AS item(
         node_id text, node_type text, node_key text, name text,
         source_refs jsonb, attributes jsonb
       )`,
    [runId, JSON.stringify(nodes)],
  );
  if (result.rowCount !== nodes.length) {
    throw new MapProjectionStoreError(
      'MAP_PROJECTION_WRITE_INCOMPLETE',
      `Projection node write persisted ${result.rowCount} of ${nodes.length} rows`,
      { expected: nodes.length, actual: result.rowCount },
    );
  }
}

async function insertEdges(client, runId, edges) {
  const result = await client.query(
    `INSERT INTO map_projection_edges
      (run_id, edge_id, edge_type, edge_key, from_node_id, to_node_id, source_refs, attributes)
     SELECT $1::uuid, item.edge_id, item.edge_type, item.edge_key,
            item.from_node_id, item.to_node_id, item.source_refs, item.attributes
       FROM jsonb_to_recordset($2::jsonb) AS item(
         edge_id text, edge_type text, edge_key text, from_node_id text,
         to_node_id text, source_refs jsonb, attributes jsonb
       )`,
    [runId, JSON.stringify(edges)],
  );
  if (result.rowCount !== edges.length) {
    throw new MapProjectionStoreError(
      'MAP_PROJECTION_WRITE_INCOMPLETE',
      `Projection edge write persisted ${result.rowCount} of ${edges.length} rows`,
      { expected: edges.length, actual: result.rowCount },
    );
  }
}

async function activateRun(client, scopeKey, runId) {
  await client.query(
    `UPDATE map_projection_runs
        SET status = 'superseded'
      WHERE scope_key = $1 AND status = 'active' AND id <> $2`,
    [scopeKey, runId],
  );
  const { rows } = await client.query(
    `UPDATE map_projection_runs
        SET status = 'active', activated_at = NOW()
      WHERE id = $1 AND status = 'building'
      RETURNING id, scope_key, manifest_version_id, manifest_digest, fact_revisions,
                projector_version, projection_digest, status, error, created_at, activated_at`,
    [runId],
  );
  if (!rows[0]) {
    throw new MapProjectionStoreError(
      'MAP_PROJECTION_WRITE_INCOMPLETE',
      'Projection run could not be activated',
    );
  }
  return rows[0];
}

export async function projectMapManifest({
  client,
  manifestVersion,
  factRevisions = {},
  mode = 'rebuild',
  buildProjection = buildMapProjection,
}) {
  if (!client?.query) {
    throw new MapProjectionStoreError(
      'MAP_PROJECTION_CLIENT_INVALID',
      'Projector requires a transaction client',
    );
  }
  assertManifestVersion(manifestVersion);
  await lockScope(client, 'map-manifest', manifestVersion.scope_key);
  await lockScope(client, 'map-projection', manifestVersion.scope_key);
  const authoritativeManifest = await readAuthoritativeManifest(client, manifestVersion, mode);
  const projection = buildProjection({
    manifest: authoritativeManifest.manifest,
    manifestDigest: authoritativeManifest.digest,
    factRevisions,
  });
  if (projection.projector_version !== MAP_PROJECTOR_VERSION) {
    throw new MapProjectionStoreError(
      'MAP_PROJECTION_VERSION_INVALID',
      `Unexpected projector version: ${projection.projector_version}`,
    );
  }

  const runId = await insertRun(client, authoritativeManifest, projection);
  await insertNodes(client, runId, projection.nodes);
  await insertEdges(client, runId, projection.edges);
  const projectionRun = await activateRun(client, authoritativeManifest.scope_key, runId);
  return { projection_run: projectionRun, projection };
}
