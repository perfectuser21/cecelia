/**
 * api-credentials-checker.js
 *
 * 检查 Anthropic API 直连 + OpenAI 凭据健康。
 *
 * 现有 credentials-health-scheduler 检查 NotebookLM / Claude OAuth / Codex / 发布器 cookies，
 * 但**漏了 Anthropic API 直连余额 + OpenAI quota** — 这两个失效是 mouth fallback 链全挂的真因。
 *
 * 检查方式：
 *   - Anthropic API: 发一个最小 LLM 请求，看 400 credit_balance / 200 success
 *   - OpenAI: 发一个最小 embedding 请求，看 429 quota_exceeded / 200 success
 *
 * 不调度（caller 决定何时跑），返回结构化结果。
 *
 * MJ4 自主神经闭环 thin feature：暴露各 API 凭据健康度供 alert / dispatcher 参考。
 */

const ANTHROPIC_API_URL = process.env.ANTHROPIC_API_BASE || 'https://api.anthropic.com';
const OPENAI_API_URL = process.env.OPENAI_API_BASE || 'https://api.openai.com';

/**
 * 单次最小 anthropic API 调用，返回健康状态。
 *
 * @param {Object} [opts]
 * @param {Function} [opts.fetchFn]   — 测试用注入
 * @param {string}   [opts.apiKey]    — 默认读 process.env.ANTHROPIC_API_KEY
 * @returns {Promise<{provider, healthy, status, error?, errorType?}>}
 */
export async function checkAnthropicApi({ fetchFn = globalThis.fetch, apiKey = process.env.ANTHROPIC_API_KEY } = {}) {
  if (!apiKey) {
    return { provider: 'anthropic-api', healthy: false, status: 'no_key', error: 'ANTHROPIC_API_KEY not set' };
  }

  try {
    const res = await fetchFn(`${ANTHROPIC_API_URL}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'a' }],
      }),
    });

    if (res.ok) {
      return { provider: 'anthropic-api', healthy: true, status: 'ok' };
    }

    const body = await res.text().catch(() => '');
    const errorType = body.includes('credit balance')
      ? 'credit_balance_too_low'
      : (res.status === 401 ? 'unauthorized' : `http_${res.status}`);
    return {
      provider: 'anthropic-api',
      healthy: false,
      status: 'failed',
      error: body.slice(0, 200),
      errorType,
    };
  } catch (err) {
    return { provider: 'anthropic-api', healthy: false, status: 'network_error', error: err.message };
  }
}

/**
 * 单次最小 OpenAI 调用（embedding endpoint，对 quota 敏感）。
 */
export async function checkOpenAI({ fetchFn = globalThis.fetch, apiKey = process.env.OPENAI_API_KEY } = {}) {
  if (!apiKey) {
    return { provider: 'openai', healthy: false, status: 'no_key', error: 'OPENAI_API_KEY not set' };
  }

  try {
    const res = await fetchFn(`${OPENAI_API_URL}/v1/embeddings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: 'a',
      }),
    });

    if (res.ok) {
      return { provider: 'openai', healthy: true, status: 'ok' };
    }

    const body = await res.text().catch(() => '');
    const errorType = body.includes('insufficient_quota') || body.includes('exceeded your current quota')
      ? 'quota_exceeded'
      : (res.status === 401 ? 'unauthorized' : `http_${res.status}`);
    return {
      provider: 'openai',
      healthy: false,
      status: 'failed',
      error: body.slice(0, 200),
      errorType,
    };
  } catch (err) {
    return { provider: 'openai', healthy: false, status: 'network_error', error: err.message };
  }
}

/**
 * 一次跑完所有 API 凭据检查，返回汇总。
 */
export async function checkAllApiCredentials(opts = {}) {
  const results = await Promise.all([
    checkAnthropicApi(opts),
    checkOpenAI(opts),
  ]);
  const healthy = results.filter(r => r.healthy).map(r => r.provider);
  const unhealthy = results.filter(r => !r.healthy);
  return { results, healthy_providers: healthy, unhealthy_providers: unhealthy.map(r => r.provider), summary: unhealthy.length === 0 ? 'all_healthy' : 'some_failed' };
}
