import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyOwnerChanges } from '../qiumi-owner-stops.js';
import { recordProjectionCommand } from '../../projection/commands.js';

vi.mock('../../recurring-notion-sync.js', () => ({ notionReq: vi.fn(), getToken: () => 'tok' }));
vi.mock('../../task-updater.js', () => ({ blockTask: vi.fn(), unblockTask: vi.fn() }));
vi.mock('../../projection/commands.js', () => ({ recordProjectionCommand: vi.fn() }));

const ID = '15f42776-8d1b-430d-b27a-38a480b93151';
const PAGE = '11111111-2222-3333-4444-555555555555';
const START = '2026-10-03T09:00:00Z';
const END = '2026-10-03T10:00:00Z';
const NOW = new Date('2026-10-01T00:00:00Z');

function setup({ start = START, end = END, row = {}, updateRows = [{ id: ID }] } = {}) {
  const page = { id: PAGE, properties: {
    '状态': { status: { name: '委派' } },
    'OpenClaw任务号': { rich_text: [{ plain_text: `brain:${ID}` }] },
    '预期开始时间': { date: start ? { start } : null },
    '预期结束时间': { date: end ? { start: end } : null },
  } };
  const notionReq = vi.fn(async (_token, _path, _method, body) => ({
    results: body.filter.and[0].status.equals === '委派' ? [page] : [],
  }));
  const query = vi.fn(async (sql) => (/SELECT/.test(sql)
    ? { rows: [{ id: ID, status: 'queued', scheduled_start: START, due_at: new Date(END), ...row }] }
    : { rows: updateRows, rowCount: updateRows.length }));
  return { query, notionReq, page };
}

async function run(options) {
  const { applyOwnerStops } = await import('../../notion-gtd-sync.js');
  const fixture = setup(options);
  const result = await applyOwnerStops({ query: fixture.query }, 'tok', { notionReq: fixture.notionReq, now: () => NOW });
  const update = fixture.query.mock.calls.find(([sql]) => /UPDATE tasks/.test(sql));
  return { ...fixture, result, update };
}

describe('中文页截止改期同步', () => {
  beforeEach(() => vi.clearAllMocks());

  it('只改结束时间也同步 due_at，开始未变不得覆盖重试退避', async () => {
    const fixture = setup({ end: '2026-10-04T18:00:00+08:00' });
    const { parseZhPage } = await import('../../notion-gtd-sync.js');
    const result = await applyOwnerChanges({ query: fixture.query }, [[], [], [parseZhPage(fixture.page)]], { now: () => NOW });
    const update = fixture.query.mock.calls.find(([sql]) => /UPDATE tasks/.test(sql));
    expect(result.rescheduled).toBe(1);
    expect(update[1]).toEqual([ID, START, false, '2026-10-04T18:00:00+08:00', true, PAGE]);
    expect(update[0]).toMatch(/due_at/);
    expect(update[0]).toMatch(/CASE WHEN \$3/);
  });

  it.each([null, '2026-10-05', '2026-10-05T18:00:00+08:00'])(
    '截止清空或更新为 %s 独立于开始改期', async (end) => {
      const { result, update } = await run({ end });
      expect(result.rescheduled).toBe(1);
      expect(update[1][3]).toBe(end === '2026-10-05' ? '2026-10-05T23:59:59+08:00' : end);
      expect(update[1][2]).toBe(false);
    },
  );

  it('相同时刻的不同UTC偏移写法不重复更新', async () => {
    const { result, update } = await run({ end: '2026-10-03T18:00:00+08:00' });
    expect(result.rescheduled).toBe(0);
    expect(update).toBeUndefined();
  });

  it('开始和截止同时更改，一次写入两项', async () => {
    const start = '2026-10-04T17:00:00+08:00';
    const end = '2026-10-04T18:00:00+08:00';
    const { result, update } = await run({ start, end });
    expect(result.rescheduled).toBe(1);
    expect(update[1]).toEqual([ID, start, true, end, true, PAGE]);
  });

  it('存量已过开始时间不冲掉退避，但仍能设置截止', async () => {
    const { result, update } = await run({ start: '2026-09-01', row: { scheduled_start: null, due_at: null } });
    expect(result.rescheduled).toBe(1);
    expect(update[1][2]).toBe(false);
    expect(update[1][3]).toBe(END);
  });

  it.each(['in_progress', 'paused', 'completed', 'completed_no_pr', 'failed', 'cancelled', 'blocked'])(
    '%s 任务不改期', async (status) => {
      const { result, update } = await run({ end: '2026-10-05', row: { status } });
      expect(result.rescheduled).toBe(0);
      expect(update).toBeUndefined();
    },
  );

  it('读取后被派走或页归属不符，UPDATE零行不能计成功', async () => {
    const { result, update } = await run({ end: '2026-10-05', updateRows: [] });
    expect(result.rescheduled).toBe(0);
    expect(update[0]).toMatch(/status = 'queued'/);
    expect(update[0]).toMatch(/task_type = 'qiumi_task'/);
    expect(update[0]).toMatch(/notion_zh_page_id/);
    expect(update[0]).toMatch(/RETURNING id/);
  });
});

describe('淘汰页急停幂等（cancelled → 淘汰 写回后不得回头触发）', () => {
  beforeEach(() => vi.clearAllMocks());
  const page = { id: PAGE, taskNo: `brain:${ID}` };
  const stop = (rows) => applyOwnerChanges({ query: vi.fn(async () => ({ rows })) }, [[page], [], []], { now: () => NOW });

  it.each(['cancelled', 'canceled', 'completed', 'completed_no_pr', 'failed', 'archived'])(
    '任务已是终态 %s → 不记取消命令、cancelled=0', async (status) => {
      const r = await stop([{ id: ID, status }]);
      expect(r.cancelled).toBe(0);
      expect(recordProjectionCommand).not.toHaveBeenCalled();
    },
  );

  it.each(['queued', 'in_progress', 'blocked', 'paused', 'quarantined', 'dep_failed'])(
    '任务仍活着 %s → 记 cancel_requested', async (status) => {
      const r = await stop([{ id: ID, status }]);
      expect(r.cancelled).toBe(1);
      expect(recordProjectionCommand).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        commandType: 'cancel_requested', entityId: ID, externalId: `${PAGE}:cancel_requested`,
      }));
    },
  );

  it('任务行查不到 → 保持旧行为照记命令', async () => {
    const r = await stop([]);
    expect(r.cancelled).toBe(1);
  });
});
