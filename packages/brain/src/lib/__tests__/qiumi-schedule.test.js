/**
 * 秋米任务按「预期开始时间」排期派发 + 委派人（决策 51c09285，任务 0b3592c9）。
 * 主理人 09-29：委派后先进数据库，没到开始时间不派；等待期中文表要看得出在等；
 * 将来 Agent 委派 Agent，要看得到委派人是谁。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockNotionReq = vi.fn();
const mockCreateRoutedTask = vi.fn();
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));
vi.mock('../../recurring-notion-sync.js', () => ({ notionReq: mockNotionReq, getToken: () => 'tok' }));
vi.mock('../../work-routing-store.js', () => ({ createRoutedTask: mockCreateRoutedTask }));
vi.mock('../../task-updater.js', () => ({ blockTask: vi.fn(), unblockTask: vi.fn() }));
vi.mock('../../projection/commands.js', () => ({ recordProjectionCommand: vi.fn() }));

const NOW = new Date('2026-09-29T02:00:00.000Z'); // 上海 10:00
const ZH_ID = '11111111-2222-3333-4444-555555555555';
const ZH32 = ZH_ID.replace(/-/g, '');
const EN_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const TID = '15f42776-8d1b-430d-b27a-38a480b93151';

const zhPage = (over = {}) => ({
  id: ZH_ID, created_time: '2026-09-29T01:00:00.000Z',
  created_by: { object: 'user', id: 'u-alex' },
  properties: {
    '名称': { title: [{ plain_text: '10月3日 发朋友圈' }] },
    '备注': { rich_text: [] },
    '状态': { status: { name: '委派' } },
    'OpenClaw任务号': { rich_text: [{ plain_text: `en:${EN_ID.replace(/-/g, '')}` }] },
    '优先级': { select: { name: '中' } },
    '预期开始时间': { date: { start: '2026-10-03T17:00:00.000+08:00' } },
    '预期结束时间': { date: { start: '2026-10-03T18:00:00.000+08:00' } },
    '委派人': { select: { name: 'media' } },
    '执行通道': { select: null },
    '执行 Agent / Workflow': { relation: [] }, '使用 Skill': { relation: [] }, 'AI 业务任务': { relation: [] },
    '负责人': { people: [] }, '归档': { checkbox: false },
    ...over,
  },
});
const enPage = () => ({
  id: EN_ID, last_edited_time: '2026-09-29T01:01:00.000Z',
  properties: {
    Name: { title: [{ plain_text: '[P2] 10月3日 发朋友圈' }] },
    Description: { rich_text: [{ plain_text: `[zh:${ZH32}]` }] },
    Status: { status: { name: 'Delegated' } },
  },
});

describe('lib/qiumi-schedule 时间归一', () => {
  it('只写日期：开始=当天 00:00 上海，结束=当天 23:59:59 上海；带钟点原样；空返回 null', async () => {
    const { toStartIso, toEndIso } = await import('../../lib/qiumi-schedule.js');
    expect(toStartIso('2026-10-03')).toBe('2026-10-03T00:00:00+08:00');
    expect(toEndIso('2026-10-03')).toBe('2026-10-03T23:59:59+08:00');
    expect(toStartIso('2026-10-03T17:00:00.000+08:00')).toBe('2026-10-03T17:00:00.000+08:00');
    expect(toStartIso(null)).toBeNull();
    expect(toEndIso('')).toBeNull();
  });
  it('isFuture / sameInstant / scheduledNote（按上海时间显示）', async () => {
    const { isFuture, sameInstant, scheduledNote } = await import('../../lib/qiumi-schedule.js');
    expect(isFuture('2026-10-03T17:00:00+08:00', NOW)).toBe(true);
    expect(isFuture('2026-09-29T09:00:00+08:00', NOW)).toBe(false);
    expect(isFuture(null, NOW)).toBe(false);
    expect(sameInstant('2026-10-03T17:00:00+08:00', '2026-10-03T09:00:00.000Z')).toBe(true);
    expect(sameInstant(null, null)).toBe(true);
    expect(sameInstant('2026-10-03T17:00:00+08:00', null)).toBe(false);
    expect(scheduledNote('2026-10-03T09:00:00.000Z')).toBe('🕐 已排期 10-03 17:00，到点派发');
  });
});

describe('中文行解析与中英镜像', () => {
  it('parseZhPage：读预期开始/结束时间与委派人；旧列「预期完成日期」兜底当开始时间', async () => {
    const { parseZhPage } = await import('../../notion-gtd-sync.js');
    const zh = parseZhPage(zhPage());
    expect(zh.startAt).toBe('2026-10-03T17:00:00.000+08:00');
    expect(zh.endAt).toBe('2026-10-03T18:00:00.000+08:00');
    expect(zh.delegatedBy).toBe('media');
    expect(zh.createdById).toBe('u-alex');
    const legacy = parseZhPage(zhPage({ '预期开始时间': undefined, '预期完成日期': { date: { start: '2026-10-05' } } }));
    expect(legacy.startAt).toBe('2026-10-05');
  });
  it('buildEnPageFromZh：Plan Date 写开始~结束区间 + Delegated By', async () => {
    const { parseZhPage, buildEnPageFromZh } = await import('../../notion-gtd-sync.js');
    const body = buildEnPageFromZh(parseZhPage(zhPage()));
    expect(body.properties['Plan Date'].date).toEqual({ start: '2026-10-03T17:00:00.000+08:00', end: '2026-10-03T18:00:00.000+08:00' });
    expect(body.properties['Delegated By'].select.name).toBe('media');
  });
  it('buildZhPageFromEn：英文 Plan Date 区间 → 中文预期开始/结束时间，Delegated By → 委派人', async () => {
    const { parseEnPage, buildZhPageFromEn } = await import('../../notion-gtd-sync.js');
    const en = parseEnPage({
      id: EN_ID,
      properties: {
        Name: { title: [{ plain_text: '[P2] 英文原生' }] }, Description: { rich_text: [] },
        Status: { status: { name: 'Delegated' } },
        'Plan Date': { date: { start: '2026-10-04T09:00:00.000+08:00', end: '2026-10-04T10:00:00.000+08:00' } },
        'Delegated By': { select: { name: 'main' } },
      },
    });
    const props = buildZhPageFromEn(en).properties;
    expect(props['预期开始时间'].date.start).toBe('2026-10-04T09:00:00.000+08:00');
    expect(props['预期结束时间'].date.start).toBe('2026-10-04T10:00:00.000+08:00');
    expect(props['委派人'].select.name).toBe('main');
    expect(props).not.toHaveProperty('预期完成日期');
  });
});

describe('入账：开始时间未到 → 进库但不派', () => {
  beforeEach(() => { mockQuery.mockReset(); mockNotionReq.mockReset(); mockCreateRoutedTask.mockReset(); });

  const run = async (zh, { users = {} } = {}) => {
    mockNotionReq.mockImplementation(async (_t, path, method) => {
      if (path === `/pages/${ZH_ID}` && method === 'GET') return zh;
      if (path.startsWith('/users/')) return users[path.slice(7)] ?? {};
      if (path.startsWith('/blocks/')) return { results: [] };
      return {};
    });
    mockCreateRoutedTask.mockResolvedValue({ task: { id: TID } });
    mockQuery.mockResolvedValue({ rows: [] });
    const { ingestDelegatedPage } = await import('../../notion-push-sync.js');
    await ingestDelegatedPage({ query: mockQuery }, 'tok', enPage(), { env: { QIUMI_DISPATCH_ENABLED: 'true' }, now: () => NOW });
    return {
      meta: mockCreateRoutedTask.mock.calls[0][1].metadata,
      zhPatch: mockNotionReq.mock.calls.find((c) => c[1] === `/pages/${ZH_ID}` && c[2] === 'PATCH')?.[3],
      dueCall: mockQuery.mock.calls.find((c) => /UPDATE tasks SET due_at/.test(c[0])),
    };
  };

  it('开始时间在未来：payload.next_run_at=开始时间（派发器按它闸住），due_at=结束时间，中文保持委派+已排期提示', async () => {
    const { meta, zhPatch, dueCall } = await run(zhPage());
    expect(meta.next_run_at).toBe('2026-10-03T17:00:00.000+08:00');
    expect(meta.delegated_by).toBe('media');
    expect(dueCall[1]).toEqual([TID, '2026-10-03T18:00:00.000+08:00']);
    expect(zhPatch.properties['OpenClaw任务号'].rich_text[0].text.content).toBe(`brain:${TID}`);
    expect(zhPatch.properties['状态'].status.name).toBe('委派');
    expect(zhPatch.properties['OpenClaw结果'].rich_text[0].text.content).toBe('🕐 已排期 10-03 17:00，到点派发');
  });

  it('开始时间已过或没写：照旧立即派（中文进行中），next_run_at 不设', async () => {
    const past = await run(zhPage({ '预期开始时间': { date: { start: '2026-09-29' } } }));
    expect(past.meta.next_run_at).toBe('2026-09-29T00:00:00+08:00');
    expect(past.zhPatch.properties['状态'].status.name).toBe('进行中');
    mockQuery.mockReset(); mockNotionReq.mockReset(); mockCreateRoutedTask.mockReset();
    const none = await run(zhPage({ '预期开始时间': { date: null }, '预期结束时间': { date: null } }));
    expect(none.meta).not.toHaveProperty('next_run_at');
    expect(none.zhPatch.properties['状态'].status.name).toBe('进行中');
  });

  it('委派人空着：按页面创建者补——人用名字，机器人记 Agent（未标注），并回写中文「委派人」', async () => {
    const human = await run(zhPage({ '委派人': { select: null } }), { users: { 'u-alex': { type: 'person', name: 'Alex' } } });
    expect(human.meta.delegated_by).toBe('Alex');
    expect(human.zhPatch.properties['委派人'].select.name).toBe('Alex');
    mockQuery.mockReset(); mockNotionReq.mockReset(); mockCreateRoutedTask.mockReset();
    const bot = await run(zhPage({ '委派人': { select: null } }), { users: { 'u-alex': { type: 'bot', name: 'Cecelia' } } });
    expect(bot.meta.delegated_by).toBe('Agent（未标注）');
  });
});

describe('回写与改期', () => {
  beforeEach(() => { mockNotionReq.mockReset(); });

  it('queued 且开始时间未到 → 中文保持委派+已排期提示，英文 Planned', async () => {
    const { pushQiumiStatus } = await import('../../notion-gtd-sync.js');
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{
        id: TID, status: 'queued', error_message: null, result: null,
        zh_page_id: ZH_ID, en_page_id: EN_ID, next_run_at: '2026-10-03T17:00:00.000+08:00',
      }] }).mockResolvedValue({ rows: [] });
    mockNotionReq.mockImplementation(async (_t, path, method) => (method === 'GET' ? zhPage() : {}));
    const { PUSH_QIUMI_QUERY } = await import('../../notion-gtd-sync.js');
    expect(PUSH_QIUMI_QUERY).toMatch(/next_run_at/);
    await pushQiumiStatus({ query }, 'tok', { notionReq: mockNotionReq, today: () => '2026-09-29', now: () => NOW });
    const zhPatch = mockNotionReq.mock.calls.find((c) => c[1] === `/pages/${ZH_ID}` && c[2] === 'PATCH')[3];
    expect(zhPatch.properties['状态'].status.name).toBe('委派');
    expect(zhPatch.properties['OpenClaw结果'].rich_text[0].text.content).toBe('🕐 已排期 10-03 17:00，到点派发');
    const enPatch = mockNotionReq.mock.calls.find((c) => c[1] === `/pages/${EN_ID}` && c[2] === 'PATCH')[3];
    expect(enPatch.properties.Status.status.name).toBe('Planned');
  });

  it('已排期的行在中文表改了开始时间 → 任务 next_run_at 跟着改，并清回写指纹让提示刷新', async () => {
    const { applyOwnerStops } = await import('../../notion-gtd-sync.js');
    const moved = zhPage({
      'OpenClaw任务号': { rich_text: [{ plain_text: `brain:${TID}` }] },
      '预期开始时间': { date: { start: '2026-10-04T08:00:00.000+08:00' } },
    });
    mockNotionReq.mockImplementation(async (_t, path, method, body) => {
      const status = body?.filter?.and?.[0]?.status?.equals;
      return { results: status === '委派' ? [moved] : [] };
    });
    const query = vi.fn(async (sql) => (/SELECT id, status/.test(sql)
      ? { rows: [{ id: TID, status: 'queued', blocked_reason: null, scheduled_start: '2026-10-03T17:00:00.000+08:00' }] }
      : { rows: [] }));
    const r = await applyOwnerStops({ query }, 'tok', { notionReq: mockNotionReq, now: () => NOW });
    expect(r.rescheduled).toBe(1);
    const upd = query.mock.calls.find((c) => /next_run_at/.test(c[0]) && /UPDATE tasks/.test(c[0]));
    expect(upd[1]).toEqual([TID, '2026-10-04T08:00:00.000+08:00']);
    expect(upd[0]).toMatch(/scheduled_start/);
    expect(upd[0]).toMatch(/- 'qiumi_pushed_status'/);
  });

  it('开始时间没变 / 任务已不在排队 / 存量任务（无 scheduled_start）且开始时间已过 → 不动（不冲掉失败重试的退避）', async () => {
    const { applyOwnerStops } = await import('../../notion-gtd-sync.js');
    const same = zhPage({ 'OpenClaw任务号': { rich_text: [{ plain_text: `brain:${TID}` }] } });
    const pastLegacy = zhPage({
      'OpenClaw任务号': { rich_text: [{ plain_text: `brain:${TID}` }] },
      '预期开始时间': { date: { start: '2026-09-01' } },
    });
    for (const [page, row] of [
      [same, { id: TID, status: 'queued', blocked_reason: null, scheduled_start: '2026-10-03T09:00:00.000Z' }],
      [same, { id: TID, status: 'in_progress', blocked_reason: null, scheduled_start: null }],
      [pastLegacy, { id: TID, status: 'queued', blocked_reason: null, scheduled_start: null }],
    ]) {
      mockNotionReq.mockImplementation(async (_t, _p, _m, body) => ({ results: body?.filter?.and?.[0]?.status?.equals === '委派' ? [page] : [] }));
      const query = vi.fn(async (sql) => (/SELECT id, status/.test(sql) ? { rows: [row] } : { rows: [] }));
      const r = await applyOwnerStops({ query }, 'tok', { notionReq: mockNotionReq, now: () => NOW });
      expect(r.rescheduled).toBe(0);
      expect(query.mock.calls.some((c) => /UPDATE tasks/.test(c[0]))).toBe(false);
    }
  });
});
