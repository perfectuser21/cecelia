/**
 * 统一 LLM 调用层
 *
 * 所有 Brain 组件的 LLM 调用都通过这个模块。
 * 根据 model-profile 配置决定用哪个模型和 provider：
 *   - anthropic-api → 直接调用 Anthropic REST API（走 API key，快 5-8x）
 *   - anthropic     → 通过 cecelia-bridge /llm-call 调用 claude -p（走订阅，降级用）
 *   - minimax       → 直接调用 MiniMax API
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
import { selectBestAccount } from './account-usage.js';

const BRIDGE_URL = process.env.EXECUTOR_BRIDGE_URL || 'http://localhost:3457';

// Model ID → claude --model flag
const CLAUDE_MODEL_FLAG = {
  'claude-haiku-4-5-20251001': 'haiku',
  'claude-sonnet-4-6': 'sonnet',
  'claude-opus-4-6': 'opus',
};

// MiniMax credentials cache
let _minimaxKey = null;
// Anthropic API key cache
let _anthropicKey = null;

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

function getAnthropicKey() {
  if (_anthropicKey) return _anthropicKey;
  try {
    const credPath = join(homedir(), '.credentials', 'anthropic.json');
    const cred = JSON.parse(readFileSync(credPath, 'utf-8'));
    _anthropicKey = cred.api_key;
    return _anthropicKey;
  } catch (err) {
    console.error('[llm-caller] Failed to load Anthropic credentials:', err.message);
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
 * @param {Array} [options.imageContent] - 图片 content blocks（Anthropic 多模态格式）
 *   例: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '...' } }]
 *   仅 anthropic-api provider 支持，bridge 调用会忽略图片（降级为纯文字）
 * @returns {Promise<{text: string, model: string, provider: string, elapsed_ms: number}>}
 */
export async function callLLM(agentId, prompt, options = {}) {
  const startTime = Date.now();
  const profile = getActiveProfile();

  // 从 profile.config 读取 brain 层 agent 的配置
  const agentConfig = profile?.config?.[agentId] || {};
  const DEFAULT_LLM_TIMEOUT_MS = parseInt(process.env.CECELIA_BRIDGE_TIMEOUT_MS || '120000', 10);
  const timeout = options.timeout || DEFAULT_LLM_TIMEOUT_MS;
  const maxTokens = options.maxTokens || 1024;
  const imageContent = options.imageContent || null;

  // 构建候选列表：主模型 + fallbacks（来自 agentConfig 或 options）
  const primary = {
    model:    options.model    || agentConfig.model    || 'claude-haiku-4-5-20251001',
    provider: options.provider || agentConfig.provider || 'anthropic',
  };
  const fallbacks = agentConfig.fallbacks || [];   // [{model, provider}, ...]
  const candidates = [primary, ...fallbacks];

  let lastError;
  let lastModel, lastProvider;
  for (let i = 0; i < candidates.length; i++) {
    const { model, provider } = candidates[i];
    lastModel = model;
    lastProvider = provider;
    const isFallback = i > 0;
    if (isFallback) {
      console.warn(`[llm-caller] ${agentId} fallback #${i}: 尝试 ${model} (${provider})`);
    }

    try {
      let text;
      // 有图片时 bridge 不支持多模态，自动升级到直连 anthropic-api
      const effectiveProvider = (imageContent && imageContent.length > 0 && provider === 'anthropic')
        ? 'anthropic-api'
        : provider;
      if (effectiveProvider !== provider) {
        console.log(`[llm-caller] ${agentId} 有图片内容，bridge 不支持视觉，自动升级到 anthropic-api`);
      }
      if (effectiveProvider === 'anthropic-api') {
        text = await callAnthropicAPI(prompt, model, timeout, maxTokens, imageContent);
      } else if (effectiveProvider === 'anthropic' || CLAUDE_MODEL_FLAG[model]) {
        // bridge 不支持图片，仅传文字 prompt（降级处理）
        text = await callClaudeViaBridge(prompt, model, timeout, model);
      } else if (provider === 'minimax') {
        text = await callMiniMaxAPI(prompt, model, timeout, maxTokens);
      } else {
        throw new Error(`Unsupported provider: ${provider}`);
      }

      const elapsed = Date.now() - startTime;
      const fallbackNote = isFallback ? ` [fallback#${i}]` : '';
      console.log(`[llm-caller] ${agentId} → ${model} (${provider})${fallbackNote} in ${elapsed}ms`);
      return { text, model, provider, elapsed_ms: elapsed, attempted_fallback: isFallback };
    } catch (err) {
      lastError = err;
      console.warn(`[llm-caller] ${agentId} ${model} 失败: ${err.message}`);
    }
  }

  if (lastError) {
    lastError.llm_model = lastModel;
    lastError.llm_provider = lastProvider;
    lastError.elapsed_ms = Date.now() - startTime;
    lastError.fallback_attempt = candidates.length - 1;
  }
  throw lastError || new Error(`[llm-caller] ${agentId}: 所有候选模型均失败`);
}

/**
 * 直接调用 Anthropic REST API（走 API key，速度快 5-8x，无并发限制）
 * 读取 ~/.credentials/anthropic.json 中的 api_key
 * @param {string} prompt - 文字 prompt
 * @param {string} model - 模型 ID
 * @param {number} timeout - 超时毫秒
 * @param {number} maxTokens - 最大 token 数
 * @param {Array|null} imageContent - 图片 content blocks（多模态），null 表示纯文字
 */
async function callAnthropicAPI(prompt, model, timeout, maxTokens, imageContent = null) {
  const apiKey = getAnthropicKey();
  if (!apiKey) throw new Error('Anthropic API key not available');

  // 构建 user content：有图片时用 content block array，否则用纯文字
  const userContent = imageContent && imageContent.length > 0
    ? [{ type: 'text', text: prompt }, ...imageContent]
    : prompt;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: userContent }],
    }),
    signal: AbortSignal.timeout(timeout),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => 'unknown');
    const apiErr = new Error(`Anthropic API error: ${response.status} - ${errText.slice(0, 200)}`);
    apiErr.status = response.status;
    throw apiErr;
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || '';
  if (!text) throw new Error('Anthropic API returned empty content');
  return text;
}

/**
 * 通过 cecelia-bridge 调用 claude -p（走订阅，不需要 API key）
 * 自动选择配额最优账号（通过 configDir 传给 bridge）
 */
async function callClaudeViaBridge(prompt, model, timeout, originalModel) {
  const claudeModel = CLAUDE_MODEL_FLAG[model] || 'haiku';
  const isHaiku = claudeModel === 'haiku';

  // 统一账号选择：所有模型共用 selectBestAccount，spending cap 过滤统一处理
  // 只传 accountId，由 bridge 在宿主机侧拼出正确 CLAUDE_CONFIG_DIR
  let accountId;
  try {
    const selection = await selectBestAccount({ model: claudeModel });
    if (selection) {
      accountId = selection.accountId;
    }
  } catch (err) {
    console.warn('[llm-caller] selectBestAccount failed, using default account:', err.message);
  }

  const response = await fetch(`${BRIDGE_URL}/llm-call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      model: claudeModel,
      timeout,
      ...(accountId ? { accountId } : {}),
    }),
    signal: AbortSignal.timeout(timeout + 10000), // bridge 自身超时 + 缓冲
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => 'unknown');
    const bridgeErr = new Error(`Bridge /llm-call error: ${response.status} - ${errText}`);
    bridgeErr.status = response.status;
    throw bridgeErr;
  }

  const data = await response.json();
  if (data.degraded === true) {
    const err = new Error(`LLM call timed out after ${data.elapsed_ms || timeout}ms`);
    err.degraded = true;
    err.status = data.status;
    throw err;
  }
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
    const mmErr = new Error(`MiniMax API error: ${response.status} - ${errText}`);
    mmErr.status = response.status;
    throw mmErr;
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
export function _resetAnthropicKey() { _anthropicKey = null; }
