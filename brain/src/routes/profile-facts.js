/**
 * Profile Facts API Routes
 *
 * 用户记忆管理 CRUD API：
 * - GET    /api/brain/profile/facts         列出所有 facts
 * - POST   /api/brain/profile/facts         添加一条 fact
 * - PUT    /api/brain/profile/facts/:id     更新 fact
 * - DELETE /api/brain/profile/facts/:id     删除 fact
 * - POST   /api/brain/profile/facts/import  批量导入（文本 → MiniMax 拆解）
 */

import { Router } from 'express';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import pool from '../db.js';
import { generateProfileFactEmbeddingAsync } from '../embedding-service.js';

const router = Router();

const MINIMAX_API_URL = 'https://api.minimaxi.com/v1/chat/completions';
let _apiKey = null;

function getApiKey() {
  if (_apiKey) return _apiKey;
  try {
    const cred = JSON.parse(readFileSync(join(homedir(), '.credentials', 'minimax.json'), 'utf-8'));
    _apiKey = cred.api_key;
    return _apiKey;
  } catch {
    return null;
  }
}

const VALID_CATEGORIES = ['preference', 'behavior', 'background', 'goal', 'relationship', 'health', 'other'];

/**
 * 调用 MiniMax 将文本拆解成 facts 列表
 * @param {string} text - 输入文本
 * @returns {Promise<string[]>} facts 数组
 */
async function parseFactsFromText(text) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('MiniMax API key not available');

  const response = await fetch(MINIMAX_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'MiniMax-M2.5-highspeed',
      messages: [
        {
          role: 'system',
          content: `你是一个信息提取助手。
请将用户提供的文本提取为简洁的个人信息条目（facts）。
每条 fact 应该是一句简短的陈述句，描述一个独立的事实。
返回 JSON 格式：{ "facts": ["fact1", "fact2", ...] }
只返回 JSON，不要其他内容。`,
        },
        {
          role: 'user',
          content: text.substring(0, 3000),
        },
      ],
      max_tokens: 1024,
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`MiniMax API error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '{}';

  // 去掉可能的 <think>...</think> 块
  const cleaned = content.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();

  // 剥离 markdown 代码块（MiniMax 有时返回 ```json {...} ``` 格式）
  const stripped = cleaned.replace(/^```(?:json)?\s*\n?|```\s*$/gm, '').trim();

  try {
    const parsed = JSON.parse(stripped);
    return Array.isArray(parsed.facts) ? parsed.facts.filter(f => typeof f === 'string' && f.trim()) : [];
  } catch {
    // 如果 JSON 解析失败，按行分割作为 fallback
    return stripped.split('\n').map(l => l.replace(/^[-*\d.]+\s*/, '').trim()).filter(Boolean);
  }
}

// ===================== GET /api/brain/profile/facts =====================

router.get('/', async (req, res) => {
  try {
    const userId = 'owner';
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const category = req.query.category || null;

    const conditions = ['user_id = $1'];
    const params = [userId];

    if (category && VALID_CATEGORIES.includes(category)) {
      conditions.push(`category = $${params.length + 1}`);
      params.push(category);
    }

    const where = conditions.join(' AND ');

    const [rowsResult, countResult] = await Promise.all([
      pool.query(
        `SELECT id, category, content, (embedding IS NOT NULL) as has_embedding, created_at
         FROM user_profile_facts
         WHERE ${where}
         ORDER BY created_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*)::int as total FROM user_profile_facts WHERE ${where}`,
        params
      ),
    ]);

    res.json({
      facts: rowsResult.rows,
      total: countResult.rows[0].total,
    });
  } catch (err) {
    console.error('[profile-facts] GET error:', err.message);
    res.status(500).json({ error: 'Failed to list facts', message: err.message });
  }
});

// ===================== POST /api/brain/profile/facts/import =====================
// 注意：放在 POST /:id 之前，避免 'import' 被解析为 id

router.post('/import', async (req, res) => {
  try {
    const { text, category = 'auto' } = req.body;
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text is required' });
    }

    const facts = await parseFactsFromText(text);
    if (facts.length === 0) {
      return res.json({ imported: 0, facts: [] });
    }

    const userId = 'owner';
    const resolvedCategory = category === 'auto' ? 'other' : (VALID_CATEGORIES.includes(category) ? category : 'other');

    const insertedIds = [];
    for (const content of facts) {
      const result = await pool.query(
        `INSERT INTO user_profile_facts (user_id, category, content)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [userId, resolvedCategory, content.trim()]
      );
      insertedIds.push(result.rows[0].id);
    }

    // fire-and-forget embeddings
    for (let i = 0; i < insertedIds.length; i++) {
      Promise.resolve().then(() =>
        generateProfileFactEmbeddingAsync(insertedIds[i], facts[i])
      ).catch(() => {});
    }

    res.json({ imported: insertedIds.length, facts });
  } catch (err) {
    console.error('[profile-facts] POST /import error:', err.message);
    res.status(500).json({ error: 'Import failed', message: err.message });
  }
});

// ===================== POST /api/brain/profile/facts =====================

router.post('/', async (req, res) => {
  try {
    const { content, category = 'other' } = req.body;
    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'content is required' });
    }

    const userId = 'owner';
    const resolvedCategory = VALID_CATEGORIES.includes(category) ? category : 'other';

    const result = await pool.query(
      `INSERT INTO user_profile_facts (user_id, category, content)
       VALUES ($1, $2, $3)
       RETURNING id, category, content, (embedding IS NOT NULL) as has_embedding, created_at`,
      [userId, resolvedCategory, content.trim()]
    );

    const fact = result.rows[0];

    // fire-and-forget embedding
    Promise.resolve().then(() =>
      generateProfileFactEmbeddingAsync(fact.id, content)
    ).catch(() => {});

    res.status(201).json(fact);
  } catch (err) {
    console.error('[profile-facts] POST error:', err.message);
    res.status(500).json({ error: 'Failed to create fact', message: err.message });
  }
});

// ===================== PUT /api/brain/profile/facts/:id =====================

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { content, category } = req.body;

    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'content is required' });
    }

    const updates = ['content = $2', 'embedding = NULL'];
    const params = ['owner', content.trim()];

    if (category && VALID_CATEGORIES.includes(category)) {
      updates.push(`category = $${params.length + 1}`);
      params.push(category);
    }

    params.push(id);
    const result = await pool.query(
      `UPDATE user_profile_facts
       SET ${updates.join(', ')}
       WHERE id = $${params.length} AND user_id = $1
       RETURNING id, category, content, (embedding IS NOT NULL) as has_embedding, created_at`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Fact not found' });
    }

    const fact = result.rows[0];

    // 重新生成 embedding
    Promise.resolve().then(() =>
      generateProfileFactEmbeddingAsync(fact.id, content)
    ).catch(() => {});

    res.json(fact);
  } catch (err) {
    console.error('[profile-facts] PUT error:', err.message);
    res.status(500).json({ error: 'Failed to update fact', message: err.message });
  }
});

// ===================== DELETE /api/brain/profile/facts/:id =====================

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM user_profile_facts WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, 'owner']
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Fact not found' });
    }

    res.json({ deleted: true, id });
  } catch (err) {
    console.error('[profile-facts] DELETE error:', err.message);
    res.status(500).json({ error: 'Failed to delete fact', message: err.message });
  }
});

export default router;
