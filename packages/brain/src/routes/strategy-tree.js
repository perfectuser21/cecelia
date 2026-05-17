/**
 * Strategy Tree API
 * 路由: GET /api/brain/strategy-tree
 *
 * 返回完整 OKR 层级树：Area → Objective → KR → Project → Scope → Initiative → Tasks
 * 每层带 total_tasks / completed_tasks / progress rollup
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

function calcProgress(completed, total) {
  if (!total || total === 0) return 0;
  return Math.round((completed / total) * 100);
}

router.get('/', async (req, res) => {
  try {
    const areasResult = await pool.query(
      'SELECT id, name, description, status FROM areas ORDER BY name'
    );
    const areas = areasResult.rows;

    const objectivesResult = await pool.query(
      "SELECT id, title, description, status, area_id FROM objectives WHERE status != 'archived' ORDER BY created_at"
    );
    const objectivesByArea = {};
    for (const obj of objectivesResult.rows) {
      if (!objectivesByArea[obj.area_id]) objectivesByArea[obj.area_id] = [];
      objectivesByArea[obj.area_id].push(obj);
    }

    const krsResult = await pool.query(
      "SELECT id, title, description, status, objective_id, current_value, target_value FROM key_results WHERE status != 'archived' ORDER BY created_at"
    );
    const krsByObjective = {};
    for (const kr of krsResult.rows) {
      if (!krsByObjective[kr.objective_id]) krsByObjective[kr.objective_id] = [];
      krsByObjective[kr.objective_id].push(kr);
    }

    const projectsResult = await pool.query(
      "SELECT id, title, description, status, kr_id FROM okr_projects WHERE status != 'archived' ORDER BY created_at"
    );
    const projectsByKr = {};
    for (const proj of projectsResult.rows) {
      if (!projectsByKr[proj.kr_id]) projectsByKr[proj.kr_id] = [];
      projectsByKr[proj.kr_id].push(proj);
    }

    const scopesResult = await pool.query(
      "SELECT id, title, description, status, project_id FROM okr_scopes WHERE status != 'archived' ORDER BY created_at"
    );
    const scopesByProject = {};
    for (const scope of scopesResult.rows) {
      if (!scopesByProject[scope.project_id]) scopesByProject[scope.project_id] = [];
      scopesByProject[scope.project_id].push(scope);
    }

    const initiativesResult = await pool.query(
      'SELECT id, title, description, status, scope_id FROM okr_initiatives ORDER BY created_at'
    );
    const initiativesByScope = {};
    for (const init of initiativesResult.rows) {
      if (!initiativesByScope[init.scope_id]) initiativesByScope[init.scope_id] = [];
      initiativesByScope[init.scope_id].push(init);
    }

    const tasksResult = await pool.query(
      `SELECT id, title, status, branch, pr_url, pr_title, learning_summary, initiative_id
       FROM tasks WHERE initiative_id IS NOT NULL ORDER BY created_at`
    );
    const tasksByInitiative = {};
    for (const task of tasksResult.rows) {
      if (!tasksByInitiative[task.initiative_id]) tasksByInitiative[task.initiative_id] = [];
      tasksByInitiative[task.initiative_id].push(task);
    }

    const completedStatuses = new Set(['done', 'completed', 'merged', 'shipped']);

    const builtInitiatives = {};
    for (const init of initiativesResult.rows) {
      const tasks = (tasksByInitiative[init.id] || []).map(t => ({
        id: t.id, title: t.title, status: t.status,
        branch: t.branch, pr_url: t.pr_url,
        pr_title: t.pr_title, learning_summary: t.learning_summary,
      }));
      const total_tasks = tasks.length;
      const completed_tasks = tasks.filter(t => completedStatuses.has(t.status)).length;
      builtInitiatives[init.id] = {
        ...init, tasks, total_tasks, completed_tasks,
        progress: calcProgress(completed_tasks, total_tasks),
      };
    }

    const builtScopes = {};
    for (const scope of scopesResult.rows) {
      const initiatives = (initiativesByScope[scope.id] || []).map(
        i => builtInitiatives[i.id] || { ...i, tasks: [], total_tasks: 0, completed_tasks: 0, progress: 0 }
      );
      const total_tasks = initiatives.reduce((s, i) => s + i.total_tasks, 0);
      const completed_tasks = initiatives.reduce((s, i) => s + i.completed_tasks, 0);
      builtScopes[scope.id] = {
        ...scope, initiatives, total_tasks, completed_tasks,
        progress: calcProgress(completed_tasks, total_tasks),
      };
    }

    const builtProjects = {};
    for (const proj of projectsResult.rows) {
      const scopes = (scopesByProject[proj.id] || []).map(
        s => builtScopes[s.id] || { ...s, initiatives: [], total_tasks: 0, completed_tasks: 0, progress: 0 }
      );
      const total_tasks = scopes.reduce((s, sc) => s + sc.total_tasks, 0);
      const completed_tasks = scopes.reduce((s, sc) => s + sc.completed_tasks, 0);
      builtProjects[proj.id] = {
        ...proj, scopes, total_tasks, completed_tasks,
        progress: calcProgress(completed_tasks, total_tasks),
      };
    }

    const builtKRs = {};
    for (const kr of krsResult.rows) {
      const projects = (projectsByKr[kr.id] || []).map(
        p => builtProjects[p.id] || { ...p, scopes: [], total_tasks: 0, completed_tasks: 0, progress: 0 }
      );
      const total_tasks = projects.reduce((s, p) => s + p.total_tasks, 0);
      const completed_tasks = projects.reduce((s, p) => s + p.completed_tasks, 0);
      builtKRs[kr.id] = {
        ...kr, projects, total_tasks, completed_tasks,
        progress: calcProgress(completed_tasks, total_tasks),
      };
    }

    const builtObjectives = {};
    for (const obj of objectivesResult.rows) {
      const key_results = (krsByObjective[obj.id] || []).map(
        kr => builtKRs[kr.id] || { ...kr, projects: [], total_tasks: 0, completed_tasks: 0, progress: 0 }
      );
      const total_tasks = key_results.reduce((s, kr) => s + kr.total_tasks, 0);
      const completed_tasks = key_results.reduce((s, kr) => s + kr.completed_tasks, 0);
      builtObjectives[obj.id] = {
        ...obj, key_results, total_tasks, completed_tasks,
        progress: calcProgress(completed_tasks, total_tasks),
      };
    }

    const builtAreas = areas.map(area => {
      const objectives = (objectivesByArea[area.id] || []).map(
        obj => builtObjectives[obj.id] || { ...obj, key_results: [], total_tasks: 0, completed_tasks: 0, progress: 0 }
      );
      const total_tasks = objectives.reduce((s, obj) => s + obj.total_tasks, 0);
      const completed_tasks = objectives.reduce((s, obj) => s + obj.completed_tasks, 0);
      return {
        ...area, objectives, total_tasks, completed_tasks,
        progress: calcProgress(completed_tasks, total_tasks),
      };
    });

    res.json({ success: true, areas: builtAreas });
  } catch (err) {
    console.error('[strategy-tree] error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
