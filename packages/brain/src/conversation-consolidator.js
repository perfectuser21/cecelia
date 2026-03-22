/**
 * Conversation Consolidator - 对话空闲超时总结
 *
 * 机制：Brain 每 5 分钟调用一次 runConversationConsolidator()
 * 条件：unified_conversations（channel='dashboard'）最后一条消息距今 ≥ 30 分钟
 *       且 那 30 分钟窗口内有对话内容（非一直静默）
 * 动作：取窗口内全部对话 → LLM 压缩总结 → 写入 memory_stream
 *       若有明确结论/决策 → 同步写 learnings
 *       更新 working_memory last_conversation_summary_at 防重复
 */

/* global console */
import crypto from 'crypto';
import pool from './db.js';
import { callLLM } from './llm-caller.js';

const IDLE_THRESHOLD_MS = 30 * 60 * 1000; // 30 分钟
const WORKING_MEMORY_KEY = 'last_conversation_summary_at';

/**
 * 检查是否满足触发条件
 * @returns {{ shouldRun: true, windowStart: Date, windowEnd: Date } | null}
 */
async function checkTriggerCondition() {
  const lastMsgResult = await pool.query(`
    SELECT MAX(created_at) AS last_at
    FROM unified_conversations
    WHERE channel = 'dashboard'
  `);
  const lastAt = lastMsgResult.rows[0]?.last_at;
  if (!lastAt) return null;

  const now = Date.now();
  const lastAtMs = new Date(lastAt).getTime();
  const idleMs = now - lastAtMs;

  // 条件1：空闲 >= 30 分钟
  if (idleMs < IDLE_THRESHOLD_MS) return null;

  const windowEnd = new Date(lastAt);
  const windowStart = new Date(lastAtMs - IDLE_THRESHOLD_MS);

  // 条件2：窗口内有对话内容
  const countResult = await pool.query(`
    SELECT COUNT(*) AS cnt
    FROM unified_conversations
    WHERE channel = 'dashboard'
      AND created_at >= $1
      AND created_at <= $2
  `, [windowStart, windowEnd]);
  const cnt = parseInt(countResult.rows[0]?.cnt || '0', 10);
  if (cnt === 0) return null;

  // 条件3：防重复 — 上次总结覆盖了这段窗口则跳过
  const wmResult = await pool.query(
    `SELECT value_json FROM working_memory WHERE key = $1 LIMIT 1`,
    [WORKING_MEMORY_KEY]
  );
  if (wmResult.rows.length > 0) {
    const raw = String(wmResult.rows[0].value_json).replace(/^"|"$/g, '');
    const lastSummaryAt = new Date(raw);
    if (!isNaN(lastSummaryAt.getTime()) && lastSummaryAt >= windowStart) {
      return null;
    }
  }

  return { shouldRun: true, windowStart, windowEnd };
}

/**
 * 取窗口内全部对话，格式化为对话文本
 */
async function fetchConversationWindow(windowStart, windowEnd) {
  const result = await pool.query(`
    SELECT role, content, created_at
    FROM unified_conversations
    WHERE channel = 'dashboard'
      AND created_at >= $1
      AND created_at <= $2
    ORDER BY created_at ASC
  `, [windowStart, windowEnd]);

  if (!result.rows.length) return '';

  return result.rows.map(row => {
    const speaker = row.role === 'user' ? 'Alex' : 'Cecelia';
    return `${speaker}：${(row.content || '').slice(0, 500)}`;
  }).join('\n');
}

/**
 * 调 LLM 压缩总结对话
 */
async function summarizeConversation(conversationText) {
  const prompt = `你是 Cecelia，刚完成了一段对话。对这段对话做压缩总结。

对话内容：
${conversationText.slice(0, 3000)}

输出 JSON：
{
  "topic": "核心话题（<50字）",
  "summary": "总结：讨论了什么，达成了什么（<300字）",
  "conclusions": ["结论1"],
  "todos": ["待办1"],
  "has_decision": true/false,
  "decision_content": "决策内容（has_decision=true 时填，<150字）"
}
严格输出 JSON，不要其他内容。`;

  const { text } = await callLLM('thalamus', prompt, { maxTokens: 600, timeout: 60000 });
  if (!text) return null;

  const jsonStr = text.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonStr) return null;

  return JSON.parse(jsonStr);
}

/**
 * 主入口：空闲超时对话总结
 */
export async function runConversationConsolidator() {
  try {
    const condition = await checkTriggerCondition();
    if (!condition) return;

    const { windowStart, windowEnd } = condition;
    console.log(`[conversation-consolidator] 触发总结 ${windowStart.toISOString()} → ${windowEnd.toISOString()}`);

    const conversationText = await fetchConversationWindow(windowStart, windowEnd);
    if (!conversationText) return;

    const summary = await summarizeConversation(conversationText);
    if (!summary?.topic) return;

    // 写入 memory_stream（importance=7，按分级 >=5 → 90天）
    const memoryContent = [
      `[对话总结] ${summary.topic}`,
      summary.summary,
      summary.conclusions?.length ? `结论：${summary.conclusions.join('；')}` : '',
      summary.todos?.length ? `待办：${summary.todos.join('；')}` : '',
    ].filter(Boolean).join('\n');

    await pool.query(`
      INSERT INTO memory_stream (content, importance, memory_type, source_type, expires_at)
      VALUES ($1, 7, 'long', 'conversation_summary', NOW() + INTERVAL '90 days')
    `, [memoryContent]);

    console.log(`[conversation-consolidator] memory_stream 写入: "${summary.topic}"`);

    // 有明确决策 → 写 learnings（去重）
    if (summary.has_decision && summary.decision_content) {
      const hashInput = `${summary.topic}\n${summary.decision_content}`;
      const contentHash = crypto.createHash('sha256').update(hashInput).digest('hex').slice(0, 16);
      const existing = await pool.query(
        'SELECT id FROM learnings WHERE content_hash = $1 AND is_latest = true LIMIT 1',
        [contentHash]
      );
      if (existing.rows.length === 0) {
        await pool.query(`
          INSERT INTO learnings (title, content, category, trigger_event, content_hash, version, is_latest, digested)
          VALUES ($1, $2, 'conversation_decision', 'conversation_consolidator', $3, 1, true, false)
        `, [summary.topic, summary.decision_content, contentHash]);
        console.log(`[conversation-consolidator] learnings 写入决策: "${summary.topic}"`);
      }
    }

    // 更新防重时间戳
    await pool.query(`
      INSERT INTO working_memory (key, value_json, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
    `, [WORKING_MEMORY_KEY, JSON.stringify(windowEnd.toISOString())]);

  } catch (err) {
    console.warn('[conversation-consolidator] 运行失败（非阻断）:', err.message);
  }
}
