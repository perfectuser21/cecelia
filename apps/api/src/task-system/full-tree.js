/**
 * full-tree.js
 * GET /api/tasks/full-tree
 *
 * 返回完整 OKR 层级树：
 * Area → Vision → Objective → KR → Project → Scope → Initiative
 *
 * 所有数据直接从同一个 cecelia PostgreSQL DB 查询。
 */

import { Router } from 'express';
import pool from './db.js';

const router = Router();

// GET /api/tasks/full-tree
// Query params: area_id (可选，只返回指定 area)
router.get('/', async (req, res) => {
  try {
    const { area_id } = req.query;

    // ── 1. Areas ──────────────────────────────────────
    const areaWhere = area_id
      ? `WHERE a.archived = false AND a.id = $1`
      : `WHERE a.archived = false`;
    const areaParams = area_id ? [area_id] : [];

    const areasResult = await pool.query(
      `SELECT DISTINCT a.id, a.name, a.name AS title, 'active' AS status, a.domain,
              NULL::date AS start_date, NULL::date AS end_date,
              NULL::text AS description, NULL::text AS owner_role, NULL::text AS priority
       FROM areas a
       INNER JOIN objectives o ON o.area_id = a.id AND o.status != 'archived'
       ${areaWhere}
       ORDER BY a.name`,
      areaParams
    );
    const areas = areasResult.rows;
    if (areas.length === 0) return res.json([]);

    const areaIds = areas.map(a => a.id);

    // ── 2. Visions（通过 objectives 推断哪个 area 下有哪些 vision）──
    const visionsResult = await pool.query(
      `SELECT DISTINCT v.id, v.title, v.status, v.description,
              COALESCE(v.owner_role, '') AS owner_role,
              v.start_date, v.end_date,
              o_link.area_id
       FROM visions v
       JOIN objectives o_link ON o_link.vision_id = v.id
            AND o_link.area_id = ANY($1)
            AND o_link.status != 'archived'
       ORDER BY v.title`,
      [areaIds]
    );
    const visions = visionsResult.rows;
    const visionIds = [...new Set(visions.map(v => v.id))];

    // ── 3. Objectives ─────────────────────────────────
    const objectivesResult = await pool.query(
      `SELECT o.id, o.title, o.status, o.area_id, o.vision_id,
              COALESCE(o.owner_role, '') AS owner_role,
              o.start_date, o.end_date, o.description, o.priority,
              o.created_at, o.updated_at
       FROM objectives o
       WHERE o.area_id = ANY($1) AND o.status != 'archived'
       ORDER BY o.created_at DESC`,
      [areaIds]
    );
    const objectives = objectivesResult.rows;
    const objIds = objectives.map(o => o.id);

    if (objIds.length === 0) {
      return res.json(areas.map(a => ({ ...a, type: 'area', children: [] })));
    }

    // ── 4. Key Results ────────────────────────────────
    const krsResult = await pool.query(
      `SELECT kr.id, kr.title, kr.status, kr.objective_id,
              kr.current_value, kr.target_value, kr.unit,
              COALESCE(ROUND((kr.current_value::numeric / NULLIF(kr.target_value::numeric,0)) * 100), 0)::int AS progress,
              kr.area_id, kr.start_date, kr.end_date, kr.description,
              COALESCE(kr.owner_role, '') AS owner_role, kr.priority,
              kr.created_at, kr.updated_at
       FROM key_results kr
       WHERE kr.objective_id = ANY($1)
       ORDER BY kr.created_at DESC`,
      [objIds]
    );
    const krs = krsResult.rows;
    const krIds = krs.map(k => k.id);

    // ── 5. Projects ───────────────────────────────────
    let projects = [];
    let projectIds = [];
    if (krIds.length > 0) {
      const projResult = await pool.query(
        `SELECT p.id, p.title, p.status, p.kr_id, p.area_id,
                p.progress, COALESCE(p.owner_role, '') AS owner_role,
                p.start_date, p.end_date, p.description,
                p.created_at, p.updated_at
         FROM okr_projects p
         WHERE p.kr_id = ANY($1)
         ORDER BY p.created_at DESC`,
        [krIds]
      );
      projects = projResult.rows;
      projectIds = projects.map(p => p.id);
    }

    // ── 6. Scopes ─────────────────────────────────────
    let scopes = [];
    let scopeIds = [];
    if (projectIds.length > 0) {
      const scopeResult = await pool.query(
        `SELECT s.id, s.title, s.status, s.project_id,
                COALESCE(s.owner_role, '') AS owner_role,
                s.start_date, s.end_date, s.description, s.progress,
                s.created_at, s.updated_at
         FROM okr_scopes s
         WHERE s.project_id = ANY($1)
         ORDER BY s.created_at DESC`,
        [projectIds]
      );
      scopes = scopeResult.rows;
      scopeIds = scopes.map(s => s.id);
    }

    // ── 7. Initiatives ────────────────────────────────
    let initiatives = [];
    if (scopeIds.length > 0) {
      const iniResult = await pool.query(
        `SELECT i.id, i.title, i.status, i.scope_id, i.area_id,
                COALESCE(i.owner_role, '') AS owner_role,
                i.start_date, i.end_date, i.description, i.priority,
                i.created_at, i.updated_at
         FROM okr_initiatives i
         WHERE i.scope_id = ANY($1)
         ORDER BY i.created_at DESC`,
        [scopeIds]
      );
      initiatives = iniResult.rows;
    }

    // ── 8. 组装树 ──────────────────────────────────────
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

    // 将 objectives 按 (area_id, vision_id) 分组
    // key: `${area_id}::${vision_id || '__none__'}`
    const objsByAreaVision = {};
    for (const o of objectives) {
      const key = `${o.area_id}::${o.vision_id || '__none__'}`;
      if (!objsByAreaVision[key]) objsByAreaVision[key] = [];
      objsByAreaVision[key].push({
        ...o, type: 'objective',
        children: krsByObj[o.id] || [],
      });
    }

    // 将 visions 按 area_id 分组（一个 vision 可能出现在多个 area 下）
    const visionsByArea = {};
    for (const v of visions) {
      const aKey = v.area_id;
      if (!visionsByArea[aKey]) visionsByArea[aKey] = {};
      if (!visionsByArea[aKey][v.id]) {
        visionsByArea[aKey][v.id] = { ...v, type: 'vision', children: [] };
      }
    }

    // 填充 vision.children = objectives with vision_id
    for (const aId of Object.keys(visionsByArea)) {
      for (const vId of Object.keys(visionsByArea[aId])) {
        const key = `${aId}::${vId}`;
        visionsByArea[aId][vId].children = objsByAreaVision[key] || [];
      }
    }

    const tree = areas.map(a => {
      const children = [];

      // 有 vision 的 objectives → Vision 节点
      const aVisions = visionsByArea[a.id] || {};
      for (const v of Object.values(aVisions)) {
        if (v.children.length > 0) children.push(v);
      }

      // 没有 vision_id 的 objectives 直接挂 area
      const noVisionKey = `${a.id}::__none__`;
      const directObjs = objsByAreaVision[noVisionKey] || [];
      children.push(...directObjs);

      return { ...a, type: 'area', children };
    });

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
    vision: 'visions',
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
