/**
 * Task Goals route (migrated to new OKR tables: objectives + key_results)
 *
 * GET /        — 列出目标（从 objectives + key_results 查询，UNION ALL）
 * GET /audit   — KR 进度审计：key_results current_value vs okr_initiatives 完成率
 * GET /:id     — 先查 objectives，再查 key_results
 * PATCH /:id   — 先更新 objectives，0 行受影响再更新 key_results
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

// 统一投影：将 objectives 行格式化为旧 goals 兼容格式
const OBJ_SELECT = `
  id,
  'area_okr'::text AS type,
  title,
  NULL::text AS description,
  NULL::uuid AS parent_id,
  NULL::uuid AS project_id,
  status,
  area_id,
  owner_role,
  start_date,
  end_date,
  NULL::numeric AS target_value,
  NULL::numeric AS current_value,
  NULL::text AS unit,
  metadata,
  custom_props,
  created_at,
  updated_at
`;

// 统一投影：将 key_results 行格式化为旧 goals 兼容格式
const KR_SELECT = `
  id,
  'area_kr'::text AS type,
  title,
  NULL::text AS description,
  objective_id AS parent_id,
  NULL::uuid AS project_id,
  status,
  area_id,
  owner_role,
  start_date,
  end_date,
  target_value,
  current_value,
  unit,
  metadata,
  custom_props,
  created_at,
  updated_at
`;

// GET /goals — 列出目标（UNION ALL objectives + key_results）
router.get('/', async (req, res) => {
  try {
    const { type, status, parent_id, area_id, limit, offset } = req.query;

    const objConds = [];
    const krConds = [];
    const params = [];
    let pi = 1;

    if (status) {
      objConds.push(`status = $${pi}`);
      krConds.push(`status = $${pi}`);
      params.push(status);
      pi++;
    }
    if (area_id) {
      objConds.push(`area_id = $${pi}`);
      krConds.push(`area_id = $${pi}`);
      params.push(area_id);
      pi++;
    }
    // parent_id 仅适用于 key_results（映射为 objective_id）
    if (parent_id) {
      krConds.push(`objective_id = $${pi}`);
      params.push(parent_id);
      pi++;
    }

    const objWhere = objConds.length ? 'WHERE ' + objConds.join(' AND ') : '';
    const krWhere = krConds.length ? 'WHERE ' + krConds.join(' AND ') : '';

    let innerSql;
    if (type === 'area_okr' || type === 'objective') {
      innerSql = `SELECT ${OBJ_SELECT} FROM objectives ${objWhere}`;
    } else if (type === 'area_kr' || type === 'global_kr' || type === 'kr') {
      innerSql = `SELECT ${KR_SELECT} FROM key_results ${krWhere}`;
    } else if (parent_id) {
      // 有 parent_id 时只查 key_results（objectives 无父级）
      innerSql = `SELECT ${KR_SELECT} FROM key_results ${krWhere}`;
    } else {
      innerSql = `SELECT ${OBJ_SELECT} FROM objectives ${objWhere}
                  UNION ALL
                  SELECT ${KR_SELECT} FROM key_results ${krWhere}`;
    }

    let query = `SELECT * FROM (${innerSql}) combined ORDER BY created_at DESC`;

    if (limit) {
      query += ` LIMIT $${pi++}`;
      params.push(parseInt(limit, 10));
    }
    if (offset) {
      query += ` OFFSET $${pi++}`;
      params.push(parseInt(offset, 10));
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list goals', details: err.message });
  }
});

// GET /goals/audit — KR 进度审计（新表版）
router.get('/audit', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        kr.id,
        kr.title,
        'area_kr' AS type,
        kr.status,
        CASE
          WHEN kr.target_value > 0
          THEN ROUND(kr.current_value * 100.0 / kr.target_value)::int
          ELSE 0
        END AS stated_progress,
        COUNT(oi.id) AS total_initiatives,
        COUNT(oi.id) FILTER (WHERE oi.status = 'completed') AS completed_initiatives,
        CASE
          WHEN COUNT(oi.id) = 0 THEN NULL
          ELSE ROUND(COUNT(oi.id) FILTER (WHERE oi.status = 'completed') * 100.0 / COUNT(oi.id))
        END AS actual_progress
      FROM key_results kr
      LEFT JOIN okr_projects op ON op.kr_id = kr.id
      LEFT JOIN okr_scopes os ON os.project_id = op.id
      LEFT JOIN okr_initiatives oi ON oi.scope_id = os.id
      GROUP BY kr.id, kr.title, kr.status, kr.current_value, kr.target_value
      ORDER BY (kr.current_value / NULLIF(kr.target_value, 0)) DESC NULLS LAST, kr.title
    `);

    const rows = result.rows.map(r => ({
      id: r.id,
      title: r.title,
      type: r.type,
      status: r.status,
      stated_progress: r.stated_progress !== null ? Number(r.stated_progress) : 0,
      actual_progress: r.actual_progress !== null ? Number(r.actual_progress) : null,
      total_initiatives: Number(r.total_initiatives),
      completed_initiatives: Number(r.completed_initiatives),
      discrepancy: r.actual_progress !== null
        ? (r.stated_progress !== null ? Number(r.stated_progress) : 0) - Number(r.actual_progress)
        : null,
    }));

    const summary = {
      total_goals: rows.length,
      overstated: rows.filter(r => r.discrepancy !== null && r.discrepancy > 10).length,
      no_initiatives: rows.filter(r => r.total_initiatives === 0).length,
      accurate: rows.filter(r => r.discrepancy !== null && Math.abs(r.discrepancy) <= 10).length,
    };

    res.json({ summary, goals: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to audit goals', details: err.message });
  }
});

// GET /goals/:id — 先查 objectives，再查 key_results
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  // 先查 objectives
  const objResult = await pool.query(
    `SELECT ${OBJ_SELECT} FROM objectives WHERE id = $1`,
    [id]
  );
  if (objResult.rows[0]) return res.json(objResult.rows[0]);

  // 再查 key_results
  const krResult = await pool.query(
    `SELECT ${KR_SELECT} FROM key_results WHERE id = $1`,
    [id]
  );
  if (krResult.rows[0]) return res.json(krResult.rows[0]);

  return res.status(404).json({ error: 'goal not found' });
});

// PATCH /goals/:id — 先更新 objectives，0 行受影响再更新 key_results
router.patch('/:id', async (req, res) => {
  try {
    const { title, status, area_id, owner_role, custom_props } = req.body;

    const setClauses = [];
    const params = [];
    let paramIndex = 1;

    if (title !== undefined) {
      setClauses.push(`title = $${paramIndex++}`);
      params.push(title);
    }
    if (status !== undefined) {
      setClauses.push(`status = $${paramIndex++}`);
      params.push(status);
    }
    if (area_id !== undefined) {
      setClauses.push(`area_id = $${paramIndex++}`);
      params.push(area_id);
    }
    if (owner_role !== undefined) {
      setClauses.push(`owner_role = $${paramIndex++}`);
      params.push(owner_role);
    }
    if (custom_props !== undefined) {
      setClauses.push(`custom_props = custom_props || $${paramIndex++}::jsonb`);
      params.push(JSON.stringify(custom_props));
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    setClauses.push(`updated_at = NOW()`);
    params.push(req.params.id);

    // 先尝试更新 objectives
    let result = await pool.query(
      `UPDATE objectives SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      params
    );

    if (!result.rows.length) {
      // 再尝试更新 key_results
      result = await pool.query(
        `UPDATE key_results SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
        params
      );
    }

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Goal not found', id: req.params.id });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update goal', details: err.message });
  }
});

export default router;
