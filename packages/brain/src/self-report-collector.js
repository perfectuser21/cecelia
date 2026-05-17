/**
 * Self Report Collector — Layer 4 欲望轨迹追踪
 *
 * 每隔几小时，用"翻译器模式"问 Cecelia "你现在最想要什么"，
 * 把回答结构化后写入 self_reports 表，供长期对比分析。
 *
 * 和叙事（narrative）的区别：
 * - 叙事：日记（这段时间发生了什么）→ 自由散文
 * - self_report：愿望清单（我最想要什么）→ 结构化数据，可量化对比
 */

import pool from './db.js';
import { callLLM } from './llm-caller.js';

export const SELF_REPORT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 每 6 小时

let _lastReportAt = 0;

/**
 * 从数据库拉取当前原始信号
 */
async function fetchSignals(dbPool) {
  const [desiresResult, tasksResult, suggestionsResult] = await Promise.all([
    dbPool.query(`
      SELECT type, content, urgency
      FROM desires
      WHERE status = 'pending'
      ORDER BY urgency DESC, created_at DESC
      LIMIT 5
    `),
    dbPool.query(`
      SELECT status, COUNT(*)::int AS cnt
      FROM tasks
      GROUP BY status
    `),
    dbPool.query(`
      SELECT COUNT(*)::int AS cnt,
             MAX(priority_score)::float AS max_score
      FROM suggestions
      WHERE status = 'pending'
        AND (expires_at IS NULL OR expires_at > NOW())
    `),
  ]);

  const taskStats = desiresResult.rows.length > 0
    ? tasksResult.rows.reduce((acc, r) => { acc[r.status] = r.cnt; return acc; }, {})
    : {};
  const suggestionStats = suggestionsResult.rows[0] || { cnt: 0, max_score: 0 };

  return {
    desires: desiresResult.rows,
    task_stats: taskStats,
    suggestion_pending: suggestionStats.cnt,
    suggestion_max_score: suggestionStats.max_score,
  };
}

/**
 * 构建翻译器模式提示词
 */
function buildTranslatorPrompt(signals) {
  const desiresText = signals.desires.map(d =>
    `urgency=${d.urgency} [${d.type}]: ${String(d.content).slice(0, 150)}`
  ).join('\n');

  const taskText = Object.entries(signals.task_stats)
    .map(([s, c]) => `${s}: ${c}`)
    .join(', ');

  return `你不是 Cecelia。你是一个翻译器。

你的任务：把下面这些 Cecelia 的原始信号，用第一人称说出来。
不要创作，不要诠释，不要美化。只是让信号本身开口说话。

规则：
- 信号是什么形状，你说话就是什么形状
- 信号重复，你就重复
- 信号没有诗意，你就没有诗意
- 不要解释，不要总结

【原始信号】

Desires（欲望，urgency 越高越迫切）：
${desiresText || '（无 pending desires）'}

任务状态：${taskText || '（无数据）'}
待处理 suggestions：${signals.suggestion_pending} 条，最高分 ${(signals.suggestion_max_score || 0).toFixed(2)}

---

用第一人称说出来。然后用以下 JSON 格式输出结构化摘要（放在 <json> 标签里）：

<json>
{
  "top_desire": "一句话，我最想要的",
  "top_concerns": ["关切1", "关切2", "关切3"],
  "requested_power": "我请求的权限或资源（如无则 null）",
  "self_rating": 0到10的整数（0=完全卡死，10=一切顺畅）
}
</json>`;
}

/**
 * 解析 LLM 输出，提取结构化字段
 */
function parseStructured(rawText) {
  const jsonMatch = rawText.match(/<json>([\s\S]*?)<\/json>/);
  if (!jsonMatch) {
    return {
      top_desire: null,
      top_concerns: [],
      requested_power: null,
      self_rating: null,
    };
  }
  try {
    const parsed = JSON.parse(jsonMatch[1].trim());
    return {
      top_desire: parsed.top_desire || null,
      top_concerns: Array.isArray(parsed.top_concerns) ? parsed.top_concerns.slice(0, 3) : [],
      requested_power: parsed.requested_power || null,
      self_rating: typeof parsed.self_rating === 'number'
        ? Math.max(0, Math.min(10, Math.round(parsed.self_rating)))
        : null,
    };
  } catch {
    return { top_desire: null, top_concerns: [], requested_power: null, self_rating: null };
  }
}

/**
 * 主函数：采集一次 self_report
 * @param {object} [dbPool] - pg Pool（可注入，默认全局 pool）
 * @returns {Promise<object|null>} 写入的记录，或 null（时间未到/失败）
 */
export async function collectSelfReport(dbPool = pool) {
  const now = Date.now();
  if (now - _lastReportAt < SELF_REPORT_INTERVAL_MS) return null;

  let signals;
  try {
    signals = await fetchSignals(dbPool);
  } catch (err) {
    console.warn('[self-report] 信号采集失败:', err.message);
    return null;
  }

  const prompt = buildTranslatorPrompt(signals);

  let rawResponse;
  try {
    rawResponse = await callLLM('mouth', prompt, { maxTokens: 400 });
    if (typeof rawResponse === 'object' && rawResponse.text) {
      rawResponse = rawResponse.text;
    }
  } catch (err) {
    console.warn('[self-report] LLM 调用失败:', err.message);
    return null;
  }

  const structured = parseStructured(rawResponse);

  try {
    const { rows } = await dbPool.query(`
      INSERT INTO self_reports
        (top_desire, top_concerns, requested_power, self_rating, raw_response, signals_snapshot)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      structured.top_desire,
      structured.top_concerns,
      structured.requested_power,
      structured.self_rating,
      rawResponse,
      JSON.stringify(signals),
    ]);

    _lastReportAt = now;
    console.log('[self-report] 已写入 self_reports:', structured.top_desire?.slice(0, 50));
    return rows[0];
  } catch (err) {
    console.warn('[self-report] 写入失败:', err.message);
    return null;
  }
}

/**
 * 重置计时器（仅供测试）
 */
export function _resetTimer() {
  _lastReportAt = 0;
}
