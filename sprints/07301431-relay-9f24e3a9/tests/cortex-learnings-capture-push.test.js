/**
 * cortex.js::recordLearnings → capture_atoms 推送（T10）行为级复现测试
 *
 * 复现 2026-07-29 21:10 UTC ledger-hygiene.js m7 探针"自主循环零产出"误报的
 * 原始怀疑点：cortex.js::recordLearnings 写入 learnings 表成功后，从未调用
 * pushCaptureAtom 推送 T10 统一收件箱。
 *
 * Mock 说明（对齐仓库既有同类测试写法 —— cortex-feedback-loop.test.js /
 * learning-capture-push.test.js 均采用同样的 db.js + capture-inbox.js 隔离
 * mock 方式）：db.js 与 capture-inbox.js 在本文件中被 mock，用于单测隔离与
 * 提速；真实 Postgres 写入链路由「结构性 source-code inspection 测试」
 * （learnings-capture-atom-routing.test.js，零 mock）与「## E2E 验收」脚本
 * （对 auto-learning.js::createAutoLearning 的真实触发 + psql 验证，同样零
 * mock）两层兜底覆盖，详见 contract-draft.md「## 未覆盖真实链路清单」。
 *
 * 本文件最终落址 packages/brain/src/__tests__/cortex-learnings-capture-push.test.js
 * （由 harness-generator 在 TDD Red 提交时原样迁入）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPool = { query: vi.fn() };
const pushMock = vi.fn().mockResolvedValue('atom-1');

function applyMocks() {
  vi.doMock('../db.js', () => ({ default: mockPool }));
  vi.doMock('../capture-inbox.js', () => ({ pushCaptureAtom: (...args) => pushMock(...args) }));
  vi.doMock('../thalamus.js', () => ({
    ACTION_WHITELIST: {
      request_human_review: { dangerous: false, description: 'Request human review' },
    },
    validateDecision: vi.fn(),
    recordLLMError: vi.fn(),
    recordTokenUsage: vi.fn(),
  }));
  vi.doMock('../llm-caller.js', () => ({
    callLLM: vi.fn().mockResolvedValue({ text: JSON.stringify({
      level: 2,
      analysis: { root_cause: 'test', contributing_factors: [], impact_assessment: 'test' },
      actions: [],
      strategy_updates: [],
      learnings: ['Cortex learned: T10 收件箱应同步接收 learnings 产出'],
      rationale: 'test',
      confidence: 0.8,
      safety: false,
    }) }),
  }));
  vi.doMock('../learning.js', () => ({
    searchRelevantLearnings: vi.fn().mockResolvedValue([]),
  }));
  vi.doMock('../cortex-quality.js', () => ({
    evaluateQualityInitial: vi.fn().mockResolvedValue(null),
    generateSimilarityHash: vi.fn().mockReturnValue('abc123'),
    checkShouldCreateRCA: vi.fn().mockResolvedValue({ should_create: true }),
  }));
  vi.doMock('../policy-validator.js', () => ({
    validatePolicyJson: vi.fn().mockReturnValue({ valid: false, errors: ['test'] }),
  }));
  vi.doMock('../self-model.js', () => ({
    getSelfModel: vi.fn().mockResolvedValue('我是 Cecelia，AI 管家系统。'),
  }));
  vi.doMock('../memory-utils.js', () => ({
    generateL0Summary: vi.fn().mockReturnValue('test summary'),
  }));
}

// analyzeDeep 调用链上 recordLearnings 之前，还会做一串其它 pool.query
// （reflection state / decision_log / system_status / cortex_analyses /
// cross-task patterns / output dedup），顺序与 cortex-feedback-loop.test.js
// 完全一致（同一条 analyzeDeep 调用链，未改动这部分）。
function setupPoolMocksUpToRecordLearnings({ dedupResult = [] } = {}) {
  mockPool.query.mockResolvedValueOnce({ rows: [] }); // 0. _loadReflectionStateFromDB
  mockPool.query.mockResolvedValueOnce({ rows: [] }); // 1. _persistReflectionEntry
  mockPool.query.mockResolvedValueOnce({ rows: [] }); // 2. decision_log SELECT
  mockPool.query.mockResolvedValueOnce({ rows: [{ tasks_in_progress: 0, recent_failures: 0, active_goals: 1 }] }); // 3. system_status
  mockPool.query.mockResolvedValueOnce({ rows: [] }); // 4. searchRelevantAnalyses
  mockPool.query.mockResolvedValueOnce({ rows: [] }); // 4b. cross-task failure patterns
  mockPool.query.mockResolvedValueOnce({ rows: [] }); // 5. _loadOutputDedupStateFromDB
  mockPool.query.mockResolvedValueOnce({ rows: [] }); // 6. _persistOutputDedupEntry
  mockPool.query.mockResolvedValueOnce({ rows: [] }); // 7. logCortexDecision
  mockPool.query.mockResolvedValueOnce({ rows: dedupResult }); // 8. recordLearnings: content_hash dedup check
  if (dedupResult.length === 0) {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'learn-cortex-1' }] }); // 9. recordLearnings: INSERT INTO learnings
  }
}

describe('cortex.js::recordLearnings → capture_atoms 推送（T10 收件箱完整性缺口修复）[BEHAVIOR]', () => {
  let analyzeDeep;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockPool.query.mockReset();
    pushMock.mockReset();
    pushMock.mockResolvedValue('atom-1');
    applyMocks();

    const mod = await import('../cortex.js');
    analyzeDeep = mod.analyzeDeep;
  });

  it('cortex.js::recordLearnings 写入 learnings 成功后应调用 pushCaptureAtom（复现 m7 探针误报的原始 issue 场景）', async () => {
    setupPoolMocksUpToRecordLearnings();

    await analyzeDeep({ type: 'test_event' });

    expect(pushMock).toHaveBeenCalledTimes(1);
  });

  it('pushCaptureAtom 推送字段（targetType/targetSubtype/routedToTable/routedToId）与 learning.js::recordLearning 既有约定一致', async () => {
    setupPoolMocksUpToRecordLearnings();

    await analyzeDeep({ type: 'test_event' });

    expect(pushMock).toHaveBeenCalledTimes(1);
    const [, fields] = pushMock.mock.calls[0];
    expect(fields.targetType).toBe('learning');
    expect(fields.targetSubtype).toBe('cortex_insight');
    expect(fields.routedToTable).toBe('learnings');
    expect(fields.routedToId).toBe('learn-cortex-1');
  });

  it('recordLearnings 去重命中（相同 content_hash 已存在）时不应调用 pushCaptureAtom', async () => {
    setupPoolMocksUpToRecordLearnings({ dedupResult: [{ id: 'existing-cortex-1' }] });

    await analyzeDeep({ type: 'test_event' });

    expect(pushMock).not.toHaveBeenCalled();
  });

  it('pushCaptureAtom 抛错时 recordLearnings 不应向上抛出未捕获异常（learnings 主写入已完成，不回滚，对齐 learning.js:121 既有容错模式）', async () => {
    setupPoolMocksUpToRecordLearnings();
    pushMock.mockRejectedValueOnce(new Error('capture_atoms insert failed'));

    let threw = false;
    let decision;
    try {
      decision = await analyzeDeep({ type: 'test_event' });
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(decision).toBeDefined();
  });
});
