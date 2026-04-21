/**
 * Brain API: Content Pipeline
 *
 * GET  /api/brain/content-types                列出所有已注册内容类型
 * GET  /api/brain/content-types/:type/config   获取指定类型的完整配置（DB 优先，YAML 兜底）
 * PUT  /api/brain/content-types/:type/config   更新指定类型配置到 DB
 * POST /api/brain/content-types/seed           从 YAML 批量导入所有类型配置到 DB
 * GET  /api/brain/pipelines                    列出 content-pipeline 任务
 * GET  /api/brain/pipelines/daily-stats        每日产出统计（completed/in_progress/failed/queued）
 * POST /api/brain/pipelines                    创建新 content-pipeline 任务
 * POST /api/brain/pipelines/trigger-topics     手动触发今日选题生成（忽略时间窗口限制）
 * POST /api/brain/pipelines/e2e-trigger        端到端流程触发（选题→Pipeline创建→执行）
 * POST /api/brain/pipelines/batch-e2e-trigger  批量端到端触发（一次创建多条 pipeline，默认5条）
 * POST /api/brain/pipelines/:id/run            手动触发 pipeline 执行（不依赖 tick）
 * POST /api/brain/pipelines/:id/pre-publish-check  发布前内容质量检查
 * GET  /api/brain/pipelines/:id/stages         查询 pipeline 子任务进度
 * GET  /api/brain/pipelines/:id/output         查询 pipeline 产出物（manifest）
 */

import express from 'express';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import pool from '../db.js';
import { listContentTypes, getContentType, getContentTypeFromYaml, listContentTypesFromYaml } from '../content-types/content-type-registry.js';
import { orchestrateContentPipelines, executeQueuedContentTasks } from '../content-pipeline-orchestrator.js';
import {
  runContentPipeline,
  isContentPipelineLangGraphEnabled,
} from '../content-pipeline-graph-runner.js';
import { triggerDailyTopicSelection, hasTodayTopics } from '../topic-selection-scheduler.js';
import { callLLM } from '../llm-caller.js';
import { validateAllVariants } from '../content-quality-validator.js';

const router = express.Router();

// Content pipeline 并发硬限（防 Mac OOM）。
// 一条 pipeline 峰值约 2GB（research/copywrite stage Claude CLI + context），
// Mac 16GB 同时跑 2 条 × 2GB = 4GB peak，留 12GB 给 Brain / Dashboard / 用户进程。
// 第 3 条请求立即 429 返回，由上层（Dashboard / cron / 手动）决定排队或丢弃。
const PIPELINE_MAX_CONCURRENT = parseInt(process.env.PIPELINE_MAX_CONCURRENT || '2', 10);
const _runningPipelines = new Set();

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
 * POST /content-types/seed
 * 从 YAML 文件批量导入所有内容类型配置到 DB（初始化用）
 * 已存在的类型会被覆盖（upsert）
 */
router.post('/content-types/seed', async (_req, res) => {
  try {
    const yamlTypes = listContentTypesFromYaml();
    const results = { seeded: [], failed: [] };

    for (const typeName of yamlTypes) {
      try {
        const config = getContentTypeFromYaml(typeName);
        if (!config) continue;

        await pool.query(
          `INSERT INTO content_type_configs (content_type, title, config, updated_by)
           VALUES ($1, $2, $3, 'seed')
           ON CONFLICT (content_type)
           DO UPDATE SET config = $3, updated_at = NOW(), updated_by = 'seed'`,
          [typeName, config.content_type || typeName, JSON.stringify(config)]
        );
        results.seeded.push(typeName);
      } catch (err) {
        results.failed.push({ type: typeName, error: err.message });
      }
    }

    res.json({
      ok: true,
      total: yamlTypes.length,
      seeded: results.seeded.length,
      failed: results.failed.length,
      details: results,
    });
  } catch (err) {
    console.error('[routes/content-pipeline] POST /content-types/seed error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /content-types/test-step
 * 测试单个 pipeline 节点：传入 step + prompt + model + input → 调 LLM → 返回结果
 */
const STEP_SYSTEM_PROMPTS = {
  'content-research': '你是一个内容调研专家。根据用户提供的关键词，进行深度调研，产出结构化的调研结果（findings）。每条 finding 包含 title、content、source、data。',
  'content-copywriting': '你是一个社交媒体文案专家。根据调研结果和用户要求，生成社交媒体图文文案和公众号长文。文案需要有吸引力，数据有支撑，语气符合目标平台。',
  'content-copy-review': '你是一个内容审核专家。检查文案是否符合品牌规范和质量标准。输出 review_passed (true/false) 和 issues 列表。',
  'content-generate': '你是一个视觉设计师。根据定稿文案，描述每张信息图卡片的设计方案（布局、色彩、文字排版、数据可视化方式）。',
  'content-image-review': '你是一个视觉审核专家。检查图片设计方案是否符合品牌视觉规范。输出 review_passed (true/false) 和改进建议。',
  'content-export': '你是一个内容发布专家。根据所有产出物，生成发布清单（manifest），包括每个平台的发布策略。',
};

router.post('/content-types/test-step', async (req, res) => {
  const { step, prompt, model, input, provider: reqProvider } = req.body || {};

  if (!step || !prompt) {
    return res.status(400).json({ error: 'step 和 prompt 必填' });
  }

  const systemPrompt = STEP_SYSTEM_PROMPTS[step];
  if (!systemPrompt) {
    return res.status(400).json({
      error: `未知的 step "${step}"，支持：${Object.keys(STEP_SYSTEM_PROMPTS).join(', ')}`,
    });
  }

  const userMessage = input
    ? `${prompt}\n\n---\n输入数据：\n${JSON.stringify(input, null, 2)}`
    : prompt;

  const fullPrompt = `${systemPrompt}\n\n---\n\n${userMessage}`;

  const resolvedModel = model || 'claude-sonnet-4-20250514';
  let resolvedProvider;
  if (reqProvider) {
    resolvedProvider = reqProvider;
  } else if (resolvedModel.startsWith('gpt')) {
    resolvedProvider = 'openai';
  } else {
    resolvedProvider = 'anthropic';
  }

  try {
    const _startTime = Date.now();
    const result = await callLLM('content-test-step', fullPrompt, {
      model: resolvedModel,
      provider: resolvedProvider,
      maxTokens: 4096,
      timeout: 60000,
    });

    res.json({
      ok: true,
      step,
      model: result.model,
      provider: result.provider,
      output: result.text,
      elapsed_ms: result.elapsed_ms,
    });
  } catch (err) {
    console.error('[routes/content-pipeline] POST /content-types/test-step error:', err.message);
    res.status(500).json({
      error: err.message,
      step,
      model: model || 'claude-sonnet-4-20250514',
    });
  }
});

/**
 * GET /content-types/:type/config
 * 获取指定内容类型的完整配置（DB 优先，YAML 兜底）
 */
router.get('/content-types/:type/config', async (req, res) => {
  const { type } = req.params;
  try {
    const config = await getContentType(type);
    if (!config) {
      return res.status(404).json({ error: `内容类型 "${type}" 不存在` });
    }

    // 查询 DB 获取元数据（updated_at, updated_by）
    let source = 'yaml';
    let meta = {};
    try {
      const dbResult = await pool.query(
        'SELECT updated_at, updated_by FROM content_type_configs WHERE content_type = $1',
        [type]
      );
      if (dbResult.rows.length > 0) {
        source = 'db';
        meta = {
          updated_at: dbResult.rows[0].updated_at,
          updated_by: dbResult.rows[0].updated_by,
        };
      }
    } catch { /* DB 不可用时不影响返回 */ }

    res.json({ content_type: type, source, config, ...meta });
  } catch (err) {
    console.error('[routes/content-pipeline] GET /content-types/:type/config error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /content-types/:type/config
 * 更新指定内容类型配置到 DB（body 是完整 config JSON）
 */
router.put('/content-types/:type/config', async (req, res) => {
  const { type } = req.params;
  const config = req.body;

  if (!config || typeof config !== 'object') {
    return res.status(400).json({ error: 'body 必须是有效的 JSON 对象' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO content_type_configs (content_type, title, config, updated_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (content_type)
       DO UPDATE SET config = $3, title = $2, updated_at = NOW(), updated_by = $4
       RETURNING content_type, title, updated_at, updated_by`,
      [type, config.content_type || type, JSON.stringify(config), config._updated_by || 'api']
    );

    res.json({ ok: true, ...result.rows[0] });
  } catch (err) {
    console.error('[routes/content-pipeline] PUT /content-types/:type/config error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /daily-stats
 * 每日内容产出统计：返回指定日期（默认今日，北京时间）的 content-pipeline 任务数量分布。
 * Query: date=YYYY-MM-DD（可选，默认今日）
 */
router.get('/daily-stats', async (req, res) => {
  const rawDate = req.query.date;
  // 格式校验：只接受 YYYY-MM-DD（防止非预期输入）
  if (rawDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    return res.status(400).json({ error: 'date 参数格式无效，请使用 YYYY-MM-DD' });
  }
  const dateStr = rawDate || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });

  try {
    const result = await pool.query(
      `SELECT
         status,
         COUNT(*)::int AS count
       FROM tasks
       WHERE task_type = 'content-pipeline'
         AND created_at >= ($1::date)::timestamptz
         AND created_at <  ($1::date + INTERVAL '1 day')::timestamptz
       GROUP BY status`,
      [dateStr]
    );

    const stats = { completed: 0, in_progress: 0, failed: 0, queued: 0 };
    for (const row of result.rows) {
      if (row.status in stats) stats[row.status] = row.count;
    }

    res.json({
      date: dateStr,
      completed: stats.completed,
      in_progress: stats.in_progress,
      failed: stats.failed,
      queued: stats.queued,
      total: result.rows.reduce((s, r) => s + r.count, 0),
    });
  } catch (err) {
    console.error('[routes/content-pipeline] GET /daily-stats error:', err.message);
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
              created_at, started_at, completed_at, error_message
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
    notebook_id = null,
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

    const payload = { keyword: keyword.trim(), content_type };

    // 优先使用请求中传入的 notebook_id，否则从 content-type 配置中自动读取
    let resolvedNotebookId = (notebook_id && typeof notebook_id === 'string' && notebook_id.trim())
      ? notebook_id.trim()
      : null;

    if (!resolvedNotebookId) {
      try {
        const typeConfig = await getContentType(content_type);
        if (typeConfig?.notebook_id && typeof typeConfig.notebook_id === 'string' && typeConfig.notebook_id.trim()) {
          resolvedNotebookId = typeConfig.notebook_id.trim();
        }
      } catch {
        // 配置读取失败不阻断创建，执行时 executeResearch 会 FAIL
      }
    }

    if (resolvedNotebookId) {
      payload.notebook_id = resolvedNotebookId;
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
        JSON.stringify(payload),
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
 * POST /pipelines/trigger-topics
 * 手动触发今日选题生成（忽略时间窗口限制，强制执行）
 * 用于测试、调试或手动补充当日选题
 */
router.post('/trigger-topics', async (req, res) => {
  res.set('Deprecation', 'true');
  res.set('Sunset', '2026-07-11');
  res.set('Link', '</api/brain/tasks>; rel="successor-version"');
  try {
    const alreadyDone = await hasTodayTopics(pool);
    if (alreadyDone && !req.query.force) {
      return res.status(200).json({
        ok: false,
        skipped: true,
        reason: '今日选题已生成，如需强制重新生成请加 ?force=1',
      });
    }

    // 传入触发窗口内的时间（UTC 01:02）绕过时间检查
    const windowTime = new Date();
    windowTime.setUTCHours(1, 2, 0, 0);

    const result = await triggerDailyTopicSelection(pool, windowTime);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[routes/content-pipeline] POST /trigger-topics error:', err.message);
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
    // 允许重新生成：completed 状态重置为 queued
    if (pipeline.status === 'completed') {
      await pool.query(
        `UPDATE tasks SET status = 'queued', completed_at = NULL, started_at = NULL, updated_at = NOW() WHERE id = $1`,
        [id]
      );
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
 * POST /:id/run-langgraph
 *
 * 走 LangGraph + Docker 路径跑 pipeline。跟 `/:id/run`（老 orchestrator）并存，
 * 由 CONTENT_PIPELINE_LANGGRAPH_ENABLED 开关灰度控制。
 *
 * body (可选): { keyword, output_dir, notebook_id }
 *   不传则从 tasks 表的 payload 读。
 */
router.post('/:id/run-langgraph', async (req, res) => {
  const { id } = req.params;

  if (!isContentPipelineLangGraphEnabled()) {
    return res.status(503).json({
      success: false,
      error: {
        code: 'LANGGRAPH_DISABLED',
        message: 'CONTENT_PIPELINE_LANGGRAPH_ENABLED 未启用，走 /:id/run 老路径',
      },
    });
  }

  try {
    const r = await pool.query(
      `SELECT id, payload FROM tasks WHERE id = $1 AND task_type = 'content-pipeline'`,
      [id],
    );
    if (r.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: 'PIPELINE_NOT_FOUND', message: `pipeline ${id} 不存在` },
      });
    }
    // 并发硬限：防 Mac OOM
    if (_runningPipelines.size >= PIPELINE_MAX_CONCURRENT && !_runningPipelines.has(id)) {
      return res.status(429).json({
        success: false,
        error: {
          code: 'PIPELINE_BUSY',
          message: `已有 ${_runningPipelines.size} 条 pipeline 并行（上限 ${PIPELINE_MAX_CONCURRENT}），稍后重试。`,
          running_ids: [..._runningPipelines],
        },
      });
    }

    const row = r.rows[0];
    const payload = row.payload || {};
    const keyword = (req.body && req.body.keyword) || payload.keyword || '';
    const outputDir = (req.body && req.body.output_dir) || payload.output_dir || '';
    const notebookId = (req.body && req.body.notebook_id) || payload.notebook_id || null;

    _runningPipelines.add(id);

    // 202 Accepted 立即返，异步跑 pipeline
    res.status(202).json({
      success: true,
      data: {
        pipeline_id: id,
        status: 'running',
        mode: 'langgraph',
        concurrent_slot: `${_runningPipelines.size}/${PIPELINE_MAX_CONCURRENT}`,
      },
    });

    (async () => {
      try {
        // Postgres checkpoint 持久化 state（仿 executor.js L2821-2825 harness 模式）
        // 避免 Brain 重启清零 state。task.id 作为 thread_id 即为 resume key。
        const { PostgresSaver } = await import('@langchain/langgraph-checkpoint-postgres');
        const checkpointer = PostgresSaver.fromConnString(
          process.env.DATABASE_URL || 'postgresql://cecelia@localhost:5432/cecelia'
        );
        await checkpointer.setup();  // 幂等建 checkpoints / checkpoint_blobs / checkpoint_writes

        const result = await runContentPipeline(
          {
            id,
            keyword,
            output_dir: outputDir,
            payload: { notebook_id: notebookId, ...payload },
          },
          {
            checkpointer,
            onStep: async (evt) => {
              // 写 cecelia_events（仿 executor.js L2840-2844 harness 同 schema）
              // onStep 失败不阻塞 pipeline，但打日志便于诊断
              try {
                await pool.query(
                  `INSERT INTO cecelia_events (event_type, task_id, payload)
                   VALUES ('content_pipeline_step', $1::uuid, $2::jsonb)`,
                  [id, JSON.stringify({
                    node: evt.node,
                    step_index: evt.step_index,
                    ...(evt.state_snapshot || {}),
                  })],
                );
              } catch (err) {
                console.warn(`[content-pipeline] langgraph_step insert failed task=${id}: ${err.message}`);
              }
            },
          },
        );
        console.log(`[content-pipeline] run-langgraph 完成: pipeline=${id} steps=${result.steps}`);
      } catch (err) {
        console.error(`[content-pipeline] run-langgraph 失败: pipeline=${id} error=${err.message}`);
        await pool.query(
          `UPDATE tasks SET status = 'failed', completed_at = NOW() WHERE id = $1`,
          [id],
        ).catch(() => {});
      } finally {
        _runningPipelines.delete(id);
      }
    })();
  } catch (err) {
    console.error('[routes/content-pipeline] POST /:id/run-langgraph error:', err.message);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: err.message },
    });
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
      SELECT task_type, status, started_at, completed_at, summary,
             payload->'review_issues' AS review_issues,
             payload->>'review_passed' AS review_passed,
             payload->'rule_scores' AS rule_scores,
             payload->>'llm_reviewed' AS llm_reviewed
      FROM tasks
      WHERE payload->>'parent_pipeline_id' = $1
      ORDER BY created_at ASC
    `, [id]);

    const stages = {};
    for (const row of result.rows) {
      const entry = {
        status: row.status,
        started_at: row.started_at,
        completed_at: row.completed_at,
        summary: row.summary || null,
      };
      if (row.review_issues !== null) entry.review_issues = row.review_issues;
      if (row.review_passed !== null) entry.review_passed = row.review_passed === 'true';
      if (row.rule_scores !== null) entry.rule_scores = row.rule_scores;
      if (row.llm_reviewed !== null) entry.llm_reviewed = row.llm_reviewed === 'true';
      stages[row.task_type] = entry;
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

    // 构建 content-output 目录路径（扫描匹配关键词的目录）
    const HOME = process.env.HOME || '/Users/administrator';
    const outputBase = join(HOME, 'perfect21', 'zenithjoy', 'content-output');

    // 找到匹配的输出目录（按关键词模糊匹配）
    let articleText = null;
    let cardsText = null;

    if (existsSync(outputBase)) {
      const dirs = readdirSync(outputBase);
      // 把关键词转为简单匹配字符串
      const kwSlug = keyword.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '').toLowerCase();
      const matchDir = dirs.find(d => {
        const dSlug = d.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '').toLowerCase();
        return dSlug.includes(kwSlug) || kwSlug.includes(dSlug.substring(0, 8));
      }) || dirs.sort().reverse().find(d => d.includes('content') || d.length > 5);

      if (matchDir) {
        const articlePath = join(outputBase, matchDir, 'article', 'article.md');
        const cardsPath = join(outputBase, matchDir, 'cards', 'copy.md');
        if (existsSync(articlePath)) {
          articleText = readFileSync(articlePath, 'utf-8');
        }
        if (existsSync(cardsPath)) {
          cardsText = readFileSync(cardsPath, 'utf-8');
        }
      }
    }

    // 扫描实际存在的图片文件
    const IMAGES_DIR = join(HOME, 'claude-output', 'images');
    const IMAGE_BASE_URL = 'http://38.23.47.81:9998/images/';
    const topic = keyword
      .replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase();

    const image_urls = [];
    if (existsSync(IMAGES_DIR)) {
      // 同时尝试带连字符（dan-koe-）和不带连字符（dankoe-）两种前缀
      const topicNoDash = topic.replace(/-/g, '');
      const allFiles = readdirSync(IMAGES_DIR)
        .filter(f => {
          const fl = f.toLowerCase();
          return (fl.startsWith(`${topic}-`) || (topicNoDash !== topic && fl.startsWith(`${topicNoDash}-`))) && f.endsWith('.png');
        })
        .sort();
      let cardIndex = 1;
      for (const file of allFiles) {
        if (file.includes('-cover.')) {
          image_urls.push({ type: 'cover', url: `${IMAGE_BASE_URL}${file}` });
        } else {
          image_urls.push({ type: 'card', index: cardIndex++, url: `${IMAGE_BASE_URL}${file}` });
        }
      }
    }

    const output = {
      keyword,
      status: pipeline.status,
      article_text: articleText,
      cards_text: cardsText,
      image_urls,
      export_path: pipeline.payload?.export_path || null,
      // 向后兼容旧格式
      images: image_urls.length > 0 ? {
        cover: image_urls.find(u => u.type === 'cover')?.url || '',
        cards: image_urls.filter(u => u.type === 'card').map(u => u.url),
      } : null,
    };
    res.json({ pipeline_id: id, output });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /pipelines/:id/stats
 * 查询 pipeline 各平台发布后数据汇总（来自 pipeline_publish_stats 表）
 */
router.get('/:id/stats', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `SELECT platform,
              SUM(views)    AS views,
              SUM(likes)    AS likes,
              SUM(comments) AS comments,
              SUM(shares)   AS shares,
              MAX(scraped_at) AS last_scraped_at,
              COUNT(*) AS scrape_count
       FROM pipeline_publish_stats
       WHERE pipeline_id = $1
       GROUP BY platform
       ORDER BY platform`,
      [id]
    );

    const stats = result.rows.map(row => ({
      platform: row.platform,
      views: parseInt(row.views, 10) || 0,
      likes: parseInt(row.likes, 10) || 0,
      comments: parseInt(row.comments, 10) || 0,
      shares: parseInt(row.shares, 10) || 0,
      last_scraped_at: row.last_scraped_at,
      scrape_count: parseInt(row.scrape_count, 10) || 0,
    }));

    res.json({ pipeline_id: id, stats });
  } catch (err) {
    console.error('[routes/content-pipeline] GET /:id/stats error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /pipelines/:id/pre-publish-check
 * 发布前内容质量检查：读取 pipeline 产出的文案内容，执行程序化质量验证。
 *
 * Body（可选）：{ content_override: string } — 直接传入内容文本（用于测试）
 *
 * Response: { passed: boolean, pipeline_id: string, issues: Array, word_count?: number }
 */
router.post('/:id/pre-publish-check', async (req, res) => {
  const { id } = req.params;
  const { content_override } = req.body || {};

  try {
    // 获取 pipeline 任务
    const pipelineResult = await pool.query(
      `SELECT id, title, payload, status FROM tasks WHERE id = $1 AND task_type = 'content-pipeline'`,
      [id]
    );
    if (pipelineResult.rows.length === 0) {
      return res.status(404).json({ error: `Pipeline ${id} 不存在` });
    }

    const pipeline = pipelineResult.rows[0];
    const contentType = pipeline.payload?.content_type || 'solo-company-case';

    // 获取内容类型配置（用于质量规则）
    let typeConfig = {};
    try {
      typeConfig = await getContentType(contentType);
    } catch {
      // 找不到配置时使用空配置（验证器有默认值兜底）
    }

    // 优先用 content_override，否则从 pipeline 产出目录读取文案
    let contentMap = {};
    if (content_override) {
      contentMap = { short_copy: content_override };
    } else {
      // 尝试从 export 产出的 manifest.json 读取
      const keyword = pipeline.payload?.keyword || pipeline.title;
      const outputBase = join(process.env.HOME || '/Users/administrator', 'claude-output');
      const slugified = keyword.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '-').replace(/-+/g, '-');

      // 查找产出目录（支持带时间戳的目录名）
      let outputDir = null;
      try {
        const dirs = readdirSync(outputBase).filter((d) => d.includes(slugified));
        if (dirs.length > 0) {
          outputDir = join(outputBase, dirs[dirs.length - 1]);
        }
      } catch {
        // 目录不存在时忽略
      }

      if (outputDir) {
        const copyPath = join(outputDir, 'cards', 'copy.md');
        const articlePath = join(outputDir, 'article', 'article.md');
        if (existsSync(copyPath)) {
          contentMap.short_copy = readFileSync(copyPath, 'utf-8');
        }
        if (existsSync(articlePath)) {
          contentMap.long_form = readFileSync(articlePath, 'utf-8');
        }
      }
    }

    if (Object.keys(contentMap).length === 0) {
      return res.json({
        passed: false,
        pipeline_id: id,
        issues: [{ rule: 'content_not_found', severity: 'blocking', message: '未找到 pipeline 产出的内容文件，请确认 pipeline 已完成 export 阶段' }],
      });
    }

    const { passed, results } = validateAllVariants(contentMap, typeConfig);

    // 汇总所有 issues
    const allIssues = [];
    for (const [variant, result] of Object.entries(results)) {
      for (const issue of result.issues) {
        allIssues.push({ ...issue, variant });
      }
    }

    console.log(`[pre-publish-check] pipeline ${id}: passed=${passed}, issues=${allIssues.length}`);
    return res.json({ passed, pipeline_id: id, content_type: contentType, issues: allIssues, results });
  } catch (err) {
    console.error('[routes/content-pipeline] POST /:id/pre-publish-check error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /pipelines/e2e-trigger
 * 端到端链路触发：选题（可选）→ 创建 Pipeline → 立即执行第一阶段。
 *
 * Body: {
 *   keyword: string,        // 必填：内容关键词（如 "Cursor AI"）
 *   content_type?: string,  // 可选：内容类型，默认 "solo-company-case"
 *   skip_topic_selection?: boolean,  // 可选：跳过选题生成，默认 false
 * }
 *
 * Response: { pipeline_id: string, status: string, message: string }
 */
router.post('/e2e-trigger', async (req, res) => {
  res.set('Deprecation', 'true');
  res.set('Sunset', '2026-07-11');
  res.set('Link', '</api/brain/tasks>; rel="successor-version"');
  const { keyword, content_type = 'solo-company-case', skip_topic_selection = false } = req.body || {};

  if (!keyword || typeof keyword !== 'string' || keyword.trim().length === 0) {
    return res.status(400).json({ error: '必填字段 keyword 不能为空' });
  }

  const cleanKeyword = keyword.trim();

  try {
    // Step 1: 触发选题生成（除非跳过）
    let topicTriggered = false;
    if (!skip_topic_selection) {
      try {
        await triggerDailyTopicSelection();
        topicTriggered = true;
      } catch (topicErr) {
        console.warn(`[e2e-trigger] 选题生成失败（不阻断流程）: ${topicErr.message}`);
      }
    }

    // Step 2: 创建 content-pipeline 任务
    const pipelinePayload = {
      keyword: cleanKeyword,
      content_type,
      trigger_source: 'e2e-trigger',
      triggered_at: new Date().toISOString(),
    };

    const insertResult = await pool.query(
      `INSERT INTO tasks (title, task_type, status, payload, priority, tags)
       VALUES ($1, 'content-pipeline', 'queued', $2::jsonb, 'P2', ARRAY['e2e-trigger','auto'])
       RETURNING id`,
      [`[Pipeline] ${cleanKeyword} (${content_type})`, JSON.stringify(pipelinePayload)]
    );

    const pipelineId = insertResult.rows[0].id;
    console.log(`[e2e-trigger] 创建 pipeline ${pipelineId}：${cleanKeyword}`);

    // Step 3: 立即触发 pipeline 执行（不等 tick）
    let executionStarted = false;
    try {
      await orchestrateContentPipelines(pool);
      await executeQueuedContentTasks(pool);
      executionStarted = true;
    } catch (execErr) {
      console.warn(`[e2e-trigger] pipeline 立即执行失败（将由 tick 接管）: ${execErr.message}`);
    }

    return res.json({
      ok: true,
      pipeline_id: pipelineId,
      keyword: cleanKeyword,
      content_type,
      topic_triggered: topicTriggered,
      execution_started: executionStarted,
      message: executionStarted
        ? `Pipeline ${pipelineId} 已创建并开始执行第一阶段`
        : `Pipeline ${pipelineId} 已创建，将由 tick 自动执行`,
      check_progress: `/api/brain/pipelines/${pipelineId}/stages`,
    });
  } catch (err) {
    console.error('[routes/content-pipeline] POST /e2e-trigger error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /pipelines/batch-e2e-trigger
 * 批量端到端触发：一次创建多条 content-pipeline，轮换3种内容类型，
 * 用于验证"AI一人公司"主题的完整内容生成闭环。
 *
 * Body: {
 *   keywords: string[],       // 必填：关键词数组（建议5个，支持1-10个）
 *   skip_topic_selection?: boolean,  // 可选：跳过选题生成，默认 true（批量场景通常已有关键词）
 * }
 *
 * 内容类型轮换策略：
 *   索引 0,3 → solo-company-case
 *   索引 1,4 → ai-tools-review
 *   索引 2   → ai-workflow-guide
 *
 * Response: { ok: boolean, created: number, pipelines: Array<{pipeline_id, keyword, content_type}> }
 */
router.post('/batch-e2e-trigger', async (req, res) => {
  res.set('Deprecation', 'true');
  res.set('Sunset', '2026-07-11');
  res.set('Link', '</api/brain/tasks>; rel="successor-version"');
  const { keywords, skip_topic_selection = true } = req.body || {};

  if (!Array.isArray(keywords) || keywords.length === 0) {
    return res.status(400).json({ error: '必填字段 keywords 不能为空，需为字符串数组' });
  }
  if (keywords.length > 10) {
    return res.status(400).json({ error: 'keywords 最多10个' });
  }

  // 内容类型轮换表（"AI一人公司"主题3种）
  const CONTENT_TYPE_ROTATION = ['solo-company-case', 'ai-tools-review', 'ai-workflow-guide'];

  const results = [];
  const errors = [];

  // 可选触发一次选题生成
  if (!skip_topic_selection) {
    try { await triggerDailyTopicSelection(); } catch { /* 不阻断 */ }
  }

  // 关键词安全校验：只允许中英文、数字、空格和常用符号，最长50字符
  const SAFE_KEYWORD_RE = /^[\w\u4e00-\u9fa5\-\s]{1,50}$/;

  for (let i = 0; i < keywords.length; i++) {
    const keyword = String(keywords[i]).trim();
    if (!keyword) continue;

    if (!SAFE_KEYWORD_RE.test(keyword)) {
      errors.push({ keyword, error: '关键词包含非法字符或超过50字符' });
      continue;
    }

    const content_type = CONTENT_TYPE_ROTATION[i % CONTENT_TYPE_ROTATION.length];

    try {
      const pipelinePayload = {
        keyword,
        content_type,
        trigger_source: 'batch-e2e-trigger',
        batch_index: i,
        triggered_at: new Date().toISOString(),
      };

      const insertResult = await pool.query(
        `INSERT INTO tasks (title, task_type, status, payload, priority, tags)
         VALUES ($1, 'content-pipeline', 'queued', $2::jsonb, 'P2', ARRAY['batch-e2e-trigger','auto'])
         RETURNING id`,
        [`[Pipeline] ${keyword} (${content_type})`, JSON.stringify(pipelinePayload)]
      );

      const pipelineId = insertResult.rows[0].id;
      results.push({ pipeline_id: pipelineId, keyword, content_type, status: 'queued' });
      console.log(`[batch-e2e-trigger] [${i + 1}/${keywords.length}] 创建 pipeline ${pipelineId}：${keyword} (${content_type})`);
    } catch (err) {
      errors.push({ keyword, error: err.message });
      console.error(`[batch-e2e-trigger] 创建 pipeline 失败：${keyword} — ${err.message}`);
    }
  }

  // 触发一次编排，让 tick 接管后续执行
  try {
    await orchestrateContentPipelines(pool);
  } catch (orchErr) {
    console.warn(`[batch-e2e-trigger] 编排启动失败（将由 tick 接管）: ${orchErr.message}`);
  }

  return res.json({
    ok: errors.length === 0,
    created: results.length,
    failed: errors.length,
    pipelines: results,
    errors: errors.length > 0 ? errors : undefined,
    message: `已创建 ${results.length} 条 pipeline，内容类型: ${[...new Set(results.map((r) => r.content_type))].join(', ')}`,
    check_each: results.map((r) => `/api/brain/pipelines/${r.pipeline_id}/stages`),
  });
});

export default router;
