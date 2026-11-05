import { afterEach, beforeEach, expect, vi } from 'vitest';

const receiptBoundary = vi.hoisted(() => ({ db: vi.fn(), record: vi.fn(async () => 'owned-notifier-receipt'), resolve: vi.fn(async () => true) }));
vi.mock('../../receipt-collector.js', () => ({
  recordActionReceipt: receiptBoundary.record, resolveActionReceipt: receiptBoundary.resolve,
}));

// 真正receipt-collector import的是src/db.js；记录后拒绝，fail-open也不能吞掉隔离违规。
vi.mock('../../db.js', () => ({ default: { query: (...args) => {
  receiptBoundary.db(...args);
  throw Error('notifier_test_forbids_receipt_db');
} } }));

beforeEach(() => {
  for (const key of ['BARK_TOKEN', 'BRAIN_MUTED']) vi.stubEnv(key, '');
});

afterEach(() => {
  expect(receiptBoundary.db).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
});

export { receiptBoundary };
