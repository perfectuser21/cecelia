import { afterEach, expect, vi } from 'vitest';

export const receiptBoundary = vi.hoisted(() => ({ db: vi.fn() }));
// 真正receipt-collector import的是src/db.js；记录后拒绝，fail-open也不能吞掉隔离违规。
vi.mock('../../db.js', () => ({ default: { query: (...args) => {
  receiptBoundary.db(...args);
  throw Error('notifier_test_forbids_receipt_db');
} } }));

afterEach(() => {
  expect(receiptBoundary.db).not.toHaveBeenCalled();
});
