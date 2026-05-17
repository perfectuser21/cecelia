/**
 * DoD-2: execution-callback LLM metrics 解析逻辑单元测试
 *
 * 测试从 claude CLI result JSON 提取：
 *   - primaryModel（cost 最高的模型）
 *   - input_tokens / output_tokens / cache_read_tokens / cache_creation_tokens
 *   - cache_hit_rate = cacheRead / (input + cacheRead)
 *   - cost_usd = total_cost_usd
 *   - exit_status（AI Done → success，其他 → failed）
 */

import { describe, it, expect } from 'vitest';

// 复现 routes.js execution-callback 中的 metrics 提取逻辑（纯函数，便于单元测试）
function extractLlmMetrics(result, status) {
  const r = (result !== null && typeof result === 'object') ? result : {};
  const usage = r.usage || {};
  const modelUsage = r.modelUsage || {};

  // 主模型：cost 最高的那个
  let primaryModel = null;
  let maxCost = -1;
  for (const [modelId, mu] of Object.entries(modelUsage)) {
    const c = mu.costUSD || 0;
    if (c > maxCost) { maxCost = c; primaryModel = modelId; }
  }

  const inputTokens = usage.input_tokens || 0;
  const cacheRead   = usage.cache_read_input_tokens || usage.cacheReadInputTokens || 0;
  const totalInputs = inputTokens + cacheRead;
  const cacheHitRate = totalInputs > 0 ? parseFloat((cacheRead / totalInputs).toFixed(4)) : null;

  const exitStatus = status === 'AI Done' ? 'success' : 'failed';

  return {
    primaryModel,
    inputTokens:      inputTokens || null,
    outputTokens:     usage.output_tokens || null,
    cacheReadTokens:  cacheRead || null,
    cacheCreationTokens: usage.cache_creation_input_tokens || usage.cacheCreationInputTokens || null,
    cacheHitRate,
    costUsd:          r.total_cost_usd || null,
    numTurns:         r.num_turns || null,
    exitStatus,
  };
}

describe('task_run_metrics LLM metrics 解析（DoD-2）', () => {
  it('应正确选出 cost 最高的主模型', () => {
    const result = {
      total_cost_usd: 0.05,
      num_turns: 10,
      usage: { input_tokens: 5000, output_tokens: 2000, cache_read_input_tokens: 3000 },
      modelUsage: {
        'claude-haiku-4-5': { costUSD: 0.01 },
        'claude-sonnet-4-6': { costUSD: 0.04 },  // ← 最高
      }
    };

    const m = extractLlmMetrics(result, 'AI Done');
    expect(m.primaryModel).toBe('claude-sonnet-4-6');
    expect(m.exitStatus).toBe('success');
    expect(m.costUsd).toBe(0.05);
    expect(m.numTurns).toBe(10);
  });

  it('应正确计算 cache_hit_rate = cacheRead / (input + cacheRead)', () => {
    const result = {
      total_cost_usd: 0.02,
      usage: {
        input_tokens: 2000,
        output_tokens: 500,
        cache_read_input_tokens: 8000,  // 80% cache hit
      },
      modelUsage: { 'claude-opus-4-6': { costUSD: 0.02 } }
    };

    const m = extractLlmMetrics(result, 'AI Done');
    // cacheHitRate = 8000 / (2000 + 8000) = 0.8
    expect(m.cacheHitRate).toBeCloseTo(0.8, 4);
    expect(m.cacheReadTokens).toBe(8000);
    expect(m.inputTokens).toBe(2000);
    expect(m.outputTokens).toBe(500);
  });

  it('当无 cache 时 cache_hit_rate 应为 0（有 input tokens）', () => {
    const result = {
      usage: { input_tokens: 1000, output_tokens: 300 },
      modelUsage: {}
    };

    const m = extractLlmMetrics(result, 'AI Done');
    // cacheRead = 0, totalInputs = 1000 > 0, cacheHitRate = 0/1000 = 0
    expect(m.cacheHitRate).toBe(0);
    expect(m.cacheReadTokens).toBeNull(); // 0 → null（|| null）
  });

  it('当 input 和 cache 都为 0 时 cache_hit_rate 应为 null', () => {
    const result = {
      usage: {},  // 没有任何 token 数据
      modelUsage: {}
    };

    const m = extractLlmMetrics(result, 'AI Done');
    // totalInputs = 0, 返回 null
    expect(m.cacheHitRate).toBeNull();
  });

  it('失败任务应映射为 exit_status: failed', () => {
    const result = { usage: {}, modelUsage: {} };
    const m = extractLlmMetrics(result, 'failed');
    expect(m.exitStatus).toBe('failed');
  });

  it('应支持 cacheReadInputTokens 驼峰命名（兼容旧格式）', () => {
    const result = {
      usage: {
        input_tokens: 1000,
        output_tokens: 200,
        cacheReadInputTokens: 4000,   // camelCase 格式
        cacheCreationInputTokens: 500,
      },
      modelUsage: { 'claude-haiku-4-5': { costUSD: 0.005 } }
    };

    const m = extractLlmMetrics(result, 'AI Done');
    expect(m.cacheReadTokens).toBe(4000);
    expect(m.cacheCreationTokens).toBe(500);
    // cacheHitRate = 4000 / (1000 + 4000) = 0.8
    expect(m.cacheHitRate).toBeCloseTo(0.8, 4);
  });

  it('当 result 为 null 时应优雅降级（不抛错）', () => {
    const m = extractLlmMetrics(null, 'AI Done');
    expect(m.primaryModel).toBeNull();
    expect(m.cacheHitRate).toBeNull();
    expect(m.exitStatus).toBe('success');
  });

  it('当 result 为空对象时应优雅降级', () => {
    const m = extractLlmMetrics({}, 'failed');
    expect(m.primaryModel).toBeNull();
    expect(m.inputTokens).toBeNull();
    expect(m.costUsd).toBeNull();
    expect(m.exitStatus).toBe('failed');
  });

  it('多模型时应选最高 cost 的那个', () => {
    const result = {
      usage: { input_tokens: 100 },
      modelUsage: {
        'claude-haiku-4-5':  { costUSD: 0.001 },
        'claude-opus-4-6':   { costUSD: 0.200 },  // ← 最高
        'claude-sonnet-4-6': { costUSD: 0.050 },
      }
    };

    const m = extractLlmMetrics(result, 'AI Done');
    expect(m.primaryModel).toBe('claude-opus-4-6');
  });

  it('cache_hit_rate 应精确到 4 位小数', () => {
    const result = {
      usage: { input_tokens: 1, cache_read_input_tokens: 2 },
      modelUsage: {}
    };
    // 2 / 3 ≈ 0.6667
    const m = extractLlmMetrics(result, 'AI Done');
    expect(m.cacheHitRate).toBe(0.6667);
  });
});
