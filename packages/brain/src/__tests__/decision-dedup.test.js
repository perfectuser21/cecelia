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

  it('dedup 前置查询必须排除已执行记录（executed_at IS NULL）并带 id DESC tie-break', async () => {
    // 回归守卫：dedup 若返回已 executed 的 decision_id，tick-runner 调 executeDecision
    // 会抛 'Decision already executed'，失败任务的第 2/3 次自动重试被静默压制。
    // mock 层无法真实执行 SQL 过滤，用 SQL 文本断言防止这个 filter 被误删。
    setupPool({ prevRows: [] });

    await generateDecision({ trigger: 'consciousness_loop' });

    const dedupCall = pool.query.mock.calls.find(
      ([sql]) => sql.includes('FROM decisions') && sql.includes('ORDER BY created_at DESC')
    );
    expect(dedupCall).toBeDefined();
    expect(dedupCall[0]).toContain('executed_at IS NULL');
    expect(dedupCall[0]).toContain('id DESC');
  });

  it('无前置记录 → 照常 INSERT', async () => {
    setupPool({ prevRows: [] });

    const result = await generateDecision({ trigger: 'tick' });

    expect(insertCalls()).toHaveLength(1);
    expect(result.decision_id).toBe('new-decision-id');
  });
});

describe('migration 330 清理条件（T8）', () => {
  it('DELETE 必须同时限定 topic 空 + decision 空 + trigger 白名单三重条件', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync(
      new URL('../../migrations/330_decisions_blank_cleanup.sql', import.meta.url),
      'utf8'
    );
    expect(sql).toContain("(topic IS NULL OR topic = '')");
    expect(sql).toContain("(decision IS NULL OR decision = '')");
    expect(sql).toContain("trigger IN ('tick', 'consciousness_loop')");
  });
});
