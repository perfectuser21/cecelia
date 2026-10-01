/**
 * OKR 层级 CRUD API
 * 路由: /api/brain/okr/*
 *
 * 棒4（决策 ee4842a6/3feeae3e）起：scope/initiative 层退役，GTD 轴只剩
 * Vision → Objective → KeyResult → Project → Task。/scopes、/initiatives 写操作
 * 一律 410 layer_retired（只读历史）；/projects 复用 routes/task-projects.js，
 * 读写真身表 projects（与 /api/brain/projects 同源）。Task 层由现有 tasks 表/路由处理。
 *
 * 表: visions / objectives / key_results / projects（真身）/ okr_scopes（冻结只读）/
 *     okr_initiatives（冻结只读）/ okr_projects（冻结只读，migration 499 写保护）
 */

import { Router } from 'express';
import pool from '../db.js';
import { computeProgress } from '../advancement-progress.js';
import taskProjectsRoutes from './task-projects.js';
import { getProjectsForKrBatch } from '../project-progress.js';
import { recalculateKrProgress } from '../lib/kr-recalculate-progress.js';

const router = Router();

// scope/initiative 层退役（决策 ee4842a6/3feeae3e，接力棒链 2afa6d69 棒4）：
// 写操作统一 410，body 格式与 migration 499 的 DB trigger 报错口径对齐。
function retiredLayerWrite(req, res) {
  res.status(410).json({ error: 'layer_retired', decision: 'ee4842a6' });
}

// ─── 通用 CRUD 工厂函数 ─────────────────────────────────────────────────────

/**
 * 为指定表生成标准 CRUD 路由
 * @param {Router} r - Express Router
 * @param {string} prefix - 路由前缀（如 '/visions'）
 * @param {string} table - 表名（如 'visions'）
 * @param {string|null} parentField - 父级外键字段名（如 'vision_id'），可为 null
 * @param {{ writesRetired?: boolean }} [opts] - writesRetired=true 时只挂 GET（只读历史），
 *   POST/PATCH/DELETE 一律 410 layer_retired（决策 ee4842a6）
 */
function mountCrud(r, prefix, table, parentField, opts = {}) {
  const { writesRetired = false } = opts;
  // GET /prefix - 列表
  r.get(prefix, async (req, res) => {
    try {
      const { status, area_id, limit = 100, offset = 0 } = req.query;
      const conditions = [];
      const params = [];

      if (status) {
        params.push(status);
        conditions.push(`status = $${params.length}`);
      }
      if (area_id) {
        params.push(area_id);
        conditions.push(`area_id = $${params.length}`);
      }
      if (parentField && req.query[parentField]) {
        params.push(req.query[parentField]);
        conditions.push(`${parentField} = $${params.length}`);
      }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const countResult = await pool.query(
        `SELECT COUNT(*) FROM ${table} ${where}`,
        params
      );
      params.push(parseInt(limit), parseInt(offset));
      const limitIdx = params.length - 1;
      const offsetIdx = params.length;

      const result = await pool.query(
        `SELECT * FROM ${table} ${where} ORDER BY created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        params
      );
      res.json({ success: true, items: result.rows, total: parseInt(countResult.rows[0].count) });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /prefix/:id - 单条
  r.get(`${prefix}/:id`, async (req, res) => {
    try {
      const result = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [req.params.id]);
      if (!result.rows.length) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true, item: result.rows[0] });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /prefix - 创建（写退役层直接 410，不查库）
  if (writesRetired) {
    r.post(prefix, retiredLayerWrite);
    r.patch(`${prefix}/:id`, retiredLayerWrite);
    r.delete(`${prefix}/:id`, retiredLayerWrite);
    return;
  }

  r.post(prefix, async (req, res) => {
    try {
      const { title } = req.body;
      if (!title) return res.status(400).json({ success: false, error: 'title is required' });

      const allowed = [
        'title', 'status', 'area_id', 'owner_role', 'start_date', 'end_date',
        'metadata', 'custom_props', 'target_value', 'current_value', 'unit',
      ];
      if (parentField) allowed.push(parentField);

      const fields = [];
      const values = [];
      for (const key of allowed) {
        if (key in req.body && req.body[key] !== null && req.body[key] !== undefined) {
          fields.push(key);
          values.push(req.body[key]);
        }
      }

      const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
      const result = await pool.query(
        `INSERT INTO ${table} (${fields.join(', ')}) VALUES (${placeholders}) RETURNING *`,
        values
      );
      res.status(201).json({ success: true, item: result.rows[0] });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // PATCH /prefix/:id - 更新
  r.patch(`${prefix}/:id`, async (req, res) => {
    try {
      const { id } = req.params;
      const allowed = [
        'title', 'status', 'area_id', 'owner_role', 'start_date', 'end_date',
        'metadata', 'custom_props', 'target_value', 'current_value', 'unit',
      ];
      if (parentField) allowed.push(parentField);

      const updates = [];
      const values = [];
      for (const key of allowed) {
        if (key in req.body) {
          values.push(req.body[key]);
          updates.push(`${key} = $${values.length}`);
        }
      }
      if (!updates.length) return res.status(400).json({ success: false, error: 'No fields to update' });

      values.push(new Date(), id);
      const result = await pool.query(
        `UPDATE ${table} SET ${updates.join(', ')}, updated_at = $${values.length - 1} WHERE id = $${values.length} RETURNING *`,
        values
      );
      if (!result.rows.length) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true, item: result.rows[0] });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // DELETE /prefix/:id - 软删除（status = 'archived'）
  r.delete(`${prefix}/:id`, async (req, res) => {
    try {
      const result = await pool.query(
        `UPDATE ${table} SET status = 'archived', updated_at = now() WHERE id = $1 RETURNING id`,
        [req.params.id]
      );
      if (!result.rows.length) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
}

// ─── 挂载各层 CRUD ───────────────────────────────────────────────────────────

mountCrud(router, '/visions', 'visions', null);
mountCrud(router, '/objectives', 'objectives', 'vision_id');
mountCrud(router, '/key-results', 'key_results', 'objective_id');
// 棒4（决策 ee4842a6/3feeae3e）：scope/initiative 层退役，okr_scopes.project_id /
// okr_initiatives.scope_id 原本挡着 /projects 改指真身表（指向 projects 会导致
// POST /scopes、/initiatives 的 FK 违反 23503）——现在 /scopes、/initiatives 的
// 写操作直接 410，不会再触发那条 FK 校验，改指真身表安全。/projects 复用
// routes/task-projects.js 同一套 handler（与 /api/brain/projects 完全同源，
// 读到同一行）；migration 499 已给 okr_projects 加写保护 trigger，新 Project
// 一律进 projects 表。okr_projects.title/okr_scopes/okr_initiatives 表和历史
// 数据原样保留，只读（mountCrud 的 GET 依旧指向旧表，见下方两行）。
router.use('/projects', taskProjectsRoutes);
mountCrud(router, '/scopes', 'okr_scopes', 'project_id', { writesRetired: true });
mountCrud(router, '/initiatives', 'okr_initiatives', 'scope_id', { writesRetired: true });

// ─── 层级树状查询 ─────────────────────────────────────────────────────────────

/**
 * GET /api/brain/okr/tree?vision_id=xxx
 * 返回完整 OKR 树：Vision → Objectives → KRs → Projects → Scopes → Initiatives → Tasks
 */
router.get('/tree', async (req, res) => {
  try {
    const { vision_id } = req.query;

    const visionRows = vision_id
      ? (await pool.query('SELECT * FROM visions WHERE id = $1', [vision_id])).rows
      : (await pool.query("SELECT * FROM visions WHERE status != 'archived' ORDER BY created_at DESC")).rows;

    const result = await Promise.all(visionRows.map(async (vision) => {
      const objectives = (await pool.query(
        "SELECT * FROM objectives WHERE vision_id = $1 AND status != 'archived' ORDER BY created_at",
        [vision.id]
      )).rows;

      const objectivesWithKRs = await Promise.all(objectives.map(async (obj) => {
        const krs = (await pool.query(
          "SELECT * FROM key_results WHERE objective_id = $1 AND status != 'archived' ORDER BY created_at",
          [obj.id]
        )).rows;

        // 批量查询所有 KR 下的 projects（棒4起真身表 projects；name AS title 兼容旧读方，
        // scope/initiative 历史行的 project_id 仍是 okr_projects.id——与 projects.id 因
        // migration 497/499 的同 id 搬家而对齐，下面按 id 关联不受影响）
        const krIds = krs.map(kr => kr.id);
        const projectsByKr = {};
        if (krIds.length > 0) {
          const projectRows = (await pool.query(
            `SELECT *, name AS title FROM projects WHERE kr_id = ANY($1) AND status != 'archived' ORDER BY created_at`,
            [krIds]
          )).rows;

          // 批量查询所有 project 下的 scopes
          const projectIds = projectRows.map(p => p.id);
          const scopesByProject = {};
          if (projectIds.length > 0) {
            const scopeRows = (await pool.query(
              `SELECT * FROM okr_scopes WHERE project_id = ANY($1) AND status != 'archived' ORDER BY created_at`,
              [projectIds]
            )).rows;

            // 批量查询所有 scope 下的 initiatives
            const scopeIds = scopeRows.map(s => s.id);
            const initiativesByScope = {};
            if (scopeIds.length > 0) {
              const initiativeRows = (await pool.query(
                `SELECT * FROM okr_initiatives WHERE scope_id = ANY($1) AND status != 'archived' ORDER BY created_at`,
                [scopeIds]
              )).rows;

              // 批量查询所有 initiative 下的 tasks
              const initiativeIds = initiativeRows.map(i => i.id);
              const tasksByInitiative = {};
              if (initiativeIds.length > 0) {
                const taskRows = (await pool.query(
                  `SELECT id, title, status, priority, okr_initiative_id, created_at, updated_at
                   FROM tasks WHERE okr_initiative_id = ANY($1) AND status != 'archived' ORDER BY created_at`,
                  [initiativeIds]
                )).rows;
                for (const task of taskRows) {
                  const key = task.okr_initiative_id;
                  if (!tasksByInitiative[key]) tasksByInitiative[key] = [];
                  tasksByInitiative[key].push(task);
                }
              }

              for (const initiative of initiativeRows) {
                if (!initiativesByScope[initiative.scope_id]) initiativesByScope[initiative.scope_id] = [];
                initiativesByScope[initiative.scope_id].push({
                  ...initiative,
                  tasks: tasksByInitiative[initiative.id] || [],
                });
              }
            }

            for (const scope of scopeRows) {
              if (!scopesByProject[scope.project_id]) scopesByProject[scope.project_id] = [];
              scopesByProject[scope.project_id].push({
                ...scope,
                initiatives: initiativesByScope[scope.id] || [],
              });
            }
          }

          for (const project of projectRows) {
            if (!projectsByKr[project.kr_id]) projectsByKr[project.kr_id] = [];
            projectsByKr[project.kr_id].push({
              ...project,
              scopes: scopesByProject[project.id] || [],
            });
          }
        }

        return {
          ...obj,
          key_results: krs.map(kr => ({
            ...kr,
            projects: projectsByKr[kr.id] || [],
          })),
        };
      }));

      return { ...vision, objectives: objectivesWithKRs };
    }));

    res.json({ success: true, tree: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── KR 进度重算 ──────────────────────────────────────────────────────────────

/** 重算与定时同步共用 project 等权聚合；无有效 target 时 current_value 为 NULL。 */
router.post('/key-results/:id/recalculate-progress', async (req, res) => {
  try {
    const result = await recalculateKrProgress(pool, req.params.id);
    if (!result) return res.status(404).json({ success: false, error: 'KeyResult not found' });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── OKR 当前进度快照 ──────────────────────────────────────────────────────────

/**
 * GET /api/brain/okr/current
 * 返回当前活跃 OKR 树形结构 + 每层完成度
 *
 * 棒5（决策 ee4842a6/3feeae3e）：每个 KR 下附 projects: [{id,name,status,progress,
 * task_total,task_done}]，数据来自真身表 projects/tasks（project-progress.js），
 * 替代此前经已退役 okr_projects 链路才能看到的 Project 信息。
 */
router.get('/current', async (req, res) => {
  try {
    const objectives = (await pool.query(`
      SELECT id, title, status, description
      FROM objectives
      WHERE status != 'archived'
      ORDER BY created_at DESC
      LIMIT 5
    `)).rows;

    const allKrs = [];
    const krsByObjective = {};
    for (const obj of objectives) {
      const krs = (await pool.query(`
        SELECT id, title, current_value, target_value, unit, status,
          COALESCE(
            progress,
            CASE WHEN target_value > 0
              THEN ROUND(current_value::numeric / target_value::numeric * 100, 0)
              ELSE 0
            END
          )::integer AS progress_pct
        FROM key_results
        WHERE objective_id = $1 AND status != 'archived'
        ORDER BY created_at
      `, [obj.id])).rows;
      krsByObjective[obj.id] = krs;
      allKrs.push(...krs);
    }

    const projectsByKr = await getProjectsForKrBatch(pool, allKrs.map((kr) => kr.id));

    const result = objectives.map((obj) => {
      const krs = krsByObjective[obj.id];
      const avgProgress = krs.length > 0
        ? Math.round(krs.reduce((sum, kr) => sum + parseFloat(kr.progress_pct || 0), 0) / krs.length)
        : 0;

      return {
        ...obj,
        progress_pct: avgProgress,
        key_results: krs.map((kr) => ({ ...kr, projects: projectsByKr[kr.id] || [] })),
      };
    });

    res.json({ success: true, objectives: result, generated_at: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── KR Verifier 手动触发 ─────────────────────────────────────────────────────

/**
 * POST /api/brain/okr/sync-verifiers
 * 立即运行所有启用的 KR verifier，更新 key_results.progress
 * 正常由 tick.js 每小时自动触发，此端点用于手动强制同步
 */
router.post('/sync-verifiers', async (req, res) => {
  try {
    const { runAllVerifiers } = await import('../kr-verifier.js');
    const result = await runAllVerifiers();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── current_value 全量回填 ───────────────────────────────────────────────────

/**
 * POST /api/brain/okr/backfill-current-values
 * 从 kr_verifiers.current_value 回填所有 key_results.current_value
 * 适用场景：Brain 重启后/紧急修复 current_value 为 0 的情况
 */
router.post('/backfill-current-values', async (req, res) => {
  try {
    const { resetAllKrProgress } = await import('../kr-verifier.js');
    const result = await resetAllKrProgress();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── T6 两轴衔接：KR↔Ability 对账视图 ─────────────────────────────────────────

/**
 * GET /api/brain/okr/kr/:id/ability-progress
 * 读 key_results.metadata.target_abilities，join journey_features(thickness) +
 * advancement_items 完成度，输出对账视图。失联引用进 missing_ability_ids。
 * 写入口：PATCH /api/brain/goals/:id（metadata merge）；
 * 禁用 PATCH /okr/key-results/:id 改 metadata（整体覆盖会吞掉 target_abilities）。
 */
router.get('/kr/:id/ability-progress', async (req, res) => {
  try {
    const { id } = req.params;
    const krResult = await pool.query('SELECT id, title, metadata FROM key_results WHERE id = $1', [id]);
    if (!krResult.rows.length) {
      return res.status(404).json({ success: false, error: 'KeyResult not found' });
    }
    const kr = krResult.rows[0];
    const targetIds = Array.isArray(kr.metadata?.target_abilities) ? kr.metadata.target_abilities : [];
    if (targetIds.length === 0) {
      return res.json({
        success: true, kr_id: kr.id, kr_title: kr.title,
        abilities: [], missing_ability_ids: [],
        hint: '该 KR 未登记 metadata.target_abilities（decomp 拆 KR 时写入）',
      });
    }

    // 格式非法的 id（非 UUID）不进 SQL（避免 invalid input syntax for type uuid 炸 500），
    // 直接归入 missing_ability_ids——端点本职就是暴露坏引用
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const validIds = targetIds.filter(tid => UUID_RE.test(tid));
    const invalidIds = targetIds.filter(tid => !UUID_RE.test(tid));
    if (validIds.length === 0) {
      return res.json({
        success: true, kr_id: kr.id, kr_title: kr.title,
        abilities: [], missing_ability_ids: invalidIds,
      });
    }

    const { rows } = await pool.query(`
      SELECT jf.id AS ability_id, jf.name, jf.thickness, jf.status,
             COUNT(ai.id) FILTER (WHERE ai.status = 'done')  AS done,
             COUNT(ai.id) FILTER (WHERE ai.status = 'doing') AS doing,
             COUNT(ai.id) FILTER (WHERE ai.status = 'todo')  AS todo
      FROM journey_features jf
      LEFT JOIN advancement_items ai ON ai.ability_id = jf.id
      WHERE jf.id = ANY($1) AND jf.kind = 'ability'
      GROUP BY jf.id, jf.name, jf.thickness, jf.status
    `, [validIds]);

    const abilities = rows.map(r => ({
      ability_id: r.ability_id, name: r.name, thickness: r.thickness, status: r.status,
      advancement: computeProgress({ done: +r.done, doing: +r.doing, todo: +r.todo }),
    }));
    const foundIds = new Set(rows.map(r => r.ability_id));
    const missing_ability_ids = [...invalidIds, ...validIds.filter(tid => !foundIds.has(tid))];

    res.json({ success: true, kr_id: kr.id, kr_title: kr.title, abilities, missing_ability_ids });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
