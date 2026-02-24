/**
 * Layer 6: 表达层（Expression）
 *
 * 接收表达决策层选出的 desire，生成消息文本并发送 Feishu。
 * 格式：观察 → 判断 → 建议 → 是否需要 Alex 决定
 * 渠道：Feishu（inform/warn/celebrate）+ proposals 表（propose/question）
 */

import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { sendFeishu } from '../notifier.js';

let _minimaxKey = null;

function getMinimaxKey() {
  if (_minimaxKey) return _minimaxKey;
  try {
    const credPath = join(homedir(), '.credentials', 'minimax.json');
    const cred = JSON.parse(readFileSync(credPath, 'utf-8'));
    _minimaxKey = cred.api_key;
    return _minimaxKey;
  } catch (err) {
    console.error('[expression] Failed to load MiniMax credentials:', err.message);
    return null;
  }
}

function stripThinking(content) {
  if (!content) return '';
  return content.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
}

/**
 * 用 MiniMax 生成格式化的 Feishu 消息
 * @param {Object} desire - desires 表记录
 * @returns {Promise<string>}
 */
async function generateMessage(desire) {
  const apiKey = getMinimaxKey();

  const typeLabel = {
    inform: '📊 汇报',
    propose: '💡 提案',
    warn: '⚠️ 预警',
    celebrate: '🎉 好消息',
    question: '❓ 需要决定'
  }[desire.type] || '📝 消息';

  if (!apiKey) {
    // 无 API key 时使用简单格式
    return `${typeLabel}\n\n${desire.content}\n\n建议：${desire.proposed_action}`;
  }

  const prompt = `你是 Cecelia，Alex 的 AI 管家。请把以下信息格式化为一条 Feishu 消息，发给 Alex。

类型：${typeLabel}
内容：${desire.content}
洞察：${desire.insight || '无'}
建议行动：${desire.proposed_action}
紧迫度：${desire.urgency}/10

消息格式（严格遵守）：
**${typeLabel}**

**观察**：[1-2句，说清楚发生了什么]

**判断**：[1-2句，这意味着什么]

**建议**：[具体可执行的建议]

${desire.type === 'question' || desire.type === 'propose' ? '**需要 Alex 决定**：[明确说明需要 Alex 做什么决定]' : ''}

要求：简洁、专业、直接。不超过 150 字。`;

  try {
    const response = await fetch('https://api.minimaxi.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'MiniMax-M2.5-highspeed',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }]
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) throw new Error(`MiniMax API error: ${response.status}`);

    const data = await response.json();
    const rawText = data.choices?.[0]?.message?.content || '';
    const text = stripThinking(rawText);
    return text || `${typeLabel}\n\n${desire.content}\n\n建议：${desire.proposed_action}`;
  } catch (err) {
    console.error('[expression] generateMessage error:', err.message);
    return `${typeLabel}\n\n${desire.content}\n\n建议：${desire.proposed_action}`;
  }
}

/**
 * 执行表达：发送 Feishu，更新 desire 状态，记录 last_feishu_at
 * @param {import('pg').Pool} pool
 * @param {Object} desire - desires 表记录
 * @returns {Promise<{sent: boolean, message?: string}>}
 */
export async function runExpression(pool, desire) {
  const message = await generateMessage(desire);

  // 发送 Feishu
  const sent = await sendFeishu(message);

  // 更新 desire 状态
  try {
    await pool.query(
      "UPDATE desires SET status = 'expressed' WHERE id = $1",
      [desire.id]
    );
  } catch (err) {
    console.error('[expression] update desire status error:', err.message);
  }

  // 记录 last_feishu_at（无论是否发送成功，只要触发了表达就记录）
  try {
    await pool.query(`
      INSERT INTO working_memory (key, value_json, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
    `, ['last_feishu_at', new Date().toISOString()]);
  } catch (err) {
    console.error('[expression] update last_feishu_at error:', err.message);
  }

  return { sent, message };
}
