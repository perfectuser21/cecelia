/**
 * Brain API: Content Pipeline
 *
 * GET  /api/brain/content-types                列出所有已注册内容类型
 * GET  /api/brain/content-types/:type/config   获取指定类型的完整配置（DB 优先，YAML 兜底）
 * PUT  /api/brain/content-types/:type/config   更新指定类型配置到 DB
 * POST /api/brain/content-types/seed           从 YAML 批量导入所有类型配置到 DB
 * GET  /api/brain/pipelines                    列出 content-pipeline 任务
 * POST /api/brain/pipelines                    创建新 content-pipeline 任务
 * POST /api/brain/pipelines/trigger-topics     手动触发今日选题生成（忽略时间窗口限制）
 * POST /api/brain/pipelines/:id/run            手动触发 pipeline 执行（不依赖 tick）
 * GET  /api/brain/pipelines/:id/stages         查询 pipeline 子任务进度
 * GET  /api/brain/pipelines/:id/output         查询 pipeline 产出物（manifest）
 */

import express from 'express';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import pool from '../db.js';
import { listContentTypes, getContentType, getContentTypeFromYaml, listContentTypesFromYaml } from '../content-types/content-type-registry.js';
import { orchestrateContentPipelines, executeQueuedContentTasks } from '../content-pipeline-orchestrator.js';
import { triggerDailyTopicSelection, hasTodayTopics } from '../topic-selection-scheduler.js';
import { callLLM } from '../llm-caller.js';

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
    const startTime = Date.now();
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
 * POST /pipelines/trigger-topics
 * 手动触发今日选题生成（忽略时间窗口限制，强制执行）
 * 用于测试、调试或手动补充当日选题
 */
router.post('/trigger-topics', async (req, res) => {
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
      SELECT task_type, status, started_at, completed_at,
             payload->'review_issues' AS review_issues,
             payload->>'review_passed' AS review_passed
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
      };
      if (row.review_issues !== null) entry.review_issues = row.review_issues;
      if (row.review_passed !== null) entry.review_passed = row.review_passed === 'true';
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

    const topicNoDash = topic.replace(/-/g, '');
    const image_urls = [];
    if (existsSync(IMAGES_DIR)) {
      const allFiles = readdirSync(IMAGES_DIR)
        .filter(f => (f.startsWith(`${topic}-`) || f.startsWith(`${topicNoDash}-`)) && f.endsWith('.png'))
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

export default router;
