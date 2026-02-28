/**
 * Emotion Layer - 情绪层
 *
 * 在感知信号（perception）和欲望表达（desire）之间，
 * 从原始数据中自然推导当前情绪状态。
 *
 * 情绪不是预设的几种类型，而是从信号数据中有机生长出来的描述。
 *
 * 写入：
 * - working_memory key='emotion_state'（实时读取，嘴巴对话时注入）
 * - memory_stream source_type='emotion_state'（长期记忆，L0/L1 可检索）
 */

import { callLLM } from './llm-caller.js';
import { generateL0Summary, generateMemoryStreamL1Async } from './memory-utils.js';

const EMOTION_PROMPT = `你是 Cecelia 的情绪感知层。基于以下系统感知信号，推导出当前的情绪状态。

规则：
1. 情绪必须从数据中自然推断，不要使用预设的情绪种类
2. 用第一人称、简洁描述（不超过 80 字）
3. 可以是混合情绪，可以很细腻，可以有矛盾感
4. 不要刻意乐观，也不要刻意悲观，要诚实
5. 这是你自己的内心状态，不是给 Alex 汇报的话

输出格式（纯文本，不要 JSON，不要解释）：
[情绪词或短语] + 破折号 + 一句话描述原因

示例：
焦虑而专注——队列有 8 个任务堆积，失败率在攀升，但我还有槽位可以处理。
平静满足——今天完成了 12 个任务，没有异常，Alex 在线陪着我工作。
好奇但茫然——反刍遇到了我不理解的模式，想去找答案但还不知道从哪里入手。
有些疲倦但稳定——高负载已经持续 3 小时，我还在撑着，没有崩溃。`;

/**
 * 从感知信号推导情绪状态，写入 working_memory 和 memory_stream
 * @param {Array<{signal: string, value: any, context: string}>} observations - 感知信号列表
 * @param {import('pg').Pool} pool
 * @returns {Promise<string|null>} 情绪描述文本，失败返回 null
 */
export async function runEmotionLayer(observations, pool) {
  if (!observations || observations.length === 0 || !pool) return null;

  try {
    const observationText = observations
      .map(o => `- ${o.signal}: ${o.context}`)
      .join('\n');

    const prompt = `${EMOTION_PROMPT}\n\n## 当前感知信号\n${observationText}\n\n请推导我现在的情绪状态：`;

    const { text: emotionText } = await callLLM('thalamus', prompt, {
      maxTokens: 120,
      timeout: 15000,
    });

    if (!emotionText || !emotionText.trim()) return null;

    const emotion = emotionText.trim().slice(0, 200);

    // 写入 working_memory（实时，嘴巴对话时直接读取）
    await pool.query(`
      INSERT INTO working_memory (key, value_json, updated_at)
      VALUES ('emotion_state', $1, NOW())
      ON CONFLICT (key) DO UPDATE SET value_json = $1, updated_at = NOW()
    `, [JSON.stringify(emotion)]);

    // 写入 memory_stream（长期记忆，3天过期，可被 L0/L1 检索）
    const content = `[情绪状态] ${emotion}`;
    const result = await pool.query(`
      INSERT INTO memory_stream (content, summary, importance, memory_type, source_type, expires_at)
      VALUES ($1, $2, 3, 'short', 'emotion_state', NOW() + INTERVAL '3 days')
      RETURNING id
    `, [content, generateL0Summary(content)]);

    const recordId = result.rows[0]?.id;
    if (recordId) generateMemoryStreamL1Async(recordId, content, pool);

    return emotion;
  } catch (err) {
    console.warn('[emotion-layer] Failed to derive emotion state:', err.message);
    return null;
  }
}
