/**
 * Layer 4: 欲望形成层（Desire Formation）
 *
 * 反思后基于洞察生成 desires 表记录。
 * 字段：{ type, content, insight, proposed_action, urgency, evidence, expires_at, status }
 * type: inform / propose / warn / celebrate / question
 */

import { callLLM } from '../llm-caller.js';

const VALID_TYPES = ['inform', 'propose', 'warn', 'celebrate', 'question', 'act', 'follow_up', 'explore'];

/**
 * 基于洞察生成欲望结构
 * @param {string} insight - 反思层产生的洞察
 * @returns {Promise<{type: string, content: string, proposed_action: string, urgency: number}>}
 */
async function generateDesireFromInsight(insight) {
  const prompt = `你是 Cecelia，Alex 的 AI 管家。基于以下反思洞察，生成一个「欲望」——你想要向 Alex 表达什么。

洞察：${insight}

生成 JSON（严格格式，不要其他内容）：
{
  "type": "inform|propose|warn|celebrate|question|act|follow_up",
  "content": "你想说什么（简短，不超过 100 字）",
  "proposed_action": "建议 Alex 做什么 或 你自己打算做什么（具体可执行）",
  "urgency": 1-10
}

type 选择（按优先级）：
- act：你自己能处理的事（创建任务、调整优先级、触发检查）— 最优先
- explore：你发现了自己不理解的模式或知识盲点，想主动去研究 — 好奇心驱动，自主学习
- follow_up：之前做过的事需要跟进（验收结果、催促进度）
- celebrate：好消息、里程碑达成、任务完成率高、KR 进度推进 — 积极信号时优先选这个
- propose：建议改进、新想法、基于反刍洞察的可执行建议
- warn：风险、失败、异常（只在真正有风险时用，不要重复报同一个问题）
- inform：一般性汇报（最后选择）
- question：需要 Alex 决策的问题

重要规则：
1. 好消息用 celebrate，不要用 inform — 让 Alex 感受到进展
2. 可执行建议用 propose，不要用 inform — 让 Alex 看到你在思考
3. 避免重复 warn 同一个问题 — 如果之前已经警告过，用 act 自己解决
4. act/follow_up/explore 不需要 Alex 同意，直接执行
5. 如果洞察中含有「需要研究」「不理解」「值得探索」的内容，优先选 explore`;

  try {
    const { text } = await callLLM('mouth', prompt, { timeout: 20000 });

    // 提取 JSON（支持 markdown 代码块包裹和纯 JSON 两种格式）
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const jsonStr = codeBlockMatch ? codeBlockMatch[1] : text.match(/\{[\s\S]*\}/)?.[0];
    if (!jsonStr) throw new Error('No JSON in response');

    const parsed = JSON.parse(jsonStr);
    const type = VALID_TYPES.includes(parsed.type) ? parsed.type : 'inform';
    const urgency = Math.max(1, Math.min(10, parseInt(parsed.urgency) || 5));

    return {
      type,
      content: parsed.content || insight,
      proposed_action: parsed.proposed_action || '请 Alex 查看',
      urgency
    };
  } catch (err) {
    console.error('[desire-formation] generateDesire error:', err.message);
    return {
      type: 'inform',
      content: insight,
      proposed_action: '请 Alex 查看系统状态',
      urgency: 5
    };
  }
}

/**
 * 基于反思洞察生成 desires 记录
 * @param {import('pg').Pool} pool
 * @param {string} insight - 反思层产生的洞察
 * @returns {Promise<{created: boolean, desire_id?: string}>}
 */
export async function runDesireFormation(pool, insight) {
  if (!insight) return { created: false };

  const desire = await generateDesireFromInsight(insight);

  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

  try {
    const { rows } = await pool.query(`
      INSERT INTO desires (type, content, insight, proposed_action, urgency, evidence, expires_at, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
      RETURNING id
    `, [
      desire.type,
      desire.content,
      insight,
      desire.proposed_action,
      desire.urgency,
      JSON.stringify({ source: 'reflection', timestamp: new Date().toISOString() }),
      expiresAt
    ]);

    // 广播 WebSocket 事件到前端
    try {
      const { publishDesireCreated } = await import('../events/taskEvents.js');
      publishDesireCreated({
        id: rows[0].id,
        type: desire.type,
        urgency: desire.urgency,
        content: desire.content
      });
    } catch (wsErr) {
      console.error('[desire-formation] WebSocket broadcast failed:', wsErr.message);
    }

    return { created: true, desire_id: rows[0].id };
  } catch (err) {
    console.error('[desire-formation] insert error:', err.message);
    return { created: false };
  }
}
