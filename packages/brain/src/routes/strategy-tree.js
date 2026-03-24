/**
 * Strategy Tree — OKR 全链路只读视图
 *
 * GET /api/brain/strategy-tree
 *   返回完整层级树：Area → Objective → KR → Project → Scope → Initiative → Tasks
 *   每个 Initiative 携带 task rollup 统计（completed/total）
 *   每个 Task 携带 pr_title + learning_summary（来自 dev_records）
 *
 * 查询策略：8次批量查询（O(1)），在 JS 中组装树，避免 N+1
 */

/* global console */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { area_id } = req.query;

    // ─── 1. Areas ─────────────────────────────────────────────────────────────
    const areaWhere = area_id ? 'WHERE archived = false AND id = $1' : 'WHERE archived = false';
    const areaParams = area_id ? [area_id] : [];
    const { rows: areas } = await pool.query(
      `SELECT id, name, domain FROM areas ${areaWhere} ORDER BY name`,
      areaParams
    );
    if (!areas.length) return res.json({ success: true, data: [] });
    const areaIds = areas.map(a => a.id);

    // ─── 2. Objectives ────────────────────────────────────────────────────────
    const { rows: objectives } = await pool.query(
      `SELECT id, area_id, title, status, description, priority
       FROM objectives
       WHERE area_id = ANY($1) AND status != 'archived'
       ORDER BY priority DESC, created_at`,
      [areaIds]
    );
    const objIds = objectives.map(o => o.id);

    // ─── 3. Key Results ───────────────────────────────────────────────────────
    let krs = [];
    if (objIds.length) {
      const { rows } = await pool.query(
        `SELECT id, objective_id, title, status, description, priority,
                target_value, current_value, unit, progress
         FROM key_results
         WHERE objective_id = ANY($1) AND status != 'archived'
         ORDER BY priority DESC, created_at`,
        [objIds]
      );
      krs = rows;
    }
    const krIds = krs.map(k => k.id);

    // ─── 4. Projects ──────────────────────────────────────────────────────────
    let projects = [];
    if (krIds.length) {
      const { rows } = await pool.query(
        `SELECT id, kr_id, title, status, description, progress
         FROM okr_projects
         WHERE kr_id = ANY($1) AND status != 'archived'
         ORDER BY created_at`,
        [krIds]
      );
      projects = rows;
    }
    const projectIds = projects.map(p => p.id);

    // ─── 5. Scopes ────────────────────────────────────────────────────────────
    let scopes = [];
    if (projectIds.length) {
      const { rows } = await pool.query(
        `SELECT id, project_id, title, status, description, progress
         FROM okr_scopes
         WHERE project_id = ANY($1) AND status != 'archived'
         ORDER BY created_at`,
        [projectIds]
      );
      scopes = rows;
    }
    const scopeIds = scopes.map(s => s.id);

    // ─── 6. Initiatives ───────────────────────────────────────────────────────
    let initiatives = [];
    if (scopeIds.length) {
      const { rows } = await pool.query(
        `SELECT id, scope_id, title, status, description, priority, progress,
                start_date, end_date, completed_at
         FROM okr_initiatives
         WHERE scope_id = ANY($1) AND status != 'archived'
         ORDER BY priority DESC, created_at`,
        [scopeIds]
      );
      initiatives = rows;
    }
    const initiativeIds = initiatives.map(i => i.id);

    // ─── 7. Task 统计（rollup） ────────────────────────────────────────────────
    const taskStats = {};
    if (initiativeIds.length) {
      const { rows } = await pool.query(
        `SELECT
           okr_initiative_id,
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE status = 'completed') AS completed
         FROM tasks
         WHERE okr_initiative_id = ANY($1)
         GROUP BY okr_initiative_id`,
        [initiativeIds]
      );
      for (const r of rows) {
        taskStats[r.okr_initiative_id] = {
          total: parseInt(r.total, 10),
          completed: parseInt(r.completed, 10),
        };
      }
    }

    // ─── 8. Tasks（含 dev_records join） ──────────────────────────────────────
    const tasksByInitiative = {};
    if (initiativeIds.length) {
      const { rows } = await pool.query(
        `SELECT
           t.id, t.okr_initiative_id, t.title, t.status, t.task_type,
           t.priority, t.created_at, t.completed_at,
           dr.pr_title, dr.pr_url, dr.learning_summary, dr.self_score,
           dr.ci_results
         FROM tasks t
         LEFT JOIN dev_records dr ON dr.task_id = t.id
         WHERE t.okr_initiative_id = ANY($1)
         ORDER BY t.created_at DESC`,
        [initiativeIds]
      );
      for (const t of rows) {
        const key = t.okr_initiative_id;
        if (!tasksByInitiative[key]) tasksByInitiative[key] = [];
        tasksByInitiative[key].push({
          id: t.id,
          title: t.title,
          status: t.status,
          task_type: t.task_type,
          priority: t.priority,
          created_at: t.created_at,
          completed_at: t.completed_at,
          pr_title: t.pr_title,
          pr_url: t.pr_url,
          learning_summary: t.learning_summary,
          self_score: t.self_score,
          ci_results: t.ci_results,
        });
      }
    }

    // ─── 9. 组装树 ────────────────────────────────────────────────────────────

    const initiativeMap = {};
    for (const ini of initiatives) {
      const stats = taskStats[ini.id] || { total: 0, completed: 0 };
      initiativeMap[ini.id] = {
        ...ini,
        task_total: stats.total,
        task_completed: stats.completed,
        tasks: tasksByInitiative[ini.id] || [],
      };
    }

    const scopeMap = {};
    for (const scope of scopes) {
      scopeMap[scope.id] = {
        ...scope,
        initiatives: initiatives
          .filter(i => i.scope_id === scope.id)
          .map(i => initiativeMap[i.id]),
      };
    }

    const projectMap = {};
    for (const proj of projects) {
      projectMap[proj.id] = {
        ...proj,
        scopes: scopes
          .filter(s => s.project_id === proj.id)
          .map(s => scopeMap[s.id]),
      };
    }

    const krMap = {};
    for (const kr of krs) {
      krMap[kr.id] = {
        ...kr,
        projects: projects
          .filter(p => p.kr_id === kr.id)
          .map(p => projectMap[p.id]),
      };
    }

    const objMap = {};
    for (const obj of objectives) {
      objMap[obj.id] = {
        ...obj,
        key_results: krs
          .filter(k => k.objective_id === obj.id)
          .map(k => krMap[k.id]),
      };
    }

    const tree = areas.map(area => ({
      ...area,
      objectives: objectives
        .filter(o => o.area_id === area.id)
        .map(o => objMap[o.id]),
    }));

    res.json({ success: true, data: tree });
  } catch (err) {
    console.error('[strategy-tree] GET error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
