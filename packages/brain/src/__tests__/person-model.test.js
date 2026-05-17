/**
 * Tests for person-model.js + pending-conversations.js + proactive-mouth.js
 *
 * 覆盖：
 *   - computeEffectiveConfidence 衰减公式（向基准线衰减）
 *   - recordSignal / getActiveSignals（含 last_accessed_at 更新）
 *   - buildPersonContext
 *   - recordOutbound / resolveByPersonReply
 *   - shouldFollowUp 概率机制
 *   - checkPendingFollowups
 *   - notifyTaskCompletion（mock sendFeishu + callLLM）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  computeEffectiveConfidence,
  getPersonModel,
  upsertPersonModel,
  recordSignal,
  getActiveSignals,
  buildPersonContext,
  extractPersonSignals,
  detectAndStoreTaskInterest
} from '../person-model.js';
import {
  recordOutbound,
  resolveByPersonReply,
  shouldFollowUp,
  checkPendingFollowups,
  getOpenConversations
} from '../pending-conversations.js';

// ─── Mock pool ──────────────────────────────────────────────

function makePool(overrides = {}) {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    ...overrides
  };
}

// ─── computeEffectiveConfidence ──────────────────────────────

describe('computeEffectiveConfidence', () => {
  it('permanent tier 直接返回原置信度', () => {
    const signal = { decay_tier: 'permanent', confidence: 0.9, last_accessed_at: new Date().toISOString(), created_at: new Date().toISOString() };
    expect(computeEffectiveConfidence(signal)).toBeCloseTo(0.9);
  });

  it('刚写入的 hourly 信号置信度接近原值', () => {
    const signal = {
      decay_tier: 'hourly',
      confidence: 0.8,
      last_accessed_at: new Date().toISOString(),
      created_at: new Date().toISOString()
    };
    const eff = computeEffectiveConfidence(signal);
    // 刚创建，衰减极少，应接近 0.8
    expect(eff).toBeGreaterThan(0.75);
  });

  it('4小时后 hourly 信号置信度向基准线衰减（不向零）', () => {
    const fourHoursAgo = new Date(Date.now() - 4 * 3600 * 1000).toISOString();
    const signal = {
      decay_tier: 'hourly',
      confidence: 0.8,
      last_accessed_at: fourHoursAgo,
      created_at: fourHoursAgo
    };
    const eff = computeEffectiveConfidence(signal);
    // 4小时 = 2倍 half-life，decay_factor = 0.5^2 = 0.25
    // expected = 0.1 + (0.8 - 0.1) * 0.25 = 0.1 + 0.175 = 0.275
    expect(eff).toBeGreaterThan(0.1);   // 必须大于基准线
    expect(eff).toBeLessThan(0.5);      // 但明显低于原值
  });

  it('weekly 信号 3天后仍有一定置信度', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
    const signal = {
      decay_tier: 'weekly',
      confidence: 0.7,
      last_accessed_at: threeDaysAgo,
      created_at: threeDaysAgo
    };
    const eff = computeEffectiveConfidence(signal);
    // 3天 = 72h = 1倍 half-life，decay_factor = 0.5
    // expected = 0.1 + (0.7 - 0.1) * 0.5 = 0.4
    expect(eff).toBeCloseTo(0.4, 1);
    expect(eff).toBeGreaterThan(0.1);
  });
});

// ─── getPersonModel ──────────────────────────────────────────

describe('getPersonModel', () => {
  it('找到时返回第一行', async () => {
    const pool = makePool({
      query: vi.fn().mockResolvedValue({
        rows: [{ person_id: 'owner', name: 'Alex', stable_traits: {} }]
      })
    });
    const result = await getPersonModel(pool, 'owner');
    expect(result).toEqual({ person_id: 'owner', name: 'Alex', stable_traits: {} });
  });

  it('未找到时返回 null', async () => {
    const pool = makePool();
    const result = await getPersonModel(pool, 'unknown');
    expect(result).toBeNull();
  });

  it('数据库错误时返回 null（不抛出）', async () => {
    const pool = makePool({ query: vi.fn().mockRejectedValue(new Error('db error')) });
    const result = await getPersonModel(pool, 'owner');
    expect(result).toBeNull();
  });
});

// ─── recordSignal ────────────────────────────────────────────

describe('recordSignal', () => {
  it('hourly tier 设置 expires_at（4小时后）', async () => {
    const pool = makePool();
    await recordSignal(pool, 'owner', 'mood', 'stressed', { decayTier: 'hourly' });

    const callArgs = pool.query.mock.calls[0];
    const sql = callArgs[0];
    const params = callArgs[1];

    expect(sql).toContain('INSERT INTO person_signals');
    expect(params[0]).toBe('owner');
    expect(params[1]).toBe('mood');
    expect(params[2]).toBe('stressed');
    // expires_at (params[6]) 应该是约 4 小时后
    const expiresAt = new Date(params[6]);
    const hoursFromNow = (expiresAt - Date.now()) / (1000 * 3600);
    expect(hoursFromNow).toBeGreaterThan(3.9);
    expect(hoursFromNow).toBeLessThan(4.1);
  });

  it('permanent tier 的 expires_at 为 null', async () => {
    const pool = makePool();
    await recordSignal(pool, 'owner', 'sentiment', 'direct_communicator', { decayTier: 'permanent' });

    const params = pool.query.mock.calls[0][1];
    expect(params[6]).toBeNull(); // expires_at
  });

  it('数据库错误时静默失败（不抛出）', async () => {
    const pool = makePool({ query: vi.fn().mockRejectedValue(new Error('db error')) });
    await expect(recordSignal(pool, 'owner', 'mood', 'calm')).resolves.toBeUndefined();
  });
});

// ─── getActiveSignals ────────────────────────────────────────

describe('getActiveSignals', () => {
  it('返回未过期信号（带有效置信度）', async () => {
    const mockSignal = {
      id: 'uuid-1',
      person_id: 'owner',
      signal_type: 'mood',
      signal_value: 'stressed',
      confidence: 0.8,
      decay_tier: 'hourly',
      last_accessed_at: new Date().toISOString(),
      created_at: new Date().toISOString()
    };
    const pool = makePool({
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [mockSignal] })  // SELECT
        .mockResolvedValueOnce({ rows: [] })             // UPDATE last_accessed_at
    });

    const signals = await getActiveSignals(pool, 'owner');
    expect(signals).toHaveLength(1);
    expect(signals[0]).toHaveProperty('effective_confidence');
    expect(signals[0].effective_confidence).toBeGreaterThan(0.15);
  });

  it('空结果返回空数组', async () => {
    const pool = makePool();
    const signals = await getActiveSignals(pool, 'nobody');
    expect(signals).toEqual([]);
  });
});

// ─── buildPersonContext ──────────────────────────────────────

describe('buildPersonContext', () => {
  it('有模型和信号时返回格式化字符串', async () => {
    const pool = makePool({
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ stable_traits: { communication_style: 'direct' } }] }) // getPersonModel
        .mockResolvedValueOnce({ rows: [{ // getActiveSignals SELECT
          id: 'uuid-1',
          signal_type: 'mood',
          signal_value: 'calm',
          confidence: 0.8,
          decay_tier: 'permanent',
          source: 'explicit',
          last_accessed_at: new Date().toISOString(),
          created_at: new Date().toISOString()
        }] })
        .mockResolvedValueOnce({ rows: [] }) // UPDATE last_accessed_at
    });

    const ctx = await buildPersonContext(pool, 'owner');
    expect(ctx).toContain('稳定特征');
    expect(ctx).toContain('当前状态');
    expect(ctx).toContain('mood=calm');
  });

  it('无数据时返回占位符', async () => {
    const pool = makePool();
    const ctx = await buildPersonContext(pool, 'unknown');
    expect(ctx).toBe('（暂无记录）');
  });
});

// ─── recordOutbound ──────────────────────────────────────────

describe('recordOutbound', () => {
  it('写入 pending_conversations 并返回 id', async () => {
    const pool = makePool({
      query: vi.fn().mockResolvedValue({ rows: [{ id: 'conv-uuid-1' }], rowCount: 1 })
    });

    const id = await recordOutbound(pool, '任务完成了', {
      contextType: 'task_completion',
      importance: 0.7
    });
    expect(id).toBe('conv-uuid-1');
    expect(pool.query.mock.calls[0][0]).toContain('INSERT INTO pending_conversations');
  });

  it('数据库错误时返回 null', async () => {
    const pool = makePool({ query: vi.fn().mockRejectedValue(new Error('db error')) });
    const id = await recordOutbound(pool, 'test');
    expect(id).toBeNull();
  });
});

// ─── shouldFollowUp ──────────────────────────────────────────

describe('shouldFollowUp', () => {
  it('超过最大跟进次数时返回 false', () => {
    const conv = {
      followed_up_count: 3,
      importance: 1.0,
      sent_at: new Date(Date.now() - 10 * 3600 * 1000).toISOString(),
      last_followup_at: null
    };
    expect(shouldFollowUp(conv)).toBe(false);
  });

  it('距上次跟进不足 1 小时时返回 false', () => {
    const conv = {
      followed_up_count: 1,
      importance: 1.0,
      sent_at: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
      last_followup_at: new Date(Date.now() - 30 * 60 * 1000).toISOString() // 30分钟前
    };
    expect(shouldFollowUp(conv)).toBe(false);
  });

  it('高重要性 + 长时间沉默 → 大概率返回 true', () => {
    const conv = {
      followed_up_count: 0,
      importance: 0.95,  // 极高重要性
      sent_at: new Date(Date.now() - 20 * 3600 * 1000).toISOString(), // 20小时前
      last_followup_at: null
    };
    // importance(0.95) + urgencyBonus(0.3) = 1.25 > 任何 Math.random() [0,1)
    // 因此必然返回 true
    const results = Array.from({ length: 20 }, () => shouldFollowUp(conv));
    expect(results.every(r => r === true)).toBe(true);
  });

  it('低重要性 + 刚发出 → 大概率返回 false', () => {
    const conv = {
      followed_up_count: 0,
      importance: 0.05,  // 极低重要性
      sent_at: new Date().toISOString(), // 刚发
      last_followup_at: null
    };
    // importance(0.05) + urgencyBonus(~0) = 0.05 < 大多数 Math.random() [0,1)
    const results = Array.from({ length: 50 }, () => shouldFollowUp(conv));
    const trueCount = results.filter(Boolean).length;
    expect(trueCount).toBeLessThan(15); // 少于 30% 返回 true
  });
});

// ─── checkPendingFollowups ───────────────────────────────────

describe('checkPendingFollowups', () => {
  it('无待回音消息时返回空数组', async () => {
    const pool = makePool();
    const result = await checkPendingFollowups(pool);
    expect(result).toEqual([]);
  });

  it('有高重要性消息时更新 followed_up_count', async () => {
    const conv = {
      id: 'uuid-conv-1',
      followed_up_count: 0,
      importance: 0.99,
      sent_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(), // 24小时前
      last_followup_at: null
    };
    const pool = makePool({
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [conv] })        // SELECT
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE
    });

    const result = await checkPendingFollowups(pool);
    // importance=0.99 + urgencyBonus=0.3 = 1.29 > Math.random()，必然跟进
    expect(result.length).toBeGreaterThan(0);
    expect(pool.query).toHaveBeenCalledTimes(2);
    const updateCall = pool.query.mock.calls[1][0];
    expect(updateCall).toContain('UPDATE pending_conversations');
    expect(updateCall).toContain('followed_up_count');
  });

  it('数据库错误时返回空数组', async () => {
    const pool = makePool({ query: vi.fn().mockRejectedValue(new Error('db error')) });
    const result = await checkPendingFollowups(pool);
    expect(result).toEqual([]);
  });
});

// ─── resolveByPersonReply ────────────────────────────────────

describe('resolveByPersonReply', () => {
  it('标记所有该人的 pending 消息为已解决', async () => {
    const pool = makePool({ query: vi.fn().mockResolvedValue({ rowCount: 2 }) });
    await resolveByPersonReply(pool, 'owner');
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain('UPDATE pending_conversations');
    expect(sql).toContain('resolved_at');
  });

  it('数据库错误时静默失败', async () => {
    const pool = makePool({ query: vi.fn().mockRejectedValue(new Error('db error')) });
    await expect(resolveByPersonReply(pool, 'owner')).resolves.toBeUndefined();
  });
});

// ─── extractPersonSignals ────────────────────────────────────

describe('extractPersonSignals', () => {
  it('LLM 返回有效 JSON 时调用 recordSignal', async () => {
    const pool = makePool();
    const callLLM = vi.fn().mockResolvedValue({
      text: '[{"signal_type":"mood","signal_value":"stressed","confidence":0.8,"source":"explicit","decay_tier":"hourly","raw_excerpt":"我在忙"}]'
    });

    await extractPersonSignals(pool, 'owner', '我今天上午一直在开会，非常忙', 'OK，了解', callLLM);
    expect(callLLM).toHaveBeenCalledOnce();
    expect(pool.query).toHaveBeenCalledOnce(); // recordSignal
  });

  it('消息太短（< 5字）时直接返回', async () => {
    const pool = makePool();
    const callLLM = vi.fn();
    await extractPersonSignals(pool, 'owner', 'ok', 'reply', callLLM);
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('LLM 返回空数组时不写入信号', async () => {
    const pool = makePool();
    const callLLM = vi.fn().mockResolvedValue({ text: '[]' });
    await extractPersonSignals(pool, 'owner', '今天天气不错', 'OK', callLLM);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('LLM 失败时静默（不抛出）', async () => {
    const pool = makePool();
    const callLLM = vi.fn().mockRejectedValue(new Error('LLM error'));
    await expect(
      extractPersonSignals(pool, 'owner', '我现在比较忙', 'OK', callLLM)
    ).resolves.toBeUndefined();
  });
});

// ─── detectAndStoreTaskInterest ──────────────────────────────

describe('detectAndStoreTaskInterest', () => {
  it('非任务询问文本 → 不查询 DB', async () => {
    const pool = makePool();
    await detectAndStoreTaskInterest(pool, '今天天气怎么样');
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('太短文本 → 直接返回', async () => {
    const pool = makePool();
    await detectAndStoreTaskInterest(pool, 'ok');
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('检测到任务询问且有匹配任务 → 写入 working_memory', async () => {
    const taskId = '550e8400-e29b-41d4-a716-446655440000';
    const pool = makePool({
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: taskId, title: '修复登录 bug' }] }) // SELECT tasks
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // INSERT working_memory
    });
    await detectAndStoreTaskInterest(pool, '那个修复登录的任务完成了吗');
    expect(pool.query).toHaveBeenCalledTimes(2);
    // 第二次调用（INSERT working_memory）的 key 包含 task_interest:
    const insertCall = pool.query.mock.calls[1];
    expect(insertCall[1][0]).toBe(`task_interest:${taskId}`);
  });

  it('检测到任务询问但无匹配任务 → 写入关键词订阅', async () => {
    const pool = makePool({
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] }) // SELECT tasks（无匹配）
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // INSERT working_memory (kw)
    });
    // 使用有实质关键词的消息（"修复认证"不在过滤列表，会被提取为关键词）
    await detectAndStoreTaskInterest(pool, '那个修复认证的任务完成了吗');
    expect(pool.query).toHaveBeenCalledTimes(2);
    const insertCall = pool.query.mock.calls[1];
    expect(insertCall[1][0]).toMatch(/^task_interest_kw:/);
  });

  it('DB 查询失败时静默（不抛出）', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('DB error')) };
    await expect(
      detectAndStoreTaskInterest(pool, '那个任务完成了吗')
    ).resolves.toBeUndefined();
  });
});
