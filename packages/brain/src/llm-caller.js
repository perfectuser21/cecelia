/**
 * 统一 LLM 调用层
 *
 * 所有 Brain 组件的 LLM 调用都通过这个模块。
 * 根据 model-profile 配置决定用哪个模型和 provider：
 *   - Anthropic 模型 → 通过 cecelia-bridge /llm-call 调用 claude -p（走订阅）
 *   - MiniMax 模型 → 直接调用 MiniMax API
 *
 * 使用方式：
 *   import { callLLM } from './llm-caller.js';
 *   const { text } = await callLLM('thalamus', prompt);
 *   const { text } = await callLLM('mouth', prompt, { timeout: 15000 });
 */

import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { getActiveProfile } from './model-profile.js';

const BRIDGE_URL = process.env.EXECUTOR_BRIDGE_URL || 'http://localhost:3457';

// Model ID → claude --model flag
const CLAUDE_MODEL_FLAG = {
  'claude-haiku-4-5-20251001': 'haiku',
  'claude-sonnet-4-6': 'sonnet',
  'claude-opus-4-6': 'opus',
};

// MiniMax credentials cache
let _minimaxKey = null;

function getMinimaxKey() {
  if (_minimaxKey) return _minimaxKey;
  try {
    const credPath = join(homedir(), '.credentials', 'minimax.json');
    const cred = JSON.parse(readFileSync(credPath, 'utf-8'));
    _minimaxKey = cred.api_key;
    return _minimaxKey;
  } catch (err) {
    console.error('[llm-caller] Failed to load MiniMax credentials:', err.message);
    return null;
  }
}

function stripThinking(content) {
  if (!content) return '';
  return content.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
}

/**
 * 统一 LLM 调用入口
 * @param {string} agentId - brain 层 agent: 'thalamus' | 'cortex' | 'reflection' | 'mouth'
 * @param {string} prompt - 完整 prompt
 * @param {Object} [options]
 * @param {number} [options.timeout] - 超时毫秒数（默认 90000，Sonnet 并发时需要充足时间）
 * @param {number} [options.maxTokens] - 最大输出 token 数（默认 1024）
 * @param {string} [options.model] - 覆盖 profile 的模型选择
 * @param {string} [options.provider] - 覆盖 profile 的 provider 选择
 * @returns {Promise<{text: string, model: string, provider: string, elapsed_ms: number}>}
 */
export async function callLLM(agentId, prompt, options = {}) {
  const startTime = Date.now();
  const profile = getActiveProfile();

  // 从 profile.config 读取 brain 层 agent 的配置
  const agentConfig = profile?.config?.[agentId] || {};
  const model = options.model || agentConfig.model || 'claude-haiku-4-5-20251001';
  const provider = options.provider || agentConfig.provider || 'anthropic';
  const timeout = options.timeout || 90000;
  const maxTokens = options.maxTokens || 1024;

  let text;

  if (provider === 'anthropic' || CLAUDE_MODEL_FLAG[model]) {
    text = await callClaudeViaBridge(prompt, model, timeout);
  } else if (provider === 'minimax') {
    text = await callMiniMaxAPI(prompt, model, timeout, maxTokens);
  } else {
    throw new Error(`[llm-caller] Unsupported provider: ${provider} for agent ${agentId}`);
  }

  const elapsed = Date.now() - startTime;
  console.log(`[llm-caller] ${agentId} → ${model} (${provider}) in ${elapsed}ms`);

  return { text, model, provider, elapsed_ms: elapsed };
}

/**
 * 通过 cecelia-bridge 调用 claude -p（走订阅，不需要 API key）
 */
async function callClaudeViaBridge(prompt, model, timeout) {
  const claudeModel = CLAUDE_MODEL_FLAG[model] || 'haiku';

  const response = await fetch(`${BRIDGE_URL}/llm-call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      model: claudeModel,
      timeout,
    }),
    signal: AbortSignal.timeout(timeout + 10000), // bridge 自身超时 + 缓冲
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => 'unknown');
    throw new Error(`Bridge /llm-call error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  if (!data.text) {
    throw new Error('Bridge /llm-call returned empty text');
  }

  return data.text;
}

/**
 * 直接调用 MiniMax API（保留兼容，用户可通过前端切换到 MiniMax）
 */
async function callMiniMaxAPI(prompt, model, timeout, maxTokens) {
  const apiKey = getMinimaxKey();
  if (!apiKey) throw new Error('MiniMax API key not available');

  const response = await fetch('https://api.minimaxi.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || 'MiniMax-M2.5-highspeed',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(timeout),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => 'unknown');
    throw new Error(`MiniMax API error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const rawText = data.choices?.[0]?.message?.content || '';
  const text = stripThinking(rawText);
  if (!text) throw new Error('MiniMax returned empty content');

  return text;
}

/**
 * 流式 MiniMax API 调用（SSE 解析）
 * @param {string} prompt - 完整 prompt
 * @param {string} model - 模型 ID
 * @param {number} timeout - 超时毫秒
 * @param {Function} onChunk - (delta: string, isDone: boolean) => void
 */
async function callMiniMaxAPIStream(prompt, model, timeout, onChunk) {
  const apiKey = getMinimaxKey();
  if (!apiKey) throw new Error('MiniMax API key not available');

  const response = await fetch('https://api.minimaxi.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || 'MiniMax-M2.5-highspeed',
      max_tokens: 2048,
      stream: true,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(timeout),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => 'unknown');
    throw new Error(`MiniMax stream API error: ${response.status} - ${errText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // 保留未完成的行

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') {
          onChunk('', true);
          return;
        }
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content || '';
          if (delta) onChunk(delta, false);
        } catch { /* skip malformed chunk */ }
      }
    }
  } finally {
    reader.releaseLock();
  }

  onChunk('', true);
}

/**
 * 流式 LLM 调用入口
 * @param {string} agentId - agent ID
 * @param {string} prompt - 完整 prompt
 * @param {Object} [options]
 * @param {Function} onChunk - (delta: string, isDone: boolean) => void
 */
export async function callLLMStream(agentId, prompt, options = {}, onChunk) {
  const profile = getActiveProfile();
  const agentConfig = profile?.config?.[agentId] || {};
  const model = options.model || agentConfig.model || 'MiniMax-M2.5-highspeed';
  const provider = options.provider || agentConfig.provider || 'minimax';
  const timeout = options.timeout || 90000;

  if (provider === 'minimax') {
    await callMiniMaxAPIStream(prompt, model, timeout, onChunk);
  } else {
    // Anthropic via bridge 不支持流式 → 降级到非流式，一次性返回
    console.warn(`[llm-caller] callLLMStream: provider ${provider} does not support streaming, falling back`);
    const text = await callClaudeViaBridge(prompt, model, timeout);
    onChunk(text, false);
    onChunk('', true);
  }
}

// 测试辅助：重置缓存
export function _resetMinimaxKey() { _minimaxKey = null; }
