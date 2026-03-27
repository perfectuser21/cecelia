/**
 * doc-chat.js — 文档+聊天分栏 API
 *
 * POST /api/brain/doc-chat
 *   - 接受文档内容 + 对话历史 + 用户消息 + 模型偏好
 *   - 以文档全文作为上下文调用 LLM
 *   - 解析回复中的 <doc_update>...</doc_update> 标记
 *   - 如有更新标记则返回 docContent，并可选持久化到 design_docs
 *
 * 返回：{ success, reply, docContent? }
 */

/* global console */

import { Router } from 'express';
import { callLLM } from '../llm-caller.js';
import pool from '../db.js';

const router = Router();

const MODEL_MAP = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-6',
};

const SYSTEM_PROMPT_TEMPLATE = (docContent) => `你是一个文档编辑助手。用户正在编辑以下文档：

<document>
${docContent || '（空文档）'}
</document>

你可以：
1. 回答用户关于文档的问题
2. 提供修改建议
3. 如果用户要求更新文档内容，用以下格式返回更新后的**完整**文档：

<doc_update>
更新后的完整文档内容（Markdown 格式）
</doc_update>

注意：
- 只有用户明确要求修改文档时才输出 <doc_update> 块
- <doc_update> 块必须包含完整的文档内容，而非片段
- 在 <doc_update> 块之外正常回复用户`;

/**
 * 从 LLM 回复中提取 <doc_update> 内容
 * @param {string} reply
 * @returns {{ reply: string, docContent: string|null }}
 */
export function extractDocUpdate(reply) {
  const match = reply.match(/<doc_update>([\s\S]*?)<\/doc_update>/);
  if (!match) return { reply, docContent: null };

  const docContent = match[1].trim();
  // 从回复中移除 <doc_update> 块，保留对话部分
  const cleanReply = reply.replace(/<doc_update>[\s\S]*?<\/doc_update>/g, '').trim();
  return { reply: cleanReply || '文档已更新。', docContent };
}

/** POST / — 文档聊天 */
router.post('/', async (req, res) => {
  try {
    const {
      message,
      messages = [],
      docContent = '',
      docId,
      model = 'haiku',
    } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, error: 'message 不能为空' });
    }

    const resolvedModel = MODEL_MAP[model] || MODEL_MAP.haiku;
    const systemPrompt = SYSTEM_PROMPT_TEMPLATE(docContent);

    // 构建对话历史（最近 10 条）
    const historySlice = messages.slice(-10);
    let prompt = systemPrompt + '\n\n';

    for (const msg of historySlice) {
      const role = msg.role === 'user' ? 'Human' : 'Assistant';
      prompt += `${role}: ${msg.content}\n\n`;
    }
    prompt += `Human: ${message}\n\nAssistant:`;

    const { text } = await callLLM('doc-editor', prompt, {
      model: resolvedModel,
      timeout: 30000,
    });

    const { reply, docContent: updatedDoc } = extractDocUpdate(text);

    // 如有文档更新且有 docId，持久化到 design_docs
    if (updatedDoc && docId) {
      await pool.query(
        'UPDATE design_docs SET content = $1, updated_at = NOW() WHERE id = $2',
        [updatedDoc, docId]
      ).catch(err => console.warn('[doc-chat] Failed to update design_doc:', err.message));
    }

    const response = { success: true, reply };
    if (updatedDoc) response.docContent = updatedDoc;

    res.json(response);
  } catch (err) {
    console.error('[doc-chat] POST / error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
