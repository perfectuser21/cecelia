/**
 * 守卫 2：blocked=owner_decision 必须带协议（决策 105a5868 ②，链 bf5088a3 棒5，任务 3fad28e0）。
 * 09-23 五把刀 blocked=owner_decision 没写等什么，真因是机器故障，主理人被迫每天来问进度。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  OWNER_DECISION_REASON,
  validateOwnerDecisionDetail,
  assertOwnerDecisionProtocol,
  OwnerDecisionProtocolError,
  openOwnerDecisionPendingAction,
  closeOwnerDecisionPendingAction,
} from '../owner-decision.js';

const good = () => ({
  question: '是否把 Deploy Preview 从 required check 里摘掉？',
  options: ['A 摘掉', 'B 保留并修'],
  default: 'B 保留并修',
  deadline: '2099-01-01T00:00:00Z',
  reversible: true,
  waiting_on: 'human',
});

describe('validateOwnerDecisionDetail', () => {
  it('完整协议 → ok', () => {
    expect(validateOwnerDecisionDetail(good())).toEqual({ ok: true, violations: [] });
  });

  it.each([
    ['question', (d) => { delete d.question; }],
    ['question', (d) => { d.question = '   '; }],
    ['options', (d) => { delete d.options; }],
    ['options', (d) => { d.options = ['只有一个']; }],
    ['options', (d) => { d.options = 'A,B'; }],
    ['default', (d) => { delete d.default; }],
    ['default', (d) => { d.default = ''; }],
    ['deadline', (d) => { delete d.deadline; }],
    ['deadline', (d) => { d.deadline = '下周吧'; }],
    ['reversible', (d) => { delete d.reversible; }],
    ['reversible', (d) => { d.reversible = 'yes'; }],
    ['waiting_on', (d) => { delete d.waiting_on; }],
    ['waiting_on', (d) => { d.waiting_on = 'owner'; }],
  ])('违规输入被拒：%s 缺失/非法 → violations 含该字段', (field, mutate) => {
    const d = good();
    mutate(d);
    const r = validateOwnerDecisionDetail(d);
    expect(r.ok).toBe(false);
    expect(r.violations.map((v) => v.field)).toContain(field);
  });

  it('detail 为空 / 字符串 / 数组 → 全部字段违规', () => {
    for (const bad of [null, undefined, 'x', ['a']]) {
      const r = validateOwnerDecisionDetail(bad);
      expect(r.ok).toBe(false);
      expect(r.violations.length).toBe(6);
    }
  });

  it('一次报全所有缺项（不是遇错即停）', () => {
    const r = validateOwnerDecisionDetail({ question: 'q' });
    expect(r.violations.map((v) => v.field).sort()).toEqual(
      ['default', 'deadline', 'options', 'reversible', 'waiting_on'].sort(),
    );
  });
});

describe('assertOwnerDecisionProtocol', () => {
  it('reason 不是 owner_decision → 不校验（其它 blocked_reason 语义不变）', () => {
    expect(() => assertOwnerDecisionProtocol({ reason: 'billing_cap', detail: null })).not.toThrow();
    expect(() => assertOwnerDecisionProtocol({ reason: 'owner_hold', detail: { message: 'x' } })).not.toThrow();
  });

  it('owner_decision + 缺协议 → 抛 OwnerDecisionProtocolError（code/violations）', () => {
    const err = (() => {
      try {
        assertOwnerDecisionProtocol({ reason: OWNER_DECISION_REASON, detail: { message: '等你' } });
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(err).toBeInstanceOf(OwnerDecisionProtocolError);
    expect(err.code).toBe('owner_decision_protocol_violation');
    expect(err.violations.length).toBeGreaterThan(0);
  });

  it('owner_decision + 完整协议 → 不抛', () => {
    expect(() => assertOwnerDecisionProtocol({ reason: 'owner_decision', detail: good() })).not.toThrow();
  });
});

describe('待办分流：waiting_on=human 才进主理人待办', () => {
  const mkDb = (existing = []) => ({
    query: vi.fn(async (sql) => {
      if (/SELECT id FROM pending_actions/.test(sql)) return { rows: existing };
      if (/INSERT INTO pending_actions/.test(sql)) return { rows: [{ id: 'pa-1' }] };
      if (/UPDATE pending_actions/.test(sql)) return { rowCount: existing.length, rows: [] };
      return { rows: [] };
    }),
  });

  it('human → 生成 pending_action（signature=owner-decision:<task_id>，带 options/deadline）', async () => {
    const db = mkDb();
    const r = await openOwnerDecisionPendingAction(db, { taskId: 't-1', title: '任务', detail: good() });
    expect(r).toEqual({ created: true, id: 'pa-1' });
    const ins = db.query.mock.calls.find(([sql]) => /INSERT INTO pending_actions/.test(sql));
    expect(ins[0]).toMatch(/owner_decision/);
    expect(JSON.stringify(ins[1])).toContain('owner-decision:t-1');
  });

  it('machine → 不生成 pending_action（不进主理人待办）', async () => {
    const db = mkDb();
    const r = await openOwnerDecisionPendingAction(db, {
      taskId: 't-2', title: '任务', detail: { ...good(), waiting_on: 'machine' },
    });
    expect(r).toEqual({ created: false, skipped: 'machine' });
    expect(db.query.mock.calls.some(([sql]) => /INSERT INTO pending_actions/.test(sql))).toBe(false);
  });

  it('同任务已有未决 pending_action → 不重复生成', async () => {
    const db = mkDb([{ id: 'pa-old' }]);
    const r = await openOwnerDecisionPendingAction(db, { taskId: 't-3', title: '任务', detail: good() });
    expect(r).toEqual({ created: false, skipped: 'exists', id: 'pa-old' });
  });

  it('unblock 后关闭该任务的未决 pending_action', async () => {
    const db = mkDb([{ id: 'pa-1' }]);
    await closeOwnerDecisionPendingAction(db, 't-1');
    const upd = db.query.mock.calls.find(([sql]) => /UPDATE pending_actions/.test(sql));
    expect(upd).toBeTruthy();
    expect(upd[1]).toContain('owner-decision:t-1');
  });
});
