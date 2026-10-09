import { describe, it, expect } from 'vitest';
import { parseTaskListQuery, MAX_TASK_LIST_LIMIT } from '../task-list-query.js';
import { TASK_STATUSES } from '../task-status-transitions.js';

describe('parseTaskListQuery', () => {
  it('非法 status → 400 invalid_status 并列出合法状态', () => {
    const r = parseTaskListQuery({ status: 'bogus' }, { defaultLimit: 100 });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_status');
    expect(r.body.allowed).toEqual([...TASK_STATUSES]);
    expect(r.body.allowed).toContain('queued');
    expect(r.body).not.toHaveProperty('details');
  });

  it.each(['Queued', 'queue', ' '])('近似/空白 status %j → 400', (s) => {
    expect(parseTaskListQuery({ status: s }, { defaultLimit: 100 }).status).toBe(400);
  });

  it.each(['abc', '-1', '0', '1.5', '1001', '99999999999999999999', '', ['5', '6']])(
    '非法 limit %j → 400 invalid_limit',
    (limit) => {
      const r = parseTaskListQuery({ limit }, { defaultLimit: 100 });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('invalid_limit');
      expect(r.body.message).toContain('正整数');
      expect(r.body.got).toEqual(limit);
      expect(r.body).not.toHaveProperty('details');
    },
  );

  it('合法 status + limit → ok', () => {
    expect(parseTaskListQuery({ status: 'queued', limit: '5' }, { defaultLimit: 100 }))
      .toEqual({ ok: true, status: 'queued', limit: 5 });
  });

  it('limit 上限本身合法', () => {
    expect(MAX_TASK_LIST_LIMIT).toBe(1000);
    expect(parseTaskListQuery({ limit: '1000' }, { defaultLimit: 100 }))
      .toEqual({ ok: true, status: undefined, limit: 1000 });
  });

  it('无参数 → 不筛选 status，limit 取默认值', () => {
    expect(parseTaskListQuery({}, { defaultLimit: 100 }))
      .toEqual({ ok: true, status: undefined, limit: 100 });
    expect(parseTaskListQuery({ status: '' }, { defaultLimit: 200 }))
      .toEqual({ ok: true, status: undefined, limit: 200 });
  });
});
