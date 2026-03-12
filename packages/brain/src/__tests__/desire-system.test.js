/**
 * Cecelia 欲望系统（Desire System）测试
 *
 * DoD 覆盖: D1-D10
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock 统一 LLM 调用层 — 所有 desire 子模块现在通过 callLLM 调用
vi.mock('../llm-caller.js', () => ({
  callLLM: vi.fn().mockResolvedValue({ text: '5', model: 'test', provider: 'test', elapsed_ms: 10 }),
}));

// ============================================================
// D2: 感知层测试
// ============================================================

describe('Layer 1: 感知层（Perception）', () => {
  it('D2: runPerception 返回观察数组', async () => {
    const mockPool = {
      query: vi.fn().mockImplementation((sql) => {
        if (sql.includes('FROM tasks') && sql.includes('COUNT')) {
          return { rows: [{ completed: '5', failed: '1', queued: '3', in_progress: '2' }] };
        }
        if (sql.includes('FROM goals')) {
          return { rows: [{ title: 'Test KR', progress: 50, status: 'in_progress', priority: 'P1' }] };
        }
        if (sql.includes("key = 'last_feishu_at'")) {
          return { rows: [] };
        }
        if (sql.includes('GROUP BY task_type')) {
          return { rows: [] };
        }
        return { rows: [] };
      })
    };

    const { runPerception } = await import('../desire/perception.js');
    const observations = await runPerception(mockPool);

    expect(Array.isArray(observations)).toBe(true);
    expect(observations.length).toBeGreaterThan(0);

    const hasTaskSignal = observations.some(o => o.signal === 'task_fail_rate_24h');
    expect(hasTaskSignal).toBe(true);
  });

  it('D2: 无 Alex 联系记录时报告 hours_since_alex_contact = 999', async () => {
    const mockPool = {
      query: vi.fn().mockImplementation((sql) => {
        if (sql.includes('FROM tasks') && sql.includes('COUNT')) {
          return { rows: [{ completed: '0', failed: '0', queued: '0', in_progress: '0' }] };
        }
        if (sql.includes('FROM goals')) {
          return { rows: [] };
        }
        if (sql.includes("last_alex_chat_at") || sql.includes("last_feishu_at")) {
          return { rows: [] };
        }
        if (sql.includes('GROUP BY task_type')) {
          return { rows: [] };
        }
        return { rows: [] };
      })
    };

    const { runPerception } = await import('../desire/perception.js');
    const observations = await runPerception(mockPool);

    const contactObs = observations.find(o => o.signal === 'hours_since_alex_contact');
    expect(contactObs).toBeDefined();
    expect(contactObs.value).toBe(999);
  });

  it('D2: 队列积压 > 10 时生成 queue_buildup 信号', async () => {
    const mockPool = {
      query: vi.fn().mockImplementation((sql) => {
        if (sql.includes('FROM tasks') && sql.includes('COUNT')) {
          return { rows: [{ completed: '5', failed: '1', queued: '15', in_progress: '2' }] };
        }
        if (sql.includes('FROM goals')) {
          return { rows: [] };
        }
        return { rows: [] };
      })
    };

    const { runPerception } = await import('../desire/perception.js');
    const observations = await runPerception(mockPool);

    const queueObs = observations.find(o => o.signal === 'queue_buildup');
    expect(queueObs).toBeDefined();
    expect(queueObs.value).toBe(15);
  });

  it('D2: 有知识盲点时生成 learning_gap_signal', async () => {
    const mockPool = {
      query: vi.fn().mockImplementation((sql) => {
        if (sql.includes('FROM memory_stream') && sql.includes('orchestrator_chat') && sql.includes('不确定')) {
          return { rows: [{ cnt: '3' }] };
        }
        return { rows: [] };
      })
    };

    const { runPerception } = await import('../desire/perception.js');
    const observations = await runPerception(mockPool);

    const gapObs = observations.find(o => o.signal === 'learning_gap_signal');
    expect(gapObs).toBeDefined();
    expect(gapObs.value).toBe(3);
    expect(gapObs.importance).toBeGreaterThan(0);
  });

  it('D2: 有对话时生成 conversation_quality 信号', async () => {
    const mockPool = {
      query: vi.fn().mockImplementation((sql) => {
        if (sql.includes('FROM memory_stream') && sql.includes('feishu_chat') && sql.includes('deep_count')) {
          return { rows: [{ deep_count: '2', total_count: '5' }] };
        }
        return { rows: [] };
      })
    };

    const { runPerception } = await import('../desire/perception.js');
    const observations = await runPerception(mockPool);

    const convObs = observations.find(o => o.signal === 'conversation_quality');
    expect(convObs).toBeDefined();
    expect(convObs.value.total_count).toBe(5);
    expect(convObs.value.deep_count).toBe(2);
    expect(convObs.value.deep_rate).toBeCloseTo(0.4);
  });

  it('D2: 超过 48h 无探索任务时生成 intellectual_idle 信号', async () => {
    const longAgo = new Date(Date.now() - 72 * 3600 * 1000); // 72 小时前
    const mockPool = {
      query: vi.fn().mockImplementation((sql) => {
        if (sql.includes('FROM tasks') && sql.includes("task_type = 'research'") && sql.includes('trigger_source')) {
          return { rows: [{ last_research: longAgo }] };
        }
        return { rows: [] };
      })
    };

    const { runPerception } = await import('../desire/perception.js');
    const observations = await runPerception(mockPool);

    const idleObs = observations.find(o => o.signal === 'intellectual_idle');
    expect(idleObs).toBeDefined();
    expect(idleObs.value).toBeGreaterThanOrEqual(48);
  });

  it('D2: 48h 内有探索任务时不生成 intellectual_idle', async () => {
    const recentTime = new Date(Date.now() - 10 * 3600 * 1000); // 10 小时前
    const mockPool = {
      query: vi.fn().mockImplementation((sql) => {
        if (sql.includes('FROM tasks') && sql.includes("task_type = 'research'") && sql.includes('trigger_source')) {
          return { rows: [{ last_research: recentTime }] };
        }
        return { rows: [] };
      })
    };

    const { runPerception } = await import('../desire/perception.js');
    const observations = await runPerception(mockPool);

    const idleObs = observations.find(o => o.signal === 'intellectual_idle');
    expect(idleObs).toBeUndefined();
  });

  it('should detect task_milestone when completion rate >= 80%', async () => {
    // Mock: 过去 7 天 10 个任务完成 8 个
    const mockPool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ completed: '2', failed: '1', queued: '0', in_progress: '0' }] }) // 信号1: 任务统计
        .mockResolvedValueOnce({ rows: [] }) // 信号2: KR 进度
        .mockResolvedValueOnce({ rows: [] }) // 信号3: last_feishu_at
        .mockResolvedValueOnce({ rows: [{ in_progress: '0', queued: '0', completed_24h: '0' }] }) // 信号4: 空闲信号
        .mockResolvedValueOnce({ rows: [] }) // 信号5: user_last_seen
        .mockResolvedValueOnce({ rows: [{ cnt: '0' }] }) // 信号6: undigested
        .mockResolvedValueOnce({ rows: [] }) // 信号7: 连续失败
        .mockResolvedValueOnce({ rows: [{ completed: '8', total: '10' }] }) // 信号8: 里程碑：80%
    };

    const { runPerception } = await import('../desire/perception.js');
    const observations = await runPerception(mockPool);
    const milestone = observations.find(o => o.signal === 'task_milestone');
    expect(milestone).toBeDefined();
    expect(milestone.value.rate).toBeGreaterThanOrEqual(0.8);
  });
});

// ============================================================
// D3: 记忆层测试
// ============================================================

describe('Layer 2: 记忆层（Memory）', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('D3: 空 observations 时跳过并返回 written=0', async () => {
    const mockPool = { query: vi.fn() };

    const { runMemory } = await import('../desire/memory.js');
    const result = await runMemory(mockPool, []);

    expect(result.written).toBe(0);
    expect(result.total_importance).toBe(0);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('D3: 有 observations 时写入 memory_stream 并更新 accumulator', async () => {
    // mock callLLM 返回重要性分数
    const { callLLM } = await import('../llm-caller.js');
    callLLM.mockResolvedValue({ text: '1: 7', model: 'test', provider: 'test', elapsed_ms: 10 });

    const insertedRows = [];
    const upsertedKeys = [];

    const mockPool = {
      query: vi.fn().mockImplementation((sql, params) => {
        if (sql.includes('INSERT INTO memory_stream')) {
          insertedRows.push(params);
          return { rows: [] };
        }
        if (sql.includes("key = 'desire_importance_accumulator'") && sql.includes('SELECT')) {
          return { rows: [{ value_json: 10 }] };
        }
        if (sql.includes('INSERT INTO working_memory')) {
          upsertedKeys.push(params);
          return { rows: [] };
        }
        return { rows: [] };
      })
    };

    const observations = [
      { signal: 'task_fail_rate_24h', value: 0.3, context: '过去 24h 失败率 30%' }
    ];

    const { runMemory } = await import('../desire/memory.js');
    const result = await runMemory(mockPool, observations);

    expect(result.written).toBe(1);
    // importance 可能是 7（有 credentials）或 5（fallback），都是合法值
    expect(result.total_importance).toBeGreaterThanOrEqual(1);
    expect(insertedRows.length).toBe(1);

    // accumulator 应该更新为 10 + importance（>= 11）
    // params: ['desire_importance_accumulator', value]
    const accUpdate = upsertedKeys.find(p => Array.isArray(p) && p[0] === 'desire_importance_accumulator');
    expect(accUpdate).toBeDefined();
    expect(accUpdate[1]).toBeGreaterThan(10); // 10 (old) + 至少 1 (importance)
  });
});

// ============================================================
// D4: 反思层测试
// ============================================================

describe('Layer 3: 反思层（Reflection）', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('D4: accumulator < 12 时不触发反思', async () => {
    const mockPool = {
      query: vi.fn().mockImplementation((sql) => {
        if (sql.includes("key = 'desire_importance_accumulator'")) {
          return { rows: [{ value_json: 8 }] };
        }
        return { rows: [] };
      })
    };

    const { runReflection } = await import('../desire/reflection.js');
    const result = await runReflection(mockPool);

    expect(result.triggered).toBe(false);
    expect(result.accumulator).toBe(8);
  });

  it('D4: accumulator >= 30 时触发反思并重置', async () => {
    // mock callLLM 返回反思洞察
    const { callLLM } = await import('../llm-caller.js');
    callLLM.mockResolvedValue({ text: '系统任务失败率上升，需要关注 executor 稳定性。', model: 'test', provider: 'test', elapsed_ms: 10 });

    const queries = [];
    const mockPool = {
      query: vi.fn().mockImplementation((sql, params) => {
        queries.push({ sql, params });
        if (sql.includes("key = 'desire_importance_accumulator'") && sql.includes('SELECT')) {
          return { rows: [{ value_json: 35 }] };
        }
        if (sql.includes('FROM memory_stream') && sql.includes('LIMIT 50')) {
          return { rows: [
            { content: '过去 24h 失败率 30%', importance: 7, memory_type: 'long', created_at: new Date() }
          ]};
        }
        return { rows: [] };
      })
    };

    const { runReflection } = await import('../desire/reflection.js');
    const result = await runReflection(mockPool);

    expect(result.triggered).toBe(true);
    expect(result.insight).toBeTruthy();
    expect(result.accumulator_before).toBe(35);

    // 验证 accumulator 被重置（params: ['desire_importance_accumulator', 0]）
    const resetQuery = queries.find(q =>
      q.sql.includes('INSERT INTO working_memory') &&
      Array.isArray(q.params) &&
      q.params[0] === 'desire_importance_accumulator' &&
      q.params[1] === 0
    );
    expect(resetQuery).toBeDefined();
  });
});

// ============================================================
// D5: 欲望形成层测试
// ============================================================

describe('Layer 4: 欲望形成层（Desire Formation）', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('D5: runDesireFormation 插入 desires 表', async () => {
    // mock callLLM 返回 desire 结构
    const { callLLM } = await import('../llm-caller.js');
    callLLM.mockResolvedValue({
      text: JSON.stringify({
        type: 'warn',
        content: '系统任务失败率持续上升',
        proposed_action: '检查 executor 日志',
        urgency: 8
      }),
      model: 'test', provider: 'test', elapsed_ms: 10
    });

    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: 'test-uuid-123' }] })
    };

    const { runDesireFormation } = await import('../desire/desire-formation.js');
    const result = await runDesireFormation(mockPool, '系统任务失败率上升，需要关注 executor 稳定性。');

    expect(result.created).toBe(true);
    expect(result.desire_id).toBe('test-uuid-123');

    const insertCall = mockPool.query.mock.calls.find(c =>
      c[0].includes('INSERT INTO desires')
    );
    expect(insertCall).toBeDefined();
    expect(insertCall[1][0]).toBe('warn'); // type
    expect(insertCall[1][4]).toBeGreaterThanOrEqual(1); // urgency
  });

  it('D5: insight 为空时不插入', async () => {
    const mockPool = { query: vi.fn() };

    const { runDesireFormation } = await import('../desire/desire-formation.js');
    const result = await runDesireFormation(mockPool, '');

    expect(result.created).toBe(false);
    expect(mockPool.query).not.toHaveBeenCalled();
  });
});

// ============================================================
// D6: 表达决策层测试
// ============================================================

describe('Layer 5: 表达决策层（Expression Decision）', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('D6: 高urgency + 长沉默 → 评分 > 0.35 触发表达', async () => {
    const mockPool = {
      query: vi.fn().mockImplementation((sql) => {
        if (sql.includes('last_expression_at') || sql.includes('last_feishu_at')) {
          // 沉默 48 小时
          const time48hAgo = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
          return { rows: [{ value_json: time48hAgo }] };
        }
        if (sql.includes("key = 'user_last_seen'")) {
          return { rows: [] };
        }
        if (sql.includes('FROM desires')) {
          return { rows: [{
            id: 'desire-1',
            type: 'warn',
            content: '系统任务失败率上升',
            insight: '失败率超过 30%',
            proposed_action: '检查 executor',
            urgency: 9,
            evidence: {},
            expires_at: new Date(Date.now() + 12 * 3600 * 1000)
          }]};
        }
        return { rows: [] };
      })
    };

    const { runExpressionDecision } = await import('../desire/expression-decision.js');
    const result = await runExpressionDecision(mockPool);

    expect(result).not.toBeNull();
    expect(result.score).toBeGreaterThan(0.35);
    expect(result.desire.urgency).toBe(9);
  });

  it('D6: 低urgency + 刚发过 → 评分 <= 0.35 不触发', async () => {
    const mockPool = {
      query: vi.fn().mockImplementation((sql) => {
        if (sql.includes('last_expression_at') || sql.includes('last_feishu_at')) {
          // 刚刚发过（1 分钟前）
          const time1minAgo = new Date(Date.now() - 1 * 60 * 1000).toISOString();
          return { rows: [{ value_json: time1minAgo }] };
        }
        if (sql.includes("key = 'user_last_seen'")) {
          return { rows: [] };
        }
        if (sql.includes('FROM desires')) {
          return { rows: [{
            id: 'desire-2',
            type: 'inform',
            content: '日常汇报',
            insight: null,
            proposed_action: '无需操作',
            urgency: 2,
            evidence: {},
            expires_at: new Date(Date.now() + 24 * 3600 * 1000)
          }]};
        }
        return { rows: [] };
      })
    };

    const { runExpressionDecision } = await import('../desire/expression-decision.js');
    const result = await runExpressionDecision(mockPool);

    expect(result).toBeNull();
  });

  it('D6: 无 pending desires 时返回 null', async () => {
    const mockPool = {
      query: vi.fn().mockImplementation(() => ({ rows: [] }))
    };

    const { runExpressionDecision } = await import('../desire/expression-decision.js');
    const result = await runExpressionDecision(mockPool);

    expect(result).toBeNull();
  });
});

// ============================================================
// D7: 表达层测试
// ============================================================

describe('Layer 6: 表达层（Expression）', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('D7: runExpression 更新 last_expression_at 和 desire 状态', async () => {
    // mock callLLM 返回格式化消息
    const { callLLM } = await import('../llm-caller.js');
    callLLM.mockResolvedValue({
      text: '**⚠️ 预警**\n\n**观察**：任务失败率上升\n\n**判断**：需要关注\n\n**建议**：检查 executor 日志',
      model: 'test', provider: 'test', elapsed_ms: 10
    });

    const upsertedKeys = [];
    const updatedStatuses = [];

    const mockPool = {
      query: vi.fn().mockImplementation((sql, params) => {
        if (sql.includes('INSERT INTO working_memory') && Array.isArray(params)) {
          upsertedKeys.push({ key: params[0], val: params[1] });
        }
        if (sql.includes('UPDATE desires SET status')) {
          updatedStatuses.push(params);
        }
        return { rows: [] };
      })
    };

    const { runExpression } = await import('../desire/expression.js');
    const desire = {
      id: 'test-desire-1',
      type: 'warn',
      content: '任务失败率上升',
      insight: '失败率超过 30%',
      proposed_action: '检查 executor 日志',
      urgency: 8
    };

    const result = await runExpression(mockPool, desire);

    // last_expression_at 应该被更新（从 last_feishu_at 改名）
    const exprUpdate = upsertedKeys.find(k => k.key === 'last_expression_at');
    expect(exprUpdate).toBeDefined();
    expect(typeof exprUpdate.val).toBe('string'); // ISO 时间字符串

    // desire 状态应该更新为 expressed
    expect(updatedStatuses.length).toBeGreaterThan(0);
  });
});

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
  it('D9: selfcheck.js EXPECTED_SCHEMA_VERSION 为 152', async () => {
    const { EXPECTED_SCHEMA_VERSION } = await import('../selfcheck.js');
    expect(EXPECTED_SCHEMA_VERSION).toBe('152');
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
