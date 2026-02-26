/**
 * User Profile — 主人画像模块
 *
 * 让 Cecelia 知道她在跟谁说话，并能从对话中学习用户信息。
 *
 * 功能：
 *   1. loadUserProfile(pool, userId)           — 读取用户画像
 *   2. upsertUserProfile(pool, userId, facts)  — 合并更新画像
 *   3. formatProfileSnippet(profile)           — 格式化为 LLM 注入片段
 *   4. extractAndSaveUserFacts(...)            — 从对话提取事实（fire-and-forget）
 */

/* global console */

import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { generateProfileFactEmbeddingAsync } from './embedding-service.js';
import { generateEmbedding } from './openai-client.js';

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

/** 导出用于测试 */
export function _resetApiKey() {
  _apiKey = null;
}

/** 仅测试用：注入 API key，绕过 credentials 文件读取 */
export function _setApiKeyForTest(key) {
  _apiKey = key;
}

function stripThinking(content) {
  if (!content) return '';
  return content.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
}

/**
 * 读取用户画像
 * @param {Object} pool - pg pool
 * @param {string} [userId='owner']
 * @returns {Promise<Object|null>}
 */
export async function loadUserProfile(pool, userId = 'owner') {
  try {
    const result = await pool.query(
      'SELECT * FROM user_profiles WHERE user_id = $1 LIMIT 1',
      [userId]
    );
    return result.rows[0] || null;
  } catch (err) {
    console.warn('[user-profile] loadUserProfile failed:', err.message);
    return null;
  }
}

/**
 * 合并更新用户画像（只更新非空字段，raw_facts 做 JSON merge）
 * @param {Object} pool
 * @param {string} userId
 * @param {Object} facts - { display_name?, focus_area?, preferred_style?, timezone?, raw_facts? }
 * @returns {Promise<Object|null>} 更新后的 profile
 */
export async function upsertUserProfile(pool, userId = 'owner', facts = {}) {
  if (!facts || Object.keys(facts).length === 0) return null;

  const updates = [];
  const values = [userId];
  let idx = 2;

  if (facts.display_name) {
    updates.push(`display_name = $${idx++}`);
    values.push(facts.display_name);
  }
  if (facts.focus_area) {
    updates.push(`focus_area = $${idx++}`);
    values.push(facts.focus_area);
  }
  if (facts.preferred_style) {
    updates.push(`preferred_style = $${idx++}`);
    values.push(facts.preferred_style);
  }
  if (facts.timezone) {
    updates.push(`timezone = $${idx++}`);
    values.push(facts.timezone);
  }
  if (facts.raw_facts && typeof facts.raw_facts === 'object') {
    updates.push(`raw_facts = raw_facts || $${idx++}`);
    values.push(JSON.stringify(facts.raw_facts));
  }

  if (updates.length === 0) return null;

  updates.push('updated_at = NOW()');

  try {
    const result = await pool.query(
      `INSERT INTO user_profiles (user_id) VALUES ($1)
       ON CONFLICT (user_id) DO UPDATE SET ${updates.join(', ')}
       RETURNING *`,
      values
    );
    return result.rows[0] || null;
  } catch (err) {
    console.warn('[user-profile] upsertUserProfile failed:', err.message);
    return null;
  }
}

/**
 * 格式化用户画像为 LLM 注入片段
 * @param {Object} profile
 * @returns {string}
 */
export function formatProfileSnippet(profile) {
  if (!profile) return '';
  const name = profile.display_name || '主人';
  const parts = [`你正在和 ${name} 对话。`];
  if (profile.focus_area) parts.push(`TA 目前的重点方向是：${profile.focus_area}。`);
  if (profile.preferred_style === 'brief') {
    parts.push('TA 偏好简洁的回答。');
  } else {
    parts.push('TA 偏好详细的回答。');
  }
  return `## 主人信息\n${parts.join('')}\n`;
}

/**
 * 向量搜索最相关的用户 facts（需要 OPENAI_API_KEY）
 * @param {Object} pool
 * @param {string} userId
 * @param {string} conversationText - 当前对话上下文（用于生成查询向量）
 * @param {number} [topK=10]
 * @returns {Promise<string[]>} 最相关的 fact content 列表，失败返回 []
 */
async function vectorSearchProfileFacts(pool, userId, conversationText, topK = 10) {
  try {
    const embedding = await generateEmbedding(conversationText.substring(0, 2000));
    const embStr = '[' + embedding.join(',') + ']';
    const result = await pool.query(
      `SELECT content
       FROM user_profile_facts
       WHERE user_id = $1 AND embedding IS NOT NULL
       ORDER BY embedding <=> $2::vector
       LIMIT $3`,
      [userId, embStr, topK]
    );
    return result.rows.map(r => r.content);
  } catch {
    return [];
  }
}

/**
 * 获取用户画像的 LLM 注入文本
 *
 * 当提供 conversationText 且环境具备向量搜索能力时，返回语义最相关的 Top-10 facts。
 * 降级条件：无 OPENAI_API_KEY、无 conversationText、向量搜索失败 → 返回结构化字段片段。
 *
 * @param {Object} pool - pg Pool
 * @param {string} [userId='owner']
 * @param {string} [conversationText=''] - 当前对话文本，用于向量检索
 * @returns {Promise<string>} 格式化的画像片段，无数据时返回 ''
 */
export async function getUserProfileContext(pool, userId = 'owner', conversationText = '') {
  // 尝试向量搜索：需要 API key + 对话上下文
  if (process.env.OPENAI_API_KEY && conversationText.trim()) {
    try {
      const facts = await vectorSearchProfileFacts(pool, userId, conversationText);
      if (facts.length > 0) {
        return `## 关于你\n${facts.map(f => `- ${f}`).join('\n')}\n`;
      }
    } catch {
      // 降级到结构化字段
    }
  }

  // 降级：结构化字段
  const profile = await loadUserProfile(pool, userId);
  return formatProfileSnippet(profile);
}

const EXTRACT_PROMPT = `你是一个信息提取助手。从以下对话中**只提取 Alex（用户）说的话中透露的稳定、长期个人事实**。

对话中有两个角色：
- Alex（用户）：是你要提取信息的对象
- Cecelia（AI管家）：是 AI 助手，不是用户。Cecelia 说的任何内容都不应该被提取为用户事实。

只提取以下类型：
- display_name: Alex 的名字（注意：Cecelia 是 AI 的名字，不是用户的名字）
- focus_area: Alex 当前的重点工作/关注方向
- preferred_style: Alex 的回答风格偏好，只能是 "brief" 或 "detailed"
- raw_facts: 关于 Alex 的其他值得长期记住的 KV 事实

规则：
- 只从 Alex 的发言中提取，忽略 Cecelia 说的一切
- 没有提取到某字段就不包含它
- 整个对话没有值得提取的长期事实，返回 {}
- 不提取一次性的请求或话题
- 只返回 JSON，不要任何解释`;

/**
 * 从对话提取事实并更新用户画像（调用方 fire-and-forget，内部自处理错误）
 * @param {Object} pool
 * @param {string} userId
 * @param {Array} messages - [{role, content}]
 * @param {string} reply - 本次回复
 */
export async function extractAndSaveUserFacts(pool, userId = 'owner', messages = [], reply = '') {
  const apiKey = getApiKey();
  if (!apiKey) return;

  // 没有用户消息且回复为空，不值得提取
  if (messages.length === 0 && !reply.trim()) return;

  const recent = messages.slice(-5);
  const conversationText = [
    ...recent.map(m => `${m.role === 'user' ? 'Alex（用户）' : 'Cecelia（AI管家）'}: ${m.content}`),
    ...(reply.trim() ? [`Cecelia（AI管家）: ${reply}`] : []),
  ].join('\n');

  if (!conversationText.trim()) return;

  try {
    const response = await fetch(MINIMAX_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'MiniMax-M2.5-highspeed',
        messages: [
          { role: 'system', content: EXTRACT_PROMPT },
          { role: 'user', content: `对话内容：\n${conversationText}` },
        ],
        max_tokens: 256,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return;

    const data = await response.json();
    const raw = stripThinking(data.choices?.[0]?.message?.content || '{}');

    let facts = {};
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) facts = JSON.parse(match[0]);
    } catch {
      return;
    }

    if (Object.keys(facts).length === 0) return;

    await upsertUserProfile(pool, userId, facts);

    // 将 raw_facts 中每条 KV 存入 user_profile_facts（向量化存储）
    if (facts.raw_facts && typeof facts.raw_facts === 'object') {
      for (const [key, value] of Object.entries(facts.raw_facts)) {
        const content = `${key}: ${value}`;
        try {
          const result = await pool.query(
            `INSERT INTO user_profile_facts (user_id, category, content)
             VALUES ($1, 'raw', $2)
             RETURNING id`,
            [userId, content]
          );
          const factId = result.rows[0]?.id;
          if (factId) {
            // fire-and-forget embedding
            Promise.resolve().then(() =>
              generateProfileFactEmbeddingAsync(factId, content)
            ).catch(() => {});
          }
        } catch {
          // 静默失败，不影响主流程
        }
      }
    }

    // 结构化字段也存一份（display_name, focus_area 等）
    const structuredFacts = [];
    if (facts.display_name) structuredFacts.push({ category: 'background', content: `名字: ${facts.display_name}` });
    if (facts.focus_area) structuredFacts.push({ category: 'behavior', content: `当前重点方向: ${facts.focus_area}` });
    if (facts.preferred_style) structuredFacts.push({ category: 'preference', content: `回答风格偏好: ${facts.preferred_style}` });

    for (const { category, content } of structuredFacts) {
      try {
        const result = await pool.query(
          `INSERT INTO user_profile_facts (user_id, category, content)
           VALUES ($1, $2, $3)
           RETURNING id`,
          [userId, category, content]
        );
        const factId = result.rows[0]?.id;
        if (factId) {
          Promise.resolve().then(() =>
            generateProfileFactEmbeddingAsync(factId, content)
          ).catch(() => {});
        }
      } catch {
        // 静默失败
      }
    }

    console.log('[user-profile] Updated user facts:', Object.keys(facts));
  } catch (err) {
    console.warn('[user-profile] extractAndSaveUserFacts failed (ignored):', err.message);
  }
}
