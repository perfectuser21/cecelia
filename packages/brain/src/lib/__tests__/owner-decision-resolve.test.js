/**
 * owner_decision 选项解析纯函数（链 bf5088a3 棒 9，任务 8aa79219）。
 * 事务/状态机行为在 integration/owner-decision-approval.pg.integration.test.js（真库）。
 */
import { describe, it, expect } from 'vitest';
import {
  pickOption,
  resolveChoice,
  computeDueAt,
  OwnerDecisionResolveError,
} from '../owner-decision-resolve.js';

const detail = (over = {}) => ({
  question: 'q',
  options: ['A: 从 Notion 反推', 'B: 主理人给清单'],
  default: 'A',
  deadline: '2026-09-28 03:19:45.357142+00',
  reversible: true,
  waiting_on: 'human',
  ...over,
});

describe('pickOption', () => {
  it('前缀标签匹配（A / a / A: / 全文）', () => {
    const o = detail().options;
    expect(pickOption(o, 'A')).toMatchObject({ label: 'A', text: 'A: 从 Notion 反推' });
    expect(pickOption(o, 'b')).toMatchObject({ label: 'B' });
    expect(pickOption(o, 'B: 主理人给清单')).toMatchObject({ label: 'B' });
    expect(pickOption(o, '  a: 从 notion 反推 ')).toMatchObject({ label: 'A' });
  });

  it('空格分隔标签（"A 摘"）与无标签全文', () => {
    expect(pickOption(['A 摘', 'B 留'], 'B')).toMatchObject({ label: 'B', text: 'B 留' });
    expect(pickOption(['A 摘', 'B 留'], 'B 留')).toMatchObject({ label: 'B' });
  });

  it('未知或歧义 → null（同标签两项不猜）', () => {
    expect(pickOption(['A: x', 'B: y'], 'Z')).toBeNull();
    expect(pickOption(['A: x', 'A: y'], 'A')).toBeNull();
    expect(pickOption(['A: x', 'B: y'], '')).toBeNull();
    expect(pickOption(['A: x', 'B: y'], null)).toBeNull();
  });

  it('对象选项 {id,text}', () => {
    const o = [{ id: 'A', text: '甲' }, { id: 'B', text: '乙' }];
    expect(pickOption(o, 'B')).toMatchObject({ label: 'B', text: '乙' });
  });
});

describe('resolveChoice', () => {
  it('缺省 / default 取协议 default', () => {
    expect(resolveChoice(detail(), undefined)).toMatchObject({ choice: 'A' });
    expect(resolveChoice(detail({ default: 'B' }), 'default')).toMatchObject({ choice: 'B', chosen_option: 'B: 主理人给清单' });
  });

  it('未知 choice 抛 400 owner_decision_unknown_choice', () => {
    let err;
    try { resolveChoice(detail(), 'Z'); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(OwnerDecisionResolveError);
    expect(err.status).toBe(400);
    expect(err.code).toBe('owner_decision_unknown_choice');
  });

  it('default 对不上任何选项时不抛：原样作为所选（到期默认不因协议小瑕疵卡死）', () => {
    expect(resolveChoice(detail({ default: '保持现状' }), undefined)).toMatchObject({ choice: '保持现状', chosen_option: '保持现状' });
  });
});

describe('computeDueAt', () => {
  it('取 deadline 与 blocked_until 中较晚者（不在声明截止前提前执行默认）', () => {
    const d = detail({ deadline: '2026-09-28T00:00:00Z' });
    expect(computeDueAt(d, '2026-09-27T00:00:00Z')).toBe(Date.parse('2026-09-28T00:00:00Z'));
    expect(computeDueAt(d, '2026-09-29T00:00:00Z')).toBe(Date.parse('2026-09-29T00:00:00Z'));
    expect(computeDueAt(d, null)).toBe(Date.parse('2026-09-28T00:00:00Z'));
  });

  it('postgres 时间戳格式（+00 无分钟）可解析；deadline 不可解析 → null', () => {
    expect(computeDueAt(detail(), null)).toBe(Date.parse('2026-09-28T03:19:45.357Z'));
    expect(computeDueAt(detail({ deadline: '下周吧' }), null)).toBeNull();
  });
});
