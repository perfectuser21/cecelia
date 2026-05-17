/**
 * WeChat RPA 路由 — Path 4 Sprint 1
 *
 * 3 个端点，全部使用 Zod 验证请求体，400/404 严格返回。
 *
 * POST /api/agent-ops/wechat/action   — 触发单次 RPA 动作
 * GET  /api/agent-ops/wechat/sessions — 查询会话历史
 * POST /api/agent-ops/wechat/llm      — 调用 OpenRouter 生成回复文本
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { spawnRpaHandler } from './wechat-rpa-handler.js';
import { callOpenRouter, OpenRouterError } from './openrouter.js';

const router = Router();

// ─── Zod schema ───────────────────────────────────────────────────────────────

const ActionSchema = z.object({
  action_type: z.enum(['send_message', 'screenshot', 'click', 'read_inbox', 'health_check']),
  target: z.string().min(1).optional(),
  content: z.string().optional(),
  dryrun: z.boolean().default(false),
  agent_id: z.string().uuid().optional(),
});

const LlmSchema = z.object({
  prompt: z.string().min(1).max(4096),
  max_tokens: z.number().int().min(1).max(4096).default(512),
  system: z.string().max(2048).optional(),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function zodError(res: Response, err: z.ZodError): void {
  res.status(400).json({
    error: 'validation_failed',
    details: err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  });
}

// ─── POST /api/agent-ops/wechat/action ───────────────────────────────────────

router.post('/action', async (req: Request, res: Response) => {
  const parsed = ActionSchema.safeParse(req.body);
  if (!parsed.success) {
    zodError(res, parsed.error);
    return;
  }

  const { action_type, target, content, dryrun, agent_id } = parsed.data;

  try {
    const result = await spawnRpaHandler({
      action_type,
      target,
      content,
      dryrun,
      agent_id,
    });

    res.status(200).json({ status: 'ok', result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'rpa_failed', message: msg });
  }
});

// ─── GET /api/agent-ops/wechat/sessions ──────────────────────────────────────

router.get('/sessions', async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? '20'), 10) || 20, 100);
  const agent_id = req.query.agent_id as string | undefined;

  if (agent_id !== undefined) {
    const idCheck = z.string().uuid().safeParse(agent_id);
    if (!idCheck.success) {
      res.status(400).json({ error: 'invalid_agent_id', message: 'agent_id must be a UUID' });
      return;
    }
  }

  // DB クエリは Brain (localhost:5221) 経由、なければ空リストを返す
  try {
    const brainUrl = process.env.BRAIN_API ?? 'http://localhost:5221';
    const qs = new URLSearchParams({ limit: String(limit) });
    if (agent_id) qs.set('agent_id', agent_id);

    const upstream = await fetch(`${brainUrl}/api/brain/agent-ops/wechat/sessions?${qs}`, {
      signal: AbortSignal.timeout(5000),
    });

    if (upstream.status === 404) {
      res.status(404).json({ error: 'not_found', message: 'Brain agent-ops endpoint not found' });
      return;
    }

    if (!upstream.ok) {
      res.status(502).json({ error: 'upstream_error', message: `Brain returned ${upstream.status}` });
      return;
    }

    const data = await upstream.json();
    res.status(200).json(data);
  } catch {
    // Brain offline — return empty list gracefully
    res.status(200).json({ sessions: [], limit, total: 0 });
  }
});

// ─── POST /api/agent-ops/wechat/llm ──────────────────────────────────────────

router.post('/llm', async (req: Request, res: Response) => {
  const parsed = LlmSchema.safeParse(req.body);
  if (!parsed.success) {
    zodError(res, parsed.error);
    return;
  }

  const { prompt, max_tokens, system } = parsed.data;

  try {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: prompt });

    const resp = await callOpenRouter({ messages, max_tokens });

    const text = resp.choices[0]?.message?.content ?? '';
    res.status(200).json({
      text,
      model: resp.model,
      usage: resp.usage,
    });
  } catch (err) {
    if (err instanceof OpenRouterError) {
      const httpStatus = err.statusCode >= 500 ? 502 : 400;
      res.status(httpStatus).json({ error: 'llm_error', message: err.message });
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'internal', message: msg });
  }
});

export default router;
