/**
 * Brain API: Content Pipeline
 *
 * GET  /api/brain/content-types         列出所有已注册内容类型
 * GET  /api/brain/pipelines             列出 content-pipeline 任务
 * POST /api/brain/pipelines             创建新 content-pipeline 任务
 * POST /api/brain/pipelines/:id/run     手动触发 pipeline 执行（不依赖 tick）
 * GET  /api/brain/pipelines/:id/stages  查询 pipeline 子任务进度
 * GET  /api/brain/pipelines/:id/output  查询 pipeline 产出物（manifest）
 */

import express from 'express';
import pool from '../db.js';
import { listContentTypes } from '../content-types/content-type-registry.js';
import { orchestrateContentPipelines, executeQueuedContentTasks } from '../content-pipeline-orchestrator.js';

const router = express.Router();

/**
 * GET /content-types
 * 返回所有已注册内容类型名称数组
 */
router.get('/content-types', async (_req, res) => {
  try {
    const types = await listContentTypes();
    res.json(types);
  } catch (err) {
    console.error('[routes/content-pipeline] GET /content-types error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /
 * 列出 content-pipeline 任务，按 created_at 倒序，默认最近 50 条
 */
router.get('/', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const offset = parseInt(req.query.offset) || 0;

  try {
    const result = await pool.query(
      `SELECT id, title, status, priority, payload,
              created_at, started_at, completed_at
       FROM tasks
       WHERE task_type = 'content-pipeline'
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[routes/content-pipeline] GET / error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /
 * 创建新 content-pipeline 任务
 *
 * Body:
 *   keyword      {string} 必填 — 内容关键词（如"字节跳动"）
 *   content_type {string} 必填 — 内容类型（如"solo-company-case"）
 *   priority     {string} 可选 — P0/P1/P2，默认 P1
 *   project_id   {string} 可选
 *   goal_id      {string} 可选
 */
router.post('/', async (req, res) => {
  const {
    keyword,
    content_type,
    priority = 'P1',
    project_id = null,
    goal_id = null,
  } = req.body || {};

  if (!keyword || typeof keyword !== 'string' || !keyword.trim()) {
    return res.status(400).json({ error: 'keyword 必填' });
  }
  if (!content_type || typeof content_type !== 'string' || !content_type.trim()) {
    return res.status(400).json({ error: 'content_type 必填' });
  }

  const validPriorities = ['P0', 'P1', 'P2'];
  if (!validPriorities.includes(priority)) {
    return res.status(400).json({ error: `priority 必须为 ${validPriorities.join('/')}` });
  }

  try {
    // 验证 content_type 存在
    const types = await listContentTypes();
    if (!types.includes(content_type)) {
      return res.status(400).json({
        error: `content_type "${content_type}" 不存在，已注册类型：${types.join(', ')}`,
      });
    }

    const result = await pool.query(
      `INSERT INTO tasks (title, description, task_type, status, priority,
                          project_id, goal_id, trigger_source, payload, created_at)
       VALUES ($1, $2, 'content-pipeline', 'queued', $3, $4, $5, $6, $7, NOW())
       RETURNING id, title, status, priority, payload, created_at`,
      [
        `[内容工厂] ${keyword} (${content_type})`,
        `内容工厂 Pipeline：关键词「${keyword}」，类型「${content_type}」。将由 tick 自动编排 content-research → content-generate → content-review → content-export 四个阶段。`,
        priority,
        project_id,
        goal_id,
        'content_pipeline_api',
        JSON.stringify({ keyword: keyword.trim(), content_type }),
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[routes/content-pipeline] POST / error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /batch
 * 批量创建 content-pipeline 任务（最少 2 条，最多 20 条）
 *
 * Body:
 *   items                {Array}  必填 — 每项含 { keyword, content_type? }，最少 2 项，最多 20 项
 *   default_content_type {string} 可选 — item 无 content_type 时使用
 *   priority             {string} 可选 — P0/P1/P2，默认 P1
 *   project_id           {string} 可选
 *   goal_id              {string} 可选
 */
router.post('/batch', async (req, res) => {
  const {
    items,
    default_content_type,
    priority = 'P1',
    project_id = null,
    goal_id = null,
  } = req.body || {};

  if (!Array.isArray(items) || items.length < 2) {
    return res.status(400).json({ error: 'items 至少 2 项' });
  }
  if (items.length > 20) {
    return res.status(400).json({ error: 'items 不超过 20 项' });
  }

  const validPriorities = ['P0', 'P1', 'P2'];
  if (!validPriorities.includes(priority)) {
    return res.status(400).json({ error: `priority 必须为 ${validPriorities.join('/')}` });
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item.keyword || typeof item.keyword !== 'string' || !item.keyword.trim()) {
      return res.status(400).json({ error: `items[${i}].keyword 必填` });
    }
    const ct = item.content_type || default_content_type;
    if (!ct || typeof ct !== 'string' || !ct.trim()) {
      return res.status(400).json({ error: `items[${i}] 缺少 content_type，且未提供 default_content_type` });
    }
  }

  try {
    const types = await listContentTypes();
    for (let i = 0; i < items.length; i++) {
      const ct = (items[i].content_type || default_content_type).trim();
      if (!types.includes(ct)) {
        return res.status(400).json({
          error: `items[${i}].content_type "${ct}" 不存在，已注册类型：${types.join(', ')}`,
        });
      }
    }

    const created = [];
    for (const item of items) {
      const keyword = item.keyword.trim();
      const content_type = (item.content_type || default_content_type).trim();
      const result = await pool.query(
        `INSERT INTO tasks (title, description, task_type, status, priority,
                            project_id, goal_id, trigger_source, payload, created_at)
         VALUES ($1, $2, 'content-pipeline', 'queued', $3, $4, $5, $6, $7, NOW())
         RETURNING id, title, status, priority, payload, created_at`,
        [
          `[内容工厂] ${keyword} (${content_type})`,
          `内容工厂 Pipeline：关键词「${keyword}」，类型「${content_type}」。批量创建，将由 tick 自动编排四阶段。`,
          priority,
          project_id,
          goal_id,
          'content_pipeline_batch_api',
          JSON.stringify({ keyword, content_type }),
        ]
      );
      created.push(result.rows[0]);
    }

    res.status(201).json({ count: created.length, pipelines: created });
  } catch (err) {
    console.error('[routes/content-pipeline] POST /batch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /:id/run
 * 手动触发 pipeline 执行（不依赖 tick 调度器）
 */
router.post('/:id/run', async (req, res) => {
  const { id } = req.params;

  try {
    const pipelineResult = await pool.query(
      `SELECT id, status, payload FROM tasks WHERE id = $1 AND task_type = 'content-pipeline'`,
      [id]
    );

    if (pipelineResult.rows.length === 0) {
      return res.status(404).json({ error: `Pipeline ${id} 不存在` });
    }

    const pipeline = pipelineResult.rows[0];
    if (pipeline.status === 'completed') {
      return res.status(400).json({ error: 'Pipeline 已完成' });
    }

    res.status(202).json({ ok: true, pipeline_id: id, status: 'running' });

    // 异步执行编排 + 逐阶段执行
    (async () => {
      try {
        await orchestrateContentPipelines();
        let rounds = 8;
        while (rounds-- > 0) {
          const { executed } = await executeQueuedContentTasks();
          if (executed === 0) break;
          await orchestrateContentPipelines();
        }
        console.log(`[content-pipeline] run 完成: pipeline=${id}`);
      } catch (err) {
        console.error(`[content-pipeline] run 失败: pipeline=${id} error=${err.message}`);
        await pool.query(
          `UPDATE tasks SET status = 'failed', completed_at = NOW() WHERE id = $1`,
          [id]
        ).catch(() => {});
      }
    })();
  } catch (err) {
    console.error('[routes/content-pipeline] POST /:id/run error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /:id/stages
 * 查询 pipeline 子任务进度
 */
router.get('/:id/stages', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(`
      SELECT task_type, status, started_at, completed_at
      FROM tasks
      WHERE payload->>'parent_pipeline_id' = $1
      ORDER BY created_at ASC
    `, [id]);

    const stages = {};
    for (const row of result.rows) {
      stages[row.task_type] = {
        status: row.status,
        started_at: row.started_at,
        completed_at: row.completed_at,
      };
    }
    res.json({ pipeline_id: id, stages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /:id/output
 * 查询 pipeline 产出物
 */
router.get('/:id/output', async (req, res) => {
  const { id } = req.params;
  try {
    const pipelineResult = await pool.query(
      `SELECT payload, status FROM tasks WHERE id = $1`, [id]
    );
    if (pipelineResult.rows.length === 0) {
      return res.status(404).json({ error: 'Pipeline 不存在' });
    }

    const pipeline = pipelineResult.rows[0];
    const keyword = pipeline.payload?.keyword || '';
    const slug = keyword.replace(/[^a-zA-Z0-9\u4e00-\u9fff-]/g, '-').replace(/-+/g, '-').substring(0, 40);
    const imageBase = 'http://38.23.47.81:9998/images/';

    const output = {
      keyword,
      status: pipeline.status,
      images: {
        cover: `${imageBase}${slug}-cover.png`,
        cards: Array.from({ length: 5 }, (_, i) =>
          `${imageBase}${slug}-${String(i + 1).padStart(2, '0')}.png`
        ),
      },
    };
    res.json({ pipeline_id: id, output });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
