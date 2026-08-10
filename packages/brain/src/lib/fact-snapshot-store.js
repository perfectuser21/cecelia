import { acquireFactSnapshotLock } from './fact-snapshot-lock.js';
import { upsertFactSnapshotHeader } from './fact-snapshot-header.js';

const KIND_CONFIG = {
  api: {
    table: 'api_registry',
    keys: ['method', 'path'],
    columns: ['method', 'path', 'file_path', 'line_number', 'area'],
    jsonColumns: new Set(),
  },
  db_schema: {
    table: 'db_schema_registry',
    keys: ['table_name'],
    columns: ['table_name', 'columns', 'indexes', 'foreign_keys', 'area'],
    jsonColumns: new Set(['columns', 'indexes', 'foreign_keys']),
  },
  test: {
    table: 'test_registry',
    keys: ['file_path'],
    columns: ['file_path', 'test_count', 'covered_behaviors', 'area', 'test_type'],
    jsonColumns: new Set(),
  },
};

function requireNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function validateSnapshot(kind, snapshot) {
  const config = KIND_CONFIG[kind];
  if (!config) throw new TypeError(`unsupported fact snapshot kind: ${kind}`);
  if (!snapshot || typeof snapshot !== 'object') throw new TypeError('snapshot is required');
  requireNonEmptyString(snapshot.repo, 'repo');
  requireNonEmptyString(snapshot.sourceRevision, 'sourceRevision');
  requireNonEmptyString(snapshot.scannerVersion, 'scannerVersion');
  if (!Array.isArray(snapshot.rows)) throw new TypeError('rows must be an array');
  return config;
}

function valueForColumn(row, column, config) {
  const value = row[column];
  return config.jsonColumns.has(column) ? JSON.stringify(value ?? []) : value;
}

async function upsertRows(client, config, snapshot) {
  const insertColumns = ['repo', ...config.columns, 'source_revision', 'scanner_version'];
  const factColumns = config.columns.filter((column) => !config.keys.includes(column));
  const conflictColumns = ['repo', ...config.keys];
  const updateColumns = [...factColumns, 'source_revision', 'scanner_version', 'scanned_at'];

  for (const row of snapshot.rows) {
    const params = [
      snapshot.repo,
      ...config.columns.map((column) => valueForColumn(row, column, config)),
      snapshot.sourceRevision,
      snapshot.scannerVersion,
    ];
    const placeholders = params.map((_, index) => `$${index + 1}`);
    await client.query(
      `INSERT INTO ${config.table} (${insertColumns.join(', ')}, scanned_at)
       VALUES (${placeholders.join(', ')}, NOW())
       ON CONFLICT (${conflictColumns.join(', ')}) DO UPDATE SET
         ${updateColumns.map((column) => `${column} = EXCLUDED.${column}`).join(', ')},
         updated_at = NOW()`,
      params,
    );
  }
}

async function deleteMissingRows(client, config, snapshot) {
  if (snapshot.rows.length === 0) {
    return client.query(`DELETE FROM ${config.table} WHERE repo = $1`, [snapshot.repo]);
  }

  if (config.keys.length === 1) {
    const key = config.keys[0];
    return client.query(
      `DELETE FROM ${config.table}
        WHERE repo = $1 AND NOT (${key} = ANY($2::text[]))`,
      [snapshot.repo, snapshot.rows.map((row) => row[key])],
    );
  }

  const [firstKey, secondKey] = config.keys;
  return client.query(
    `DELETE FROM ${config.table} AS existing
      WHERE existing.repo = $1
        AND NOT EXISTS (
          SELECT 1
            FROM unnest($2::text[], $3::text[]) AS snapshot(${firstKey}, ${secondKey})
           WHERE snapshot.${firstKey} = existing.${firstKey}
             AND snapshot.${secondKey} = existing.${secondKey}
        )`,
    [
      snapshot.repo,
      snapshot.rows.map((row) => row[firstKey]),
      snapshot.rows.map((row) => row[secondKey]),
    ],
  );
}

export async function replaceFactSnapshot(pool, kind, snapshot) {
  const config = validateSnapshot(kind, snapshot);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await acquireFactSnapshotLock(client, kind, snapshot.repo);
    await upsertRows(client, config, snapshot);
    const deletion = await deleteMissingRows(client, config, snapshot);
    await upsertFactSnapshotHeader(client, kind, {
      repo: snapshot.repo,
      sourceRevision: snapshot.sourceRevision,
      scannerVersion: snapshot.scannerVersion,
      rowCount: snapshot.rows.length,
    });
    await client.query('COMMIT');
    return { upserted: snapshot.rows.length, deleted: deletion.rowCount ?? 0 };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
