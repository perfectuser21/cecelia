/**
 * Layer 4: 欲望形成层（Desire Formation）
 *
 * 反思后基于洞察生成 desires 表记录。
 * 字段：{ type, content, insight, proposed_action, urgency, evidence, expires_at, status }
 * type: inform / propose / warn / celebrate / question
 */

import { callLLM } from '../llm-caller.js';

const VALID_TYPES = ['inform', 'propose', 'warn', 'celebrate', 'question', 'act', 'follow_up'];

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

type 选择：
- act：你自己能处理的事（创建任务、调整优先级、触发检查）— 优先选这个
- follow_up：之前做过的事需要跟进（验收结果、催促进度）
- warn：风险、失败、异常
- propose：建议改进、新想法（需要 Alex 同意）
- inform：一般性汇报
- celebrate：好消息、里程碑
- question：需要 Alex 决策的问题

重要：如果是你自己能处理的事，优先选 act/follow_up，不要只是 inform Alex。`;

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
