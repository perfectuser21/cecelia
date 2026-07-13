import { readFileSync } from 'fs';
import { describe, it, expect } from 'vitest';
import { EXPECTED_SCHEMA_VERSION } from '../selfcheck.js';

// Migration 315: 九要素存储 —— action_receipts 台账 + decisions.review_after
// 源码守卫：断言 migration DDL 正确 + selfcheck 地板已推进到 315（facts-check 会卡不一致）。
describe('Migration 315 — action_receipts + decisions.review_after', () => {
  const SQL = readFileSync(new URL('../../migrations/315_action_receipts_and_decision_review.sql', import.meta.url), 'utf8');

  it('创建 action_receipts 表（IF NOT EXISTS 幂等）', () => {
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS action_receipts/);
  });

  it('action_receipts 含九要素字段', () => {
    for (const col of ['action_id', 'kind', 'target', 'sent_at', 'receipt_status', 'evidence']) {
      expect(SQL).toContain(col);
    }
    // evidence 是 JSONB
    expect(SQL).toMatch(/evidence\s+JSONB/i);
  });

  it('receipt_status 有四态 CHECK 约束', () => {
    expect(SQL).toMatch(/receipt_status[\s\S]*CHECK[\s\S]*'pending'[\s\S]*'confirmed'[\s\S]*'failed'[\s\S]*'timeout'/);
  });

  it('decisions 加 review_after 列（IF NOT EXISTS 幂等）', () => {
    expect(SQL).toMatch(/ALTER TABLE decisions ADD COLUMN IF NOT EXISTS review_after/);
  });

  it('selfcheck EXPECTED_SCHEMA_VERSION 地板已推进到至少 315', () => {
    // >= 而非 ===：后续 migration 推进地板不应回头改本文件（316 起实证）
    expect(parseInt(EXPECTED_SCHEMA_VERSION, 10)).toBeGreaterThanOrEqual(315);
  });
});
