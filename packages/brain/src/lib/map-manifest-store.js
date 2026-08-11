import { digestMapManifest, validateMapManifest } from './map-manifest-schema.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class MapManifestError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.name = 'MapManifestError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function requireValidManifest(input) {
  const validation = validateMapManifest(input);
  if (!validation.valid) {
    throw new MapManifestError(
      'MAP_MANIFEST_INVALID',
      'Map manifest validation failed',
      422,
      validation.errors,
    );
  }
  return validation.manifest;
}

async function begin(client) {
  await client.query('BEGIN');
}

async function rollback(client) {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original transaction error.
  }
}

async function lockScope(client, scopeKey) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtext($1::text))',
    [`map-manifest:${scopeKey}`],
  );
}

async function lockSourceDecision(client, decisionId) {
  const { rows } = await client.query(
    'SELECT id FROM decisions WHERE id = $1 FOR KEY SHARE',
    [decisionId],
  );
  if (!rows[0]) {
    throw new MapManifestError(
      'MAP_MANIFEST_SOURCE_DECISION_NOT_FOUND',
      `Source decision does not exist: ${decisionId}`,
      422,
    );
  }
}

export async function submitMapManifest(pool, input) {
  const manifest = requireValidManifest(input);
  const digest = digestMapManifest(manifest);
  const client = await pool.connect();

  try {
    await begin(client);
    await lockScope(client, manifest.scope_key);
    await lockSourceDecision(client, manifest.source_decision_id);

    const existing = await client.query(
      `SELECT id, scope_key, version, source_decision_id, manifest, digest,
              status, created_at, activated_at
         FROM map_manifest_versions
        WHERE scope_key = $1 AND digest = $2`,
      [manifest.scope_key, digest],
    );
    if (existing.rows[0]) {
      await client.query('COMMIT');
      return { manifest_version: existing.rows[0], created: false };
    }

    const nextVersion = await client.query(
      `SELECT COALESCE(MAX(version), 0)::int + 1 AS version
         FROM map_manifest_versions WHERE scope_key = $1`,
      [manifest.scope_key],
    );
    const inserted = await client.query(
      `INSERT INTO map_manifest_versions
        (scope_key, version, source_decision_id, manifest, digest, status)
       VALUES ($1, $2, $3, $4::jsonb, $5, 'draft')
       RETURNING id, scope_key, version, source_decision_id, manifest, digest,
                 status, created_at, activated_at`,
      [
        manifest.scope_key,
        nextVersion.rows[0].version,
        manifest.source_decision_id,
        JSON.stringify(manifest),
        digest,
      ],
    );
    await client.query('COMMIT');
    return { manifest_version: inserted.rows[0], created: true };
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }
}

async function unavailableProjector() {
  throw new MapManifestError(
    'MAP_PROJECTOR_UNAVAILABLE',
    'Map projector is not installed; manifest remains draft',
    503,
  );
}

async function selectManifestVersion(client, id, lock = false) {
  const { rows } = await client.query(
    `SELECT id, scope_key, version, source_decision_id, manifest, digest,
            status, created_at, activated_at
       FROM map_manifest_versions
      WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [id],
  );
  return rows[0] ?? null;
}

export async function activateMapManifest(
  pool,
  id,
  { projector = unavailableProjector } = {},
) {
  if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
    throw new MapManifestError(
      'MAP_MANIFEST_ID_INVALID',
      'Map manifest version id must be a UUID',
      422,
    );
  }
  const client = await pool.connect();
  try {
    await begin(client);
    const candidate = await selectManifestVersion(client, id);
    if (!candidate) {
      throw new MapManifestError('MAP_MANIFEST_NOT_FOUND', 'Map manifest version not found', 404);
    }

    await lockScope(client, candidate.scope_key);
    const manifestVersion = await selectManifestVersion(client, id, true);
    if (!manifestVersion) {
      throw new MapManifestError('MAP_MANIFEST_NOT_FOUND', 'Map manifest version not found', 404);
    }
    if (manifestVersion.status === 'active') {
      await client.query('COMMIT');
      return { manifest_version: manifestVersion, activated: false };
    }
    if (manifestVersion.status !== 'draft') {
      throw new MapManifestError(
        'MAP_MANIFEST_STATE_CONFLICT',
        `Only draft manifests can be activated; current status is ${manifestVersion.status}`,
        409,
        { status: manifestVersion.status },
      );
    }

    await lockSourceDecision(client, manifestVersion.source_decision_id);
    await projector({ client, manifestVersion });

    await client.query(
      `UPDATE map_manifest_versions
          SET status = 'superseded'
        WHERE scope_key = $1 AND status = 'active' AND id <> $2`,
      [manifestVersion.scope_key, manifestVersion.id],
    );
    const activated = await client.query(
      `UPDATE map_manifest_versions
          SET status = 'active', activated_at = NOW()
        WHERE id = $1
        RETURNING id, scope_key, version, source_decision_id, manifest, digest,
                  status, created_at, activated_at`,
      [manifestVersion.id],
    );
    await client.query('COMMIT');
    return { manifest_version: activated.rows[0], activated: true };
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }
}
