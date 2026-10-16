import { describe, it, expect, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { projectCustomerChildren } from './notion-children.js';

const id = n => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const fields = { data_source_id: id(3), id: 'Brain记录ID', title: '客户名称', customer_relation: '对应客户' };
const binding = { id: id(1), tenant_id: id(2), data_source_id: id(4), fields: { messages: fields, reports: { ...fields, data_source_id: id(5) } } };
const customer = { id: id(6), binding_id: binding.id, tenant_id: binding.tenant_id, source_page_id: id(7), display_name: '张总' };
const message = { id: id(8), tenant_id: binding.tenant_id, customer_id: customer.id, account_id: 'wx-self', message_id: 'native-1', direction: 'inbound', text: '原文：预算5000', occurred_at: '2026-10-16T01:00:00Z', time_precision: 'exact', projection_pending: true };
const report = { id: id(9), tenant_id: binding.tenant_id, customer_id: customer.id, type: 'daily', period_start: '2026-10-16', period_end: '2026-10-16', version: 1, markdown: '今天确认预算', message_ids: [message.id], projection_pending: true };
const schema = config => ({ id: config.data_source_id, properties: { Brain记录ID: { type: 'rich_text' }, 客户名称: { type: 'title' }, 对应客户: { type: 'relation', relation: { data_source_id: binding.data_source_id } } } });
const page = (record, config, pageId = id(20)) => ({ id: pageId, parent: { data_source_id: config.data_source_id }, properties: { Brain记录ID: { type: 'rich_text', rich_text: [{ plain_text: record.id }] }, 客户名称: { type: 'title', title: [{ plain_text: 'title' }] }, 对应客户: { type: 'relation', relation: [{ id: customer.source_page_id }], has_more: false } } });
function setup() {
  const pages = new Map(); let nextId = 20;
  const store = { listCustomerMessages: vi.fn(async () => [message]), listCustomerReports: vi.fn(async () => [report]), markMessageProjected: vi.fn(async () => true), markReportProjected: vi.fn(async () => true) };
  const request = vi.fn(async (path, method = 'GET', body) => {
    const config = path.includes(id(5)) ? binding.fields.reports : fields;
    if (path.startsWith('/data_sources/') && method === 'GET') return schema(config);
    if (path.endsWith('/query')) return { results: [...pages.values()].filter(p => p.parent.data_source_id === config.data_source_id && (p.properties.Brain记录ID.rich_text[0].plain_text ?? p.properties.Brain记录ID.rich_text[0].text?.content) === body.filter.rich_text.equals), has_more: false };
    if (path === '/pages' && method === 'POST') {
      const recordId = body.properties.Brain记录ID.rich_text[0].text.content;
      const record = recordId === message.id ? message : report;
      const p = page(record, record === message ? fields : binding.fields.reports, id(nextId++));
      for (const [key, value] of Object.entries(body.properties)) {
        const type = Object.keys(value)[0]; p.properties[key] = { type, ...value };
      }
      pages.set(p.id, p); return p;
    }
    if (path.startsWith('/pages/') && method === 'PATCH') {
      const p = pages.get(path.split('/')[2]);
      for (const [key, value] of Object.entries(body.properties)) p.properties[key] = { type: Object.keys(value)[0], ...value };
      return p;
    }
    if (path.startsWith('/pages/')) return pages.get(path.split('/')[2]);
    throw Error('unexpected request');
  });
  return { store, request, pages };
}
describe('CRM原文与报告只写已登记库', () => {
  it('先消息后日报，只创建machine属性和正文，读回后才mark', async () => {
    const { store, request } = setup();
    expect(await projectCustomerChildren({}, store, request, binding, customer)).toEqual({ messages_projected: 1, reports_projected: 1, deferred: 0 });
    const creates = request.mock.calls.filter(c => c[0] === '/pages');
    expect(creates).toHaveLength(2);
    expect(creates[0][2].markdown).toContain('wx-self');
    expect(creates[0][2].markdown).toContain(message.text);
    expect(creates[0][2].markdown).toContain('方向：客户');
    expect(creates[0][2].markdown).toContain('<details>');
    expect(creates[1][2].markdown).toContain(report.markdown);
    expect(creates[1][2].properties.客户名称.title[0].text.content).toContain('日报');
    expect(creates[1][2].markdown).toContain('https://www.notion.so/');
    expect(store.markMessageProjected).toHaveBeenCalledWith({}, binding.tenant_id, message.id, id(20));
    expect(store.markReportProjected).toHaveBeenCalledWith({}, binding.tenant_id, report.id, id(21));
    expect(request.mock.calls.some(c => c[1] === 'PATCH')).toBe(false);
  });
  it('未配置不创建库或页面，按pending条数deferred', async () => {
    const { store, request } = setup();
    expect(await projectCustomerChildren({}, store, request, { ...binding, fields: {} }, customer)).toEqual({ messages_projected: 0, reports_projected: 0, deferred: 2 });
    expect(request).not.toHaveBeenCalled();
  });
  it('错误schema和关系目标零创建零mark', async () => {
    const { store, request } = setup();
    request.mockImplementation(async () => ({ ...schema(fields), properties: { ...schema(fields).properties, 对应客户: { type: 'relation', relation: { data_source_id: id(99) } } } }));
    await expect(projectCustomerChildren({}, store, request, binding, customer)).rejects.toMatchObject({ code: 'invalid_schema' });
    expect(request.mock.calls.every(c => !c[1] || c[1] === 'GET')).toBe(true);
    expect(store.markMessageProjected).not.toHaveBeenCalled();
  });
  it('按稳定UUID查询发现重复页即拒绝', async () => {
    const { store, request } = setup();
    request.mockImplementation(async (path, method) => method === 'POST' ? { results: [page(message, fields), page(message, fields, id(21))], has_more: false } : schema(path.includes(id(5)) ? binding.fields.reports : fields));
    await expect(projectCustomerChildren({}, store, request, binding, customer)).rejects.toMatchObject({ code: 'duplicate_external_record' });
    expect(request.mock.calls.some(c => c[0] === '/pages')).toBe(false);
  });
  it('已有页关联其他客户或父库错误不得认领或覆盖', async () => {
    for (const wrong of ['customer', 'parent']) {
      const { store, request, pages } = setup();
      const p = page(message, fields);
      if (wrong === 'customer') p.properties.对应客户.relation = [{ id: id(99) }];
      else p.parent.data_source_id = id(99);
      pages.set(p.id, p);
      store.listCustomerMessages.mockResolvedValue([{ ...message, notion_page_id: p.id }]);
      await expect(projectCustomerChildren({}, store, request, binding, customer)).rejects.toMatchObject({ code: 'external_identity_conflict' });
      expect(store.markMessageProjected).not.toHaveBeenCalled();
      expect(request.mock.calls.some(c => ['POST', 'PATCH'].includes(c[1]) && c[0] === '/pages')).toBe(false);
    }
  });
  it('创建成功但确认丢失后重放找到原页，不重复create或更新正文', async () => {
    const { store, request } = setup();
    await projectCustomerChildren({}, store, request, binding, customer);
    request.mockClear();
    const result = await projectCustomerChildren({}, store, request, binding, customer);
    expect(result.messages_projected).toBe(1);
    expect(result.reports_projected).toBe(1);
    expect(request.mock.calls.some(c => c[0] === '/pages')).toBe(false);
  });
  it('asyncunknown不mark，报告等待原文页可核验', async () => {
    const { store, request } = setup();
    const normal = request.getMockImplementation();
    request.mockImplementation(async (path, method, body) => path === '/pages' ? { object: 'async_task', id: 'task-unknown' } : normal(path, method, body));
    const result = await projectCustomerChildren({}, store, request, binding, customer);
    expect(result).toEqual({ messages_projected: 0, reports_projected: 0, deferred: 2 });
    expect(store.markMessageProjected).not.toHaveBeenCalled();
    expect(store.markReportProjected).not.toHaveBeenCalled();
  });
  it('固定request报告async pending时同样保持deferred', async () => {
    const { store, request } = setup();
    const normal = request.getMockImplementation();
    request.mockImplementation(async (path, method, body) => {
      if (path === '/pages') throw Object.assign(Error('pending'), { code: 'notion_async_pending' });
      return normal(path, method, body);
    });
    expect((await projectCustomerChildren({}, store, request, binding, customer)).deferred).toBe(2);
    expect(store.markMessageProjected).not.toHaveBeenCalled();
  });
  it('Date格式周期转YYYY-MM-DD，标题不暴露英文类型', async () => {
    const { store, request } = setup();
    store.listCustomerReports.mockResolvedValue([{ ...report, period_start: pg.types.getTypeParser(1082)('2026-10-16'), period_end: pg.types.getTypeParser(1082)('2026-10-16') }]);
    await projectCustomerChildren({}, store, request, binding, customer);
    const body = request.mock.calls.filter(c => c[0] === '/pages')[1][2];
    expect(body.properties.客户名称.title[0].text.content).toContain('日报 2026-10-16');
    expect(body.markdown).toContain('2026-10-16 ～ 2026-10-16');
  });
  it.each(['Asia/Shanghai', 'Pacific/Kiritimati', 'UTC', 'America/Los_Angeles'])('真实PG DATE在%s保持日历周期，消息时间仍为时间点', tz => {
    const script = `
      import pg from 'pg';
      import { projectCustomerChildren } from ${JSON.stringify(new URL('./notion-children.js', import.meta.url).href)};
      const binding = ${JSON.stringify(binding)}, customer = ${JSON.stringify(customer)};
      const message = ${JSON.stringify(message)}, report = ${JSON.stringify(report)};
      const parse = pg.types.getTypeParser(1082), output = [];
      const config = binding.fields.reports;
      Object.assign(config, { period_start: '周期开始', period_end: '周期结束' });
      for (const date of ['2026-10-16', '2026-01-01', '2026-03-01', '2024-02-29', '2026-03-08', '2026-11-01']) {
        const pages = new Map(), bodies = [];
        const request = async (path, method, body) => {
          if (path.startsWith('/data_sources/') && !method) {
            const cfg = path.includes(config.data_source_id) ? config : binding.fields.messages;
            return { id: cfg.data_source_id, properties: {
              Brain记录ID: { type: 'rich_text' }, 客户名称: { type: 'title' },
              对应客户: { type: 'relation', relation: { data_source_id: binding.data_source_id } },
              周期开始: { type: 'date' }, 周期结束: { type: 'date' },
            } };
          }
          if (path.endsWith('/query')) return { results: [], has_more: false };
          if (path === '/pages' && method === 'POST') {
            bodies.push(body);
            const id = bodies.length === 1 ? message.id : report.id;
            const properties = Object.fromEntries(Object.entries(body.properties).map(([key, value]) => [key, { type: Object.keys(value)[0], ...value }]));
            const page = { id, parent: body.parent, properties };
            pages.set(id, page); return page;
          }
          if (path.startsWith('/pages/')) return pages.get(path.split('/')[2]);
          throw Error('unexpected request');
        };
        const store = {
          listCustomerMessages: async () => [message],
          listCustomerReports: async () => [{ ...report, period_start: parse(date), period_end: parse(date) }],
          markMessageProjected: async () => true, markReportProjected: async () => true,
        };
        await projectCustomerChildren({}, store, request, binding, customer);
        output.push({ date, title: bodies[1].properties.客户名称.title[0].text.content,
          markdown: bodies[1].markdown, start: bodies[1].properties.周期开始.date.start,
          end: bodies[1].properties.周期结束.date.start, message: bodies[0].markdown });
      }
      process.stdout.write(JSON.stringify(output));
    `;
    const rows = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, TZ: tz }, encoding: 'utf8', timeout: 15000,
    }));
    for (const row of rows) {
      expect(row.title).toContain('日报 ' + row.date);
      expect(row.markdown).toContain(row.date + ' ～ ' + row.date);
      expect(row.start).toBe(row.date);
      expect(row.end).toBe(row.date);
      expect(row.message).toContain('2026-10-16T01:00:00.000Z');
    }
  });
  it('无效Date拒绝报告创建和回填', async () => {
    const { store, request } = setup();
    store.listCustomerMessages.mockResolvedValue([]);
    store.listCustomerReports.mockResolvedValue([{ ...report, message_ids: [], period_start: new Date(NaN) }]);
    await expect(projectCustomerChildren({}, store, request, binding, customer)).rejects.toMatchObject({ code: 'invalid_input' });
    expect(request.mock.calls.some(call => call[0] === '/pages')).toBe(false);
    expect(store.markReportProjected).not.toHaveBeenCalled();
  });
  it('服务端已创建但响应超时，重跑仅找回原页', async () => {
    const { store, request } = setup();
    const normal = request.getMockImplementation(); let timedOut = false;
    request.mockImplementation(async (path, method, body) => {
      const result = await normal(path, method, body);
      if (path === '/pages' && !timedOut) { timedOut = true; throw Object.assign(Error('timeout'), { code: 'ETIMEDOUT' }); }
      return result;
    });
    await expect(projectCustomerChildren({}, store, request, binding, customer)).rejects.toMatchObject({ code: 'ETIMEDOUT' });
    expect(store.markMessageProjected).not.toHaveBeenCalled();
    request.mockClear();
    expect((await projectCustomerChildren({}, store, request, binding, customer)).messages_projected).toBe(1);
    const creates = request.mock.calls.filter(c => c[0] === '/pages');
    expect(creates).toHaveLength(1);
    expect(creates[0][2].properties.Brain记录ID.rich_text[0].text.content).toBe(report.id);
  });
  it('报告类型周期与消息来源写入指定machine属性，日报view可筛选', async () => {
    const { store, request } = setup(), normal = request.getMockImplementation();
    const extended = { ...binding, fields: {
      messages: { ...fields, direction: '消息方向', source_account: '来源账号', native_id: '消息ID' },
      reports: { ...binding.fields.reports, report_type: '报告类型', period_start: '周期开始', period_end: '周期结束' },
    } };
    request.mockImplementation(async (path, method, body) => {
      const value = await normal(path, method, body);
      if (path.startsWith('/data_sources/') && !method) Object.assign(value.properties, path.includes(id(5)) ? { 报告类型: { type: 'select' }, 周期开始: { type: 'date' }, 周期结束: { type: 'date' } } : { 消息方向: { type: 'select' }, 来源账号: { type: 'rich_text' }, 消息ID: { type: 'rich_text' } });
      return value;
    });
    await projectCustomerChildren({}, store, request, extended, customer);
    const creates = request.mock.calls.filter(c => c[0] === '/pages');
    expect(creates[0][2].properties.消息方向).toEqual({ select: { name: '客户' } });
    expect(creates[0][2].properties.来源账号.rich_text[0].text.content).toBe('wx-self');
    expect(creates[1][2].properties.报告类型).toEqual({ select: { name: '日报' } });
    expect(creates[1][2].properties.周期开始).toEqual({ date: { start: '2026-10-16' } });
    expect(creates[1][2].properties.周期结束).toEqual({ date: { start: '2026-10-16' } });
  });
  it('同UUID旧报告只补指定machine属性，不改正文和人工属性', async () => {
    const { store, request, pages } = setup(), normal = request.getMockImplementation();
    const extended = { ...binding, fields: { reports: { ...binding.fields.reports, report_type: '报告类型' } } };
    const p = page(report, binding.fields.reports, id(30));
    p.properties.人工备注 = { type: 'rich_text', rich_text: [{ plain_text: '人工保留' }] };
    pages.set(p.id, p);
    store.listCustomerMessages.mockResolvedValue([]);
    store.listCustomerReports.mockResolvedValue([{ ...report, message_ids: [], notion_page_id: p.id, projection_pending: false }]);
    request.mockImplementation(async (path, method, body) => {
      const value = await normal(path, method, body);
      if (path.startsWith('/data_sources/') && !method) value.properties.报告类型 = { type: 'select' };
      return value;
    });
    await projectCustomerChildren({}, store, request, extended, customer);
    const patches = request.mock.calls.filter(c => c[1] === 'PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0]).toEqual([`/pages/${p.id}`, 'PATCH', { properties: { 报告类型: { select: { name: '日报' } } } }]);
    expect(p.properties.人工备注.rich_text[0].plain_text).toBe('人工保留');
    expect(request.mock.calls.some(c => c[0] === '/pages')).toBe(false);
    expect(store.markReportProjected).toHaveBeenCalledWith({}, binding.tenant_id, report.id, p.id);
  });
  it('可选machine属性类型不符零写入', async () => {
    const { store, request } = setup(), normal = request.getMockImplementation();
    const extended = { ...binding, fields: { reports: { ...binding.fields.reports, report_type: '报告类型' } } };
    request.mockImplementation(async (path, method, body) => {
      const value = await normal(path, method, body);
      if (path.startsWith('/data_sources/') && !method) value.properties.报告类型 = { type: 'rich_text' };
      return value;
    });
    await expect(projectCustomerChildren({}, store, request, extended, customer)).rejects.toMatchObject({ code: 'invalid_schema' });
    expect(request.mock.calls.some(c => ['POST', 'PATCH'].includes(c[1]))).toBe(false);
  });
  it('补属性后读回仍不符则不得mark，GET返回别的页面也零PATCH', async () => {
    for (const wrongPage of [false, true]) {
      const { store, request, pages } = setup(), normal = request.getMockImplementation();
      const extended = { ...binding, fields: { reports: { ...binding.fields.reports, report_type: '报告类型' } } };
      const p = page(report, binding.fields.reports, id(30)); pages.set(p.id, p);
      store.listCustomerMessages.mockResolvedValue([]);
      store.listCustomerReports.mockResolvedValue([{ ...report, message_ids: [], notion_page_id: p.id }]);
      request.mockImplementation(async (path, method, body) => {
        if (method === 'PATCH') return p;
        const value = await normal(path, method, body);
        if (path.startsWith('/data_sources/') && !method) value.properties.报告类型 = { type: 'select' };
        if (wrongPage && path.startsWith('/pages/')) return { ...value, id: id(99) };
        return value;
      });
      await expect(projectCustomerChildren({}, store, request, extended, customer)).rejects.toMatchObject({ code: wrongPage ? 'external_identity_conflict' : 'projection_readback_mismatch' });
      expect(store.markReportProjected).not.toHaveBeenCalled();
      if (wrongPage) expect(request.mock.calls.some(c => c[1] === 'PATCH')).toBe(false);
    }
  });
});
