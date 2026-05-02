// packages/brain/src/routes/features.js
import { Router } from 'express';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import pool from '../db.js';

const router = Router();
const __dirname = dirname(fileURLToPath(import.meta.url));

// 导出供 unit test 使用
export function buildWhereClause(query) {
  const conditions = [];
  const params = [];
  const { priority, status, smoke_status, domain, area } = query;

  if (priority)     { conditions.push(`priority = $${params.length + 1}`);     params.push(priority); }
  if (status)       { conditions.push(`status = $${params.length + 1}`);       params.push(status); }
  if (smoke_status) { conditions.push(`smoke_status = $${params.length + 1}`); params.push(smoke_status); }
  if (domain)       { conditions.push(`domain = $${params.length + 1}`);       params.push(domain); }
  if (area)         { conditions.push(`area = $${params.length + 1}`);         params.push(area); }
  if (query.smoke_cmd === 'null') { conditions.push('smoke_cmd IS NULL'); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return { where, params };
}

// POST /seed — 从 feature-ledger.yaml 批量 upsert（不覆盖 smoke_status/smoke_last_run）
// 注意：必须在 GET /:id 之前注册，否则 /seed 会被 :id 捕获
router.post('/seed', async (req, res) => {
  try {
    const yamlPath = join(__dirname, '../../../../docs/feature-ledger.yaml');
    const raw = readFileSync(yamlPath, 'utf8');
    const data = yaml.load(raw);

    let inserted = 0;
    let updated = 0;

    for (const f of data.features) {
      const { rows } = await pool.query(
        `INSERT INTO features
           (id, name, domain, area, priority, status, description, smoke_cmd,
            has_unit_test, has_integration_test, has_e2e, last_verified, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (id) DO UPDATE SET
           name                = EXCLUDED.name,
           domain              = EXCLUDED.domain,
           area                = EXCLUDED.area,
           priority            = EXCLUDED.priority,
           status              = EXCLUDED.status,
           description         = EXCLUDED.description,
           smoke_cmd           = EXCLUDED.smoke_cmd,
           has_unit_test       = EXCLUDED.has_unit_test,
           has_integration_test = EXCLUDED.has_integration_test,
           has_e2e             = EXCLUDED.has_e2e,
           last_verified       = EXCLUDED.last_verified,
           notes               = EXCLUDED.notes,
           updated_at          = NOW()
         RETURNING (xmax = 0) AS is_insert`,
        [f.id, f.name, f.domain ?? null, f.area ?? null, f.priority ?? null,
         f.status ?? 'unknown', f.description ?? null, f.smoke_cmd ?? null,
         f.has_unit_test ?? false, f.has_integration_test ?? false,
         f.has_e2e ?? false, f.last_verified ?? null, f.notes ?? null]
      );
      if (rows[0]?.is_insert) inserted++;
      else updated++;
    }

    res.json({ inserted, updated, total: data.features.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET / — 列表（支持过滤）
router.get('/', async (req, res) => {
  try {
    const { where, params } = buildWhereClause(req.query);
    const { rows } = await pool.query(
      `SELECT * FROM features ${where} ORDER BY priority, domain, id`,
      params
    );
    res.json({ features: rows, total: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /:id — 单条
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM features WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Feature not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST / — 新增
router.post('/', async (req, res) => {
  try {
    const { id, name, domain, area, priority, status, description, smoke_cmd,
            has_unit_test, has_integration_test, has_e2e, last_verified, notes } = req.body;
    if (!id || !name) return res.status(400).json({ error: 'id and name are required' });

    const { rows } = await pool.query(
      `INSERT INTO features
         (id, name, domain, area, priority, status, description, smoke_cmd,
          has_unit_test, has_integration_test, has_e2e, last_verified, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [id, name, domain ?? null, area ?? null, priority ?? null,
       status ?? 'unknown', description ?? null, smoke_cmd ?? null,
       has_unit_test ?? false, has_integration_test ?? false, has_e2e ?? false,
       last_verified ?? null, notes ?? null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Feature id already exists' });
    res.status(500).json({ error: err.message });
  }
});

// PATCH /:id — 更新（含 smoke_status 回填）
router.patch('/:id', async (req, res) => {
  try {
    const ALLOWED = ['name', 'domain', 'area', 'priority', 'status', 'description',
                     'smoke_cmd', 'smoke_status', 'smoke_last_run',
                     'has_unit_test', 'has_integration_test', 'has_e2e',
                     'last_verified', 'notes'];
    const fields = {};
    for (const key of ALLOWED) {
      if (key in req.body) fields[key] = req.body[key];
    }
    if (!Object.keys(fields).length) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    fields.updated_at = new Date().toISOString();

    const keys = Object.keys(fields);
    const vals = Object.values(fields);
    const set = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');

    const { rows } = await pool.query(
      `UPDATE features SET ${set} WHERE id = $${keys.length + 1} RETURNING *`,
      [...vals, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Feature not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
