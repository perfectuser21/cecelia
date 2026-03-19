/**
 * Brain API: Content Topics（选题生成）
 *
 * POST /api/brain/content/topics/generate   — AI 生成选题建议
 * GET  /api/brain/content/topics            — 查询选题列表
 * PATCH /api/brain/content/topics/:id       — 更新选题状态
 */

import express from 'express';
import pool from '../db.js';
import { callLLM } from '../llm-caller.js';

const router = express.Router();

/** 检查 status 是否在允许列表中，不合法时返回 400 */
function rejectInvalidStatus(res, status, allowed) {
  if (!status || !allowed.includes(status)) {
    res.status(400).json({ error: `status 必须为 ${allowed.join('/')}` });
    return true;
  }
  return false;
}

/** 默认账号画像（大湖成长日记） */
const DEFAULT_ACCOUNT_PROFILE = {
  name: '大湖成长日记',
  audience: '企业主A类 + 副业创业B类',
  tone: '真实、接地气、成长型',
  focus: '一人公司、副业、创业成长',
};

/**
 * 从 LLM 返回的 text 中解析 JSON 数组（三层容错）
 * @param {string} text
 * @returns {Array|null}
 */
function parseTopicsJSON(text) {
  if (!text) return null;

  // Layer 1: 直接解析
  try {
    const parsed = JSON.parse(text.trim());
    if (Array.isArray(parsed)) return parsed;
  } catch { /* continue */ }

  // Layer 2: 提取 JSON 数组块
  const match = text.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* continue */ }
  }

  return null;
}

/**
 * POST /generate
 * 调用 LLM 生成选题建议，批量入库，返回结果列表
 *
 * Body（均可选，有默认值）：
 *   account_profile {object}  账号画像
 *   count           {number}  生成数量，默认 10，范围 1-50
 */
router.post('/generate', async (req, res) => {
  const { account_profile = DEFAULT_ACCOUNT_PROFILE, count = 10 } = req.body || {};

  const countNum = parseInt(count, 10);
  if (!Number.isInteger(countNum) || countNum <= 0 || countNum > 50) {
    return res.status(400).json({ error: 'count 必须为 1-50 之间的整数' });
  }

  const prompt = `你是一位专业的内容创作策略师，帮助以下账号生成选题建议。

账号信息：
- 账号名称：${account_profile.name || '大湖成长日记'}
- 目标受众：${account_profile.audience || '企业主 + 副业创业者'}
- 内容调性：${account_profile.tone || '真实、接地气、成长型'}
- 聚焦话题：${account_profile.focus || '一人公司、副业、创业成长'}

请生成 ${countNum} 个内容选题建议，要求：
1. 每个选题都真实可落地，有明确的目标受众痛点
2. 标题吸引眼球，有好奇心或共鸣感
3. 文案草稿字数 150-300 字，语言接地气
4. 结合账号定位推荐适合的发布平台
5. 禁止政治敏感内容、无法核实的数据、过于泛泛的内容

必须返回纯 JSON 数组，格式如下（不要任何额外文字）：
[
  {
    "title": "选题标题",
    "hook": "吸引眼球的开头句（1-2句话）",
    "body_draft": "完整文案草稿（150-300字）",
    "target_platforms": ["douyin", "xiaohongshu"],
    "ai_score": 8.5,
    "score_reason": "评分理由（1句话）"
  }
]

可选平台：douyin、xiaohongshu、weibo、wechat、zhihu、toutiao、kuaishou、shipinhao`;

  let topics;
  try {
    const { text } = await callLLM('cortex', prompt, { maxTokens: 4096, timeout: 60000 });
    topics = parseTopicsJSON(text);
    if (!topics || topics.length === 0) {
      throw new Error('LLM 返回内容无法解析为选题数组');
    }
  } catch (err) {
    console.error('[routes/content-topics] POST /generate LLM error:', err.message);
    return res.status(500).json({ error: `选题生成失败: ${err.message}` });
  }

  // 批量入库
  const insertedTopics = [];
  try {
    for (const topic of topics) {
      const { title, hook, body_draft, target_platforms, ai_score, score_reason } = topic;
      if (!title) continue;

      const result = await pool.query(
        `INSERT INTO content_topics
           (title, hook, body_draft, target_platforms, ai_score, score_reason, account_profile)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, title, hook, body_draft, target_platforms, ai_score, score_reason,
                   status, generated_at, created_at`,
        [
          title,
          hook || null,
          body_draft || null,
          target_platforms || [],
          ai_score != null ? parseFloat(ai_score) : null,
          score_reason || null,
          JSON.stringify(account_profile),
        ]
      );
      insertedTopics.push(result.rows[0]);
    }
  } catch (err) {
    console.error('[routes/content-topics] POST /generate DB error:', err.message);
    return res.status(500).json({ error: `选题入库失败: ${err.message}` });
  }

  res.json({ topics: insertedTopics, count: insertedTopics.length });
});

/**
 * GET /
 * 查询选题列表，支持 status 过滤 + 分页
 *
 * Query params:
 *   status  {string}  过滤状态（pending/adopted/skipped），不传则返回全部
 *   limit   {number}  默认 20，最大 100
 *   offset  {number}  默认 0
 */
router.get('/', async (req, res) => {
  const { status, limit: limitRaw, offset: offsetRaw } = req.query;
  const limit = Math.min(parseInt(limitRaw, 10) || 20, 100);
  const offset = parseInt(offsetRaw, 10) || 0;

  if (status && rejectInvalidStatus(res, status, ['pending', 'adopted', 'skipped'])) return;

  try {
    const params = [];
    let where = '';
    if (status) {
      params.push(status);
      where = `WHERE status = $${params.length}`;
    }

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM content_topics ${where}`,
      params
    );
    const total = countResult.rows[0].total;

    params.push(limit, offset);
    const result = await pool.query(
      `SELECT id, title, hook, body_draft, target_platforms, ai_score, score_reason,
              status, generated_at, adopted_at, created_at
       FROM content_topics
       ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({ topics: result.rows, total, limit, offset });
  } catch (err) {
    console.error('[routes/content-topics] GET / error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /:id
 * 更新选题状态（adopted → 写 adopted_at，skipped → 清 adopted_at）
 *
 * Body:
 *   status {string} 必填 — 'adopted' | 'skipped'
 */
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};

  if (rejectInvalidStatus(res, status, ['adopted', 'skipped'])) return;

  try {
    const result = await pool.query(
      `UPDATE content_topics
       SET status = $1,
           adopted_at = CASE WHEN $1 = 'adopted' THEN NOW() ELSE NULL END
       WHERE id = $2
       RETURNING id, title, status, adopted_at`,
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: `选题 ${id} 不存在` });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[routes/content-topics] PATCH /:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
