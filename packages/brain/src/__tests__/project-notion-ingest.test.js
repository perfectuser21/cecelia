import { describe, expect, it, vi } from 'vitest';

const api = await import('../project-notion-ingest.js').catch(() => ({}));
const ID = '11111111-1111-4111-8111-111111111111';
const PAGE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const text = value => [{ type: 'text', text: { content: value }, plain_text: value }];
function page({ id = PAGE, run = '', name = '人工项目', archive = false, status = 'In Progress' } = {}) {
  return { id, last_edited_time: '2026-10-12T02:00:00.000Z', properties: {
    Name: { title: text(name) }, 'Run ID': { rich_text: text(run) }, Archive: { checkbox: archive },
    Status: { status: { name: status } }, Priority: { select: { name: 'High' } },
    Remark: { rich_text: text('人工备注') }, 'Due Date': { date: { start: '2026-10-20' } },
    'AI 参与': { select: { name: '盯着' } },
  } };
}
const baseline = { status: 'In Progress', priority: 'High', remark: '人工备注', due: '2026-10-20', ai_tier: '盯着' };
function root(extra = {}) {
  return { id: ID, name: '人工项目', status: 'in_progress', custom_props: { priority: 'High', remark: '人工备注', unrelated: 7 },
    end_date: '2026-10-20', ai_tier: '盯着', metadata: { retained: true },
    notion_props: { notion_id: PAGE, project_db: 'db', human_baseline: baseline }, ...extra };
}

// Stateful DB double: an INSERT committed before a failed remote write survives the next attempt.
function database(initial = [], cursor = null) {
  const rows = structuredClone(initial), calls = [];
  let checkpoint;
  const client = { query: vi.fn(async (sql, args = []) => {
    calls.push({ sql, args });
    if (sql === 'BEGIN') { checkpoint = structuredClone(rows); return { rows: [] }; }
    if (sql === 'ROLLBACK') { rows.splice(0, rows.length, ...checkpoint); return { rows: [] }; }
    if (sql === 'COMMIT') return { rows: [] };
    if (/SELECT last_seen/.test(sql)) return { rows: cursor ? [{ last_seen: cursor }] : [] };
    if (/SELECT .*FROM projects/s.test(sql)) {
      return { rows: rows.filter(r => sql.includes("notion_props->>'notion_id'") ? r.notion_props.notion_id === args[0] : r.id === args[0]) };
    }
    if (/INSERT INTO projects/.test(sql)) {
      const [name, status, custom, due, tier, props] = args;
      const added = root({ name, status, custom_props: JSON.parse(custom), end_date: due, ai_tier: tier,
        metadata: { source: 'notion' }, notion_props: JSON.parse(props) });
      rows.push(added); return { rows: [added], rowCount: 1 };
    }
    if (/UPDATE projects/.test(sql)) {
      const [id, status, custom, due, tier, metadata, props] = args;
      const found = rows.find(r => r.id === id);
      Object.assign(found, { status, custom_props: JSON.parse(custom), end_date: due, ai_tier: tier,
        metadata: JSON.parse(metadata), notion_props: JSON.parse(props) });
      return { rows: [found], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  }) };
  return { client, rows, calls };
}
const deps = notionReq => ({ notionReq, dbId: 'db', log: { warn: vi.fn() }, now: new Date('2026-10-12T03:00:00.000Z') });

describe('Projects Notion 导入接缝', () => {
  it('人建页保留人工备注并回填身份，不读写正文', async () => {
    const f = database(), req = vi.fn(async () => ({}));
    const result = await api.ingestProjectPage(f.client, 'token', page(), deps(req));
    expect(result).toMatchObject({ name: '人工项目', status: 'in_progress', ai_tier: '盯着', metadata: { source: 'notion' } });
    expect(f.rows[0].custom_props.remark).toBe('人工备注');
    expect(f.rows[0].notion_props.human_baseline).toEqual(baseline);
    expect(req).toHaveBeenCalledWith('token', `/pages/${PAGE}`, 'PATCH', { properties: { 'Run ID': { rich_text: [{ type: 'text', text: { content: `brain:${ID}` } }] } } });
    expect(req.mock.calls.every(([, path]) => !path.includes('/blocks/'))).toBe(true);
  });

  it('INSERT 后回填失败，重试仍只有一条记录且补回填 Run ID', async () => {
    const f = database(), req = vi.fn().mockRejectedValueOnce(new Error('Notion 503')).mockResolvedValue({});
    await expect(api.ingestProjectPage(f.client, 'token', page(), deps(req))).rejects.toThrow('503');
    expect(f.rows).toHaveLength(1);
    await api.ingestProjectPage(f.client, 'token', page(), deps(req));
    expect(f.rows).toHaveLength(1);
    expect(req).toHaveBeenCalledTimes(2);
    expect(f.calls.filter(c => /INSERT INTO projects/.test(c.sql))).toHaveLength(1);
  });

  it.each([{ archive: true }, { run: 'external:other' }, { name: '' }])('不接收归档、陌生身份或空标题页 %j', async options => {
    const f = database(), req = vi.fn();
    if (options.name === '') await expect(api.ingestProjectPage(f.client, 'token', page(options), deps(req))).rejects.toThrow();
    else expect(await api.ingestProjectPage(f.client, 'token', page(options), deps(req))).toBeNull();
    expect(f.rows).toHaveLength(0); expect(req).not.toHaveBeenCalled();
  });

  it('Run ID 不允许劫持已关联其他页面的项目', async () => {
    const f = database([root({ notion_props: { notion_id: 'another-page', human_baseline: baseline } })]);
    const req = vi.fn();
    await expect(api.ingestProjectPage(f.client, 'token', page({ run: `brain:${ID}` }), deps(req))).rejects.toThrow();
    expect(f.rows[0].notion_props.notion_id).toBe('another-page');
    expect(req).not.toHaveBeenCalled();
  });

  it('已勾 Archive 的历史副本即使复用 Run ID 也跳过，不阻断正常项目回灌', async () => {
    const f = database([root({ notion_props: { notion_id: 'another-page', human_baseline: baseline } })]);
    const req = vi.fn();
    expect(await api.ingestProjectPage(f.client, 'token', page({ run: `brain:${ID}`, archive: true }), deps(req))).toBeNull();
    expect(f.rows[0].notion_props.notion_id).toBe('another-page');
    expect(req).not.toHaveBeenCalled();
  });

  it('仅初始化基线不刷新项目业务活动时间', async () => {
    const f = database([root({ notion_props: { notion_id: PAGE, project_db: 'db' } })]);
    await api.ingestProjectPage(f.client, 'token', page({ run: `brain:${ID}` }), deps(vi.fn()));
    const update = f.calls.find(c => /UPDATE projects/.test(c.sql));
    expect(update).toBeDefined();
    expect(update.sql).not.toContain('updated_at = NOW()');
    expect(f.rows[0].notion_props.human_baseline).toEqual(baseline);
  });

  it('已关联页即使勾 Archive，人工变更仍回写并保留其他字段', async () => {
    const old = Array.from({ length: 20 }, (_, i) => ({ field: 'old', at: `${i}` }));
    const f = database([root({ status: 'paused', metadata: { retained: true, notion_overrides: old } })]);
    await api.ingestProjectPage(f.client, 'token', page({ run: `brain:${ID}`, archive: true, status: 'Completed' }), deps(vi.fn()));
    expect(f.rows[0]).toMatchObject({ status: 'completed', custom_props: { unrelated: 7 }, metadata: { retained: true } });
    expect(f.rows[0].metadata.notion_overrides).toHaveLength(20);
    expect(f.rows[0].metadata.notion_overrides.at(-1)).toMatchObject({ field: 'status' });
    expect(f.calls.some(c => /FOR UPDATE/.test(c.sql))).toBe(true);
    expect(f.calls.find(c => /UPDATE projects/.test(c.sql)).sql).toContain('updated_at = NOW()');
  });
});

describe('Projects 增量游标与分页', () => {
  it('完成所有分页后推进到轮次开始时间，过滤保留两分钟重叠', async () => {
    const f = database([], '2026-10-12T02:00:00.000Z');
    const req = vi.fn().mockResolvedValueOnce({ results: [page({ run: 'external:skip' })], has_more: true, next_cursor: 'next' })
      .mockResolvedValueOnce({ results: [], has_more: false });
    const result = await api.pullProjects(f.client, 'token', deps(req));
    expect(result).toEqual({ read: 1, imported: 0, updated: 0, failed: 0 });
    expect(req.mock.calls[0][3].filter.last_edited_time.on_or_after).toBe('2026-10-12T01:58:00.000Z');
    expect(req.mock.calls[1][3].start_cursor).toBe('next');
    const cursor = f.calls.find(c => /INSERT INTO ops_notion_ingest_cursor/.test(c.sql));
    expect(cursor.args).toContain('2026-10-12T03:00:00.000Z');
  });

  it('第二页查询失败不推进游标，返回失败供调度入口阻止推送', async () => {
    const f = database();
    const req = vi.fn().mockResolvedValueOnce({ results: [], has_more: true, next_cursor: 'next' }).mockRejectedValueOnce(new Error('503'));
    expect(await api.pullProjects(f.client, 'token', deps(req))).toMatchObject({ failed: 1 });
    expect(f.calls.some(c => /INSERT INTO ops_notion_ingest_cursor/.test(c.sql))).toBe(false);
  });

  it('单页导入失败不推进游标，重放成功后回填且不重复导入', async () => {
    const f = database(); let fail = true;
    const req = vi.fn(async (_token, path) => {
      if (path.includes('/query')) return { results: [page()], has_more: false };
      if (fail) throw new Error('503'); return {};
    });
    expect(await api.pullProjects(f.client, 'token', deps(req))).toMatchObject({ failed: 1 });
    expect(f.calls.some(c => /INSERT INTO ops_notion_ingest_cursor/.test(c.sql))).toBe(false);
    fail = false;
    expect(await api.pullProjects(f.client, 'token', deps(req))).toMatchObject({ failed: 0, imported: 0 });
    expect(f.rows).toHaveLength(1);
  });
});
