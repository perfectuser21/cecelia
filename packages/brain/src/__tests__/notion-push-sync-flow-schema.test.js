import { beforeEach, describe, expect, it, vi } from 'vitest';
const { query, request } = vi.hoisted(() => ({ query: vi.fn(), request: vi.fn() }));
vi.mock('../db.js', () => ({ default: { query } }));
vi.mock('../recurring-notion-sync.js', () => ({ notionReq: request, getToken: () => 'fake-token' }));
import { runNotionPushSync } from '../notion-push-sync.js';
import { buildStepLinkNotionProperties } from '../notion-probe-projection.js';
import { buildStepLinkDbProps } from '../ops-notion-schema.js';

describe('新增活动指标列未就绪时保留正确页面绑定', () => {
  let row;
  beforeEach(() => {
    query.mockReset(); request.mockReset();
    row = { id: 'activity-fixture', journey_name: '路径', step_id: 'activity',
      cell_level: 'activity', cell_kind: 'element', notion_id: 'correct-page', notion_digest: 'existing-digest' };
    query.mockImplementation(async sql => {
      const text = String(sql);
      if (text.includes('FROM journey_step_links l') && !text.includes('activity_flow_sweep')) return { rows: [row] };
      if (text.includes('UPDATE journey_step_links') && text.includes('notion_id = NULL')) {
        row.notion_id = null; row.notion_digest = null;
      }
      return { rows: [] };
    });
  });
  it.each(['read', 'add', 'type', 'malformed', 'read-array', 'read-string', 'unconfirmed', 'changed_type', 'missing-after-add'])('%s失败不向页面发未就绪属性，不解绑或标同步', async failure => {
    const schema = buildStepLinkDbProps();
    if (['add', 'unconfirmed', 'changed_type', 'missing-after-add'].includes(failure)) delete schema.FlowP50Ms;
    if (failure === 'type') schema.FlowP50Ms = { rich_text: {} };
    request.mockImplementation(async (_token, path, method, body) => {
      if (path.startsWith('/databases/') && method === 'GET') {
        if (failure === 'read') throw new Error('Notion 503 schema unavailable');
        if (failure === 'read-array') return { properties: [] };
        if (failure === 'read-string') return { properties: 'bad' };
        return failure === 'malformed' ? {} : { properties: schema };
      }
      if (path.startsWith('/databases/') && method === 'PATCH') {
        if (failure === 'unconfirmed' || failure === 'malformed') return {};
        if (failure === 'missing-after-add') return { properties: schema };
        if (failure === 'changed_type') return { properties: { ...schema, FlowP50Ms: { type: 'rich_text' } } };
        throw new Error('Notion 503 schema patch failed');
      }
      if (path.startsWith('/pages/') && method === 'PATCH' && 'FlowP50Ms' in body.properties) {
        throw new Error('Notion 400: FlowP50Ms is not a property that exists');
      }
      return {};
    });
    await runNotionPushSync({ query });
    expect(row).toMatchObject({ notion_id: 'correct-page', notion_digest: 'existing-digest' });
    expect(request.mock.calls.filter(([, path]) => path.startsWith('/pages'))).toEqual([]);
    expect(query.mock.calls.some(([sql]) => /UPDATE journey_step_links/.test(String(sql)))).toBe(false);
  });
  it.each(['step', 'enabler', 'legacy'])('%s行不追加活动指标属性', kind => {
    const props = buildStepLinkNotionProperties({ ...row,
      cell_level: kind === 'legacy' ? 'activity' : kind, cell_kind: kind === 'legacy' ? null : 'element' });
    expect(Object.keys(props).filter(key => key.startsWith('Flow'))).toEqual([]);
    expect(props.Name.title[0].text.content).toContain('路径');
  });
  it('补列后以远端真实schema继续推送，不覆盖已有列', async () => {
    const schema = buildStepLinkDbProps(); delete schema.FlowP50Ms;
    request.mockImplementation(async (_token, path, method) => {
      if (!path.startsWith('/databases/')) return {};
      return { properties: method === 'GET' ? schema : buildStepLinkDbProps() };
    });
    await runNotionPushSync({ query });
    const repair = request.mock.calls.find(([, path, method]) => path.startsWith('/databases/') && method === 'PATCH');
    expect(Object.keys(repair[3].properties)).toEqual(['FlowP50Ms']);
    expect(request.mock.calls.some(([, path]) => path === '/pages/correct-page')).toBe(true);
    expect(row.notion_id).toBe('correct-page');
  });
  it('活动七日过期继续显式清空，schema就绪后可真实推送', async () => {
    request.mockImplementation(async (_token, path, method) =>
      path.startsWith('/databases/') && method === 'GET' ? { properties: buildStepLinkDbProps() } : {});
    await runNotionPushSync({ query });
    const page = request.mock.calls.find(([, path, method]) => path === '/pages/correct-page' && method === 'PATCH');
    expect(page[3].properties.FlowP50Ms).toEqual({ number: null });
    expect(page[3].properties.FlowMetrics).toEqual({ rich_text: [] });
    expect(row.notion_id).toBe('correct-page');
  });
});
