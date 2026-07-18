/**
 * 照相层(事实层)查询:api_registry / db_schema_registry / test_registry 三张扫描表。
 * 与账本层(system_registry,对抗流水线增量)永久分离——刀0 决策,2026-07-18。
 * spec: docs/superpowers/specs/2026-07-18-registry-photo-layer-revive-design.md
 */
import { computeFreshness } from './registry-freshness.js';

const PHOTO_TABLES = {
  api: {
    table: 'api_registry',
    columns: 'id, method, path, file_path, line_number, area, description, scanned_at',
    searchClause: (n1, n2) => `(path ILIKE $${n1} OR file_path ILIKE $${n2})`,
    orderBy: 'path, method',
    mapRow: (r) => ({
      id: r.id, name: `${r.method} ${r.path}`, type: 'api', status: 'active',
      location: `${r.file_path}:${r.line_number}`, description: r.description,
      area: r.area, scanned_at: r.scanned_at,
    }),
  },
  db_schema: {
    table: 'db_schema_registry',
    columns: 'id, table_name, columns, area, scanned_at',
    searchClause: (n1, n2) => `(table_name ILIKE $${n1} OR columns::text ILIKE $${n2})`,
    orderBy: 'table_name',
    mapRow: (r) => ({
      id: r.id, name: r.table_name, type: 'db_schema', status: 'active',
      location: r.area,
      description: (typeof r.columns === 'string' ? r.columns : JSON.stringify(r.columns)).slice(0, 500),
      area: r.area, scanned_at: r.scanned_at,
    }),
  },
  test: {
    table: 'test_registry',
    columns: 'id, file_path, test_count, test_type, status, area, scanned_at',
    searchClause: (n1, n2) => `(file_path ILIKE $${n1} OR test_type ILIKE $${n2})`,
    orderBy: 'file_path',
    mapRow: (r) => ({
      id: r.id, name: r.file_path, type: 'test', status: r.status || 'active',
      location: r.file_path, description: `${r.test_count} tests, ${r.test_type || 'unknown'}`,
      area: r.area, scanned_at: r.scanned_at,
    }),
  },
};

export function isPhotoType(type) {
  return Object.hasOwn(PHOTO_TABLES, type);
}

export async function listPhotoLayer(pool, type, { search, limit = 50, offset = 0 } = {}) {
  const cfg = PHOTO_TABLES[type];
  const params = [];
  let where = '';
  if (search) {
    const qv = `%${search}%`;
    params.push(qv, qv);
    where = `WHERE ${cfg.searchClause(params.length - 1, params.length)}`;
  }
  params.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT ${cfg.columns} FROM ${cfg.table} ${where}
     ORDER BY ${cfg.orderBy}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const { rows: fr } = await pool.query(`SELECT max(scanned_at) AS latest FROM ${cfg.table}`);
  return {
    items: rows.map(cfg.mapRow),
    count: rows.length,
    freshness: computeFreshness(fr[0]?.latest ?? null),
  };
}
