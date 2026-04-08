/**
 * OKR 层级 CRUD API
 * 路由: /api/brain/okr/*
 *
 * 7层结构：Vision → Objective → KeyResult → Project → Scope → Initiative → Task
 * 本文件覆盖前6层，Task 层由现有 tasks 表/路由处理
 *
 * 表: visions / objectives / key_results / okr_projects / okr_scopes / okr_initiatives
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

// ─── 通用 CRUD 工厂函数 ─────────────────────────────────────────────────────

/**
 * 为指定表生成标准 CRUD 路由
 * @param {Router} r - Express Router
 * @param {string} prefix - 路由前缀（如 '/visions'）
 * @param {string} table - 表名（如 'visions'）
 * @param {string|null} parentField - 父级外键字段名（如 'vision_id'），可为 null
 */
function mountCrud(r, prefix, table, parentField) {
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

  // POST /prefix - 创建
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
mountCrud(router, '/projects', 'okr_projects', 'kr_id');
mountCrud(router, '/scopes', 'okr_scopes', 'project_id');
mountCrud(router, '/initiatives', 'okr_initiatives', 'scope_id');

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

        // 批量查询所有 KR 下的 projects
        const krIds = krs.map(kr => kr.id);
        const projectsByKr = {};
        if (krIds.length > 0) {
          const projectRows = (await pool.query(
            `SELECT * FROM okr_projects WHERE kr_id = ANY($1) AND status != 'archived' ORDER BY created_at`,
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

/**
 * POST /api/brain/okr/key-results/:id/recalculate-progress
 * 重算指定 KR 的进度：
 *   current_value = completed tasks / total tasks × target_value
 *
 * 链路：key_result → okr_projects → okr_scopes → okr_initiatives → tasks
 */
router.post('/key-results/:id/recalculate-progress', async (req, res) => {
  try {
    const { id } = req.params;

    // 验证 KR 存在
    const krResult = await pool.query('SELECT id, target_value FROM key_results WHERE id = $1', [id]);
    if (!krResult.rows.length) {
      return res.status(404).json({ success: false, error: 'KeyResult not found' });
    }
    const { target_value } = krResult.rows[0];

    // 统计该 KR 下所有 initiatives 关联的 tasks
    const statsResult = await pool.query(`
      SELECT
        COUNT(t.id) FILTER (WHERE t.status = 'completed') AS completed_count,
        COUNT(t.id) AS total_count
      FROM okr_projects p
      JOIN okr_scopes s ON s.project_id = p.id
      JOIN okr_initiatives i ON i.scope_id = s.id
      LEFT JOIN tasks t ON t.okr_initiative_id = i.id
      WHERE p.kr_id = $1
    `, [id]);

    const { completed_count, total_count } = statsResult.rows[0];
    const completedNum = parseInt(completed_count, 10) || 0;
    const totalNum = parseInt(total_count, 10) || 0;

    // 计算新进度（total=0 时进度为 0）
    const newValue = totalNum > 0
      ? Math.round((completedNum / totalNum) * parseFloat(target_value) * 100) / 100
      : 0;

    // 更新 current_value
    await pool.query(
      'UPDATE key_results SET current_value = $1, updated_at = now() WHERE id = $2',
      [newValue, id]
    );

    res.json({
      success: true,
      kr_id: id,
      completed_tasks: completedNum,
      total_tasks: totalNum,
      target_value: parseFloat(target_value),
      current_value: newValue
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ─── OKR 当前进度快照 ──────────────────────────────────────────────────────────

/**
 * GET /api/brain/okr/current
 * 返回当前活跃 OKR 树形结构 + 每层完成度
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

    const result = await Promise.all(objectives.map(async (obj) => {
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

      const avgProgress = krs.length > 0
        ? Math.round(krs.reduce((sum, kr) => sum + parseFloat(kr.progress_pct || 0), 0) / krs.length)
        : 0;

      return { ...obj, progress_pct: avgProgress, key_results: krs };
    }));

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

// ─── OKR Project 进度手动更新 ─────────────────────────────────────────────────

/**
 * PATCH /api/brain/okr/projects/:id
 * 手动更新 okr_project 的 progress（0-100）和/或 status
 * 用途：当 verifier 采集不到真实进度时，由人/agent 手动补填历史数据
 */
router.patch('/projects/:id', async (req, res) => {
  const { id } = req.params;
  const { progress, status, notes } = req.body;

  if (progress !== undefined && (typeof progress !== 'number' || progress < 0 || progress > 100)) {
    return res.status(400).json({ error: 'progress must be a number between 0 and 100' });
  }

  const updates = [];
  const values = [];
  let idx = 1;

  if (progress !== undefined) { updates.push(`progress = $${idx++}`); values.push(progress); }
  if (status !== undefined)   { updates.push(`status = $${idx++}`); values.push(status); }
  if (notes !== undefined)    { updates.push(`custom_props = COALESCE(custom_props,'{}') || jsonb_build_object('notes', $${idx++}::text)`); values.push(notes); }

  if (updates.length === 0) return res.status(400).json({ error: 'no fields to update' });

  updates.push(`updated_at = NOW()`);
  values.push(id);

  try {
    const { rows } = await pool.query(
      `UPDATE okr_projects SET ${updates.join(', ')} WHERE id = $${idx} RETURNING id, title, status, progress`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: 'project not found' });
    res.json({ success: true, project: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── KR Verifier 健康度汇总 ──────────────────────────────────────────────────

/**
 * GET /api/brain/okr/health
 * 汇总所有活跃 KR verifier 健康状态
 * healthy = 无错误且 last_checked < 2h 前
 * stale   = last_checked > 2h 前
 * error   = last_error 非空
 */
router.get('/health', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        kr.id AS kr_id,
        kr.title,
        kv.current_value,
        kv.last_checked,
        kv.last_error,
        kv.enabled,
        CASE
          WHEN kv.last_error IS NOT NULL THEN 'error'
          WHEN kv.last_checked IS NULL OR kv.last_checked < NOW() - INTERVAL '2 hours' THEN 'stale'
          ELSE 'healthy'
        END AS health_status
      FROM kr_verifiers kv
      JOIN key_results kr ON kr.id = kv.kr_id
      WHERE kr.status = 'active' AND kv.enabled = true
      ORDER BY health_status, kr.title
    `);

    const summary = rows.reduce((acc, r) => {
      acc[r.health_status] = (acc[r.health_status] || 0) + 1;
      return acc;
    }, {});

    const total = rows.length;
    const healthy = summary.healthy || 0;
    const trust_score = total > 0 ? Math.round((healthy / total) * 100) : 0;

    res.json({ success: true, trust_score, summary, verifiers: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
