import { describe, it, expect, vi, beforeEach } from 'vitest';

const DB = '11111111-1111-4111-8111-111111111111';
const KR = { id: '22222222-2222-4222-8222-222222222222', title: '管家闭环', status: 'active',
  progress: 25, current_value: '2', target_value: '8', unit: '条',
  metadata: { progress_source: 'projects_v1' }, updated_at: '2026-10-01T00:00:00Z' };
const requests = vi.fn();
const schema = () => ({ title: [{ plain_text: 'Brain Key Results' }], properties: Object.fromEntries(Object.entries({Name:'title','Brain ID':'rich_text',Status:'select',Progress:'number',Current:'number',Target:'number',Unit:'rich_text',Source:'rich_text','Brain Updated At':'date'}).map(([name,type]) => [name,{type}])) });
const makePool = ({ registered = true, dbId = DB, rows = [KR], link = null } = {}) => ({
  query: vi.fn(async (sql) => {
    if (sql.includes('FROM notion_projection_map')) return { rows: registered ? [{ notion_db_id: dbId }] : [] };
    if (sql.includes('FROM key_results')) return { rows: rows.map(row => ({ ...row, external_id: link?.external_id, content_hash: link?.content_hash })) };
    return { rows: [] };
  }),
});

beforeEach(() => {
  requests.mockReset();
  requests.mockImplementation(async (_token, path, method) => {
    if (path.includes('/query')) return { results: [] };
    if (path === '/pages/page-new' && method === 'GET') return { parent: { database_id: DB }, properties: { 'Brain ID': { rich_text: [{ plain_text: KR.id }] } } };
    if (path.includes('/databases/') && method === 'GET') return schema();
    if (method === 'POST') return { id: 'page-new' };
    return {};
  });
});
const api = () => import('../key-results.js');
const deps = () => ({ token: 'test-token', notionReq: requests, now: Date.parse('2026-10-01T03:00:00Z') });

describe('Brain KR 独立投影', () => {
  it('登记前零远程请求，缺凭据也零写', async () => {
    const { runNotionKrProjection } = await api();
    expect(await runNotionKrProjection(makePool({ registered: false }), deps())).toMatchObject({ skipped: true, reason: 'not_registered' });
    expect(await runNotionKrProjection(makePool(), { ...deps(), token: null })).toMatchObject({ skipped: true, reason: 'not_configured' });
    expect(requests).not.toHaveBeenCalled();
  });
  it('拒绝公司KR库，不用编号把经营条数覆盖为系统百分比', async () => {
    const { runNotionKrProjection } = await api();
    await expect(runNotionKrProjection(makePool({ dbId: '684c40c2ba6383a7b6ba8161f110a18c' }), deps())).rejects.toThrow('公司 KR');
    expect(requests).not.toHaveBeenCalled();
  });
  it('Current/Target/Progress分别投影，NaN与null诚实清空，注明来源和更新时间', async () => {
    const { buildNotionKrProperties } = await api();
    const props = buildNotionKrProperties({ ...KR, current_value: 'NaN', target_value: null });
    expect(props.Current.number).toBeNull();
    expect(props.Target.number).toBeNull();
    expect(props.Progress.number).toBe(25);
    expect(props.Source.rich_text[0].text.content).toBe('projects_v1');
    expect(props['Brain Updated At'].date.start).toBe('2026-10-01T00:00:00.000Z');
    expect(props.Unit.rich_text[0].text.content).toBe('条');
    expect(props['Brain ID'].rich_text[0].text.content).toBe(KR.id);
  });
  it('创建投影后只记projection_links，重复轮次按指纹不重写远程', async () => {
    const { runNotionKrProjection, buildNotionKrProperties, krProjectionDigest } = await api();
    const pool = makePool();
    expect(await runNotionKrProjection(pool, deps())).toMatchObject({ created: 1, failed: 0 });
    const post = requests.mock.calls.find(([, path, method]) => path === '/pages' && method === 'POST');
    expect(post[3].parent.database_id).toBe(DB);
    expect(post[3].properties.Current.number).toBe(2);
    expect(pool.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO projection_links'))).toBe(true);
    expect(pool.query.mock.calls.some(([sql]) => /UPDATE key_results/.test(sql))).toBe(false);
    requests.mockClear();
    const hash = krProjectionDigest(DB, buildNotionKrProperties(KR));
    expect(await runNotionKrProjection(makePool({ link: { external_id: 'page-new', content_hash: hash } }), { ...deps(), now: deps().now + 300001 })).toMatchObject({ skipped: 1 });
    expect(requests.mock.calls.every(([,path,method]) => method === 'GET')).toBe(true);
  });
  it('数据库回执丢失时按Brain ID查找远程原行，禁止重复创建', async () => {
    const { runNotionKrProjection } = await api();
    requests.mockImplementation(async (_token, path) => path.includes('/query') ? { results: [{ id: 'existing-page' }] } : path.includes('/databases/') ? schema() : {});
    expect(await runNotionKrProjection(makePool(), deps())).toMatchObject({ patched: 1 });
    expect(requests.mock.calls.some(([,path,method]) => path === '/pages' && method === 'POST')).toBe(false);
    expect(requests.mock.calls.some(([,path,method]) => path === '/pages/existing-page' && method === 'PATCH')).toBe(true);
  });
  it('部分推送失败向scheduler暴露失败，并保留已成功映射', async () => {
    const { runNotionKrProjection } = await api();
    requests.mockRejectedValue(new Error('Notion 429'));
    const pool = makePool();
    await expect(runNotionKrProjection(pool, deps())).rejects.toThrow('KR 投影失败');
    expect(pool.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO projection_links'))).toBe(false);
  });
  it('库名或列类型不符时零页面写；失败回执不会伪装成成功', async () => {
    const { runNotionKrProjection } = await api();
    requests.mockImplementation(async () => ({ ...schema(), title: [{ plain_text: 'Key Results' }] }));
    await expect(runNotionKrProjection(makePool(), deps())).rejects.toThrow('独立');
    expect(requests.mock.calls.some(([,path,method]) => path.startsWith('/pages') && ['PATCH','POST'].includes(method))).toBe(false);
  });
  it('旧链接错库时按当前独立库查回页面，不更新错误页面', async () => {
    const { runNotionKrProjection } = await api();
    requests.mockImplementation(async (_token, path, method) => {
      if (path === '/pages/wrong-page') return { parent: { database_id: 'company-db' }, properties: { 'Brain ID': { rich_text: [{ plain_text: KR.id }] } } };
      if (path.includes('/query')) return { results: [{ id: 'right-page' }] };
      if (path.includes('/databases/') && method === 'GET') return schema();
      return {};
    });
    expect(await runNotionKrProjection(makePool({ link: { external_id: 'wrong-page' } }), deps())).toMatchObject({ patched: 1 });
    expect(requests.mock.calls.some(([,path,method]) => path === '/pages/wrong-page' && method === 'PATCH')).toBe(false);
    expect(requests.mock.calls.some(([,path,method]) => path === '/pages/right-page' && method === 'PATCH')).toBe(true);
  });
  it('同Brain ID有多行时拒绝任选或创建，交由对账排错', async () => {
    const { runNotionKrProjection } = await api();
    requests.mockImplementation(async (_token, path) => path.includes('/query') ? { results: [{ id: 'a' }, { id: 'b' }] } : schema());
    await expect(runNotionKrProjection(makePool(), deps())).rejects.toThrow('重复投影');
    expect(requests.mock.calls.some(([,path,method]) => path.startsWith('/pages') && ['PATCH','POST'].includes(method))).toBe(false);
  });
  it('远程请求超过五分钟时禁止重入，scheduler超时不能创建并行投影', async () => {
    const { runNotionKrProjection } = await api();
    let release;
    const blocked = new Promise(resolve => { release = resolve; });
    requests.mockImplementation(async (_token, path, method) => path.includes('/databases/') && method === 'GET' ? blocked : path.includes('/query') ? { results: [] } : { id: 'slow-page' });
    const pool = makePool();
    const first = runNotionKrProjection(pool, deps());
    await vi.waitFor(() => expect(requests).toHaveBeenCalled());
    const repeated = runNotionKrProjection(pool, { ...deps(), now: deps().now + 600001 });
    release(schema());
    await expect(repeated).resolves.toMatchObject({ skipped: true, reason: 'in_flight' });
    await first.catch(() => {});
  });
  it('同一pool五分钟内自gate，其他pool不共用节流', async () => {
    const { runNotionKrProjection } = await api();
    const pool = makePool();
    await runNotionKrProjection(pool, deps());
    expect(await runNotionKrProjection(pool, { ...deps(), now: deps().now + 1000 })).toMatchObject({ skipped: true, reason: 'interval' });
    expect(await runNotionKrProjection(makePool(), deps())).toMatchObject({ created: 1 });
  });
});

describe('已同步KR页面消失后仍恢复', () => {
  for (const state of ['deleted', 'archived', 'moved']) {
    it(`指纹未变化但页面${state}时创建当前库投影`, async () => {
      const { runNotionKrProjection, buildNotionKrProperties, krProjectionDigest } = await api();
      requests.mockImplementation(async (_token, path, method) => {
        if (path === '/pages/old-page') {
          if (state === 'deleted') throw Object.assign(new Error('Notion 404'), { status: 404 });
          return { archived: state === 'archived', parent: { database_id: state === 'moved' ? 'other-db' : DB }, properties: { 'Brain ID': { rich_text: [{ plain_text: KR.id }] } } };
        }
        if (path.includes('/databases/') && method === 'GET') return schema();
        if (path.includes('/query')) return { results: [] };
        return { id: 'recovered-page' };
      });
      const pool = makePool({ link: { external_id: 'old-page', content_hash: krProjectionDigest(DB, buildNotionKrProperties(KR)) } });
      expect(await runNotionKrProjection(pool, deps())).toMatchObject({ created: 1, skipped: 0 });
    });
  }
});

describe('独立 KR 配置窄口', () => {
  it('UUID规范化及公司库拒绝发生在任何网络和数据库变更之前', async () => {
    const { configureKrProjection } = await api();
    const pool = { connect: vi.fn() };
    await expect(configureKrProjection(pool, 'not-a-uuid', deps())).rejects.toThrow('UUID');
    await expect(configureKrProjection(pool, '684c40c2ba6383a7b6ba8161f110a18c', deps())).rejects.toThrow('公司 KR');
    expect(pool.connect).not.toHaveBeenCalled();
    expect(requests).not.toHaveBeenCalled();
  });
  it('名称和schema断言失败不连接DB或改注册表', async () => {
    const { configureKrProjection } = await api();
    requests.mockResolvedValue({ ...schema(), title: [{ plain_text: '公司经营KR' }] });
    const pool = { connect: vi.fn() };
    await expect(configureKrProjection(pool, DB, deps())).rejects.toThrow('独立');
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it('目标已由其它table/vessel/face拥有时回滚，绝不停旧库或抢占目标', async () => {
    const { configureKrProjection } = await api();
    const query = vi.fn(async sql => sql.includes('SELECT') ? { rows: [{ notion_db_id: DB, brain_table: 'tasks', vessel: 'other', face: 'inlet' }] } : { rows: [] });
    const release = vi.fn();
    await expect(configureKrProjection({ connect: async () => ({ query, release }) }, DB, deps())).rejects.toThrow('归属');
    expect(query.mock.calls.some(([sql]) => /^(?:UPDATE|INSERT)/.test(sql.trim()))).toBe(false);
    expect(query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
    expect(release).toHaveBeenCalledOnce();
  });
});
