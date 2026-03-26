/**
 * full-tree.js
 * GET /api/tasks/full-tree
 *
 * 返回完整 OKR 层级树：
 * Area → Objective → KR → Project → Scope → Initiative
 *
 * 所有数据直接从同一个 cecelia PostgreSQL DB 查询。
 */

import { Router } from 'express';
import pool from './db.js';

const router = Router();

// GET /api/tasks/full-tree
// Query params: area_id (可选，只返回指定 area), status (可选，过滤 active/cancelled 等)
router.get('/', async (req, res) => {
  try {
    const { area_id } = req.query;

    // ── 1. Areas（只取有 objectives 挂载的 area，避免重复/空 area 干扰）──
    const areaWhere = area_id
      ? `WHERE a.archived = false AND a.id = $1`
      : `WHERE a.archived = false`;
    const areaParams = area_id ? [area_id] : [];

    const areasResult = await pool.query(
      `SELECT DISTINCT a.id, a.name, a.domain
       FROM areas a
       INNER JOIN objectives o ON o.area_id = a.id
       ${areaWhere}
       ORDER BY a.name`,
      areaParams
    );
    const areas = areasResult.rows;
    if (areas.length === 0) return res.json([]);

    const areaIds = areas.map(a => a.id);

    // ── 2. Objectives ─────────────────────────────────
    const objectivesResult = await pool.query(
      `SELECT o.id, o.title, o.status, o.area_id,
              COALESCE(o.owner_role, '') AS owner_role,
              o.created_at, o.updated_at
       FROM objectives o
       WHERE o.area_id = ANY($1)
       ORDER BY o.created_at DESC`,
      [areaIds]
    );
    const objectives = objectivesResult.rows;
    const objIds = objectives.map(o => o.id);

    if (objIds.length === 0) {
      return res.json(areas.map(a => ({ ...a, type: 'area', children: [] })));
    }

    // ── 3. Key Results ────────────────────────────────
    const krsResult = await pool.query(
      `SELECT kr.id, kr.title, kr.status, kr.objective_id,
              kr.current_value, kr.target_value, kr.unit,
              COALESCE(ROUND((kr.current_value::numeric / NULLIF(kr.target_value::numeric,0)) * 100), 0)::int AS progress,
              kr.area_id, kr.created_at, kr.updated_at
       FROM key_results kr
       WHERE kr.objective_id = ANY($1)
       ORDER BY kr.created_at DESC`,
      [objIds]
    );
    const krs = krsResult.rows;
    const krIds = krs.map(k => k.id);

    // ── 4. Projects ───────────────────────────────────
    let projects = [];
    let projectIds = [];
    if (krIds.length > 0) {
      const projResult = await pool.query(
        `SELECT p.id, p.title, p.status, p.kr_id, p.area_id,
                p.progress, p.owner_role, p.created_at, p.updated_at
         FROM okr_projects p
         WHERE p.kr_id = ANY($1)
         ORDER BY p.created_at DESC`,
        [krIds]
      );
      projects = projResult.rows;
      projectIds = projects.map(p => p.id);
    }

    // ── 5. Scopes ─────────────────────────────────────
    let scopes = [];
    let scopeIds = [];
    if (projectIds.length > 0) {
      const scopeResult = await pool.query(
        `SELECT s.id, s.title, s.status, s.project_id, s.created_at, s.updated_at
         FROM okr_scopes s
         WHERE s.project_id = ANY($1)
         ORDER BY s.created_at DESC`,
        [projectIds]
      );
      scopes = scopeResult.rows;
      scopeIds = scopes.map(s => s.id);
    }

    // ── 6. Initiatives ────────────────────────────────
    let initiatives = [];
    if (scopeIds.length > 0) {
      const iniResult = await pool.query(
        `SELECT i.id, i.title, i.status, i.scope_id, i.area_id,
                i.owner_role, i.created_at, i.updated_at
         FROM okr_initiatives i
         WHERE i.scope_id = ANY($1)
         ORDER BY i.created_at DESC`,
        [scopeIds]
      );
      initiatives = iniResult.rows;
    }

    // ── 7. 组装树 ──────────────────────────────────────
    const iniByScope = {};
    for (const i of initiatives) {
      if (!iniByScope[i.scope_id]) iniByScope[i.scope_id] = [];
      iniByScope[i.scope_id].push({ ...i, type: 'initiative', children: [] });
    }

    const scopesByProject = {};
    for (const s of scopes) {
      if (!scopesByProject[s.project_id]) scopesByProject[s.project_id] = [];
      scopesByProject[s.project_id].push({
        ...s, type: 'scope',
        children: iniByScope[s.id] || [],
      });
    }

    const projByKr = {};
    for (const p of projects) {
      if (!projByKr[p.kr_id]) projByKr[p.kr_id] = [];
      projByKr[p.kr_id].push({
        ...p, type: 'project',
        children: scopesByProject[p.id] || [],
      });
    }

    const krsByObj = {};
    for (const k of krs) {
      if (!krsByObj[k.objective_id]) krsByObj[k.objective_id] = [];
      krsByObj[k.objective_id].push({
        ...k, type: 'kr',
        children: projByKr[k.id] || [],
      });
    }

    const objsByArea = {};
    for (const o of objectives) {
      if (!objsByArea[o.area_id]) objsByArea[o.area_id] = [];
      objsByArea[o.area_id].push({
        ...o, type: 'objective',
        children: krsByObj[o.id] || [],
      });
    }

    const tree = areas.map(a => ({
      ...a, type: 'area',
      children: objsByArea[a.id] || [],
    }));

    res.json(tree);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load full tree', details: err.message });
  }
});

// PATCH /api/tasks/full-tree/:nodeType/:id — inline 编辑（status/title）
router.patch('/:nodeType/:id', async (req, res) => {
  const { nodeType, id } = req.params;
  const { status, title } = req.body;

  const TABLE_MAP = {
    objective: 'objectives',
    kr: 'key_results',
    project: 'okr_projects',
    scope: 'okr_scopes',
    initiative: 'okr_initiatives',
  };

  const table = TABLE_MAP[nodeType];
  if (!table) return res.status(400).json({ error: `Unknown node type: ${nodeType}` });

  const updates = [];
  const params = [];
  let idx = 1;
  if (title !== undefined) { updates.push(`title = $${idx++}`); params.push(title); }
  if (status !== undefined) { updates.push(`status = $${idx++}`); params.push(status); }
  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
  updates.push('updated_at = NOW()');
  params.push(id);

  try {
    const result = await pool.query(
      `UPDATE ${table} SET ${updates.join(', ')} WHERE id = $${idx} RETURNING id, title, status, updated_at`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update', details: err.message });
  }
});

export default router;
