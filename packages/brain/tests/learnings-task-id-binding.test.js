/**
 * DoD tests for migration 271: learnings.task_id 代码层强绑定
 *
 * [BEHAVIOR] learnings-received 收到 task_id → INSERT INTO learnings 必须把它写入 task_id 列
 * [BEHAVIOR] learnings-received 缺 task_id 但有 next_steps → 触发 missing_task_id 事件
 * [BEHAVIOR] recordLearning 收到 analysis.task_id → INSERT 必须把它写入 task_id 列
 * [BEHAVIOR] auto-learning createAutoLearning 收到 metadata.task_id（UUID）→ 提升到列
 *
 * 不连真 DB，用内存 pool 拦截 SQL 验证参数。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── 内存 pool：拦截 query 调用，记录 SQL + params ────────────────────────────
function makeMockPool() {
  const calls = [];
  const fakeId = '00000000-0000-0000-0000-000000000001';
  const mockPool = {
    calls,
    query: vi.fn(async (sql, params = []) => {
      calls.push({ sql, params });
      // dedup SELECT (content_hash 查询) → 返回空
      if (/SELECT id.*FROM learnings.*content_hash/i.test(sql)) {
        return { rows: [] };
      }
      // INSERT ... RETURNING * (recordLearning) → 返回完整 row
      if (/RETURNING\s+\*/i.test(sql)) {
        return { rows: [{ id: fakeId, title: 'mock', task_id: params[params.length - 1] }] };
      }
      // INSERT ... RETURNING id 或 id, title → 返回伪 id
      if (/RETURNING\s+id/i.test(sql)) {
        return { rows: [{ id: fakeId, title: 'mock' }] };
      }
      return { rows: [] };
    }),
  };
  return mockPool;
}

// 在 import 前 mock db pool — 让 routes/tasks.js + learning.js 共用同一个
vi.mock('../src/db.js', () => {
  const mockPool = makeMockPool();
  return { default: mockPool, getPoolHealth: () => ({}) };
});

// 防止 RCA learning 路径里 fire-and-forget embedding 调用真服务
vi.mock('../src/embedding-service.js', () => ({
  generateLearningEmbeddingAsync: vi.fn(),
}));
vi.mock('../src/openai-client.js', () => ({
  generateEmbedding: vi.fn(async () => new Array(1536).fill(0)),
}));

// memory-utils.generateL0Summary 是纯函数，但避免连接 LLM
vi.mock('../src/memory-utils.js', () => ({
  generateL0Summary: (s) => (s || '').slice(0, 80),
}));

vi.mock('../src/llm-caller.js', () => ({
  callLLM: vi.fn(async () => ({ text: null })),
}));

// ── 测试 ─────────────────────────────────────────────────────────────────────

describe('migration 271 — learnings.task_id 代码层强绑定', () => {
  let pool;

  beforeEach(async () => {
    const dbMod = await import('../src/db.js');
    pool = dbMod.default;
    pool.calls.length = 0;
    pool.query.mockClear();
  });

  describe('recordLearning (RCA 路径)', () => {
    it('analysis.task_id 被写入 INSERT INTO learnings 的 task_id 列', async () => {
      const { recordLearning } = await import('../src/learning.js');
      const taskId = '11111111-1111-1111-1111-111111111111';

      await recordLearning({
        task_id: taskId,
        analysis: { root_cause: 'test cause', contributing_factors: [] },
        learnings: ['l1'],
        recommended_actions: [],
        confidence: 0.9,
      });

      const insertCall = pool.calls.find(c => /INSERT INTO learnings/i.test(c.sql) && /RETURNING \*/i.test(c.sql));
      expect(insertCall, 'recordLearning 应该执行 INSERT INTO learnings ... RETURNING *').toBeTruthy();

      // SQL 包含 task_id 列
      expect(insertCall.sql).toMatch(/task_id/);

      // task_id 在参数尾部传入
      expect(insertCall.params).toContain(taskId);
    });

    it('analysis 无 task_id → INSERT 仍执行但 task_id 参数为 null（不阻断主流程）', async () => {
      const { recordLearning } = await import('../src/learning.js');

      await recordLearning({
        analysis: { root_cause: 'no task cause', contributing_factors: [] },
        learnings: ['l1'],
        recommended_actions: [],
      });

      const insertCall = pool.calls.find(c => /INSERT INTO learnings/i.test(c.sql) && /RETURNING \*/i.test(c.sql));
      expect(insertCall).toBeTruthy();
      // task_id 参数应该是 null（不会 throw）
      expect(insertCall.params).toContain(null);
    });
  });

  describe('createAutoLearning (任务回调路径)', () => {
    // T9 起 completed 路径停写（事件层噪音），metadata.task_id 提升逻辑由 failed 路径承载验证
    it('metadata.task_id 是 UUID → 提升到 task_id 列（failed 路径）', async () => {
      const autoLearning = await import('../src/auto-learning.js');
      const taskId = '22222222-2222-2222-2222-222222222222';

      await autoLearning.handleTaskFailedLearning(
        taskId, 'dev', 'failed',
        { exit_code: 1, error: 'boom' },
        1,
        { trigger_source: 'unit_test' }
      );

      const insertCall = pool.calls.find(c => /INSERT INTO learnings/i.test(c.sql));
      expect(insertCall, 'handleTaskFailedLearning 应该调用 INSERT INTO learnings').toBeTruthy();
      expect(insertCall.sql).toMatch(/task_id/);
      expect(insertCall.params).toContain(taskId);
    });

    it('metadata.task_id 不是合法 UUID → task_id 列写 null（防 cast error）', async () => {
      const autoLearning = await import('../src/auto-learning.js');

      await autoLearning.handleTaskFailedLearning(
        'not-a-uuid', 'dev', 'failed',
        { exit_code: 1, error: 'boom' },
        1,
        {}
      );

      const insertCall = pool.calls.find(c => /INSERT INTO learnings/i.test(c.sql));
      expect(insertCall).toBeTruthy();
      // task_id 参数应该是 null
      expect(insertCall.params).toContain(null);
    });

    it('handleTaskCompletedLearning 已停写（T9）→ 返回 null 且不 INSERT', async () => {
      const autoLearning = await import('../src/auto-learning.js');

      const result = await autoLearning.handleTaskCompletedLearning(
        '22222222-2222-2222-2222-222222222222', 'dev', 'completed',
        { exit_code: 0, summary: 'ok' },
        { trigger_source: 'unit_test' }
      );

      expect(result).toBeNull();
      const insertCall = pool.calls.find(c => /INSERT INTO learnings/i.test(c.sql));
      expect(insertCall).toBeUndefined();
    });
  });
});
