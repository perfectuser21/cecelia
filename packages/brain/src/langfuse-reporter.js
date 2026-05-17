/**
 * Langfuse Reporter — 非阻塞上报 LLM 调用到 Langfuse
 *
 * 读取 ~/.credentials/langfuse.env，若缺字段则 disable（所有调用变 no-op）。
 * 所有网络上报 fire-and-forget，异常被 swallow，不影响主链。
 *
 * env 文件格式（KEY="value" 一行一条）:
 *   LANGFUSE_PUBLIC_KEY="pk-lf-..."
 *   LANGFUSE_SECRET_KEY="sk-lf-..."
 *   LANGFUSE_BASE_URL="http://100.86.118.99:3000"
 */

import { randomUUID } from 'crypto';
import { loadLangfuseConfig, _resetLangfuseConfig } from './lib/langfuse-config.js';

const loadConfig = loadLangfuseConfig;

export function isEnabled() {
  return !!loadConfig();
}

function truncate(v, max = 10000) {
  if (typeof v !== 'string') return v;
  return v.length > max ? v.slice(0, max) + '…[truncated]' : v;
}

export function buildIngestionPayload({ agentId, model, provider, prompt, text, error, elapsedMs, startedAt }) {
  const traceId = randomUUID();
  const genId = randomUUID();
  const endIso = new Date().toISOString();
  const startIso = new Date(startedAt || Date.now() - (elapsedMs || 0)).toISOString();
  const inputField = truncate(prompt);
  const outputField = error ? null : truncate(text);

  const batch = [
    {
      id: randomUUID(),
      type: 'trace-create',
      timestamp: endIso,
      body: {
        id: traceId,
        name: `llm-call-${agentId}`,
        userId: 'brain',
        metadata: { agentId, model, provider, elapsedMs },
        input: { prompt: inputField },
        output: outputField === null ? null : { text: outputField },
      },
    },
    {
      id: randomUUID(),
      type: 'generation-create',
      timestamp: endIso,
      body: {
        id: genId,
        traceId,
        name: agentId,
        model,
        modelParameters: { provider },
        startTime: startIso,
        endTime: endIso,
        input: inputField,
        output: outputField,
        level: error ? 'ERROR' : 'DEFAULT',
        statusMessage: error ? (error.message || String(error)) : undefined,
        metadata: { elapsedMs, agentId, provider },
      },
    },
  ];
  return { batch };
}

export async function reportCall(opts) {
  const cfg = loadConfig();
  if (!cfg) return;
  try {
    const payload = buildIngestionPayload(opts);
    const auth = Buffer.from(`${cfg.LANGFUSE_PUBLIC_KEY}:${cfg.LANGFUSE_SECRET_KEY}`).toString('base64');
    const resp = await fetch(`${cfg.LANGFUSE_BASE_URL}/api/public/ingestion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
      body: JSON.stringify(payload),
    });
    if (!resp.ok && process.env.LANGFUSE_DEBUG) {
      const body = await resp.text().catch(() => '');
      console.warn(`[langfuse-reporter] ingestion ${resp.status}: ${body.slice(0, 200)}`);
    }
  } catch (err) {
    if (process.env.LANGFUSE_DEBUG) {
      console.warn(`[langfuse-reporter] failed: ${err.message}`);
    }
  }
}

export function _reset() {
  _resetLangfuseConfig();
}
