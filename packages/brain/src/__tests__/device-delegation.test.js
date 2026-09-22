/**
 * device-delegation.test.js — 秋米设备子任务对账（PR3 补充五）
 *
 * 为什么需要对账：设备那一段不是就地改 task_type（回执不可变触发器 421 禁止），
 * 而是派生一条 device_job 子任务、父 qiumi_task 挂 blocked。子任务终态不回写父任务，
 * 中文表里那行就永远停在「进行中」，主理人看到的是一件永远做不完的活。
 *
 * 父任务的 blocked_until 是 NULL（故意的，见计划补充五），自动解闸器捞不到它——
 * 本模块是**唯一**的放行方，所以这里的映射错一个字，活就卡死或提前销账。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/task-event-log.js', () => ({ recordTaskEventSafe: vi.fn().mockResolvedValue(true) }));

import { recordTaskEventSafe } from '../lib/task-event-log.js';
import { reconcileDelegatedDeviceJobs } from '../routing/device-delegation.js';

const PARENT = '11111111-2222-3333-4444-555555555555';
const CHILD = '99999999-8888-7777-6666-555555555555';

/**
 * 中文表推送读回执的方式（notion-gtd-sync.js 的 resultTextOf 逐字搬来）：
 * 父任务 result.receipt 不长成这个形状，主理人在「OpenClaw结果」列只会看到空白。
 */
const resultTextOf = (result) => {
  const r = result?.receipt ?? result ?? {};
  return String(r.finalAssistantVisibleText ?? r.text ?? r.summary ?? '').slice(0, 1900);
};

/** 假 pool：按 SQL 特征分流。scan → 父任务候选；child → 子任务行；其余当写回记下来。 */
function makePool({ parents = [{ id: PARENT, device_task_id: CHILD }], child = null } = {}) {
  const writes = [];
  const query = vi.fn(async (sql, params) => {
    if (/delegated_device_job/.test(sql) && /SELECT/i.test(sql)) return { rows: parents, rowCount: parents.length };
    if (/FROM tasks\s+WHERE id = \$1/.test(sql) && /SELECT/i.test(sql)) {
      return { rows: child ? [child] : [], rowCount: child ? 1 : 0 };
    }
    writes.push({ sql, params });
    return { rowCount: 1, rows: [] };
  });
  return { pool: { query }, writes, query };
}

const childRow = (status, extra = {}) => ({
  id: CHILD, status, result: { ok: true }, error_message: null, ...extra,
});

beforeEach(() => vi.clearAllMocks());

describe('reconcileDelegatedDeviceJobs — 候选取数', () => {
  it('只捞 blocked + delegated_device_job + 有 device_task_id 的 qiumi_task，带 LIMIT 50', async () => {
    const { pool, query } = makePool({ child: childRow('in_progress') });
    await reconcileDelegatedDeviceJobs(pool);
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/task_type = 'qiumi_task'/);
    expect(sql).toMatch(/status = 'blocked'/);
    expect(sql).toMatch(/blocked_reason = 'delegated_device_job'/);
    expect(sql).toMatch(/payload->>'device_task_id' IS NOT NULL/);
    expect(sql).toMatch(/LIMIT 50/);
    // 按 updated_at 排，不按 blocked_at：子行丢失的父任务 blocked_at 永不变，
    // 按 blocked_at 排它会永远压在前 50 里，把后面的活挡在窗口外。
    expect(sql).toMatch(/ORDER BY updated_at ASC/);
  });

  it('没有候选 → 一条写回都不发，返回全 0', async () => {
    const { pool, writes } = makePool({ parents: [] });
    await expect(reconcileDelegatedDeviceJobs(pool)).resolves.toEqual({ checked: 0, completed: 0, failed: 0 });
    expect(writes).toHaveLength(0);
  });
});

describe('reconcileDelegatedDeviceJobs — 子任务终态回写父任务', () => {
  it('子 completed → 父 completed_no_pr + result.receipt 带子任务 id 与结论，CAS 只认 blocked', async () => {
    const { pool, writes } = makePool({ child: childRow('completed') });
    const out = await reconcileDelegatedDeviceJobs(pool);
    expect(out).toEqual({ checked: 1, completed: 1, failed: 0 });
    const w = writes.find((x) => /completed_no_pr/.test(x.sql));
    expect(w).toBeTruthy();
    expect(w.sql).toMatch(/AND status = 'blocked'/);
    expect(w.sql).toMatch(/completed_at = COALESCE\(completed_at, NOW\(\)\)/);
    expect(w.params[0]).toBe(PARENT);
    const receipt = JSON.parse(w.params[1]);
    expect(receipt).toMatchObject({ device_task_id: CHILD, child_status: 'completed' });
    expect(typeof receipt.reaped_at).toBe('string');
  });

  it('回执长成收割器同款（finalAssistantVisibleText/text），中文表的 resultTextOf 读得到', async () => {
    const { pool, writes } = makePool({
      child: childRow('completed', { result: { receipt: { finalAssistantVisibleText: '点赞 12 条' } } }),
    });
    await reconcileDelegatedDeviceJobs(pool);
    const receipt = JSON.parse(writes.find((x) => /completed_no_pr/.test(x.sql)).params[1]);
    expect(resultTextOf({ receipt })).toBe('点赞 12 条');
    expect(receipt.text).toBe('点赞 12 条');
  });

  it('子任务没留可见结论 → 回执给兜底文案，不让中文表的结果列空着', async () => {
    const { pool, writes } = makePool({ child: childRow('completed_no_pr', { result: null }) });
    await reconcileDelegatedDeviceJobs(pool);
    const receipt = JSON.parse(writes.find((x) => /completed_no_pr/.test(x.sql)).params[1]);
    expect(resultTextOf({ receipt })).toBe('设备任务已完成');
  });

  it('子 completed_no_pr（执行面不产 PR 的销账态）→ 父同样 completed_no_pr', async () => {
    const { pool, writes } = makePool({ child: childRow('completed_no_pr') });
    const out = await reconcileDelegatedDeviceJobs(pool);
    expect(out).toEqual({ checked: 1, completed: 1, failed: 0 });
    expect(writes.some((x) => /completed_no_pr/.test(x.sql))).toBe(true);
  });

  it('子 failed → 父 failed，error_message=device_job_failed', async () => {
    const { pool, writes } = makePool({ child: childRow('failed') });
    const out = await reconcileDelegatedDeviceJobs(pool);
    expect(out).toEqual({ checked: 1, completed: 0, failed: 1 });
    const w = writes.find((x) => /SET status = 'failed'/.test(x.sql));
    expect(w).toBeTruthy();
    expect(w.sql).toMatch(/AND status = 'blocked'/);
    expect(w.params[1]).toBe('device_job_failed');
    // 失败也要留回执：不然主理人只看到「推迟」，不知道是哪台手机哪条子任务栽的
    expect(JSON.parse(w.params[2])).toMatchObject({ device_task_id: CHILD, child_status: 'failed' });
  });

  it('失败回执带上子任务的 error_message', async () => {
    const { pool, writes } = makePool({ child: childRow('failed', { error_message: 'adb 离线' }) });
    await reconcileDelegatedDeviceJobs(pool);
    const w = writes.find((x) => /SET status = 'failed'/.test(x.sql));
    expect(JSON.parse(w.params[2]).error_message).toBe('adb 离线');
  });

  it('子 cancelled / canceled（生产两种拼写都在用）→ 父 failed，错因带原拼写', async () => {
    for (const s of ['cancelled', 'canceled']) {
      vi.clearAllMocks();
      const { pool, writes } = makePool({ child: childRow(s) });
      const out = await reconcileDelegatedDeviceJobs(pool);
      expect(out).toEqual({ checked: 1, completed: 0, failed: 1 });
      expect(writes.find((x) => /SET status = 'failed'/.test(x.sql)).params[1]).toBe(`device_job_${s}`);
    }
  });

  it('子还在跑（queued/in_progress/blocked）→ 一条写回都不发', async () => {
    for (const s of ['queued', 'in_progress', 'blocked']) {
      vi.clearAllMocks();
      const { pool, writes } = makePool({ child: childRow(s) });
      const out = await reconcileDelegatedDeviceJobs(pool);
      expect(out).toEqual({ checked: 1, completed: 0, failed: 0 });
      expect(writes).toHaveLength(0);
    }
  });

  it('子任务行查不到 → 不动父任务状态（宁可挂着让人查，也不替一件不知死活的活销账），但留一次痕', async () => {
    const { pool, writes } = makePool({ child: null });
    const out = await reconcileDelegatedDeviceJobs(pool);
    expect(out).toEqual({ checked: 1, completed: 0, failed: 0 });
    expect(writes.some((x) => /SET status/.test(x.sql))).toBe(false);
    expect(recordTaskEventSafe).toHaveBeenCalledWith(
      pool, PARENT, 'qiumi_device_child_missing', expect.objectContaining({ device_task_id: CHILD }),
    );
  });

  it('子任务行查不到的痕只留一次（已标记过的父任务不再重复留痕，否则 60s 一条刷爆 task_events）', async () => {
    const { pool, writes } = makePool({
      parents: [{ id: PARENT, device_task_id: CHILD, child_missing_at: '2026-09-23T00:00:00.000Z' }],
      child: null,
    });
    await reconcileDelegatedDeviceJobs(pool);
    expect(recordTaskEventSafe).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });
});

describe('reconcileDelegatedDeviceJobs — 不变量', () => {
  it('写回绝不碰 payload / task_type（碰了就会叫醒回执不可变触发器 421）', async () => {
    for (const s of ['completed', 'failed']) {
      vi.clearAllMocks();
      const { pool, writes } = makePool({ child: childRow(s) });
      await reconcileDelegatedDeviceJobs(pool);
      for (const w of writes) {
        expect(w.sql).not.toMatch(/payload/);
        expect(w.sql).not.toMatch(/task_type\s*=/);
      }
    }
  });

  it('留痕 qiumi_device_reconciled，带子任务 id 与落点', async () => {
    const { pool } = makePool({ child: childRow('completed') });
    await reconcileDelegatedDeviceJobs(pool);
    expect(recordTaskEventSafe).toHaveBeenCalledWith(
      pool, PARENT, 'qiumi_device_reconciled',
      expect.objectContaining({ device_task_id: CHILD, child_status: 'completed', outcome: 'completed_no_pr' }),
    );
  });

  it('一条父任务出错不吞掉整轮（下一条照样对账）', async () => {
    const parents = [{ id: 'bad', device_task_id: CHILD }, { id: PARENT, device_task_id: CHILD }];
    let first = true;
    const query = vi.fn(async (sql) => {
      if (/delegated_device_job/.test(sql) && /SELECT/i.test(sql)) return { rows: parents, rowCount: 2 };
      if (/FROM tasks\s+WHERE id = \$1/.test(sql) && /SELECT/i.test(sql)) {
        if (first) { first = false; throw new Error('boom'); }
        return { rows: [childRow('completed')], rowCount: 1 };
      }
      return { rowCount: 1, rows: [] };
    });
    const out = await reconcileDelegatedDeviceJobs({ query });
    expect(out).toEqual({ checked: 2, completed: 1, failed: 0 });
  });
});
