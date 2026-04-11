/**
 * Brain API: LLM Service
 *
 * POST /api/brain/llm/call   外部系统（如 zenithjoy）调用 LLM 的统一入口
 */

import express from 'express';
import { callLLM } from '../llm-caller.js';

const router = express.Router();

/**
 * POST /llm/call
 * Body: { model, messages, system_prompt?, max_tokens?, temperature? }
 * Resp: { content, usage, latency_ms }
 */
router.post('/call', async (req, res) => {
  const startAt = Date.now();
  try {
    const { model, messages, system_prompt, max_tokens, temperature } = req.body;
    if (!model || !messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'model 和 messages 为必填字段' });
    }

    const result = await callLLM({
      model,
      messages,
      system: system_prompt,
      max_tokens: max_tokens || 2048,
      temperature: temperature ?? 0.7,
    });

    res.json({
      content: result.content || result,
      usage: result.usage || null,
      latency_ms: Date.now() - startAt,
    });
  } catch (err) {
    console.error('[llm-service] POST /call error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
