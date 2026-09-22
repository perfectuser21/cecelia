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
const taskRow = (over = {}) => ({
  id: TID, status: 'in_progress', error_message: null, result: null, zh_page_id: ZH, en_page_id: EN, ...over,
});
const deps = { notionReq: mockNotionReq, today: () => '2026-09-23' };

describe('pushQiumiStatus', () => {
  beforeEach(() => { mockNotionReq.mockReset(); });
  it('completed_no_pr → 中文已完成+勾选+日期，英文 Done，指纹更新', async () => {
    const { pushQiumiStatus, PUSH_QIUMI_QUERY } = await import('../notion-gtd-sync.js');
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: TID, status: 'completed_no_pr', error_message: null, result: { receipt: { finalAssistantVisibleText: '做完了' } }, zh_page_id: ZH, en_page_id: EN }] })
      .mockResolvedValue({ rows: [] });
    mockNotionReq.mockResolvedValueOnce(zhPageWith('进行中')).mockResolvedValue({});
    const r = await pushQiumiStatus({ query }, 'tok', deps);
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
  it('中文当前状态是人工态（阻塞/淘汰/收集/下一个行动）→ 不写中文页，指纹带 qiumi_human_hold 保留标记', async () => {
    const { pushQiumiStatus } = await import('../notion-gtd-sync.js');
    for (const human of ['阻塞', '淘汰', '收集', '下一个行动']) {
      mockNotionReq.mockReset();
      const query = vi.fn()
        .mockResolvedValueOnce({ rows: [taskRow({ status: 'blocked', error_message: 'owner_hold' })] })
        .mockResolvedValue({ rows: [] });
      mockNotionReq.mockResolvedValueOnce(zhPageWith(human)).mockResolvedValue({});
      const r = await pushQiumiStatus({ query }, 'tok', deps);
      expect(r.skippedHuman).toBe(1);
      expect(mockNotionReq.mock.calls.some((c) => c[1] === `/pages/${ZH}` && c[2] === 'PATCH')).toBe(false);
      // stamp 真发生，且写进保留标记（否则人拖回可同步态时永不回写）
      const [sql, params] = query.mock.calls.at(-1);
      expect(sql).toMatch(/UPDATE tasks/);
      expect(sql).toMatch(/qiumi_human_hold/);
      expect(params.slice(0, 2)).toEqual([TID, 'blocked']);
      expect(params).toContain(human);
    }
  });
  it('保留标记闭环：第一轮人工态挂起，第二轮人拖回可同步态（Brain 状态没变）仍要推送并清标记', async () => {
    const { pushQiumiStatus, PUSH_QIUMI_QUERY } = await import('../notion-gtd-sync.js');
    // 查询本身必须捞得回「状态没变但带保留标记」的行，否则第二轮根本不会被扫到
    expect(PUSH_QIUMI_QUERY).toMatch(/qiumi_human_hold/);
    const q1 = vi.fn().mockResolvedValueOnce({ rows: [taskRow()] }).mockResolvedValue({ rows: [] });
    mockNotionReq.mockResolvedValueOnce(zhPageWith('阻塞')).mockResolvedValue({});
    const r1 = await pushQiumiStatus({ query: q1 }, 'tok', deps);
    expect(r1).toEqual({ pushed: 0, skippedHuman: 1, skippedNoMap: 0 });
    expect(q1.mock.calls.at(-1)[0]).toMatch(/qiumi_human_hold/);

    mockNotionReq.mockReset();
    const q2 = vi.fn().mockResolvedValueOnce({ rows: [taskRow()] }).mockResolvedValue({ rows: [] });
    mockNotionReq.mockResolvedValueOnce(zhPageWith('委派')).mockResolvedValue({});
    const r2 = await pushQiumiStatus({ query: q2 }, 'tok', deps);
    expect(r2).toEqual({ pushed: 1, skippedHuman: 0, skippedNoMap: 0 });
    const zhPatch = mockNotionReq.mock.calls.find((c) => c[1] === `/pages/${ZH}` && c[2] === 'PATCH')[3];
    expect(zhPatch.properties['状态'].status.name).toBe('进行中');
    const [sql2, params2] = q2.mock.calls.at(-1);
    expect(sql2).toMatch(/- 'qiumi_human_hold'/);
    expect(params2).toEqual([TID, 'in_progress']);
  });
  it('blocked（系统等待态）→ 中文保持进行中 + [等待中: reason]；pending → 不写但仍 stamp（skippedNoMap）', async () => {
    const { pushQiumiStatus } = await import('../notion-gtd-sync.js');
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [
        taskRow({ status: 'blocked', error_message: 'quota_exhausted' }),
        taskRow({ id: 'p-1', status: 'pending' }),
      ] }).mockResolvedValue({ rows: [] });
    mockNotionReq.mockResolvedValueOnce(zhPageWith('进行中')).mockResolvedValue({});
    const r = await pushQiumiStatus({ query }, 'tok', deps);
    expect(r).toEqual({ pushed: 1, skippedHuman: 0, skippedNoMap: 1 });
    const zhPatch = mockNotionReq.mock.calls.find((c) => c[1] === `/pages/${ZH}` && c[2] === 'PATCH')[3];
    expect(zhPatch.properties['状态'].status.name).toBe('进行中');
    expect(zhPatch.properties['OpenClaw结果'].rich_text[0].text.content).toBe('[等待中: quota_exhausted]');
    // 无映射行也要 stamp，否则每轮重复捞同一行
    expect(query.mock.calls.at(-1)[1]).toEqual(['p-1', 'pending']);
    // 无映射行不读页：只有 blocked 那行发了 GET
    expect(mockNotionReq.mock.calls.filter((c) => c[2] === 'GET')).toHaveLength(1);
  });
  it('英文页 id 为空 → 只写中文页，不 PATCH 英文页', async () => {
    const { pushQiumiStatus } = await import('../notion-gtd-sync.js');
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [taskRow({ status: 'completed', en_page_id: null })] })
      .mockResolvedValue({ rows: [] });
    mockNotionReq.mockResolvedValueOnce(zhPageWith('进行中')).mockResolvedValue({});
    const r = await pushQiumiStatus({ query }, 'tok', deps);
    expect(r.pushed).toBe(1);
    expect(mockNotionReq.mock.calls.some((c) => c[1] === `/pages/${ZH}` && c[2] === 'PATCH')).toBe(true);
    expect(mockNotionReq.mock.calls.some((c) => String(c[1]).startsWith('/pages/') && c[1] !== `/pages/${ZH}`)).toBe(false);
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
    expect(r).toEqual({ cancelled: 1, held: 1, resumed: 1, ignored: [] });
    expect(mockRecord).toHaveBeenCalledWith({ query }, expect.objectContaining({ target: 'notion', entityId: TID, commandType: 'cancel_requested', externalId: `${ZH}:cancel_requested` }));
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
  it('淘汰行每轮不再生成新命令：同一页两轮（人又编辑过 last_edited_time 变了）externalId 相同', async () => {
    const { applyOwnerStops } = await import('../notion-gtd-sync.js');
    const query = vi.fn().mockResolvedValue({ rows: [] });
    for (const edited of ['2026-09-23T01:00:00.000Z', '2026-09-23T02:30:00.000Z']) {
      mockNotionReq.mockReset();
      mockNotionReq
        .mockResolvedValueOnce({ results: [{ ...zhPageWith('淘汰'), last_edited_time: edited }] })
        .mockResolvedValueOnce({ results: [] })
        .mockResolvedValueOnce({ results: [] });
      await applyOwnerStops({ query }, 'tok', { notionReq: mockNotionReq });
    }
    expect(mockRecord).toHaveBeenCalledTimes(2);
    const ids = mockRecord.mock.calls.map((c) => c[1].externalId);
    expect(ids[0]).toBe(`${ZH}:cancel_requested`);
    expect(ids[1]).toBe(ids[0]); // 第二轮命中同一 external_id → ON CONFLICT 不再新建 pending 命令
    // 铁律：淘汰是人工态，消解绝不靠回写页面（清任务号方案已被主理人否掉）
    expect(mockNotionReq.mock.calls.some((c) => c[2] === 'PATCH')).toBe(false);
  });

  it('blockTask 不成功（任务不在可阻塞态）→ held 不计数，但进 ignored 不再静默', async () => {
    const { applyOwnerStops } = await import('../notion-gtd-sync.js');
    mockNotionReq.mockResolvedValueOnce({ results: [] }).mockResolvedValueOnce({ results: [zhPageWith('阻塞')] }).mockResolvedValueOnce({ results: [] });
    mockBlock.mockResolvedValue({ success: false, error: 'invalid_status' });
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const r = await applyOwnerStops({ query }, 'tok', { notionReq: mockNotionReq });
    expect(r.held).toBe(0);
    expect(r.ignored).toEqual([{ id: TID, action: 'hold', reason: 'invalid_status' }]);
  });
});
