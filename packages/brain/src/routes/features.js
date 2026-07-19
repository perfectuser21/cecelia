// packages/brain/src/routes/features.js
// 注意：这里操作的是 brain_modules 表（原名 features），追踪 Brain 自身内部意识模块的健康状态
// （tick/cortex/memory/quarantine/immune/desire/alertness 等，对应 brain-manifest.js 架构）。
// 客户 Golden Path 功能表是 journey_features，不是这里。
import { Router } from 'express';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import pool from '../db.js';
import { computeLedgerStatus } from '../lib/eleven-elements-ledger.js';

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
        `INSERT INTO brain_modules
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
      `SELECT * FROM brain_modules ${where} ORDER BY priority, domain, id`,
      params
    );
    res.json({ features: rows, total: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /ledger — 11要素账本状态（按 domain 分组，前端运维页使用）
// 必须在 /:id 之前注册，否则 Express 会把 'ledger' 当作 :id 参数
router.get('/ledger', async (req, res) => {
  try {
    const { rows: features } = await pool.query(
      `SELECT * FROM brain_modules ORDER BY priority, domain, name`
    );

    // 统计每个 feature 的 NFR 决策数（category='nfr'，target_id 关联）
    const { rows: nfrDecisions } = await pool.query(
      `SELECT target_id, COUNT(*) AS cnt
         FROM decisions
        WHERE category = 'nfr' AND target_id IS NOT NULL
        GROUP BY target_id`
    );
    const nfrMap = Object.fromEntries(nfrDecisions.map(d => [d.target_id, parseInt(d.cnt)]));

    // 统计 invariant 决策
    const { rows: invDecisions } = await pool.query(
      `SELECT target_id, COUNT(*) AS cnt
         FROM decisions
        WHERE (category = 'invariant' OR topic ILIKE '%铁律%' OR topic ILIKE '%invariant%')
          AND target_id IS NOT NULL
        GROUP BY target_id`
    );
    const invMap = Object.fromEntries(invDecisions.map(d => [d.target_id, parseInt(d.cnt)]));

    const now = Date.now();

    // 按 domain 分组
    const grouped = {};
    for (const f of features) {
      const domain = f.domain || '(未分类)';
      if (!grouped[domain]) grouped[domain] = [];
      grouped[domain].push({
        ...f,
        ledger: computeLedgerStatus(f, nfrMap, invMap, now),
      });
    }

    res.json({
      domains: Object.entries(grouped).map(([domain, items]) => ({ domain, items })),
      total: features.length,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[features] GET /ledger error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /:id — 单条
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM brain_modules WHERE id = $1', [req.params.id]);
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
      `INSERT INTO brain_modules
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
      `UPDATE brain_modules SET ${set} WHERE id = $${keys.length + 1} RETURNING *`,
      [...vals, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Feature not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
