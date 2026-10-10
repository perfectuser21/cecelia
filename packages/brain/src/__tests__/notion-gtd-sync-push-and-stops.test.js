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
    expect(r).toEqual({ pushed: 1, skippedHuman: 0, skippedNoMap: 0, skippedGone: 0 });
    expect(query.mock.calls[0][0]).toBe(PUSH_QIUMI_QUERY);
    expect(PUSH_QIUMI_QUERY).toMatch(/LIMIT 50/);
    // device_job 子任务绝不能进推送集合：它若带着中文页 id，会把同一行中文表按子任务的
    // 状态推来推去——子 queued 把行推回「委派」（下一轮同步当新行二次入账）、子完成抢在
    // 父任务之前写「已完成」、子失败写「推迟」并清空 OpenClaw任务号（急停与重排的唯一锚）。
    // 第一道闸是子任务不带 notion_zh_page_id（qiumi-router.js），这里是第二道：SQL 层收窄。
    expect(PUSH_QIUMI_QUERY, 'device_job 行会被推送去改中文表').toMatch(/AND task_type = 'qiumi_task'/);
    const zhPatch = mockNotionReq.mock.calls.find((c) => c[1] === `/pages/${ZH}` && c[2] === 'PATCH')[3];
    expect(zhPatch.properties['状态'].status.name).toBe('已完成');
    expect(zhPatch.properties['已完成'].checkbox).toBe(true);
    expect(zhPatch.properties['OpenClaw结果'].rich_text[0].text.content).toBe('做完了');
    const enPatch = mockNotionReq.mock.calls.find((c) => c[1] === `/pages/${EN}` && c[2] === 'PATCH')[3];
    expect(enPatch.properties.Status.status.name).toBe('Done');
    expect(query.mock.calls.at(-1)[0]).toMatch(/qiumi_pushed_status/);
    expect(query.mock.calls.at(-1)[1]).toEqual([TID, 'completed_no_pr', null, null]);
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
    expect(r1).toEqual({ pushed: 0, skippedHuman: 1, skippedNoMap: 0, skippedGone: 0 });
    expect(q1.mock.calls.at(-1)[0]).toMatch(/qiumi_human_hold/);

    mockNotionReq.mockReset();
    const q2 = vi.fn().mockResolvedValueOnce({ rows: [taskRow()] }).mockResolvedValue({ rows: [] });
    mockNotionReq.mockResolvedValueOnce(zhPageWith('委派')).mockResolvedValue({});
    const r2 = await pushQiumiStatus({ query: q2 }, 'tok', deps);
    expect(r2).toEqual({ pushed: 1, skippedHuman: 0, skippedNoMap: 0, skippedGone: 0 });
    const zhPatch = mockNotionReq.mock.calls.find((c) => c[1] === `/pages/${ZH}` && c[2] === 'PATCH')[3];
    expect(zhPatch.properties['状态'].status.name).toBe('进行中');
    const [sql2, params2] = q2.mock.calls.at(-1);
    expect(sql2).toMatch(/- 'qiumi_human_hold'/);
    expect(params2).toEqual([TID, 'in_progress', null, null]);
  });
  it('blocked（系统等待态）→ 中文受阻 + [受阻: reason]，英文 Blocked；pending → 不写但仍 stamp（skippedNoMap）', async () => {
    const { pushQiumiStatus } = await import('../notion-gtd-sync.js');
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [
        taskRow({ status: 'blocked', error_message: 'quota_exhausted' }),
        taskRow({ id: 'p-1', status: 'pending' }),
      ] }).mockResolvedValue({ rows: [] });
    mockNotionReq.mockResolvedValueOnce(zhPageWith('进行中')).mockResolvedValue({});
    const r = await pushQiumiStatus({ query }, 'tok', deps);
    expect(r).toEqual({ pushed: 1, skippedHuman: 0, skippedNoMap: 1, skippedGone: 0 });
    const zhPatch = mockNotionReq.mock.calls.find((c) => c[1] === `/pages/${ZH}` && c[2] === 'PATCH')[3];
    expect(zhPatch.properties['状态'].status.name).toBe('受阻');
    expect(zhPatch.properties['OpenClaw结果'].rich_text[0].text.content).toBe('[受阻: quota_exhausted]');
    const enPatch = mockNotionReq.mock.calls.find((c) => c[1] === `/pages/${EN}` && c[2] === 'PATCH')[3];
    expect(enPatch.properties.Status.status.name).toBe('Blocked');
    // 无映射行也要 stamp，否则每轮重复捞同一行
    expect(query.mock.calls.at(-1)[1]).toEqual(['p-1', 'pending', null, null]);
    // 无映射行不读页：只有 blocked 那行发了 GET
    expect(mockNotionReq.mock.calls.filter((c) => c[2] === 'GET')).toHaveLength(1);
  });
  it('blocked + blocked_reason=device_unresolved → 中文 OpenClaw结果 显示「⚠️ 手机未确定…」（任务 b923b1f7）', async () => {
    const { pushQiumiStatus, PUSH_QIUMI_QUERY } = await import('../notion-gtd-sync.js');
    expect(PUSH_QIUMI_QUERY).toMatch(/blocked_reason/);
    const note = '⚠️ 手机未确定：请在正文写明手机昵称（小彩/小白/小黄/小蓝）或抖音账号';
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [taskRow({ status: 'blocked', blocked_reason: 'device_unresolved', error_message: note })] })
      .mockResolvedValue({ rows: [] });
    mockNotionReq.mockResolvedValueOnce(zhPageWith('进行中')).mockResolvedValue({});
    await pushQiumiStatus({ query }, 'tok', deps);
    const zhPatch = mockNotionReq.mock.calls.find((c) => c[1] === `/pages/${ZH}` && c[2] === 'PATCH')[3];
    expect(zhPatch.properties['状态'].status.name).toBe('受阻');
    expect(zhPatch.properties['OpenClaw结果'].rich_text[0].text.content).toBe(note);
  });
  it('中文行已被主理人归档/删除 → 不 PATCH、记指纹不再重扫，且不挡住同轮后面的行（09-28 实测 48h 重试 586 次）', async () => {
    const { pushQiumiStatus } = await import('../notion-gtd-sync.js');
    const ZH2 = '99999999-2222-3333-4444-555555555555';
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [
        taskRow({ status: 'completed_no_pr' }),
        taskRow({ id: 'next-1', status: 'completed_no_pr', zh_page_id: ZH2, en_page_id: null }),
      ] }).mockResolvedValue({ rows: [] });
    mockNotionReq.mockImplementation(async (_t, path, method) => {
      if (path === `/pages/${ZH}` && method === 'GET') return { ...zhPageWith('进行中'), archived: true, in_trash: true };
      if (path === `/pages/${ZH}` && method === 'PATCH') throw new Error("Notion PATCH → 400: Can't edit block that is archived.");
      if (path === `/pages/${ZH2}` && method === 'GET') return { ...zhPageWith('进行中'), id: ZH2 };
      return {};
    });
    const r = await pushQiumiStatus({ query }, 'tok', deps);
    expect(r).toEqual({ pushed: 1, skippedHuman: 0, skippedNoMap: 0, skippedGone: 1 });
    expect(mockNotionReq.mock.calls.some((c) => c[1] === `/pages/${ZH}` && c[2] === 'PATCH'), '对归档页发了 PATCH').toBe(false);
    expect(mockNotionReq.mock.calls.some((c) => c[1] === `/pages/${EN}` && c[2] === 'PATCH'), '归档行的英文页也不该动').toBe(false);
    expect(mockNotionReq.mock.calls.some((c) => c[1] === `/pages/${ZH2}` && c[2] === 'PATCH'), '后面的行被挡住没推').toBe(true);
    // 归档行也要 stamp，否则每 30s 捞回来重试
    const stamps = query.mock.calls.slice(1).map((c) => c[1]);
    expect(stamps).toContainEqual([TID, 'completed_no_pr', null, null]);
    mockNotionReq.mockReset();
  });
  it('中文页已被彻底删除（GET 404）→ 同样记指纹跳过，不挡后面的行（09-29 实测 4c75a4ef 404 卡住整步）', async () => {
    const { pushQiumiStatus } = await import('../notion-gtd-sync.js');
    const ZH2 = '99999999-2222-3333-4444-555555555555';
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [
        taskRow({ status: 'completed_no_pr' }),
        taskRow({ id: 'next-1', status: 'completed_no_pr', zh_page_id: ZH2, en_page_id: null }),
      ] }).mockResolvedValue({ rows: [] });
    mockNotionReq.mockImplementation(async (_t, path, method) => {
      if (path === `/pages/${ZH}`) throw Object.assign(new Error('Notion GET → 404: Could not find page'), { status: 404 });
      if (path === `/pages/${ZH2}` && method === 'GET') return { ...zhPageWith('进行中'), id: ZH2 };
      return {};
    });
    const r = await pushQiumiStatus({ query }, 'tok', deps);
    expect(r).toEqual({ pushed: 1, skippedHuman: 0, skippedNoMap: 0, skippedGone: 1 });
    expect(query.mock.calls.slice(1).map((c) => c[1])).toContainEqual([TID, 'completed_no_pr', null, null]);
    expect(mockNotionReq.mock.calls.some((c) => c[1] === `/pages/${ZH2}` && c[2] === 'PATCH')).toBe(true);
    mockNotionReq.mockReset();
  });
  it('非永久错误（如 400 校验错、重试后仍 5xx）→ 不记指纹（下轮重试），但不挡后面的行，最后整步报错', async () => {
    const { pushQiumiStatus } = await import('../notion-gtd-sync.js');
    const ZH2 = '99999999-2222-3333-4444-555555555555';
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [
        taskRow({ status: 'completed_no_pr' }),
        taskRow({ id: 'next-1', status: 'completed_no_pr', zh_page_id: ZH2, en_page_id: null }),
      ] }).mockResolvedValue({ rows: [] });
    mockNotionReq.mockImplementation(async (_t, path, method) => {
      if (path === `/pages/${ZH}`) throw Object.assign(new Error('Notion GET → 400: validation_error'), { status: 400 });
      if (path === `/pages/${ZH2}` && method === 'GET') return { ...zhPageWith('进行中'), id: ZH2 };
      return {};
    });
    await expect(pushQiumiStatus({ query }, 'tok', deps)).rejects.toThrow(/1 行回写失败/);
    expect(mockNotionReq.mock.calls.some((c) => c[1] === `/pages/${ZH2}` && c[2] === 'PATCH'), '后面的行被挡住').toBe(true);
    expect(query.mock.calls.slice(1).map((c) => c[1]), '临时失败的行不该记指纹').not.toContainEqual([TID, 'completed_no_pr', null, null]);
    mockNotionReq.mockReset();
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
    expect(r).toEqual({ cancelled: 1, held: 1, resumed: 1, rescheduled: 0, rerouted: 0, ignored: [] });
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

describe('pushQiumiStatus：手机忙排队等待（任务 5ad81457）', () => {
  beforeEach(() => { mockNotionReq.mockReset(); });
  it('queued + next_run_at 在未来 + device_busy → 「OpenClaw结果」写手机忙提示而非「已排期」', async () => {
    const { pushQiumiStatus, PUSH_QIUMI_QUERY } = await import('../notion-gtd-sync.js');
    expect(PUSH_QIUMI_QUERY).toMatch(/device_busy/);
    const nextRunAt = '2026-09-30T01:20:00.000Z';
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [taskRow({ status: 'queued', next_run_at: nextRunAt, device_busy: { owner: 't3-readonly-20260930-01', attempts: 2, next_run_at: nextRunAt } })] })
      .mockResolvedValue({ rows: [] });
    mockNotionReq.mockResolvedValueOnce(zhPageWith('进行中')).mockResolvedValue({});
    await pushQiumiStatus({ query }, 'tok', { ...deps, now: () => new Date('2026-09-30T01:15:00.000Z') });
    const zhPatch = mockNotionReq.mock.calls.find((c) => c[1] === `/pages/${ZH}` && c[2] === 'PATCH')[3];
    expect(zhPatch.properties['状态'].status.name).toBe('排队中');
    const enPatch = mockNotionReq.mock.calls.find((c) => c[1] === `/pages/${EN}` && c[2] === 'PATCH')[3];
    expect(enPatch.properties.Status.status.name).toBe('Queued');
    expect(zhPatch.properties['OpenClaw结果'].rich_text[0].text.content)
      .toBe('⏳ 手机忙（被 t3-readonly-20260930-01 占用），已排队，09:20 后重试（第 2 次）');
  });
});

describe('pushQiumiStatus：手机忙到截止仍未执行（device_busy_expired）', () => {
  beforeEach(() => { mockNotionReq.mockReset(); });
  const push = async (row) => {
    const { pushQiumiStatus } = await import('../notion-gtd-sync.js');
    const query = vi.fn().mockResolvedValueOnce({ rows: [taskRow(row)] }).mockResolvedValue({ rows: [] });
    mockNotionReq.mockResolvedValueOnce(zhPageWith('委派')).mockResolvedValue({});
    await pushQiumiStatus({ query }, 'tok', deps);
    return mockNotionReq.mock.calls.find((c) => c[1] === `/pages/${ZH}` && c[2] === 'PATCH')[3];
  };
  it('failed + device_busy_expired →「OpenClaw结果」写 ⌛ 到截止时间仍未轮到手机（一直被 <owner> 占用），未执行', async () => {
    const zhPatch = await push({
      status: 'failed', error_message: 'device_busy_expired',
      result: { receipt: { finalAssistantVisibleText: 'DEVICE_BUSY owner=harvest-cron serial=S9' }, device_busy: { owner: 'harvest-cron', attempts: 12 } },
      device_busy: { owner: 'older-owner', attempts: 11 },
    });
    expect(zhPatch.properties['OpenClaw结果'].rich_text[0].text.content)
      .toBe('⌛ 到截止时间仍未轮到手机（一直被 harvest-cron 占用），未执行');
    // 其余失败态写法不变，状态改为「失败」（旧为「推迟」），仍清任务号
    expect(zhPatch.properties['状态'].status.name).toBe('失败');
    expect(zhPatch.properties['OpenClaw任务号'].rich_text).toEqual([]);
  });
  it('result 里没有 owner → 回落 payload.device_busy.owner', async () => {
    const zhPatch = await push({ status: 'failed', error_message: 'device_busy_expired', result: null, device_busy: { owner: 't3-readonly' } });
    expect(zhPatch.properties['OpenClaw结果'].rich_text[0].text.content)
      .toBe('⌛ 到截止时间仍未轮到手机（一直被 t3-readonly 占用），未执行');
  });
  it('其他失败原因照旧 [执行失败: …]', async () => {
    const zhPatch = await push({ status: 'failed', error_message: 'openclaw_agent_exit_1', result: null });
    expect(zhPatch.properties['OpenClaw结果'].rich_text[0].text.content).toMatch(/^\[执行失败: openclaw_agent_exit_1\]/);
  });
});

describe('pushQiumiStatus：中英文状态一一对应（排队中/受阻/失败/淘汰）', () => {
  beforeEach(() => { mockNotionReq.mockReset(); });
  const patchOf = (id) => mockNotionReq.mock.calls.find((c) => c[1] === `/pages/${id}` && c[2] === 'PATCH')?.[3];
  const pushOne = async (row, page, extra = {}) => {
    const { pushQiumiStatus } = await import('../notion-gtd-sync.js');
    const query = vi.fn().mockResolvedValueOnce({ rows: [taskRow(row)] }).mockResolvedValue({ rows: [] });
    mockNotionReq.mockResolvedValueOnce(page).mockResolvedValue({});
    const result = await pushQiumiStatus({ query }, 'tok', { ...deps, ...extra });
    return { result, query };
  };

  it('queued 未排期 → 中文排队中 / 英文 Queued，不写结果栏', async () => {
    await pushOne({ status: 'queued' }, zhPageWith('排队中'));
    expect(patchOf(ZH).properties['状态'].status.name).toBe('排队中');
    expect(patchOf(ZH).properties['OpenClaw结果']).toBeUndefined();
    expect(patchOf(EN).properties.Status.status.name).toBe('Queued');
  });

  it('queued 已排期（next_run_at 在未来）→ 排队中 + 已排期提示，英文 Queued（不再回「委派」/Planned）', async () => {
    await pushOne({ status: 'queued', next_run_at: '2026-10-12T01:00:00.000Z' }, zhPageWith('委派'),
      { now: () => new Date('2026-10-10T00:00:00.000Z') });
    expect(patchOf(ZH).properties['状态'].status.name).toBe('排队中');
    expect(patchOf(ZH).properties['OpenClaw结果'].rich_text[0].text.content).toMatch(/已排期/);
    expect(patchOf(EN).properties.Status.status.name).toBe('Queued');
  });

  it('failed → 失败 / Failed，清任务号（失败拖回「委派」= 重试的锚）', async () => {
    await pushOne({ status: 'failed', error_message: 'ssh_down' }, zhPageWith('进行中'));
    expect(patchOf(ZH).properties['状态'].status.name).toBe('失败');
    expect(patchOf(ZH).properties['OpenClaw任务号'].rich_text).toEqual([]);
    expect(patchOf(EN).properties.Status.status.name).toBe('Failed');
  });

  it('旧「推迟」页 + failed → 仍可被改写成「失败」（旧页只识别、不当人工态）', async () => {
    const { result } = await pushOne({ status: 'failed', error_message: 'x' }, zhPageWith('推迟'));
    expect(result.pushed).toBe(1);
    expect(patchOf(ZH).properties['状态'].status.name).toBe('失败');
  });

  it('cancelled → 淘汰 / Cancelled，保留任务号', async () => {
    await pushOne({ status: 'cancelled', error_message: 'api_cancel' }, zhPageWith('进行中'));
    expect(patchOf(ZH).properties['状态'].status.name).toBe('淘汰');
    expect(patchOf(ZH).properties['OpenClaw任务号']).toBeUndefined();
    expect(patchOf(EN).properties.Status.status.name).toBe('Cancelled');
  });

  it('cancelled 且页面本来就是「淘汰」（主理人拖的急停）→ 不再 PATCH 中文页、不挂保留标记，只同步英文 Cancelled', async () => {
    const { result, query } = await pushOne({ status: 'cancelled' }, zhPageWith('淘汰'));
    expect(result.pushed + result.skippedHuman).toBe(1);
    expect(patchOf(ZH)).toBeUndefined();
    expect(patchOf(EN).properties.Status.status.name).toBe('Cancelled');
    expect(query.mock.calls.at(-1)[1]).toEqual([TID, 'cancelled', null, null]);
  });

  it('页面是「淘汰」但任务还没取消（急停命令未处理完）→ 视为人工态，不覆盖、挂保留标记', async () => {
    const { result, query } = await pushOne({ status: 'in_progress' }, zhPageWith('淘汰'));
    expect(result.skippedHuman).toBe(1);
    expect(patchOf(ZH)).toBeUndefined();
    expect(patchOf(EN)).toBeUndefined();
    expect(query.mock.calls.at(-1)[1]).toEqual([TID, 'in_progress', null, '淘汰']);
  });

  it('blocked + delegated_device_job（转手机领单通道）→ 进行中 / In Progress，不显示受阻', async () => {
    await pushOne({ status: 'blocked', blocked_reason: 'delegated_device_job' }, zhPageWith('排队中'));
    expect(patchOf(ZH).properties['状态'].status.name).toBe('进行中');
    expect(patchOf(ZH).properties['OpenClaw结果'].rich_text[0].text.content).not.toMatch(/受阻/);
    expect(patchOf(EN).properties.Status.status.name).toBe('In Progress');
  });

  it('blocked + owner_hold（页面是主理人设的「阻塞」）→ 中文页不动，英文 Blocked，指纹不挂保留标记', async () => {
    const { result, query } = await pushOne({ status: 'blocked', blocked_reason: 'owner_hold', error_message: 'owner_hold' }, zhPageWith('阻塞'));
    expect(result.skippedHuman).toBe(1);
    expect(patchOf(ZH)).toBeUndefined();
    expect(patchOf(EN).properties.Status.status.name).toBe('Blocked');
    expect(query.mock.calls.at(-1)[1]).toEqual([TID, 'blocked', null, null]);
  });

  it('blocked + owner_hold 但页面已不是「阻塞」→ 仍不写中文页（owner_hold 永不回写中文）', async () => {
    await pushOne({ status: 'blocked', blocked_reason: 'owner_hold' }, zhPageWith('进行中'));
    expect(patchOf(ZH)).toBeUndefined();
    expect(patchOf(EN).properties.Status.status.name).toBe('Blocked');
  });

  it('人工态「收集」+ 普通任务 → 仍整行跳过（中英文都不写）', async () => {
    const { result } = await pushOne({ status: 'in_progress' }, zhPageWith('收集'));
    expect(result.skippedHuman).toBe(1);
    expect(patchOf(ZH)).toBeUndefined();
    expect(patchOf(EN)).toBeUndefined();
  });
});

describe('applyOwnerStops：新旧状态页都识别（排队中/受阻 与 委派/进行中），淘汰幂等', () => {
  beforeEach(() => { mockNotionReq.mockReset(); mockBlock.mockReset(); mockUnblock.mockReset(); mockRecord.mockReset(); });
  const STOP_STATUSES = ['淘汰', '阻塞', '委派', '排队中'];

  it('OWNER_STOP_FILTERS：淘汰/阻塞/委派/排队中四个状态，且都限定任务号 brain: 开头', async () => {
    const { OWNER_STOP_FILTERS } = await import('../notion-gtd-sync.js');
    expect(OWNER_STOP_FILTERS.map((f) => f.and[0].status.equals)).toEqual(STOP_STATUSES);
    for (const f of OWNER_STOP_FILTERS) expect(f.and[1]).toEqual({ property: 'OpenClaw任务号', rich_text: { starts_with: 'brain:' } });
  });

  const stopsWith = async (byStatus, rows, options = {}) => {
    const { applyOwnerStops } = await import('../notion-gtd-sync.js');
    mockNotionReq.mockImplementation(async (_t, _p, _m, body) => ({
      results: (byStatus[body.filter.and[0].status.equals] ?? []).map((s) => zhPageWith(s)),
    }));
    const query = vi.fn().mockResolvedValue({ rows });
    mockBlock.mockResolvedValue({ success: true }); mockUnblock.mockResolvedValue({ success: true });
    return { r: await applyOwnerStops({ query }, 'tok', { notionReq: mockNotionReq, ...options }), query };
  };

  it('页面「排队中」+ 任务 owner_hold 阻塞（主理人把「阻塞」拖到排队中）→ 恢复', async () => {
    const { r } = await stopsWith({ 排队中: ['排队中'] }, [{ id: TID, status: 'blocked', blocked_reason: 'owner_hold' }]);
    expect(r.resumed).toBe(1);
    expect(mockUnblock).toHaveBeenCalledWith(TID);
  });

  it('页面「排队中」+ 任务系统阻塞（非 owner_hold）→ 不 unblock', async () => {
    const { r } = await stopsWith({ 排队中: ['排队中'] }, [{ id: TID, status: 'blocked', blocked_reason: 'quota_exhausted' }]);
    expect(r.resumed).toBe(0);
    expect(mockUnblock).not.toHaveBeenCalled();
  });

  it('页面「排队中」+ queued 任务：改开始时间 → 改期生效（原本只有「委派」页才认）', async () => {
    const { applyOwnerStops } = await import('../notion-gtd-sync.js');
    const page = zhPageWith('排队中');
    page.properties['预期开始时间'] = { date: { start: '2030-10-04T17:00:00+08:00' } };
    mockNotionReq.mockImplementation(async (_t, _p, _m, body) => ({ results: body.filter.and[0].status.equals === '排队中' ? [page] : [] }));
    const query = vi.fn(async (sql) => (/SELECT/.test(sql)
      ? { rows: [{ id: TID, status: 'queued', scheduled_start: '2030-10-03T09:00:00Z', due_at: null }] }
      : { rows: [{ id: TID }], rowCount: 1 }));
    const r = await applyOwnerStops({ query }, 'tok', { notionReq: mockNotionReq, now: () => new Date('2026-10-10T00:00:00Z') });
    expect(r.rescheduled).toBe(1);
  });

  it.each(['cancelled', 'canceled', 'completed', 'completed_no_pr', 'failed', 'archived'])(
    '「淘汰」页 + 任务已是终态 %s → 不记取消命令、不计 cancelled（幂等，AI 自己写的淘汰不回头触发）', async (status) => {
      const { r } = await stopsWith({ 淘汰: ['淘汰'] }, [{ id: TID, status }]);
      expect(mockRecord).not.toHaveBeenCalled();
      expect(r.cancelled).toBe(0);
      expect(mockBlock).not.toHaveBeenCalled();
      expect(mockUnblock).not.toHaveBeenCalled();
      expect(mockNotionReq.mock.calls.some((c) => c[2] === 'PATCH')).toBe(false);
    },
  );

  it.each(['queued', 'in_progress', 'blocked', 'paused', 'quarantined'])(
    '「淘汰」页 + 任务仍活着（%s）→ 照旧记 cancel_requested（主理人的急停有效）', async (status) => {
      const { r } = await stopsWith({ 淘汰: ['淘汰'] }, [{ id: TID, status }]);
      expect(r.cancelled).toBe(1);
      expect(mockRecord).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ commandType: 'cancel_requested', entityId: TID }));
    },
  );

  it('「淘汰」页 + 任务行查不到 → 保持旧行为照记命令（交给命令处理器判定）', async () => {
    const { r } = await stopsWith({ 淘汰: ['淘汰'] }, []);
    expect(r.cancelled).toBe(1);
  });
});
