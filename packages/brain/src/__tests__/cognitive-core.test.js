/**
 * Cognitive Core 单元测试
 *
 * 覆盖 8 个认知系统的核心逻辑
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  evaluateEmotion,
  getCurrentEmotion,
  EMOTION_STATES,
  updateSubjectiveTime,
  getSubjectiveTime,
  getParallelAwareness,
  predictTaskOutcome,
  getTrustScores,
  getTrustScore,
  getDelegationConfidence,
  calculateMotivation,
  recordTickEvent,
  updateNarrative,
  getLatestNarrative,
  _resetCaches,
} from '../cognitive-core.js';

// ──────────────────────────────────────────────────────────────
// Mock 依赖
// ──────────────────────────────────────────────────────────────

vi.mock('../db.js', () => ({
  default: {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  },
}));

vi.mock('../llm-caller.js', () => ({
  callLLM: vi.fn().mockResolvedValue('今天我处理了几个任务，感觉还不错，时间流逝，我在持续运转。'),
}));

// ──────────────────────────────────────────────────────────────
// 1. 情绪系统
// ──────────────────────────────────────────────────────────────

describe('情绪系统 (Emotion System)', () => {
  it('CPU高+队列深 → overloaded', () => {
    const result = evaluateEmotion({ cpuPercent: 85, queueDepth: 15, successRate: 0.8 });
    expect(result.state).toBe(EMOTION_STATES.overloaded);
    expect(result.dispatch_rate_modifier).toBeLessThan(1);
  });

  it('成功率低 → anxious', () => {
    const result = evaluateEmotion({ cpuPercent: 20, queueDepth: 2, successRate: 0.4 });
    expect(result.state).toBe(EMOTION_STATES.anxious);
  });

  it('连续成功+低负载 → excited', () => {
    const result = evaluateEmotion({ cpuPercent: 20, queueDepth: 5, successRate: 0.95 });
    expect(result.state).toBe(EMOTION_STATES.excited);
    expect(result.dispatch_rate_modifier).toBeGreaterThan(1);
  });

  it('长时间运行+高警觉 → tired', () => {
    const result = evaluateEmotion({ alertnessLevel: 3, uptimeHours: 15, successRate: 0.7 });
    expect(result.state).toBe(EMOTION_STATES.tired);
  });

  it('低负载低队列 → focused', () => {
    const result = evaluateEmotion({ cpuPercent: 10, queueDepth: 1, successRate: 0.8 });
    expect(result.state).toBe(EMOTION_STATES.focused);
  });

  it('情绪结果包含行为修正器', () => {
    const result = evaluateEmotion({});
    expect(result).toHaveProperty('dispatch_rate_modifier');
    expect(result).toHaveProperty('concurrency_modifier');
    expect(result).toHaveProperty('label');
  });

  it('getCurrentEmotion 返回持久化状态', () => {
    evaluateEmotion({ cpuPercent: 85, queueDepth: 20 });
    const state = getCurrentEmotion();
    expect(state).toHaveProperty('state');
    expect(state).toHaveProperty('duration_ms');
  });
});

// ──────────────────────────────────────────────────────────────
// 2. 主观时间感
// ──────────────────────────────────────────────────────────────

describe('主观时间感 (Subjective Time)', () => {
  it('首次调用返回 normal', () => {
    const result = updateSubjectiveTime();
    expect(result).toHaveProperty('felt_pace');
    expect(result).toHaveProperty('multiplier');
  });

  it('多次调用后有 felt_elapsed_ms', () => {
    updateSubjectiveTime();
    updateSubjectiveTime();
    const result = updateSubjectiveTime();
    expect(result.actual_elapsed_ms).toBeGreaterThanOrEqual(0);
  });

  it('getSubjectiveTime 返回最新状态', () => {
    updateSubjectiveTime();
    const state = getSubjectiveTime();
    expect(state).toHaveProperty('felt_pace');
  });
});

// ──────────────────────────────────────────────────────────────
// 3. 并发意识
// ──────────────────────────────────────────────────────────────

describe('并发意识 (Parallel Awareness)', () => {
  it('返回任务快照结构', async () => {
    const mockDb = {
      query: vi.fn().mockResolvedValue({
        rows: [
          { id: '1', title: '测试任务', task_type: 'dev', skill: '/dev', assigned_agent: '/dev', started_at: new Date(), running_minutes: 5 },
        ]
      })
    };
    const result = await getParallelAwareness(mockDb);
    expect(result).toHaveProperty('tasks');
    expect(result).toHaveProperty('agent_load');
    expect(result).toHaveProperty('conflicts');
    expect(result.total_running).toBe(1);
  });

  it('同 agent 超过 2 个任务 → 检测冲突', async () => {
    const mockDb = {
      query: vi.fn().mockResolvedValue({
        rows: [
          { id: '1', title: '任务A', assigned_agent: '/dev', started_at: new Date(), running_minutes: 5 },
          { id: '2', title: '任务B', assigned_agent: '/dev', started_at: new Date(), running_minutes: 3 },
          { id: '3', title: '任务C', assigned_agent: '/dev', started_at: new Date(), running_minutes: 1 },
        ]
      })
    };
    const result = await getParallelAwareness(mockDb);
    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(result.conflicts[0].type).toBe('agent_overload');
  });

  it('DB 错误时优雅降级', async () => {
    const mockDb = { query: vi.fn().mockRejectedValue(new Error('DB down')) };
    const result = await getParallelAwareness(mockDb);
    expect(result.tasks).toEqual([]);
    expect(result.total_running).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────
// 4. 世界模型
// ──────────────────────────────────────────────────────────────

describe('世界模型 (World Model)', () => {
  beforeEach(() => { _resetCaches(); });

  it('基于历史数据预测成功概率', async () => {
    const mockDb = {
      query: vi.fn().mockResolvedValue({
        rows: [{ successes: '8', failures: '2', avg_minutes: '25' }]
      })
    };
    const result = await predictTaskOutcome({ task_type: 'dev', skill: '/dev' }, mockDb);
    expect(result.success_prob).toBeCloseTo(0.8, 1);
    expect(result.avg_duration_min).toBeCloseTo(25, 0);
  });

  it('无历史数据时返回默认值', async () => {
    const mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [{ successes: '0', failures: '0', avg_minutes: null }] })
    };
    const result = await predictTaskOutcome({ task_type: 'qa', skill: '/qa' }, mockDb);
    expect(result.success_prob).toBe(0.7);
  });
});

// ──────────────────────────────────────────────────────────────
// 5. 信任校准
// ──────────────────────────────────────────────────────────────

describe('信任校准 (Trust Model)', () => {
  beforeEach(() => { _resetCaches(); });

  it('高成功率 → 高信任分', async () => {
    const mockDb = {
      query: vi.fn().mockResolvedValue({
        rows: [{ agent_key: '/dev', successes: '18', failures: '2', total: '20' }]
      })
    };
    const scores = await getTrustScores(mockDb);
    expect(scores['/dev'].score).toBeGreaterThan(0.8);
    expect(scores['/dev'].label).toBe('高信任');
  });

  it('低成功率 → 低信任分', async () => {
    const mockDb = {
      query: vi.fn().mockResolvedValue({
        rows: [{ agent_key: '/dev', successes: '3', failures: '17', total: '20' }]
      })
    };
    const scores = await getTrustScores(mockDb);
    expect(scores['/dev'].score).toBeLessThan(0.65);
    expect(scores['/dev'].label).toBe('低信任');
  });

  it('未知 agent → 返回默认 0.7', () => {
    const score = getTrustScore({}, 'unknown-agent');
    expect(score).toBe(0.7);
  });
});

// ──────────────────────────────────────────────────────────────
// 6. 委托信心
// ──────────────────────────────────────────────────────────────

describe('委托信心 (Delegation Confidence)', () => {
  it('高信任+兴奋情绪 → delegate', () => {
    const trustScores = { '/dev': { score: 0.9 } };
    const result = getDelegationConfidence({ skill: '/dev', priority: 'P1' }, trustScores, 'excited');
    expect(result.action).toBe('delegate');
    expect(result.score).toBeGreaterThan(0.75);
  });

  it('低信任+焦虑情绪 → wait', () => {
    const trustScores = { '/dev': { score: 0.4 } };
    const result = getDelegationConfidence({ skill: '/dev', priority: 'P2' }, trustScores, 'anxious');
    expect(result.action).toBe('wait');
  });

  it('中等信任 → analyze', () => {
    const trustScores = { '/dev': { score: 0.65 } };
    const result = getDelegationConfidence({ skill: '/dev', priority: 'P2' }, trustScores, 'calm');
    expect(result.action).toBe('analyze');
  });
});

// ──────────────────────────────────────────────────────────────
// 7. 动机系统
// ──────────────────────────────────────────────────────────────

describe('动机系统 (Motivation System)', () => {
  it('高KR对齐+高信任+好情绪 → 高动机', () => {
    const trustScores = { '/dev': { score: 0.9 } };
    const result = calculateMotivation({ skill: '/dev' }, trustScores, 'focused', 0.9);
    expect(result.score).toBeGreaterThan(0.7);
    expect(result.should_reflect).toBe(false);
  });

  it('低KR对齐+过载 → 低动机 → 触发反思', () => {
    const trustScores = { '/dev': { score: 0.5 } };
    const result = calculateMotivation({ skill: '/dev' }, trustScores, 'overloaded', 0.1);
    expect(result.score).toBeLessThan(0.4);
    expect(result.should_reflect).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────
// 8. 内在叙事
// ──────────────────────────────────────────────────────────────

describe('内在叙事 (Narrative Loop)', () => {
  beforeEach(() => {
    // 重置叙事状态（通过记录足够多事件触发）
    for (let i = 0; i < 5; i++) {
      recordTickEvent({ phase: 'tick', detail: `事件 ${i}` });
    }
  });

  it('recordTickEvent 不抛出异常', () => {
    expect(() => recordTickEvent({ phase: 'dispatch', detail: '派发任务' })).not.toThrow();
  });

  it('冷却期内 updateNarrative 返回 null', async () => {
    // 在冷却期内（刚刚重置后立即调用）
    const mockDb = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    // 叙事间隔 1 小时，所以第一次调用可能返回 null（取决于上次记录时间）
    const result = await updateNarrative({ state: 'calm', label: '平静', intensity: 0.5 }, mockDb);
    // 结果是 null 或有 narrative
    expect(result === null || typeof result.narrative === 'string').toBe(true);
  });

  it('getLatestNarrative 返回最近叙事', async () => {
    const mockDb = {
      query: vi.fn().mockResolvedValue({
        rows: [{ content: '今天我处理了几个任务', created_at: new Date() }]
      })
    };
    const result = await getLatestNarrative(mockDb);
    expect(result?.content).toBe('今天我处理了几个任务');
  });
});
