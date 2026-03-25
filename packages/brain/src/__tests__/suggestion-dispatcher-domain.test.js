/**
 * suggestion-dispatcher.js domain 推断测试
 * 验证 dispatchPendingSuggestions 通过 thalamus.processEvent 传递正确的 domain/owner_role
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
    connect: vi.fn()
  }
}));

// Mock thalamus.js — 捕获传入的事件参数
vi.mock('../thalamus.js', () => ({
  processEvent: vi.fn(async () => ({
    level: 0,
    actions: [{ type: 'log_event', params: { event_type: 'suggestion_dispatched' } }],
    rationale: '丘脑创建任务',
    confidence: 0.95,
    safety: false,
    _suggestion_dispatched: true,
  })),
  EVENT_TYPES: {
    SUGGESTION_READY: 'suggestion_ready',
  },
}));

import { dispatchPendingSuggestions } from '../suggestion-dispatcher.js';
import { processEvent } from '../thalamus.js';
import { detectDomain } from '../domain-detector.js';

function buildMockPool(candidates = []) {
  return {
    query: vi.fn(async (sql) => {
      if (sql.includes("status = 'pending'") && sql.includes('priority_score >= 0.68')) {
        return { rows: candidates };
      }
      return { rows: [] };
    }),
    connect: vi.fn(),
  };
}

describe('suggestion-dispatcher - domain 推断', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  describe('dispatchPendingSuggestions - 通过 processEvent 传递 domain/owner_role', () => {
    it('content 含 coding 关键词时，processEvent 收到 domain=coding, owner_role=cto', async () => {
      const pool = buildMockPool([{
        id: 'sg-1',
        content: 'fix this bug in the API code',
        priority_score: 0.9,
        source: 'test',
        agent_id: null,
      }]);

      await dispatchPendingSuggestions(pool, 1);

      expect(processEvent).toHaveBeenCalledTimes(1);
      const eventArg = processEvent.mock.calls[0][0];
      expect(eventArg.domain).toBe('coding');
      expect(eventArg.owner_role).toBe('cto');
    });

    it('content 无关键词时，processEvent 收到 domain=null, owner_role=null', async () => {
      const pool = buildMockPool([{
        id: 'sg-2',
        content: 'xyz abc qrs 完全无法识别的建议',
        priority_score: 0.75,
        source: 'test',
        agent_id: null,
      }]);

      await dispatchPendingSuggestions(pool, 1);

      const eventArg = processEvent.mock.calls[0][0];
      expect(eventArg.domain).toBeNull();
      expect(eventArg.owner_role).toBeNull();
    });

    it('content 含 agent_ops 关键词时，processEvent 收到 domain=agent_ops, owner_role=vp_agent_ops', async () => {
      const pool = buildMockPool([{
        id: 'sg-3',
        content: 'Brain dispatch executor tick planner',
        priority_score: 0.85,
        source: 'test',
        agent_id: null,
      }]);

      await dispatchPendingSuggestions(pool, 1);

      const eventArg = processEvent.mock.calls[0][0];
      expect(eventArg.domain).toBe('agent_ops');
      expect(eventArg.owner_role).toBe('vp_agent_ops');
    });
  });
});
