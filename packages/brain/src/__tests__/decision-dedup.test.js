/**
 * Regression test: T8 decisions 表灌水去重
 * generateDecision 写入前必须比对同 trigger 上一条记录，内容相同跳过 INSERT。
 * 背景：consciousness_loop 每 20 分钟无条件写一条重复建议，累计 9.6 万垃圾行。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn() }
}));

import pool from '../db.js';
import { generateDecision } from '../decision.js';

function setupPool({ prevRows }) {
  pool.query.mockImplementation((sql) => {
    if (sql.includes('key_results')) {
      return Promise.resolve({ rows: [] });
    }
    if (sql.includes("status = 'failed'")) {
      return Promise.resolve({ rows: [{ id: 'task-1', title: '失败任务', goal_id: null }] });
    }
    if (sql.includes('FROM decisions') && sql.includes('ORDER BY created_at DESC')) {
      return Promise.resolve({ rows: prevRows });
    }
    if (sql.includes('INSERT INTO decisions')) {
      return Promise.resolve({ rows: [{ id: 'new-decision-id' }] });
    }
    return Promise.resolve({ rows: [] });
  });
}

function insertCalls() {
  return pool.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO decisions'));
}

describe('generateDecision 写入去重（T8）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('上一条同 trigger 记录内容相同 → 跳过 INSERT，返回上一条 id + deduped', async () => {
    setupPool({ prevRows: [{ id: 'prev-decision-id', same: true }] });

    const result = await generateDecision({ trigger: 'consciousness_loop' });

    expect(insertCalls()).toHaveLength(0);
    expect(result.decision_id).toBe('prev-decision-id');
    expect(result.deduped).toBe(true);
    expect(result.actions).toHaveLength(1);
  });

  it('上一条内容不同 → 照常 INSERT', async () => {
    setupPool({ prevRows: [{ id: 'prev-decision-id', same: false }] });

    const result = await generateDecision({ trigger: 'consciousness_loop' });

    expect(insertCalls()).toHaveLength(1);
    expect(result.decision_id).toBe('new-decision-id');
    expect(result.deduped).toBeUndefined();
  });

  it('无前置记录 → 照常 INSERT', async () => {
    setupPool({ prevRows: [] });

    const result = await generateDecision({ trigger: 'tick' });

    expect(insertCalls()).toHaveLength(1);
    expect(result.decision_id).toBe('new-decision-id');
  });
});
