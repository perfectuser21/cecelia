/**
 * Greet — 用户到来时的主动问候
 *
 * 当用户打开 Dashboard 时，前端 POST /api/brain/greet。
 * 后端根据当前系统状态生成一段自然语言问候，
 * 通过 WebSocket DESIRE_EXPRESSED 推送到 VoiceCard。
 *
 * 冷却：5 分钟内不重复生成（防刷 + 省钱）。
 */

import pool from './db.js';
import { callLLM } from './llm-caller.js';
import { getBriefing } from './briefing.js';

const GREET_COOLDOWN_MS = 5 * 60 * 1000; // 5 分钟

/**
 * 检查是否在冷却期
 * @returns {Promise<boolean>} true = 在冷却期，不应生成新问候
 */
export async function isInCooldown() {
  const { rows } = await pool.query(
    "SELECT value_json FROM working_memory WHERE key = 'last_greet_at'"
  );
  if (rows.length === 0) return false;
  const lastGreetAt = new Date(rows[0].value_json).getTime();
  return (Date.now() - lastGreetAt) < GREET_COOLDOWN_MS;
}

/**
 * 记录问候时间 + 用户在线
 */
async function recordGreetAndPresence() {
  const now = new Date().toISOString();
  await pool.query(`
    INSERT INTO working_memory (key, value_json, updated_at)
    VALUES ('last_greet_at', $1, NOW())
    ON CONFLICT (key) DO UPDATE SET value_json = $1, updated_at = NOW()
  `, [JSON.stringify(now)]);

  await pool.query(`
    INSERT INTO working_memory (key, value_json, updated_at)
    VALUES ('user_last_seen', $1, NOW())
    ON CONFLICT (key) DO UPDATE SET value_json = $1, updated_at = NOW()
  `, [JSON.stringify(now)]);
}

/**
 * 生成情境化问候
 * @returns {Promise<{message: string, type: string, urgency: number} | null>}
 *   null = 冷却期或生成失败
 */
export async function generateGreeting() {
  // 冷却检查
  if (await isInCooldown()) {
    return null;
  }

  // 记录问候时间 + 用户在线
  await recordGreetAndPresence();

  // 获取当前系统状态
  const briefing = await getBriefing();

  // 构建 prompt
  const prompt = buildGreetPrompt(briefing);

  try {
    const { text } = await callLLM('mouth', prompt, { timeout: 15000, maxTokens: 256 });
    const message = text.trim();
    if (!message) return null;

    return {
      message,
      type: 'inform',
      urgency: 3,
    };
  } catch (err) {
    console.error('[greet] LLM 调用失败，降级到静态问候:', err.message);
    // 降级：返回基于数据的简单问候
    return buildFallbackGreeting(briefing);
  }
}

/**
 * 构建 LLM prompt
 */
function buildGreetPrompt(briefing) {
  const stats = briefing.since_last_visit || {};
  const runningTasks = briefing.running_tasks || [];
  const pendingDecisions = briefing.pending_decisions || [];
  const focus = briefing.today_focus;

  const lines = [
    '你是 Cecelia，Alex 的私人管家。Alex 刚打开了 Dashboard，你要主动跟他打个招呼。',
    '',
    '要求：',
    '- 用中文，1-3 句话，简洁自然，像管家汇报',
    '- 根据当前时间段选择合适的问候（早上好/下午好/晚上好）',
    '- 提及当前最重要的 1-2 件事（运行中的任务、异常、排队情况）',
    '- 如果有失败的任务或待决策，优先提及',
    '- 不要用 markdown，不要用"**"，纯文字',
    '- 语气亲切但专业，像一个高效的管家',
    '- 不要说"欢迎回来"这种套话，直接说有用的信息',
    '',
    '当前系统状态：',
    `- 时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
    `- 今日完成：${stats.completed || 0} 个任务`,
    `- 今日失败：${stats.failed || 0} 个任务`,
    `- 排队中：${stats.queued || 0} 个任务`,
    `- 运行中：${stats.in_progress || 0} 个任务`,
  ];

  if (runningTasks.length > 0) {
    lines.push(`- 运行中任务: ${runningTasks.map(t => `${t.title}(${t.priority})`).join(', ')}`);
  }

  if (pendingDecisions.length > 0) {
    lines.push(`- 待决策：${pendingDecisions.length} 个（最高优先级: "${pendingDecisions[0]?.summary?.slice(0, 50) || '...'}"）`);
  }

  if (focus) {
    lines.push(`- 今日焦点：${focus.title}（进度 ${focus.progress}%）`);
  }

  lines.push('', '请生成问候（纯文字，1-3 句）：');

  return lines.join('\n');
}

/**
 * LLM 失败时的降级问候
 */
function buildFallbackGreeting(briefing) {
  const hour = new Date().getHours();
  let timeGreet;
  if (hour < 6) timeGreet = '夜深了';
  else if (hour < 12) timeGreet = '早上好';
  else if (hour < 14) timeGreet = '中午好';
  else if (hour < 18) timeGreet = '下午好';
  else timeGreet = '晚上好';

  const stats = briefing.since_last_visit || {};
  const parts = [timeGreet];

  if (stats.in_progress > 0) {
    parts.push(`正在执行 ${stats.in_progress} 个任务`);
  }
  if (stats.failed > 0) {
    parts.push(`有 ${stats.failed} 个任务失败需要关注`);
  }
  if (stats.queued > 0) {
    parts.push(`${stats.queued} 个任务排队中`);
  }

  return {
    message: parts.join('，') + '。',
    type: 'inform',
    urgency: 2,
  };
}
