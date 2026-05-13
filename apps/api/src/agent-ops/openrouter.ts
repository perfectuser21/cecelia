/**
 * OpenRouter LLM client — Path 4 Sprint 1
 *
 * 测试钩子：设置 OPENROUTER_FORCE_5XX=1 时，所有请求返回模拟 502 错误，
 * 用于 CI 验证错误处理路径而不消耗真实 token。
 *
 * CI 约定：测试调用时应传入 max_tokens ≤ 20，节省配额。
 */

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'deepseek/deepseek-chat';

export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenRouterRequest {
  messages: OpenRouterMessage[];
  model?: string;
  max_tokens?: number;
  temperature?: number;
}

export interface OpenRouterResponse {
  id: string;
  model: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class OpenRouterError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'OpenRouterError';
  }
}

export async function callOpenRouter(req: OpenRouterRequest): Promise<OpenRouterResponse> {
  // 测试钩子：模拟上游 5xx，不产生真实 API 调用
  if (process.env.OPENROUTER_FORCE_5XX === '1') {
    throw new OpenRouterError(502, 'OPENROUTER_FORCE_5XX: simulated upstream 502');
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new OpenRouterError(500, 'OPENROUTER_API_KEY is not set');
  }

  const body = {
    model: req.model ?? DEFAULT_MODEL,
    messages: req.messages,
    ...(req.max_tokens !== undefined && { max_tokens: req.max_tokens }),
    ...(req.temperature !== undefined && { temperature: req.temperature }),
  };

  const resp = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://github.com/cecelia-monorepo',
      'X-Title': 'Cecelia Agent Ops',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new OpenRouterError(resp.status, `OpenRouter ${resp.status}: ${text}`);
  }

  return resp.json() as Promise<OpenRouterResponse>;
}
