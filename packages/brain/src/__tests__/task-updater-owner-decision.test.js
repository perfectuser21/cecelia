/**
 * blockTask / unblockTask 与 owner_decision 协议（守卫 2，链 bf5088a3 棒5，任务 3fad28e0）。
 * mock pool，无需真 DB；真库触发器见 integration/task-governance-guards.pg.integration.test.js。
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ default: mockPool }));
vi.mock('../events/taskEvents.js', () => ({
  publishTaskStarted: vi.fn(), publishTaskCompleted: vi.fn(), publishTaskFailed: vi.fn(), publishTaskProgress: vi.fn(),
}));
vi.mock('../event-bus.js', () => ({ emit: vi.fn().mockResolvedValue(undefined) }));

let blockTask;
let unblockTask;
beforeAll(async () => {
  vi.resetModules();
  ({ blockTask, unblockTask } = await import('../task-updater.js'));
});

const good = () => ({
  question: '要不要摘掉？',
  options: ['A', 'B'],
  default: 'B',
  deadline: '2099-01-01T00:00:00Z',
  reversible: true,
  waiting_on: 'human',
});
const sqls = () => mockPool.query.mock.calls.map(([s]) => String(s));

beforeEach(() => {
  mockPool.query.mockReset();
  mockPool.query.mockImplementation(async (sql) => {
    if (/UPDATE tasks/.test(sql) && /status = 'blocked'/.test(sql)) return { rows: [{ id: 't-1', title: '任务' }] };
    if (/SELECT id FROM pending_actions/.test(sql)) return { rows: [] };
    if (/INSERT INTO pending_actions/.test(sql)) return { rows: [{ id: 'pa-1' }] };
    if (/UPDATE tasks/.test(sql) && /status = 'queued'/.test(sql)) return { rows: [{ id: 't-1', title: '任务' }] };
    return { rows: [], rowCount: 0 };
  });
});

describe('blockTask + owner_decision', () => {
  it('违规输入被拒：owner_decision 无协议 → success=false + code，且不 UPDATE', async () => {
    const r = await blockTask('t-1', { reason: 'owner_decision', detail: '等你拍板' });
    expect(r.success).toBe(false);
    expect(r.code).toBe('owner_decision_protocol_violation');
    expect(r.violations.length).toBeGreaterThan(0);
    expect(sqls().some((s) => /UPDATE tasks/.test(s))).toBe(false);
  });

  it('违规输入被拒：缺 deadline → 拒', async () => {
    const d = good();
    delete d.deadline;
    const r = await blockTask('t-1', { reason: 'owner_decision', detail: d });
    expect(r.success).toBe(false);
    expect(r.violations.map((v) => v.field)).toContain('deadline');
  });

  it('完整协议 + human → 成功，且生成 pending_action', async () => {
    const r = await blockTask('t-1', { reason: 'owner_decision', detail: good() });
    expect(r.success).toBe(true);
    expect(sqls().some((s) => /INSERT INTO pending_actions/.test(s))).toBe(true);
  });

  it('完整协议 + machine → 成功，不生成 pending_action', async () => {
    const r = await blockTask('t-1', { reason: 'owner_decision', detail: { ...good(), waiting_on: 'machine' } });
    expect(r.success).toBe(true);
    expect(sqls().some((s) => /INSERT INTO pending_actions/.test(s))).toBe(false);
  });

  it('其它 reason（billing_cap，字符串 detail）行为不变', async () => {
    const r = await blockTask('t-1', { reason: 'billing_cap', detail: 'cap' });
    expect(r.success).toBe(true);
    expect(sqls().some((s) => /pending_actions/.test(s))).toBe(false);
  });
});

describe('unblockTask 关闭待办', () => {
  it('unblock 成功后关闭该任务未决的 owner-decision pending_action', async () => {
    const r = await unblockTask('t-1');
    expect(r.success).toBe(true);
    const upd = mockPool.query.mock.calls.find(([s]) => /UPDATE pending_actions/.test(s));
    expect(upd).toBeTruthy();
    expect(upd[1]).toContain('owner-decision:t-1');
  });
});
