/**
 * notion-memory-sync.test.js
 * 测试 Notion Memory 同步模块的导出和基本行为
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// mock pool
const mockPool = {
  query: vi.fn(),
};
vi.mock('../db.js', () => ({ default: mockPool }));

const {
  NOTION_MEMORY_DB_IDS,
  parseContactContent,
  contactFieldsToNotionProps,
  pushFactToNotion,
  pushMemoryToNotion,
  rebuildMemoryDatabases,
  importAllMemoryData,
} = await import('../notion-memory-sync.js');

describe('notion-memory-sync 模块导出', () => {
  it('导出 NOTION_MEMORY_DB_IDS 对象，包含 3 个 DB id', () => {
    expect(NOTION_MEMORY_DB_IDS).toMatchObject({
      ownerProfile: expect.any(String),
      contacts:     expect.any(String),
      diary:        expect.any(String),
    });
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    expect(NOTION_MEMORY_DB_IDS.ownerProfile).toMatch(uuidRe);
    expect(NOTION_MEMORY_DB_IDS.contacts).toMatch(uuidRe);
    expect(NOTION_MEMORY_DB_IDS.diary).toMatch(uuidRe);
  });

  it('导出的函数类型正确', () => {
    expect(typeof parseContactContent).toBe('function');
    expect(typeof contactFieldsToNotionProps).toBe('function');
    expect(typeof pushFactToNotion).toBe('function');
    expect(typeof pushMemoryToNotion).toBe('function');
    expect(typeof rebuildMemoryDatabases).toBe('function');
    expect(typeof importAllMemoryData).toBe('function');
  });
});

describe('parseContactContent', () => {
  it('解析标准 key:value 格式', () => {
    const r = parseContactContent('姓名:胡月萍 称呼:糊糊 实际关系:妻子 生日:1989-07-02 分类:至亲');
    expect(r['姓名']).toBe('胡月萍');
    expect(r['称呼']).toBe('糊糊');
    expect(r['实际关系']).toBe('妻子');
    expect(r['生日']).toBe('1989-07-02');
    expect(r['分类']).toBe('至亲');
  });

  it('解析包含职业和朋友分类的联系人', () => {
    const r = parseContactContent('姓名:贾得巍 实际关系:法务专家 分类:朋友 职业:律师');
    expect(r['姓名']).toBe('贾得巍');
    expect(r['职业']).toBe('律师');
    expect(r['分类']).toBe('朋友');
  });

  it('无冒号时整体作为备注', () => {
    const r = parseContactContent('普通文本没有冒号');
    expect(r['备注']).toBe('普通文本没有冒号');
  });

  it('空/null 输入返回空对象', () => {
    expect(parseContactContent('')).toEqual({});
    expect(parseContactContent(null)).toEqual({});
    expect(parseContactContent(undefined)).toEqual({});
  });
});

describe('contactFieldsToNotionProps', () => {
  it('关系字段映射到 select', () => {
    const p = contactFieldsToNotionProps({ 实际关系: '妻子' });
    expect(p['关系']).toEqual({ select: { name: '妻子' } });
  });

  it('分类字段映射到 multi_select（逗号分隔）', () => {
    const p = contactFieldsToNotionProps({ 分类: '朋友,至亲' });
    expect(p['分类']).toEqual({ multi_select: [{ name: '朋友' }, { name: '至亲' }] });
  });

  it('生日字段映射到 date（格式规范化）', () => {
    const p = contactFieldsToNotionProps({ 生日: '1989-07-02' });
    expect(p['生日']).toEqual({ date: { start: '1989-07-02' } });
  });

  it('生日斜杠格式规范化为连字符', () => {
    const p = contactFieldsToNotionProps({ 生日: '1989/07/02' });
    expect(p['生日']).toEqual({ date: { start: '1989-07-02' } });
  });

  it('邮箱字段映射到 email', () => {
    const p = contactFieldsToNotionProps({ 邮箱: 'alice@example.com' });
    expect(p['邮箱']).toEqual({ email: 'alice@example.com' });
  });

  it('电话字段映射到 phone_number', () => {
    const p = contactFieldsToNotionProps({ 电话: '13800138000' });
    expect(p['电话']).toEqual({ phone_number: '13800138000' });
  });

  it('网址字段映射到 url', () => {
    const p = contactFieldsToNotionProps({ 网址: 'https://example.com' });
    expect(p['网址']).toEqual({ url: 'https://example.com' });
  });

  it('职业映射到 rich_text', () => {
    const p = contactFieldsToNotionProps({ 职业: '律师' });
    expect(p['职业']).toEqual({ rich_text: [{ text: { content: '律师' } }] });
  });

  it('称呼映射到 rich_text', () => {
    const p = contactFieldsToNotionProps({ 称呼: '糊糊' });
    expect(p['称呼']).toEqual({ rich_text: [{ text: { content: '糊糊' } }] });
  });

  it('姓名字段被跳过（title 字段单独处理）', () => {
    const p = contactFieldsToNotionProps({ 姓名: '张三', 称呼: '小张' });
    expect(p['姓名']).toBeUndefined();
    expect(p['称呼']).toBeDefined();
  });

  it('sourceName 写入来源 select', () => {
    const p = contactFieldsToNotionProps({}, 'import', null);
    expect(p['来源']).toEqual({ select: { name: 'import' } });
  });

  it('updatedAt 写入更新时间 date', () => {
    const d = new Date('2026-01-01');
    const p = contactFieldsToNotionProps({}, null, d);
    expect(p['更新时间']).toEqual({ date: { start: '2026-01-01' } });
  });

  it('未知 key 但值为邮箱格式时自动检测', () => {
    const p = contactFieldsToNotionProps({ 联络: 'bob@test.com' });
    expect(p['邮箱']).toEqual({ email: 'bob@test.com' });
  });

  it('未知 key 但值为 URL 格式时自动检测', () => {
    const p = contactFieldsToNotionProps({ 主页: 'https://github.com/bob' });
    expect(p['网址']).toEqual({ url: 'https://github.com/bob' });
  });
});

describe('pushFactToNotion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NOTION_API_KEY;
  });

  it('无 NOTION_API_KEY 时抛错，被 catch 吞掉不影响调用', async () => {
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({}) });
    await expect(pushFactToNotion({ id: 1, category: 'raw', content: 'a: b', key: 'raw.a', source: 'auto' })).resolves.toBeUndefined();
  });

  it('有 NOTION_API_KEY 时，调用 Notion POST /pages（非 contact）', async () => {
    process.env.NOTION_API_KEY = 'test-key';
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'page-xyz-123' }),
    });
    mockPool.query.mockResolvedValue({ rows: [] });

    await pushFactToNotion({
      id: 99,
      category: 'background',
      content: 'display_name: Alex',
      key: 'display_name',
      source: 'auto',
      created_at: new Date('2026-01-01'),
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('api.notion.com/v1/pages');
    expect(opts.method).toBe('POST');

    const body = JSON.parse(opts.body);
    expect(body.parent.database_id).toBe(NOTION_MEMORY_DB_IDS.ownerProfile);
    expect(body.properties['键'].title[0].text.content).toBe('display_name');
    expect(body.properties['值'].rich_text[0].text.content).toContain('Alex');
    // 非 contact 必须有 已验证 checkbox
    expect(body.properties['已验证'].checkbox).toBe(false);

    expect(mockPool.query).toHaveBeenCalledWith(
      'UPDATE user_profile_facts SET notion_id=$1 WHERE id=$2',
      ['page-xyz-123', 99]
    );

    delete process.env.NOTION_API_KEY;
  });

  it('category=other 时，推送到 contacts DB，并解析 content 写入正确字段', async () => {
    process.env.NOTION_API_KEY = 'test-key';
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'contact-page-001' }),
    });
    mockPool.query.mockResolvedValue({ rows: [] });

    await pushFactToNotion({
      id: 55,
      category: 'other',
      content: '姓名:魏嫦娥 分类:同事,朋友 职业:设计师',
      key: null,
      source: 'import',
      created_at: new Date('2026-01-01'),
    });

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.parent.database_id).toBe(NOTION_MEMORY_DB_IDS.contacts);
    expect(body.properties['姓名'].title[0].text.content).toBe('魏嫦娥');
    // 分类应该是 multi_select
    expect(body.properties['分类'].multi_select).toHaveLength(2);
    expect(body.properties['分类'].multi_select[0].name).toBe('同事');
    // 职业应该是 rich_text
    expect(body.properties['职业'].rich_text[0].text.content).toBe('设计师');

    delete process.env.NOTION_API_KEY;
  });
});

describe('pushMemoryToNotion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('有 NOTION_API_KEY 时，推送到 diary DB，包含 checkbox/status/page body', async () => {
    process.env.NOTION_API_KEY = 'test-key';
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'diary-page-001' }),
    });
    mockPool.query.mockResolvedValue({ rows: [] });

    const fullText = '今天 Cecelia 完成了一项重要任务：Notion Memory 同步功能上线了！';
    await pushMemoryToNotion({
      id: 200,
      source_type: 'episodic',
      content: fullText,
      importance: 8,
      status: 'active',
      resolved_at: null,
      created_at: new Date('2026-03-03'),
    });

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.parent.database_id).toBe(NOTION_MEMORY_DB_IDS.diary);
    expect(body.properties['摘要'].title[0].text.content).toBe(fullText.slice(0, 80));
    expect(body.properties['类型'].select.name).toBe('episodic');
    expect(body.properties['重要性'].number).toBe(8);
    // 新增字段
    expect(body.properties['已处理'].checkbox).toBe(false);
    expect(body.properties['状态'].status.name).toBe('active');
    // page body
    expect(body.children).toHaveLength(1);
    expect(body.children[0].paragraph.rich_text[0].text.content).toContain('Notion Memory');

    expect(mockPool.query).toHaveBeenCalledWith(
      'UPDATE memory_stream SET notion_id=$1 WHERE id=$2',
      ['diary-page-001', 200]
    );

    delete process.env.NOTION_API_KEY;
  });

  it('resolved_at 有值时，已处理=true', async () => {
    process.env.NOTION_API_KEY = 'test-key';
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'diary-page-002' }),
    });
    mockPool.query.mockResolvedValue({ rows: [] });

    await pushMemoryToNotion({
      id: 201,
      source_type: 'episodic',
      content: '已处理的记忆',
      importance: 5,
      status: 'resolved',
      resolved_at: new Date('2026-03-01'),
      created_at: new Date(),
    });

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.properties['已处理'].checkbox).toBe(true);
    expect(body.properties['状态'].status.name).toBe('resolved');

    delete process.env.NOTION_API_KEY;
  });

  it('无效 source_type 降级为 episodic', async () => {
    process.env.NOTION_API_KEY = 'test-key';
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'diary-page-003' }),
    });
    mockPool.query.mockResolvedValue({ rows: [] });

    await pushMemoryToNotion({
      id: 202,
      source_type: 'unknown_type',
      content: '测试',
      importance: 0,
      created_at: new Date(),
    });

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.properties['类型'].select.name).toBe('episodic');

    delete process.env.NOTION_API_KEY;
  });

  it('长文本超 2000 字时拆分为多个 paragraph block', async () => {
    process.env.NOTION_API_KEY = 'test-key';
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'diary-page-004' }),
    });
    mockPool.query.mockResolvedValue({ rows: [] });

    const longText = 'A'.repeat(4500);
    await pushMemoryToNotion({
      id: 203,
      source_type: 'episodic',
      content: longText,
      importance: 1,
      created_at: new Date(),
    });

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    // 4500 / 2000 = 3 blocks
    expect(body.children).toHaveLength(3);
    expect(body.children[0].paragraph.rich_text[0].text.content).toHaveLength(2000);
    expect(body.children[1].paragraph.rich_text[0].text.content).toHaveLength(2000);
    expect(body.children[2].paragraph.rich_text[0].text.content).toHaveLength(500);

    delete process.env.NOTION_API_KEY;
  });
});

describe('rebuildMemoryDatabases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NOTION_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.NOTION_API_KEY;
  });

  it('先 GET 获取 title 属性名，再 PATCH 添加缺失属性', async () => {
    // 每个 DB 的 GET 返回：title 属性叫 '名称'，没有其他属性
    const dbGetResponse = {
      properties: {
        '名称': { type: 'title', title: {} },
      },
    };
    // GET → dbGetResponse, PATCH → ok
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => dbGetResponse }) // GET ownerProfile
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'db-1' }) }) // PATCH ownerProfile
      .mockResolvedValueOnce({ ok: true, json: async () => dbGetResponse }) // GET contacts
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'db-2' }) }) // PATCH contacts
      .mockResolvedValueOnce({ ok: true, json: async () => dbGetResponse }) // GET diary
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'db-3' }) }); // PATCH diary

    const results = await rebuildMemoryDatabases();

    expect(results.ownerProfile).toBe('ok');
    expect(results.contacts).toBe('ok');
    expect(results.diary).toBe('ok');

    // 验证第 2 次调用（第 1 个 PATCH）包含正确的属性重命名和新属性
    const patchCall = mockFetch.mock.calls[1];
    const patchBody = JSON.parse(patchCall[1].body);
    // 旧 title 属性 '名称' 应被 rename 到 '键'
    expect(patchBody.properties['名称']).toEqual({ name: '键' });
    // 新属性应被添加
    expect(patchBody.properties['值']).toEqual({ rich_text: {} });
    expect(patchBody.properties['更新时间']).toEqual({ date: {} });
  });

  it('title 属性名已经是目标名时不 rename', async () => {
    // ownerProfile DB 的 title 已经叫 '键'，且所有属性（含已验证）都已存在
    const dbGetResponse = {
      properties: {
        '键':       { type: 'title', title: {} },
        '值':       { type: 'rich_text', rich_text: {} },
        '类别':     { type: 'select', select: {} },
        '来源':     { type: 'select', select: {} },
        '更新时间': { type: 'date', date: {} },
        '已验证':   { type: 'checkbox', checkbox: {} },
      },
    };
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => dbGetResponse }) // GET
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'db-1' }) }); // PATCH

    await rebuildMemoryDatabases().catch(() => {}); // 可能3个DB都需要mock

    // 第 2 次调用（第 1 个 PATCH）- properties 应为空对象（无需改动）
    const patchBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(patchBody.properties).toEqual({});
  });
});
