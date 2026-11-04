/**
 * Cecelia 欲望系统（Desire System）测试
 *
 * DoD 覆盖: D8-D10
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock 统一 LLM 调用层 — 所有 desire 子模块现在通过 callLLM 调用
vi.mock('../llm-caller.js', () => ({
  callLLM: vi.fn().mockResolvedValue({ text: '5', model: 'test', provider: 'test', elapsed_ms: 10 }),
}));

// Fail before any real network or shared database boundary can escape this suite.
const outbound = vi.hoisted(() => ({
  fetch: vi.fn(() => { throw new Error('owned fixture forbids network'); }),
  receipt: vi.fn(() => { throw new Error('owned fixture forbids receipts'); }),
  query: vi.fn(() => { throw new Error('owned fixture forbids shared DB'); }),
}));
vi.mock('../receipt-collector.js', () => ({
  recordActionReceipt: outbound.receipt,
  resolveActionReceipt: outbound.receipt,
}));
vi.mock('../db.js', () => ({ default: { query: outbound.query } }));
vi.mock('../notifier.js', () => ({ sendFeishu: vi.fn().mockResolvedValue(true) }));

// ============================================================
// D8: 集成测试 - runDesireSystem
// ============================================================

describe('D8: runDesireSystem 集成测试', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('D8: runDesireSystem 返回完整结果结构', async () => {
    // mock callLLM 返回默认分数
    const { callLLM } = await import('../llm-caller.js');
    callLLM.mockResolvedValue({ text: '1: 5', model: 'test', provider: 'test', elapsed_ms: 10 });

    const mockPool = {
      query: vi.fn().mockImplementation((sql) => {
        if (sql.includes('FROM tasks') && sql.includes('COUNT')) {
          return { rows: [{ completed: '5', failed: '1', queued: '3', in_progress: '2' }] };
        }
        if (sql.includes('FROM goals')) {
          return { rows: [] };
        }
        if (sql.includes('last_expression_at') || sql.includes('last_feishu_at')) {
          return { rows: [] };
        }
        if (sql.includes("key = 'user_last_seen'")) {
          return { rows: [] };
        }
        if (sql.includes("key = 'desire_importance_accumulator'")) {
          return { rows: [{ value_json: 5 }] };
        }
        return { rows: [] };
      })
    };

    const { runDesireSystem } = await import('../desire/index.js');
    const result = await runDesireSystem(mockPool);

    expect(result).toHaveProperty('perception');
    expect(result).toHaveProperty('memory');
    expect(result).toHaveProperty('reflection');
    expect(result).toHaveProperty('desire_formed');
    expect(result).toHaveProperty('expression');
    expect(typeof result.perception.observations).toBe('number');
  });

  it('D8: 任何层报错不影响整体结果', async () => {
    const mockPool = {
      query: vi.fn().mockRejectedValue(new Error('DB connection error'))
    };

    const { runDesireSystem } = await import('../desire/index.js');

    // 不应该抛出异常
    await expect(runDesireSystem(mockPool)).resolves.toBeDefined();
  });
});

// ============================================================
// D9: selfcheck schema version 测试
// ============================================================

describe('D9: EXPECTED_SCHEMA_VERSION', () => {
  it('D9: selfcheck.js EXPECTED_SCHEMA_VERSION 为有效的数字字符串', async () => {
    const { EXPECTED_SCHEMA_VERSION } = await import('../selfcheck.js');
    // 不硬编码具体版本号，只验证格式为合法的数字字符串且 >= 207（初始版本）
    expect(typeof EXPECTED_SCHEMA_VERSION).toBe('string');
    const ver = parseInt(EXPECTED_SCHEMA_VERSION, 10);
    expect(Number.isNaN(ver)).toBe(false);
    expect(ver).toBeGreaterThanOrEqual(207);
  });
});

// ============================================================
// D10: Reflection 去重机制测试
// ============================================================

describe('D10: Reflection 去重机制', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('D10-1: 相似度 > 0.75 的洞察被跳过', async () => {
    const { callLLM } = await import('../llm-caller.js');
    const { runReflection } = await import('../desire/reflection.js');

    // Mock LLM 返回新洞察（英文空格分词，让 Jaccard 相似度计算正确生效）
    callLLM.mockResolvedValue({
      text: 'reflection loop bottleneck fix three step performance restore',
      model: 'test',
      provider: 'test',
      elapsed_ms: 10
    });

    let accumulatorResetCount = 0;
    const mockPool = {
      query: vi.fn().mockImplementation((sql, params) => {
        // 返回 accumulator 值（SELECT 时 key 内联在 SQL 字符串里）
        if (sql.includes('desire_importance_accumulator')) {
          return { rows: [{ value_json: 15 }] };
        }

        // accumulator 重置（INSERT INTO working_memory，key 作为参数 $1）
        if (sql.includes('working_memory') && (sql.includes('INSERT') || sql.includes('UPDATE')) && params && params[0] === 'desire_importance_accumulator') {
          accumulatorResetCount++;
          return { rows: [] };
        }

        // 返回最近 50 条记忆（reflection 的第一步）
        if (sql.includes('FROM memory_stream') && sql.includes('ORDER BY created_at DESC') && sql.includes('LIMIT 50') && !sql.includes('content LIKE')) {
          return {
            rows: [
              { content: '观察 1', importance: 5, memory_type: 'short', created_at: new Date() },
              { content: '观察 2', importance: 6, memory_type: 'short', created_at: new Date() }
            ]
          };
        }

        // 返回最近的 memory_stream（包含相似洞察）- 去重查询
        // 英文空格分词确保 Jaccard 相似度 = 8/10 = 0.80 > 0.75
        if (sql.includes('content LIKE') && sql.includes('反思洞察') && sql.includes('INTERVAL')) {
          return {
            rows: [
              { content: '[反思洞察] reflection loop bottleneck fix three step performance restore system' },
              { content: '[反思洞察] 其他不相关的洞察内容 ABCDEFG HIJKLMN' }
            ]
          };
        }

        // 其他查询返回空
        return { rows: [] };
      })
    };

    const result = await runReflection(mockPool);

    // 验证去重生效
    expect(result.triggered).toBe(true);
    expect(result.insight).toBeNull();
    expect(result.skipped).toBe('duplicate');
    expect(result.similarity).toBeGreaterThan(0.75);

    // 验证 accumulator 被重置
    expect(accumulatorResetCount).toBe(1);
  });

  it('D10-2: 相似度 <= 0.75 的洞察正常写入', async () => {
    const { callLLM } = await import('../llm-caller.js');
    const { runReflection } = await import('../desire/reflection.js');

    // Mock LLM 返回新洞察
    callLLM.mockResolvedValue({
      text: '完全不同的新洞察内容 XYZ 123 ABC',
      model: 'test',
      provider: 'test',
      elapsed_ms: 10
    });

    let insightInserted = false;
    const mockPool = {
      query: vi.fn().mockImplementation((sql, params) => {
        // 返回 accumulator 值
        if (sql.includes('desire_importance_accumulator')) {
          if (sql.includes('INSERT') || sql.includes('UPDATE')) {
            return { rows: [] };
          }
          return { rows: [{ value_json: 15 }] };
        }

        // 返回最近 50 条记忆（reflection 的第一步）
        if (sql.includes('FROM memory_stream') && sql.includes('ORDER BY created_at DESC') && sql.includes('LIMIT 50') && !sql.includes('content LIKE')) {
          return {
            rows: [
              { content: '观察 1', importance: 5, memory_type: 'short', created_at: new Date() },
              { content: '观察 2', importance: 6, memory_type: 'short', created_at: new Date() }
            ]
          };
        }

        // 返回最近的 memory_stream（包含不相似洞察）- 去重查询
        if (sql.includes('content LIKE') && sql.includes('反思洞察') && sql.includes('INTERVAL')) {
          return {
            rows: [
              { content: '[反思洞察] 旧的洞察内容完全不同 QWERTY ASDFGH' }
            ]
          };
        }

        // 洞察写入 memory_stream
        if (sql.includes('INSERT INTO memory_stream')) {
          insightInserted = true;
          return { rows: [{ id: 'test-id-123' }] };
        }

        // 其他查询返回空
        return { rows: [] };
      })
    };

    const result = await runReflection(mockPool);

    // 验证洞察正常写入
    expect(result.triggered).toBe(true);
    expect(result.insight).toBe('完全不同的新洞察内容 XYZ 123 ABC');
    expect(result.skipped).toBeUndefined();
    expect(insightInserted).toBe(true);
  });

  it('D10-3: 去重检查失败不影响主流程', async () => {
    const { callLLM } = await import('../llm-caller.js');
    const { runReflection } = await import('../desire/reflection.js');

    callLLM.mockResolvedValue({
      text: '新的洞察内容',
      model: 'test',
      provider: 'test',
      elapsed_ms: 10
    });

    let insightInserted = false;
    const mockPool = {
      query: vi.fn().mockImplementation((sql, params) => {
        // 返回 accumulator 值
        if (sql.includes('desire_importance_accumulator')) {
          if (sql.includes('INSERT') || sql.includes('UPDATE')) {
            return { rows: [] };
          }
          return { rows: [{ value_json: 15 }] };
        }

        // 返回最近 50 条记忆（reflection 的第一步）
        if (sql.includes('FROM memory_stream') && sql.includes('ORDER BY created_at DESC') && sql.includes('LIMIT 50') && !sql.includes('content LIKE')) {
          return {
            rows: [
              { content: '观察 1', importance: 5, memory_type: 'short', created_at: new Date() },
              { content: '观察 2', importance: 6, memory_type: 'short', created_at: new Date() }
            ]
          };
        }

        // 去重查询失败
        if (sql.includes('content LIKE') && sql.includes('反思洞察') && sql.includes('INTERVAL')) {
          throw new Error('Database query error');
        }

        // 洞察写入 memory_stream
        if (sql.includes('INSERT INTO memory_stream')) {
          insightInserted = true;
          return { rows: [{ id: 'test-id-456' }] };
        }

        // 其他查询返回空
        return { rows: [] };
      })
    };

    const result = await runReflection(mockPool);

    // 验证去重失败后仍然写入洞察
    expect(result.triggered).toBe(true);
    expect(result.insight).toBe('新的洞察内容');
    expect(insightInserted).toBe(true);
  });
});
