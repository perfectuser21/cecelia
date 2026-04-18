/**
 * Brain API: LLM Service（对外 HTTP 暴露）
 *
 * POST /api/brain/llm-service/generate
 *
 * 供内部系统（如 zenithjoy pipeline-worker、creator 服务）统一调用 LLM 写文案 /
 * 审查图片 / 生成结构化输出。直接复用 brain 内部的 callLLM（tier 映射 → model/provider
 * → 账号选择 → 降级瀑布），调用方只需提供 tier + prompt。
 *
 * 鉴权：挂在 internalAuth 中间件之后（见 routes.js 的 /llm-service 挂载）。
 *
 * 请求 body:
 *   {
 *     "tier": "thalamus" | "cortex" | "mouth" | "reflection" | "narrative" | "memory" | "fact_extractor",
 *     "prompt": "...",
 *     "max_tokens": 8192,           // 可选，默认 2048，硬上限 16384
 *     "timeout": 180,               // 秒，默认 180，硬上限 600
 *     "format": "text" | "json"     // 可选，json 时会将 JSON hint 追加到 prompt
 *   }
 *
 * 响应成功:
 *   {
 *     "success": true,
 *     "data": {
 *       "text": "...",
 *       "content": "...",           // 同 text，兼容调用方
 *       "model": "claude-...",
 *       "provider": "anthropic-api",
 *       "tier": "thalamus",
 *       "elapsed_ms": 1234,
 *       "tokens_used": { "input": null, "output": null },
 *       "account_id": null
 *     },
 *     "error": null
 *   }
 *
 * 响应错误:
 *   { "success": false, "data": null, "error": { "code": "...", "message": "..." } }
 */

import express from 'express';
import { callLLM } from '../llm-caller.js';

const router = express.Router();

// 允许的 tier 白名单（对应 model-profile.config.<agentId> 的 brain 层 agent）
const ALLOWED_TIERS = new Set([
  'thalamus',
  'cortex',
  'mouth',
  'reflection',
  'narrative',
  'memory',
  'fact_extractor',
]);

const MAX_TOKENS_CEILING = 16384;
const TIMEOUT_CEILING_SEC = 600;
const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_TIMEOUT_SEC = 180;
const MAX_PROMPT_CHARS = 200_000; // 防止调用方塞巨大 prompt 拖垮 brain

/**
 * 把 callLLM 抛出的错误映射到对外 error.code
 */
function classifyError(err) {
  const msg = (err && err.message) || '';
  const status = err && err.status;

  if (err && err.degraded) {
    return { code: 'LLM_TIMEOUT', message: msg || 'LLM call timed out' };
  }
  if (/timeout/i.test(msg) || /timed out/i.test(msg)) {
    return { code: 'LLM_TIMEOUT', message: msg };
  }
  if (status === 401 || status === 403 || /api key|unauthorized|forbidden/i.test(msg)) {
    return { code: 'LLM_AUTH_FAILED', message: msg };
  }
  if (status === 429 || /rate limit|quota|额度|超配|spending cap/i.test(msg)) {
    return { code: 'LLM_QUOTA_EXCEEDED', message: msg };
  }
  if (status === 413 || /too long|context length|max_tokens|prompt.*too/i.test(msg)) {
    return { code: 'LLM_PROMPT_TOO_LONG', message: msg };
  }
  return { code: 'LLM_CALL_FAILED', message: msg || 'LLM call failed' };
}

router.post('/generate', async (req, res) => {
  const body = req.body || {};
  const { tier, prompt, format } = body;

  // ===== 参数校验 =====
  if (!tier || typeof tier !== 'string') {
    return res.status(400).json({
      success: false,
      data: null,
      error: { code: 'INVALID_TIER', message: 'tier 必填（string）' },
    });
  }
  if (!ALLOWED_TIERS.has(tier)) {
    return res.status(400).json({
      success: false,
      data: null,
      error: {
        code: 'INVALID_TIER',
        message: `tier 非法，必须是 ${[...ALLOWED_TIERS].join(' | ')}`,
      },
    });
  }
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({
      success: false,
      data: null,
      error: { code: 'INVALID_PROMPT', message: 'prompt 必填（非空 string）' },
    });
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return res.status(400).json({
      success: false,
      data: null,
      error: {
        code: 'PROMPT_TOO_LARGE',
        message: `prompt 超过 ${MAX_PROMPT_CHARS} 字符上限`,
      },
    });
  }

  // max_tokens 归一化
  let maxTokens = body.max_tokens ?? body.maxTokens ?? DEFAULT_MAX_TOKENS;
  if (typeof maxTokens !== 'number' || !Number.isFinite(maxTokens) || maxTokens <= 0) {
    return res.status(400).json({
      success: false,
      data: null,
      error: { code: 'INVALID_MAX_TOKENS', message: 'max_tokens 必须为正整数' },
    });
  }
  if (maxTokens > MAX_TOKENS_CEILING) {
    return res.status(400).json({
      success: false,
      data: null,
      error: {
        code: 'INVALID_MAX_TOKENS',
        message: `max_tokens 不得超过 ${MAX_TOKENS_CEILING}`,
      },
    });
  }
  maxTokens = Math.floor(maxTokens);

  // timeout（秒）归一化
  let timeoutSec = body.timeout ?? DEFAULT_TIMEOUT_SEC;
  if (typeof timeoutSec !== 'number' || !Number.isFinite(timeoutSec) || timeoutSec <= 0) {
    return res.status(400).json({
      success: false,
      data: null,
      error: { code: 'INVALID_TIMEOUT', message: 'timeout 必须为正数（秒）' },
    });
  }
  if (timeoutSec > TIMEOUT_CEILING_SEC) {
    return res.status(400).json({
      success: false,
      data: null,
      error: {
        code: 'INVALID_TIMEOUT',
        message: `timeout 不得超过 ${TIMEOUT_CEILING_SEC} 秒`,
      },
    });
  }
  const timeoutMs = Math.floor(timeoutSec * 1000);

  // format（可选）
  if (format != null && format !== 'text' && format !== 'json') {
    return res.status(400).json({
      success: false,
      data: null,
      error: { code: 'INVALID_FORMAT', message: "format 必须是 'text' 或 'json'" },
    });
  }

  // 如果调用方要 json，追加 hint（callLLM 本身无 format 能力，走 prompt 诱导）
  let finalPrompt = prompt;
  if (format === 'json') {
    finalPrompt = `${prompt}\n\n请严格输出单个合法的 JSON 对象，不要附加任何解释文字或 Markdown 代码块标记。`;
  }

  // ===== 调用 callLLM =====
  try {
    const result = await callLLM(tier, finalPrompt, {
      timeout: timeoutMs,
      maxTokens,
    });
    // callLLM 返回 { text, model, provider, elapsed_ms, attempted_fallback? }
    const text = result?.text || '';
    return res.json({
      success: true,
      data: {
        text,
        content: text, // 兼容 copywriting.py:83 等调用方
        model: result?.model || null,
        provider: result?.provider || null,
        tier,
        elapsed_ms: result?.elapsed_ms ?? null,
        // callLLM 目前不返回 token 用量/账号，占位字段保持契约
        tokens_used: { input: null, output: null },
        account_id: null,
        attempted_fallback: Boolean(result?.attempted_fallback),
      },
      error: null,
    });
  } catch (err) {
    const classified = classifyError(err);
    console.error(
      `[llm-service] generate 失败 tier=${tier} code=${classified.code}: ${classified.message}`
    );
    return res.status(500).json({
      success: false,
      data: null,
      error: classified,
    });
  }
});

export default router;
