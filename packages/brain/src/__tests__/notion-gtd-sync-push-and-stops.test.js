import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockNotionReq = vi.fn();
vi.mock('../recurring-notion-sync.js', () => ({ notionReq: mockNotionReq, getToken: () => 'tok' }));
const mockBlock = vi.fn(); const mockUnblock = vi.fn();
vi.mock('../task-updater.js', () => ({ blockTask: mockBlock, unblockTask: mockUnblock }));
const mockRecord = vi.fn();
vi.mock('../projection/commands.js', () => ({ recordProjectionCommand: mockRecord }));

const ZH = '11111111-2222-3333-4444-555555555555';
const EN = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const TID = '15f42776-8d1b-430d-b27a-38a480b93151';
const zhPageWith = (status, taskNo = `brain:${TID}`) => ({
  id: ZH, last_edited_time: '2026-09-23T01:00:00.000Z',
  properties: { '状态': { status: { name: status } }, 'OpenClaw任务号': { rich_text: [{ plain_text: taskNo }] } },
});

describe('pushQiumiStatus', () => {
  beforeEach(() => { mockNotionReq.mockReset(); });
  it('completed_no_pr → 中文已完成+勾选+日期，英文 Done，指纹更新', async () => {
    const { pushQiumiStatus, PUSH_QIUMI_QUERY } = await import('../notion-gtd-sync.js');
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: TID, status: 'completed_no_pr', error_message: null, result: { receipt: { finalAssistantVisibleText: '做完了' } }, zh_page_id: ZH, en_page_id: EN }] })
      .mockResolvedValue({ rows: [] });
    mockNotionReq.mockResolvedValueOnce(zhPageWith('进行中')).mockResolvedValue({});
    const r = await pushQiumiStatus({ query }, 'tok', { notionReq: mockNotionReq, today: () => '2026-09-23' });
    expect(r).toEqual({ pushed: 1, skippedHuman: 0, skippedNoMap: 0 });
    expect(query.mock.calls[0][0]).toBe(PUSH_QIUMI_QUERY);
    expect(PUSH_QIUMI_QUERY).toMatch(/LIMIT 50/);
    const zhPatch = mockNotionReq.mock.calls.find((c) => c[1] === `/pages/${ZH}` && c[2] === 'PATCH')[3];
    expect(zhPatch.properties['状态'].status.name).toBe('已完成');
    expect(zhPatch.properties['已完成'].checkbox).toBe(true);
    expect(zhPatch.properties['OpenClaw结果'].rich_text[0].text.content).toBe('做完了');
    const enPatch = mockNotionReq.mock.calls.find((c) => c[1] === `/pages/${EN}` && c[2] === 'PATCH')[3];
    expect(enPatch.properties.Status.status.name).toBe('Done');
    expect(query.mock.calls.at(-1)[0]).toMatch(/qiumi_pushed_status/);
    expect(query.mock.calls.at(-1)[1]).toEqual([TID, 'completed_no_pr']);
  });
  it('中文当前状态是人工态（阻塞/淘汰/收集/下一个行动）→ 不写中文页，只更新指纹', async () => {
    const { pushQiumiStatus } = await import('../notion-gtd-sync.js');
    for (const human of ['阻塞', '淘汰', '收集', '下一个行动']) {
      mockNotionReq.mockReset();
      const query = vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: TID, status: 'blocked', error_message: 'owner_hold', result: null, zh_page_id: ZH, en_page_id: EN }] })
        .mockResolvedValue({ rows: [] });
      mockNotionReq.mockResolvedValueOnce(zhPageWith(human)).mockResolvedValue({});
      const r = await pushQiumiStatus({ query }, 'tok', { notionReq: mockNotionReq, today: () => '2026-09-23' });
      expect(r.skippedHuman).toBe(1);
      expect(mockNotionReq.mock.calls.some((c) => c[1] === `/pages/${ZH}` && c[2] === 'PATCH')).toBe(false);
    }
  });
  it('blocked（系统等待态）→ 中文保持进行中 + [等待中: reason]；pending → 不写（skippedNoMap）', async () => {
    const { pushQiumiStatus } = await import('../notion-gtd-sync.js');
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [
        { id: TID, status: 'blocked', error_message: 'quota_exhausted', result: null, zh_page_id: ZH, en_page_id: EN },
        { id: 'p-1', status: 'pending', error_message: null, result: null, zh_page_id: ZH, en_page_id: EN },
      ] }).mockResolvedValue({ rows: [] });
    mockNotionReq.mockResolvedValueOnce(zhPageWith('进行中')).mockResolvedValue({});
    const r = await pushQiumiStatus({ query }, 'tok', { notionReq: mockNotionReq, today: () => '2026-09-23' });
    expect(r).toEqual({ pushed: 1, skippedHuman: 0, skippedNoMap: 1 });
    const zhPatch = mockNotionReq.mock.calls.find((c) => c[1] === `/pages/${ZH}` && c[2] === 'PATCH')[3];
    expect(zhPatch.properties['状态'].status.name).toBe('进行中');
    expect(zhPatch.properties['OpenClaw结果'].rich_text[0].text.content).toBe('[等待中: quota_exhausted]');
  });
});

describe('applyOwnerStops（急停只对任务号 brain: 的行生效）', () => {
  beforeEach(() => { mockNotionReq.mockReset(); mockBlock.mockReset(); mockUnblock.mockReset(); mockRecord.mockReset(); });
  it('淘汰→cancel_requested；阻塞→blockTask(owner_hold)；委派(从阻塞拖回)→unblockTask；任务号为空的行永不读', async () => {
    const { applyOwnerStops, OWNER_STOP_FILTERS } = await import('../notion-gtd-sync.js');
    mockNotionReq
      .mockResolvedValueOnce({ results: [zhPageWith('淘汰'), zhPageWith('淘汰', '')] })  // 淘汰 查询
      .mockResolvedValueOnce({ results: [zhPageWith('阻塞')] })                            // 阻塞
      .mockResolvedValueOnce({ results: [zhPageWith('委派')] });                           // 委派
    const query = vi.fn().mockResolvedValue({ rows: [{ id: TID, status: 'blocked', blocked_reason: 'owner_hold' }] });
    mockBlock.mockResolvedValue({ success: true }); mockUnblock.mockResolvedValue({ success: true });
    const r = await applyOwnerStops({ query }, 'tok', { notionReq: mockNotionReq });
    expect(r).toEqual({ cancelled: 1, held: 1, resumed: 1 });
    expect(mockRecord).toHaveBeenCalledWith({ query }, expect.objectContaining({ target: 'notion', entityId: TID, commandType: 'cancel_requested', externalId: `${ZH}:2026-09-23T01:00:00.000Z` }));
    expect(mockBlock).toHaveBeenCalledWith(TID, expect.objectContaining({ reason: 'owner_hold' }));
    expect(mockUnblock).toHaveBeenCalledWith(TID);
    for (const f of OWNER_STOP_FILTERS) {
      expect(JSON.stringify(f)).toMatch(/"starts_with":"brain:"/);
    }
  });
  it('委派但任务不是 owner_hold 的 blocked → 不 unblock（系统阻塞不受人工影响）', async () => {
    const { applyOwnerStops } = await import('../notion-gtd-sync.js');
    mockNotionReq.mockResolvedValueOnce({ results: [] }).mockResolvedValueOnce({ results: [] }).mockResolvedValueOnce({ results: [zhPageWith('委派')] });
    const query = vi.fn().mockResolvedValue({ rows: [{ id: TID, status: 'blocked', blocked_reason: 'dispatch_fail_autoblock' }] });
    const r = await applyOwnerStops({ query }, 'tok', { notionReq: mockNotionReq });
    expect(r.resumed).toBe(0);
    expect(mockUnblock).not.toHaveBeenCalled();
  });
});
