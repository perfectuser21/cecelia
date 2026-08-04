/**
 * S3 联动清单格子状态回写单元测试 (cascade-writeback.js)
 * TDD: 先写失败测试，再实现 lib/cascade-writeback.js
 * PRD: docs/prd/2026-07-17-mj5-promise-map-first-cut.prd.md §五
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeCascadeCellStatuses } from '../cascade-writeback.js';

describe('writeCascadeCellStatuses — S3 格子状态回写', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('[BEHAVIOR] ran=true + result=pass → PATCH journey_step_links cell_status=green + assertion_ref', async () => {
    const cascade = [
      { link_id: 'l1', assertion_ref: 'tests/crm.test.ts', ran: true, result: 'pass' },
    ];
    const { written } = await writeCascadeCellStatuses(cascade);
    expect(written).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5221/api/brain/journey_step_links/l1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ cell_status: 'green', assertion_ref: 'tests/crm.test.ts' }),
      })
    );
  });

  it('[BEHAVIOR] ran=false → 跳过，不发 PATCH（真机 L3 等待 nightly 覆盖）', async () => {
    const cascade = [
      { link_id: 'l2', assertion_ref: 'manual:true-machine', ran: false, result: 'skip' },
    ];
    const { written, skipped } = await writeCascadeCellStatuses(cascade);
    expect(written).toBe(0);
    expect(skipped).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('[BEHAVIOR] result=fail → 跳过，不写 green（不能因 PASS 主测试就绿掉 cascade fail）', async () => {
    const cascade = [
      { link_id: 'l3', assertion_ref: 'tests/foo.test.ts', ran: true, result: 'fail' },
    ];
    const { written, skipped } = await writeCascadeCellStatuses(cascade);
    expect(written).toBe(0);
    expect(skipped).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('[BEHAVIOR] 空数组 → 无 PATCH，{written:0, skipped:0}', async () => {
    const result = await writeCascadeCellStatuses([]);
    expect(result).toEqual({ written: 0, skipped: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('[BEHAVIOR] 混合：2 pass + 1 skip → 2 次 PATCH，skipped=1', async () => {
    const cascade = [
      { link_id: 'l4', assertion_ref: 'tests/a.test.ts', ran: true,  result: 'pass' },
      { link_id: 'l5', assertion_ref: 'tests/b.test.ts', ran: true,  result: 'pass' },
      { link_id: 'l6', assertion_ref: 'manual:rpa',      ran: false, result: 'skip' },
    ];
    const { written, skipped } = await writeCascadeCellStatuses(cascade);
    expect(written).toBe(2);
    expect(skipped).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('[BEHAVIOR] PATCH 返回非 2xx → 非致命，继续处理剩余项', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: true,  status: 200 });
    const cascade = [
      { link_id: 'l7', assertion_ref: 'tests/c.test.ts', ran: true, result: 'pass' },
      { link_id: 'l8', assertion_ref: 'tests/d.test.ts', ran: true, result: 'pass' },
    ];
    const { written, skipped } = await writeCascadeCellStatuses(cascade);
    expect(written).toBe(1);
    expect(skipped).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('[BEHAVIOR] PATCH 抛异常 → 非致命，继续处理剩余项', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const cascade = [
      { link_id: 'l9',  assertion_ref: 'tests/e.test.ts', ran: true, result: 'pass' },
      { link_id: 'l10', assertion_ref: 'tests/f.test.ts', ran: true, result: 'pass' },
    ];
    const { written, skipped } = await writeCascadeCellStatuses(cascade);
    expect(written).toBe(1);
    expect(skipped).toBe(1);
  });

  it('[BEHAVIOR] null/undefined → 无副作用，返回 {written:0, skipped:0}', async () => {
    expect(await writeCascadeCellStatuses(null)).toEqual({ written: 0, skipped: 0 });
    expect(await writeCascadeCellStatuses(undefined)).toEqual({ written: 0, skipped: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
