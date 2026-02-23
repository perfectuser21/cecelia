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

const EXTRACT_PROMPT = `你是一个信息提取助手。从以下对话中提取用户透露的**稳定的、长期的个人事实**。

只提取以下类型：
- display_name: 用户的名字
- focus_area: 用户当前的重点工作/关注方向
- preferred_style: 回答风格，只能是 "brief" 或 "detailed"
- raw_facts: 其他值得长期记住的 KV 事实

规则：
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
    ...recent.map(m => `${m.role === 'user' ? '用户' : 'Cecelia'}: ${m.content}`),
    ...(reply.trim() ? [`Cecelia: ${reply}`] : []),
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
    console.log('[user-profile] Updated user facts:', Object.keys(facts));
  } catch (err) {
    console.warn('[user-profile] extractAndSaveUserFacts failed (ignored):', err.message);
  }
}
