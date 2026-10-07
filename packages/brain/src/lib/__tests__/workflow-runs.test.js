import { describe, it, expect, vi } from 'vitest';
import { isSelfSkipped, schedulerOutcome, pruneSchedulerRuns } from '../workflow-runs.js';

describe('workflow-runs', () => {
  it('自 gate 判定覆盖仓库现存四种写法，真干活的不算跳过', () => {
    for (const r of [{ skipped: true }, { skipped: 'cooldown' }, { status: 'skipped' }, { triggered: false }, { inWindow: false }]) {
      expect(isSelfSkipped(r), JSON.stringify(r)).toBe(true);
    }
    for (const r of [null, undefined, [], { processed: 0 }, { skipped: false, archived: 0 }, { triggered: true }]) {
      expect(isSelfSkipped(r), JSON.stringify(r)).toBe(false);
    }
  });

  it('结果映射：超时 > 抛错 > 返回 ok:false > 成功', () => {
    expect(schedulerOutcome({ timedOut: true, error: 'x' })).toBe('timeout');
    expect(schedulerOutcome({ error: 'x' })).toBe('fail');
    expect(schedulerOutcome({ result: { ok: false } })).toBe('fail');
    expect(schedulerOutcome({ result: { ok: true } })).toBe('pass');
  });

  it('保留期清理只删定时任务运行：成功 30 天、失败 90 天，每小时最多一次', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rowCount: 3 }) };
    const t0 = Date.parse('2026-10-07T00:00:00Z');
    expect(await pruneSchedulerRuns(db, t0)).toBe(3);
    const [sql] = db.query.mock.calls[0];
    expect(sql).toMatch(/DELETE FROM runs/);
    expect(sql).toMatch(/trigger_kind = 'schedule'/);
    expect(sql).toMatch(/30 days/);
    expect(sql).toMatch(/90 days/);
    expect(await pruneSchedulerRuns(db, t0 + 30 * 60 * 1000)).toBeNull();
    expect(db.query).toHaveBeenCalledTimes(1);
    await pruneSchedulerRuns(db, t0 + 61 * 60 * 1000);
    expect(db.query).toHaveBeenCalledTimes(2);
  });
});
