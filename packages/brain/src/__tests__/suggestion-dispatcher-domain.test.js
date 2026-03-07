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

import { dispatchPendingSuggestions } from '../suggestion-dispatcher.js';
import { detectDomain } from '../domain-detector.js';

// 构造 mock pool（与 suggestion-dispatcher.test.js 保持一致）
function buildMockPool({
  candidates = [],
  inFlight = [],
  insertedTaskId = 'task-sd-123'
} = {}) {
  let capturedInsertParams = null;

  const client = {
    query: vi.fn(async (sql) => {
      if (sql.trim().startsWith('BEGIN') || sql.trim().startsWith('COMMIT') || sql.trim().startsWith('ROLLBACK')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO tasks')) {
        return { rows: [{ id: insertedTaskId }] };
      }
      if (sql.includes('UPDATE suggestions')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
    getCapturedInsertParams: () => capturedInsertParams,
  };

  // 记录 INSERT 参数，用于断言
  const origQuery = client.query;
  client.query = vi.fn(async (sql, params) => {
    if (sql.includes('INSERT INTO tasks')) {
      capturedInsertParams = params;
    }
    return origQuery(sql, params);
  });

  return {
    query: vi.fn(async (sql) => {
      if (sql.includes("status = 'pending'") && sql.includes('priority_score >= 0.68')) {
        return { rows: candidates };
      }
      if (sql.includes("task_type = 'suggestion_plan'") && sql.includes('queued')) {
        return { rows: inFlight };
      }
      return { rows: [] };
    }),
    connect: vi.fn(async () => client),
    _client: client,
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
  describe('dispatchPendingSuggestions - domain 填充', () => {
    it('content 含 coding 关键词时，INSERT 包含 domain=coding, owner_role=cto', async () => {
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

      const insertParams = pool._client.getCapturedInsertParams();
      expect(insertParams).not.toBeNull();
      // $4 = domain, $5 = owner_role
      expect(insertParams[3]).toBe('coding');
      expect(insertParams[4]).toBe('cto');
    });

    it('content 无关键词时，domain 和 owner_role 为 null', async () => {
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

      const insertParams = pool._client.getCapturedInsertParams();
      expect(insertParams).not.toBeNull();
      expect(insertParams[3]).toBeNull();
      expect(insertParams[4]).toBeNull();
    });

    it('content 含 agent_ops 关键词时，domain=agent_ops, owner_role=vp_agent_ops', async () => {
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

      const insertParams = pool._client.getCapturedInsertParams();
      expect(insertParams).not.toBeNull();
      expect(insertParams[3]).toBe('agent_ops');
      expect(insertParams[4]).toBe('vp_agent_ops');
    });
  });
});
