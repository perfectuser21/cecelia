/**
 * Capture Digestion Job
 * 扫描 inbox captures → 调 LLM 拆解为原子事件 → 写入 capture_atoms 表
 * Brain tick 每轮调用一次 runCaptureDigestion()
 */

import pool from './db.js';

// 动态引入避免 cortex→thalamus 在 tick 测试中触发 mock 链
let _callCortexLLM = null;
async function getCortexLLM() {
  if (!_callCortexLLM) {
    const { callCortexLLM } = await import('./cortex.js');
    _callCortexLLM = callCortexLLM;
  }
  return _callCortexLLM;
}

// 每次最多处理几条 inbox captures
const BATCH_SIZE = parseInt(process.env.CECELIA_CAPTURE_DIGEST_BATCH || '3', 10);

const DIGESTION_PROMPT = `你是 Cecelia 的信息消化模块。用户输入了一段原始内容，你需要把它拆解为一个或多个原子事件。

## 6 种目标类型（target_type）

1. **note** — 笔记记录
   子类型: project_note, daily_diary, meeting_note, idea_note, reflection
2. **knowledge** — 知识沉淀
   子类型: operational（SOP/流程）, reference（外来文章/视频）, domain（领域知识）, insight（洞察/pattern）
3. **content** — 内容种子，将来可加工为发布内容
   子类型: content_seed
4. **task** — 待办事项
   子类型: action_item
5. **decision** — 决策记录
   子类型: decision
6. **event** — 生活事件
   子类型: meal, travel, health, social, family, work, finance

## 输出格式

返回 JSON 数组，每个元素代表一个原子事件：
\`\`\`json
[
  {
    "content": "原子事件的具体内容描述",
    "target_type": "note|knowledge|content|task|decision|event",
    "target_subtype": "具体子类型",
    "confidence": 0.85,
    "reason": "为什么归为这个类型的简短理由"
  }
]
\`\`\`

## 规则

- 一段输入可以拆成多个原子事件（如一段对话可能同时产出一个 task + 一条 knowledge + 一个 event）
- 每个原子事件必须是独立的、自包含的
- confidence 范围 0.00-1.00，表示分类把握程度
- 如果输入太短或无法分类，返回空数组 []
- 只返回 JSON 数组，不要其他文字

## 用户输入

`;

/**
 * 从 LLM 响应中提取 JSON 数组
 */
function extractJsonArray(text) {
  // 尝试直接解析
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
  } catch {}

  // 尝试从 markdown code block 中提取
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }

  // 尝试提取方括号内容
  const bracketMatch = text.match(/\[[\s\S]*\]/);
  if (bracketMatch) {
    try {
      const parsed = JSON.parse(bracketMatch[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }

  return null;
}

/**
 * 验证单个 atom 的字段
 */
function validateAtom(atom) {
  const VALID_TYPES = ['note', 'knowledge', 'content', 'task', 'decision', 'event'];
  if (!atom.content || typeof atom.content !== 'string') return false;
  if (!VALID_TYPES.includes(atom.target_type)) return false;
  if (typeof atom.confidence !== 'number' || atom.confidence < 0 || atom.confidence > 1) {
    atom.confidence = 0.5; // fallback
  }
  return true;
}

/**
 * 主入口：扫描 inbox captures → LLM 拆解 → 写入 capture_atoms
 * @returns {{ processed: number, atoms_created: number }}
 */
export async function runCaptureDigestion() {
  // 1. 查询 inbox captures
  const { rows: captures } = await pool.query(
    `SELECT id, content, source FROM captures
     WHERE status = 'inbox' AND owner = 'user'
     ORDER BY created_at ASC
     LIMIT $1`,
    [BATCH_SIZE]
  );

  if (captures.length === 0) {
    return { processed: 0, atoms_created: 0 };
  }

  console.warn(`[capture-digestion] 发现 ${captures.length} 条 inbox captures，开始消化...`);

  const callCortexLLM = await getCortexLLM();
  let totalAtoms = 0;

  for (const capture of captures) {
    try {
      // 2. 标记为 analyzing
      await pool.query(
        `UPDATE captures SET status = 'processing', updated_at = now() WHERE id = $1`,
        [capture.id]
      );

      // 3. 调 LLM 拆解
      const prompt = DIGESTION_PROMPT + capture.content;
      const { text } = await callCortexLLM(prompt);

      // 4. 解析结果
      const atoms = extractJsonArray(text);
      if (!atoms || atoms.length === 0) {
        console.warn(`[capture-digestion] capture ${capture.id}: LLM 返回空结果，跳过`);
        await pool.query(
          `UPDATE captures SET status = 'done', updated_at = now() WHERE id = $1`,
          [capture.id]
        );
        continue;
      }

      // 5. 写入 capture_atoms
      for (const atom of atoms) {
        if (!validateAtom(atom)) continue;

        await pool.query(
          `INSERT INTO capture_atoms (capture_id, content, target_type, target_subtype, confidence, ai_reason)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            capture.id,
            atom.content,
            atom.target_type,
            atom.target_subtype || null,
            atom.confidence,
            atom.reason || null,
          ]
        );
        totalAtoms++;
      }

      // 6. 标记 capture 为 done
      await pool.query(
        `UPDATE captures SET status = 'done', updated_at = now() WHERE id = $1`,
        [capture.id]
      );

      console.warn(`[capture-digestion] capture ${capture.id}: 拆解为 ${atoms.length} 个 atoms`);
    } catch (err) {
      console.error(`[capture-digestion] capture ${capture.id} 消化失败:`, err.message);
      // 失败时恢复为 inbox，下次重试
      await pool.query(
        `UPDATE captures SET status = 'inbox', updated_at = now() WHERE id = $1`,
        [capture.id]
      ).catch(() => {});
    }
  }

  console.warn(`[capture-digestion] 完成: ${captures.length} captures → ${totalAtoms} atoms`);
  return { processed: captures.length, atoms_created: totalAtoms };
}
