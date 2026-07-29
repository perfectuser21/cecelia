import { describe, expect, it, vi, beforeEach } from 'vitest';

const sendBark = vi.fn(async () => true);
vi.mock('../notifier.js', () => ({ sendBark }));

const { runAcceptanceAging, _resetGateForTest } = await import('../acceptance-aging.js');

function makePool(scripts) {
  return { query: vi.fn(async (sql, params) => scripts(sql, params) ?? { rows: [] }) };
}

describe('acceptance-aging 超时哨兵（主理人条件一）', () => {
  beforeEach(() => {
    sendBark.mockClear();
    _resetGateForTest();
  });

  it('有超 48h 未验收的 run → Bark 告警 + cecelia_events P1', async () => {
    const events = [];
    const pool = makePool((sql, params) => {
      if (sql.includes("status IN ('pending','in_review')") && sql.includes("interval '48 hours'")) {
        return { rows: [{ run_key: 'r1', title: '关键词获客验收', created_at: '2026-07-27T00:00:00Z' }] };
      }
      if (sql.includes('INSERT INTO cecelia_events')) { events.push(params); return { rows: [] }; }
    });
    const res = await runAcceptanceAging(pool);
    expect(res.overdue_runs).toBe(1);
    expect(sendBark).toHaveBeenCalledTimes(1);
    expect(sendBark.mock.calls[0][0]).toContain('验收');
    expect(events.length).toBe(1);
  });

  it('无超时 → 不告警', async () => {
    const pool = makePool((sql) => {
      if (sql.includes("interval '48 hours'")) return { rows: [] };
    });
    const res = await runAcceptanceAging(pool);
    expect(res.overdue_runs).toBe(0);
    expect(sendBark).not.toHaveBeenCalled();
  });

  it('failed 但无驳回任务的 run → 一并告警（驳回补偿扫描）', async () => {
    const pool = makePool((sql) => {
      if (sql.includes("interval '48 hours'")) return { rows: [] };
      if (sql.includes("status = 'failed'") && sql.includes('NOT EXISTS')) {
        return { rows: [{ run_key: 'r2', title: '被驳回但没开任务的单' }] };
      }
    });
    const res = await runAcceptanceAging(pool);
    expect(res.orphan_failed).toBe(1);
    expect(sendBark).toHaveBeenCalledTimes(1);
  });

  it('间隔 gate：1 小时内第二次调用直接 skip', async () => {
    const pool = makePool(() => ({ rows: [] }));
    await runAcceptanceAging(pool);
    const second = await runAcceptanceAging(pool);
    expect(second.skipped).toBe(true);
  });

  it('SQL 异常 → 不抛出（不拖垮 tick），返回 error 字段', async () => {
    const pool = { query: vi.fn(async () => { throw new Error('db down'); }) };
    const res = await runAcceptanceAging(pool);
    expect(res.error).toContain('db down');
  });
});
