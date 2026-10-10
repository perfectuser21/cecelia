/**
 * 统一 LLM 调用层
 *
 * 所有 Brain 组件的 LLM 调用都通过这个模块。
 * 根据 model-profile 配置决定用哪个模型和 provider：
 *   - anthropic-api → 直接调用 Anthropic REST API（走 API key，快 5-8x）
 *   - anthropic     → 已退役：原经 cecelia-bridge /llm-call 调 claude -p（订阅 OAuth），
 *                     现不发任何请求，按该候选失败（claude_channel_retired）走 fallbacks
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
import { spawn } from 'child_process';
import { getActiveProfile } from './model-profile.js';
import { CODEX_ACCOUNTS } from './llm-capacity.js';
import { reportCall } from './langfuse-reporter.js';
import { assertLiveLLMAllowed } from './runtime-safety.js';
import { ClaudeChannelRetiredError } from './lib/claude-channel.js';

// ─── Anthropic API 余额告警去重 ───────────────────────────────────────────────
// 同一 runtime 只 raise 一次，Brain 重启后重新计数
const _anthropicBalanceAlerted = new Set();

// 曾映射到 claude --model 的模型 ID：非 anthropic-api provider 配了这些模型时，原本也落到 bridge（claude -p）
const CLAUDE_CLI_MODELS = new Set([
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'claude-opus-4-6',
]);

// MiniMax credentials cache
let _minimaxKey = null;
// Anthropic API key cache
let _anthropicKey = null;
// OpenAI API key cache
let _openaiKey = null;

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


function getOpenAIKey() {
  if (_openaiKey) return _openaiKey;
  try {
    const credPath = join(homedir(), '.credentials', 'openai.json');
    const cred = JSON.parse(readFileSync(credPath, 'utf-8'));
    _openaiKey = cred.api_key;
    return _openaiKey;
  } catch {
    // fallback to env var
  }
  if (process.env.OPENAI_API_KEY) {
    _openaiKey = process.env.OPENAI_API_KEY;
    return _openaiKey;
  }
  console.error('[llm-caller] Failed to load OpenAI credentials');
  return null;
}

function stripThinking(content) {
  if (!content) return '';
  const stripped = content.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
  if (stripped) return stripped;
  // Fallback: 推理模型把全部内容放在 <think> 里时，提取 think 内容
  const thinkContent = content.match(/<think>([\s\S]*?)<\/think>/)?.[1]?.trim();
  return thinkContent || content.trim();
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
 *   anthropic-api provider 走 Anthropic REST API 多模态字段。minimax / openai 暂不支持图片。
 * @returns {Promise<{text: string, model: string, provider: string, elapsed_ms: number}>}
 */
export async function callLLM(agentId, prompt, options = {}) {
  assertLiveLLMAllowed();
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
      const effectiveProvider = provider;
      if (effectiveProvider === 'anthropic-api') {
        text = await callAnthropicAPI(prompt, model, timeout, maxTokens, imageContent);
      } else if (effectiveProvider === 'anthropic' || CLAUDE_CLI_MODELS.has(model)) {
        // Claude 无头通道已退役：不发请求，按该候选失败走 fallbacks（不碰任何账号熔断）
        throw new ClaudeChannelRetiredError(`llm-caller provider=${provider} model=${model}`);
      } else if (effectiveProvider === 'minimax' || provider === 'minimax') {
        text = await callMiniMaxAPI(prompt, model, timeout, maxTokens);
      } else if (effectiveProvider === 'openai' || provider === 'openai') {
        text = await callOpenAIAPI(prompt, model, timeout, maxTokens);
      } else if (effectiveProvider === 'codex' || provider === 'codex') {
        text = await callCodexHeadless(prompt, model, { timeout });
      } else {
        throw new Error(`Unsupported provider: ${provider}`);
      }

      const elapsed = Date.now() - startTime;
      const fallbackNote = isFallback ? ` [fallback#${i}]` : '';
      console.log(`[llm-caller] ${agentId} → ${model} (${provider})${fallbackNote} in ${elapsed}ms`);
      reportCall({ agentId, model, provider, prompt, text, elapsedMs: elapsed, startedAt: startTime }).catch(() => {});
      return { text, model, provider, elapsed_ms: elapsed, attempted_fallback: isFallback };
    } catch (err) {
      if (err.code === 'LLM_ACCOUNT_UNAVAILABLE') throw err;
      lastError = err;
      console.warn(`[llm-caller] ${agentId} ${model} 失败: ${err.message}`);
    }
  }

  // Implicit fallback to anthropic-api when all configured candidates fail.
  // Covers: anthropic（已退役通道）AND non-anthropic providers (codex/openai) with no Anthropic fallback configured.
  // Reason: codex/openai may be unavailable (no OAuth accounts, no API key), but Anthropic API key is typically stable.
  const ANTHROPIC_PROVIDERS = ['anthropic', 'anthropic-api'];
  const hasAnthropicCandidate = candidates.some(c => ANTHROPIC_PROVIDERS.includes(c.provider));
  if (!hasAnthropicCandidate) {
    const fallbackModel = 'claude-haiku-4-5-20251001';
    console.warn(`[llm-caller] ${agentId} 所有候选（${candidates.map(c=>c.provider).join(',')}）失败，尝试 anthropic-api 兜底`);
    try {
      const text = await callAnthropicAPI(prompt, fallbackModel, timeout, maxTokens, imageContent);
      const elapsed = Date.now() - startTime;
      console.log(`[llm-caller] ${agentId} → ${fallbackModel} (anthropic-api emergency fallback) in ${elapsed}ms`);
      reportCall({ agentId, model: fallbackModel, provider: 'anthropic-api', prompt, text, elapsedMs: elapsed, startedAt: startTime }).catch(() => {});
      return { text, model: fallbackModel, provider: 'anthropic-api', elapsed_ms: elapsed, attempted_fallback: true };
    } catch (apiErr) {
      console.warn(`[llm-caller] ${agentId} anthropic-api 兜底也失败: ${apiErr.message}`);
    }
  } else if (primary.provider === 'anthropic') {
    console.warn(`[llm-caller] ${agentId} anthropic 通道已退役（claude_channel_retired），尝试 anthropic-api 直连`);
    try {
      const text = await callAnthropicAPI(prompt, primary.model, timeout, maxTokens, imageContent);
      const elapsed = Date.now() - startTime;
      console.log(`[llm-caller] ${agentId} → ${primary.model} (anthropic-api implicit fallback) in ${elapsed}ms`);
      reportCall({ agentId, model: primary.model, provider: 'anthropic-api', prompt, text, elapsedMs: elapsed, startedAt: startTime }).catch(() => {});
      return { text, model: primary.model, provider: 'anthropic-api', elapsed_ms: elapsed, attempted_fallback: true };
    } catch (apiErr) {
      console.warn(`[llm-caller] ${agentId} anthropic-api 直连也失败: ${apiErr.message}`);
    }
  }

  if (lastError) {
    lastError.llm_model = lastModel;
    lastError.llm_provider = lastProvider;
    lastError.elapsed_ms = Date.now() - startTime;
    lastError.fallback_attempt = candidates.length - 1;
  }
  reportCall({
    agentId,
    model: lastModel,
    provider: lastProvider,
    prompt,
    error: lastError || new Error(`[llm-caller] ${agentId}: all candidates failed`),
    elapsedMs: Date.now() - startTime,
    startedAt: startTime,
  }).catch(() => {});
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
    // 余额不足 → P1 告警（同 runtime 去重），仍抛异常让调用方走 fallback
    const lowerErr = errText.toLowerCase();
    if (
      lowerErr.includes('credit balance is too low') ||
      lowerErr.includes('credit balance too low') ||
      lowerErr.includes('insufficient_balance')
    ) {
      if (!_anthropicBalanceAlerted.has('anthropic_api_balance_low')) {
        _anthropicBalanceAlerted.add('anthropic_api_balance_low');
        try {
          const { raise } = await import('./alerting.js');
          raise(
            'P1',
            'anthropic_api_balance_low',
            '⚠️ Anthropic API 余额不足，thalamus 直连路径不可用 — 请充值'
          ).catch(() => {});
        } catch { /* 告警失败不阻断主流程 */ }
      }
    }
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
  assertLiveLLMAllowed();
  const profile = getActiveProfile();
  const agentConfig = profile?.config?.[agentId] || {};
  const model = options.model || agentConfig.model || 'MiniMax-M2.5-highspeed';
  const provider = options.provider || agentConfig.provider || 'minimax';
  const timeout = options.timeout || 90000;

  if (provider === 'minimax') {
    await callMiniMaxAPIStream(prompt, model, timeout, onChunk);
  } else {
    // 非 minimax 不支持流式 → 降级到 callLLM 非流式（含 fallbacks），一次性返回
    console.warn(`[llm-caller] callLLMStream: provider ${provider} does not support streaming, falling back`);
    const { text } = await callLLM(agentId, prompt, { ...options, model, provider, timeout });
    onChunk(text, false);
    onChunk('', true);
  }
}

// Codex OAuth team 账号目录列表（round-robin 轮换）
//
// 从 llm-capacity.js 的 CODEX_ACCOUNTS 派生，不再各写一份。
// 2026-09-06 事故：这里曾硬编码只有 team1/team2，而 llm-capacity 登记了 team1~team5，
// 结果 T3/T4/T5 三个 5h 与 7d 均为 0% 的满额度账号从未被派过活，
// 调度侧却按 5 个账号的容量做规划。加账号只改 llm-capacity.js 一处。
// 导出供 tests/gp/g5/step1-codex-account-pool-consistency 机械校验两者一致。
export const CODEX_TEAM_HOMES = CODEX_ACCOUNTS.map((a) => a.home);
let _codexTeamIndex = 0;

/**
 * 获取下一个可用的 Codex team 账号 HOME 路径（round-robin）
 * 检查 auth.json 存在且 tokens 字段有值（OAuth 登录状态）
 * 若无可用 team 账号，返回 null（调用方直接抛错，不再 fallback 到 API key 计费）
 */
function getNextCodexTeamHome() {
  for (let i = 0; i < CODEX_TEAM_HOMES.length; i++) {
    const idx = (_codexTeamIndex + i) % CODEX_TEAM_HOMES.length;
    const home = CODEX_TEAM_HOMES[idx];
    try {
      const auth = JSON.parse(readFileSync(join(home, 'auth.json'), 'utf8'));
      if (auth.tokens) {
        _codexTeamIndex = (idx + 1) % CODEX_TEAM_HOMES.length;
        return home;
      }
    } catch {
      // 账号不存在或无效，跳过
    }
  }
  return null;
}

/**
 * 通过 codex exec 无头调用 Codex（走 OAuth 订阅账号，不消耗 API 额度）
 * model ID 格式: "codex/<model-name>"，传给 -m 时去掉前缀
 * 只使用 ~/.codex-teamX OAuth 账号（CODEX_HOME）；全部账号掉线时直接抛错，
 * 禁止 fallback 到 API key 计费调用
 */
async function callCodexHeadless(prompt, model, options = {}) {
  const timeout = options.timeout || 120000;
  // model ID 格式为 "codex/gpt-5.4-mini"，提取实际模型名
  const actualModel = model.startsWith('codex/') ? model.slice(6) : model;

  // 优先用 OAuth team 账号（走订阅，不消耗 API 额度）
  const teamHome = getNextCodexTeamHome();
  if (!teamHome) {
    // 2026-09-02：曾经这里会 fallback 到 OPENAI_API_KEY 直接计费调用 Codex，
    // 在 team 账号掉线期间静默烧掉约 24 美元且无任何告警。禁止这条路径——
    // 直接失败，交给 callLLM() 既有的 anthropic-api 紧急兜底机制接管。
    const poolNames = CODEX_ACCOUNTS.map((a) => a.name).join('/');
    throw new Error(
      `Codex: 无可用 OAuth team 账号（${poolNames} 全部掉线），已禁止 fallback 到 API Key 计费，请检查 codex 账号登录状态`
    );
  }
  const env = { ...process.env };
  env.CODEX_HOME = teamHome;
  // 删除 API key，确保走 OAuth 而非直接计费
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  console.log(`[llm-caller] codex 使用 OAuth team 账号: ${teamHome}`);

  return new Promise((resolve, reject) => {
    // --skip-git-repo-check: brain 进程 cwd 不是 git 仓库（容器内 /app），
    // 缺这个 flag 时 codex exec 立即 exit 1（"Not inside a trusted directory"），
    // 该错误文本被截断后常被误读成前面无害的 PATH 只读警告。
    const child = spawn('codex', ['exec', '--skip-git-repo-check', '-m', actualModel, prompt], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`callCodexHeadless timeout after ${timeout}ms`));
    }, timeout);

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`codex exec failed (exit ${code}): ${stderr.slice(0, 300)}`));
      } else {
        const text = stdout.trim();
        if (!text) reject(new Error('codex exec returned empty output'));
        else resolve(text);
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * 直接调用 OpenAI API（gpt-5.x 系列用 max_completion_tokens）
 */
async function callOpenAIAPI(prompt, model, timeout, maxTokens) {
  const apiKey = getOpenAIKey();
  if (!apiKey) throw new Error('OpenAI API key not available');

  const isGPT5 = model && model.startsWith('gpt-5');
  const tokenParam = isGPT5
    ? { max_completion_tokens: maxTokens }
    : { max_tokens: maxTokens };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      ...tokenParam,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(timeout),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => 'unknown');
    const apiErr = new Error(`OpenAI API error: ${response.status} - ${errText.slice(0, 200)}`);
    apiErr.status = response.status;
    throw apiErr;
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || '';
  if (!text) throw new Error('OpenAI API returned empty content');
  return text;
}

// 测试辅助：重置缓存
export function _resetMinimaxKey() { _minimaxKey = null; }
export function _resetAnthropicKey() { _anthropicKey = null; }
export function _resetOpenAIKey() { _openaiKey = null; }

// 测试辅助：重置 anthropic balance 告警去重
export function _resetAnthropicBalanceAlerted() {
  _anthropicBalanceAlerted.clear();
}
