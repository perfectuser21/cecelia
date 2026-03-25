/**
 * suggestion-dispatcher.js domain 推断测试
 * 验证 dispatchPendingSuggestions 中使用 detectDomain 正确填充 domain/owner_role
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
    connect: vi.fn()
  }
}));

// Mock thalamus: suggestion-dispatcher 通过丘脑创建任务
vi.mock('../thalamus.js', () => ({
  processEvent: vi.fn(),
  EVENT_TYPES: { SUGGESTION_READY: 'suggestion_ready' }
}));

// Mock actions.js: createTask 由丘脑决策驱动
vi.mock('../actions.js', () => ({
  createTask: vi.fn()
}));

// 注意：不 mock domain-detector.js，使用真实实现来验证 domain 推断

import { dispatchPendingSuggestions } from '../suggestion-dispatcher.js';
import { detectDomain } from '../domain-detector.js';
import { processEvent as thalamusProcessEvent } from '../thalamus.js';
import { createTask } from '../actions.js';

// 构造简化 mock pool（新架构不使用 client.connect/transaction）
function buildMockPool({ candidates = [], inFlight = [] } = {}) {
  return {
    query: vi.fn(async (sql) => {
      if (sql.includes("status = 'pending'") && sql.includes('priority_score >= 0.68')) {
        return { rows: candidates };
      }
      if (sql.includes("task_type = 'suggestion_plan'") && sql.includes('queued')) {
        return { rows: inFlight };
      }
      if (sql.includes('UPDATE suggestions')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    }),
  };
}

describe('suggestion-dispatcher - domain 推断', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认：丘脑返回 create_task 决策，createTask 返回成功
    thalamusProcessEvent.mockResolvedValue({
      level: 0,
      actions: [{ type: 'create_task', params: { title: 'test', task_type: 'suggestion_plan', payload: { suggestion_id: '1', suggestion_score: 0.9 } } }],
    });
    createTask.mockResolvedValue({ success: true, task: { id: 'task-sd-123' }, deduplicated: false });
  });

  // ===== detectDomain 行为验证（复用 domain-detector.js）=====
  describe('detectDomain 行为（供 suggestion-dispatcher 复用）', () => {
    it('包含 "bug" 关键词 → domain=coding, confidence>0', () => {
      const result = detectDomain('修复 bug in API');
      expect(result.domain).toBe('coding');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('包含 "qa" 关键词 → domain=quality', () => {
      const result = detectDomain('QA quality coverage regression');
      expect(result.domain).toBe('quality');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('包含 "agent" 关键词 → domain=agent_ops', () => {
      const result = detectDomain('Cecelia brain agent dispatch');
      expect(result.domain).toBe('agent_ops');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('无匹配关键词时 confidence=0', () => {
      const result = detectDomain('xyz abc qrs');
      expect(result.confidence).toBe(0);
    });

    it('空字符串 confidence=0', () => {
      const result = detectDomain('');
      expect(result.confidence).toBe(0);
    });
  });

  // ===== dispatchPendingSuggestions domain 填充 =====
  // 新架构：domain/owner_role 以事件参数传给丘脑，不再直接出现在 INSERT 参数中
  describe('dispatchPendingSuggestions - domain 填充', () => {
    it('content 含 coding 关键词时，thalamusProcessEvent 收到 domain=coding, owner_role=cto', async () => {
      const pool = buildMockPool({
        candidates: [{
          id: 'sg-1',
          content: 'fix this bug in the API code',
          priority_score: 0.9,
          source: 'test',
          agent_id: null,
        }],
      });

      await dispatchPendingSuggestions(pool, 1);

      expect(thalamusProcessEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: 'coding',
          owner_role: 'cto',
          suggestion_id: 'sg-1',
        })
      );
    });

    it('content 无关键词时，thalamusProcessEvent 收到 domain=null, owner_role=null', async () => {
      const pool = buildMockPool({
        candidates: [{
          id: 'sg-2',
          content: 'xyz abc qrs 完全无法识别的建议',
          priority_score: 0.75,
          source: 'test',
          agent_id: null,
        }],
      });

      await dispatchPendingSuggestions(pool, 1);

      expect(thalamusProcessEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: null,
          owner_role: null,
          suggestion_id: 'sg-2',
        })
      );
    });

    it('content 含 agent_ops 关键词时，thalamusProcessEvent 收到 domain=agent_ops', async () => {
      const pool = buildMockPool({
        candidates: [{
          id: 'sg-3',
          content: 'Brain dispatch executor tick planner',
          priority_score: 0.85,
          source: 'test',
          agent_id: null,
        }],
      });

      await dispatchPendingSuggestions(pool, 1);

      expect(thalamusProcessEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: 'agent_ops',
          owner_role: 'vp_agent_ops',
          suggestion_id: 'sg-3',
        })
      );
    });
  });
});
