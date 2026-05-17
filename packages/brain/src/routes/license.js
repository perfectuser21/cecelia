/**
 * License System 路由
 *
 * Admin（需 internalAuth）:
 *   POST   /api/brain/admin/license       — 生成 license
 *   GET    /api/brain/admin/license       — 列表查询
 *   DELETE /api/brain/admin/license/:id  — 吊销
 *
 * Agent（公开）:
 *   POST   /api/brain/license/register   — 注册机器，验证 license_key + 装机配额
 */

import { Router } from 'express';
import { randomBytes } from 'crypto';
import pool from '../db.js';
import { internalAuth } from '../middleware/internal-auth.js';

export const TIER_CONFIG = {
  basic:      { max_machines: 1,  price_cny: 3000  },
  matrix:     { max_machines: 3,  price_cny: 6000  },
  studio:     { max_machines: 10, price_cny: 15000 },
  enterprise: { max_machines: 30, price_cny: 40000 },
};

export function generateLicenseKey() {
  const hex = randomBytes(8).toString('hex').toUpperCase();
  return `CECE-${hex.slice(0,4)}-${hex.slice(4,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}`;
}

const router = Router();

// GET /api/brain/license — 状态检查 + tier 清单
router.get('/license', (_req, res) => {
  res.json({ status: 'ok', tiers: Object.keys(TIER_CONFIG) });
});

// ─────────────────────────────────────────────────────
// Admin: 生成 License
// POST /api/brain/admin/license
// Body: { tier, customer_name?, customer_email?, expires_in_days? }
// ─────────────────────────────────────────────────────
router.post('/admin/license', internalAuth, async (req, res) => {
  try {
    const { tier, customer_name, customer_email, expires_in_days = 365 } = req.body || {};

    if (!tier || !TIER_CONFIG[tier]) {
      return res.status(400).json({
        error: `tier 无效，可选：${Object.keys(TIER_CONFIG).join(', ')}`,
      });
    }

    if (typeof expires_in_days !== 'number' || expires_in_days <= 0) {
      return res.status(400).json({ error: 'expires_in_days 必须为正整数' });
    }

    const { max_machines } = TIER_CONFIG[tier];
    const license_key = generateLicenseKey();
    const expires_at = new Date(Date.now() + expires_in_days * 86_400_000);

    const { rows } = await pool.query(
      `INSERT INTO licenses (license_key, tier, max_machines, customer_name, customer_email, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [license_key, tier, max_machines, customer_name || null, customer_email || null, expires_at]
    );

    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[license] create error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────
// Admin: 查询 License 列表
// GET /api/brain/admin/license?tier=&status=&limit=&offset=
// ─────────────────────────────────────────────────────
router.get('/admin/license', internalAuth, async (req, res) => {
  try {
    const { tier, status, limit = 50, offset = 0 } = req.query;
    const conditions = [];
    const params = [];

    if (tier) {
      params.push(tier);
      conditions.push(`tier = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(parseInt(limit), parseInt(offset));

    const { rows } = await pool.query(
      `SELECT l.*,
              (SELECT COUNT(*) FROM license_machines WHERE license_id = l.id) AS machines_used
       FROM licenses l
       ${where}
       ORDER BY l.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return res.json(rows);
  } catch (err) {
    console.error('[license] list error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────
// Admin: 吊销 License
// DELETE /api/brain/admin/license/:id
// ─────────────────────────────────────────────────────
router.delete('/admin/license/:id', internalAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const { rows } = await pool.query(
      `UPDATE licenses
       SET status = 'revoked', revoked_at = NOW()
       WHERE id = $1 AND status = 'active'
       RETURNING *`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'License 不存在或已吊销' });
    }

    return res.json({ success: true, license: rows[0] });
  } catch (err) {
    console.error('[license] revoke error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────
// Agent: 注册机器
// POST /api/brain/license/register
// Body: { license_key, machine_id, machine_name? }
// ─────────────────────────────────────────────────────
router.post('/license/register', async (req, res) => {
  try {
    const { license_key, machine_id, machine_name } = req.body || {};

    if (!license_key || !machine_id) {
      return res.status(400).json({ error: '缺少必填字段：license_key, machine_id' });
    }

    // 1. 查询 license
    const { rows: licenseRows } = await pool.query(
      `SELECT * FROM licenses WHERE license_key = $1`,
      [license_key]
    );

    if (licenseRows.length === 0) {
      return res.status(404).json({ error: 'License 不存在' });
    }

    const license = licenseRows[0];

    if (license.status === 'revoked') {
      return res.status(403).json({ error: 'License 已被吊销' });
    }

    if (new Date(license.expires_at) < new Date()) {
      return res.status(403).json({ error: 'License 已过期' });
    }

    // 2. 查询当前装机数
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) AS cnt FROM license_machines WHERE license_id = $1`,
      [license.id]
    );
    const machines_used = parseInt(countRows[0].cnt);

    // 3. 检查是否已注册此机器
    const { rows: existing } = await pool.query(
      `SELECT id FROM license_machines WHERE license_id = $1 AND machine_id = $2`,
      [license.id, machine_id]
    );

    if (existing.length > 0) {
      // 已注册，仅刷新 last_seen_at
      await pool.query(
        `UPDATE license_machines
         SET last_seen_at = NOW(), machine_name = COALESCE($1, machine_name)
         WHERE license_id = $2 AND machine_id = $3`,
        [machine_name || null, license.id, machine_id]
      );

      return res.json({
        valid: true,
        tier: license.tier,
        expires_at: license.expires_at,
        machines_used,
        max_machines: license.max_machines,
        registered: false,
      });
    }

    // 4. 装机配额检查
    if (machines_used >= license.max_machines) {
      return res.status(403).json({
        error: '装机配额已满',
        machines_used,
        max_machines: license.max_machines,
      });
    }

    // 5. 注册新机器
    await pool.query(
      `INSERT INTO license_machines (license_id, machine_id, machine_name)
       VALUES ($1, $2, $3)`,
      [license.id, machine_id, machine_name || null]
    );

    return res.status(201).json({
      valid: true,
      tier: license.tier,
      expires_at: license.expires_at,
      machines_used: machines_used + 1,
      max_machines: license.max_machines,
      registered: true,
    });
  } catch (err) {
    console.error('[license] register error:', err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
