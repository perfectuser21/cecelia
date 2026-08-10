/**
 * 照相层(事实层)查询:api_registry / db_schema_registry / test_registry 三张扫描表。
 * 与账本层(system_registry,对抗流水线增量)永久分离——刀0 决策,2026-07-18。
 * spec: docs/superpowers/specs/2026-07-18-registry-photo-layer-revive-design.md
 */
import { computeFreshness } from './registry-freshness.js';

const PHOTO_TABLES = {
  api: {
    table: 'api_registry',
    columns: 'id, repo, method, path, file_path, line_number, area, description, scanned_at, source_revision, scanner_version',
    searchClause: (n1, n2) => `(path ILIKE $${n1} OR file_path ILIKE $${n2})`,
    orderBy: 'path, method',
    mapRow: (r) => ({
      id: r.id, name: `${r.method} ${r.path}`, type: 'api', status: 'active',
      location: `${r.file_path}:${r.line_number}`, description: r.description,
      area: r.area, scanned_at: r.scanned_at, last_success_at: r.scanned_at,
      repo: r.repo, source_revision: r.source_revision, scanner_version: r.scanner_version,
    }),
  },
  db_schema: {
    table: 'db_schema_registry',
    columns: 'id, repo, table_name, columns, area, scanned_at, source_revision, scanner_version',
    searchClause: (n1, n2) => `(table_name ILIKE $${n1} OR columns::text ILIKE $${n2})`,
    orderBy: 'table_name',
    mapRow: (r) => ({
      id: r.id, name: r.table_name, type: 'db_schema', status: 'active',
      location: r.area,
      description: (typeof r.columns === 'string' ? r.columns : JSON.stringify(r.columns)).slice(0, 500),
      area: r.area, scanned_at: r.scanned_at, last_success_at: r.scanned_at,
      repo: r.repo, source_revision: r.source_revision, scanner_version: r.scanner_version,
    }),
  },
  test: {
    table: 'test_registry',
    columns: 'id, repo, file_path, test_count, test_type, status, area, scanned_at, source_revision, scanner_version',
    searchClause: (n1, n2) => `(file_path ILIKE $${n1} OR test_type ILIKE $${n2})`,
    orderBy: 'file_path',
    mapRow: (r) => ({
      id: r.id, name: r.file_path, type: 'test', status: r.status || 'active',
      location: r.file_path, description: `${r.test_count} tests, ${r.test_type || 'unknown'}`,
      area: r.area, scanned_at: r.scanned_at, last_success_at: r.scanned_at,
      repo: r.repo, source_revision: r.source_revision, scanner_version: r.scanner_version,
    }),
  },
};

export function isPhotoType(type) {
  return Object.hasOwn(PHOTO_TABLES, type);
}

export async function listPhotoLayer(pool, type, {
  repo = 'cecelia', search, limit = 50, offset = 0,
} = {}) {
  const cfg = PHOTO_TABLES[type];
  const params = [repo];
  const clauses = ['repo = $1'];
  if (search) {
    const qv = `%${search}%`;
    params.push(qv, qv);
    clauses.push(cfg.searchClause(params.length - 1, params.length));
  }
  params.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT ${cfg.columns} FROM ${cfg.table} WHERE ${clauses.join(' AND ')}
     ORDER BY ${cfg.orderBy}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const { rows: fr } = await pool.query(
    `SELECT repo, scanned_at, source_revision, scanner_version
       FROM ${cfg.table}
      WHERE repo = $1
      ORDER BY scanned_at DESC
      LIMIT 1`,
    [repo],
  );
  const freshness = { repo, ...computeFreshness(fr[0] ?? null) };
  return {
    items: rows.map(cfg.mapRow),
    count: rows.length,
    repo,
    source_revision: freshness.source_revision,
    scanner_version: freshness.scanner_version,
    last_success_at: freshness.last_success_at,
    freshness,
  };
}
