/**
 * org-units.js — 组织真身只读端点（链 bf5088a3 棒6，决策 de1e9ba9）。
 *
 * GET /api/brain/org-units — 返回 org_units 树（company→department）+ 每个 unit 的成员计数，
 * 供以后"AI 掌握公司信息"用。只读，不接调度、不做升格执行。
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

router.get('/org-units', async (req, res) => {
  try {
    const { rows: units } = await pool.query(
      `SELECT id, unit_type, parent_id, name, leader, area_id, status,
              survival_started_at, created_at, updated_at
       FROM org_units
       ORDER BY unit_type = 'company' DESC, created_at ASC`
    );

    const { rows: memberCounts } = await pool.query(
      `SELECT org_unit_id, member_type, COUNT(*)::int AS count
       FROM org_unit_members
       GROUP BY org_unit_id, member_type`
    );

    const countsByUnit = new Map();
    for (const row of memberCounts) {
      const entry = countsByUnit.get(row.org_unit_id) || { agent: 0, human: 0 };
      entry[row.member_type] = row.count;
      countsByUnit.set(row.org_unit_id, entry);
    }

    const byId = new Map();
    for (const unit of units) {
      byId.set(unit.id, {
        ...unit,
        member_counts: countsByUnit.get(unit.id) || { agent: 0, human: 0 },
        departments: [],
      });
    }

    const roots = [];
    for (const unit of byId.values()) {
      if (unit.parent_id && byId.has(unit.parent_id)) {
        byId.get(unit.parent_id).departments.push(unit);
      } else {
        roots.push(unit);
      }
    }

    res.json({ companies: roots, generated_at: new Date().toISOString() });
  } catch (err) {
    console.error('[org-units] GET /org-units error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
