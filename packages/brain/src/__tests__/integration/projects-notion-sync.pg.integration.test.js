import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
import { runRelayProjection, PROJECTS_DB } from '../../notion-relay-projection.js';
import { humanProps, notionText } from '../../lib/project-notion-human.js';

// 仅真实本地 scratch / CI service；每次随机隔离 schema，绝不碰已有业务表。
const database = process.env.CI ? DB_DEFAULTS.database : 'cecelia_scratch';
const schema = `projects_sync_${randomUUID().replaceAll('-', '')}`;
const client = new pg.Client({ ...DB_DEFAULTS, database });
const pool = { connect: async () => ({ query: client.query.bind(client), release() {} }) };
const text = value => [{ type: 'text', text: { content: value } }];
const initialHuman = { status: 'In Progress', priority: null, remark: '', due: null, ai_tier: '知情' };
let notion;

function notionFixture() {
  const pages = new Map(), calls = [];
  let clock = Date.parse('2030-10-12T00:00:00Z');
  const currentTime = () => new Date(clock);
  const edit = (page, properties) => {
    Object.assign(page.properties, structuredClone(properties));
    page.last_edited_time = new Date(clock += 1000).toISOString();
  };
  const create = (properties, children = []) => {
    const page = { id: randomUUID(), properties: structuredClone(properties), parent: { database_id: PROJECTS_DB },
      children: children.map(b => ({ ...structuredClone(b), id: randomUUID() })), archived: false };
    edit(page, {}); pages.set(page.id, page); return page;
  };
  const request = vi.fn(async (_token, path, method = 'GET', body) => {
    calls.push({ path, method, body });
    if (path === `/databases/${PROJECTS_DB}` && method === 'GET') return { properties: {
      'AI 参与': { type: 'select' }, 'AI 进展': { type: 'rich_text' },
    } };
    if (path === `/databases/${PROJECTS_DB}/query`) {
      let selected = [...pages.values()].filter(p => !p.archived);
      if (body.filter?.property === 'Run ID') selected = selected.filter(p =>
        notionText(p.properties['Run ID']?.rich_text) === body.filter.rich_text.equals);
      if (body.filter?.timestamp === 'last_edited_time') selected = selected.filter(p =>
        p.last_edited_time >= body.filter.last_edited_time.on_or_after);
      selected.sort((a, b) => a.last_edited_time.localeCompare(b.last_edited_time));
      const start = Number(body.start_cursor || 0), size = Math.min(body.page_size, 7);
      const end = start + size;
      return structuredClone({ results: selected.slice(start, end), has_more: end < selected.length,
        next_cursor: end < selected.length ? String(end) : null });
    }
    if (path === '/pages' && method === 'POST') return structuredClone(create(body.properties, body.children));
    if (path.startsWith('/pages/')) {
      const page = pages.get(path.slice('/pages/'.length));
      if (!page) throw new Error('Notion 404');
      if (method === 'PATCH') edit(page, body.properties);
      return structuredClone(page);
    }
    const blocks = path.match(/^\/blocks\/([^/]+)\/children/);
    if (blocks) {
      const page = pages.get(blocks[1]);
      if (method === 'GET') return structuredClone({ results: page.children, has_more: false });
      page.children.push(...body.children.map(b => ({ ...structuredClone(b), id: randomUUID() })));
      edit(page, {}); return { results: [] };
    }
    if (path.startsWith('/blocks/') && method === 'DELETE') {
      for (const page of pages.values()) page.children = page.children.filter(b => b.id !== path.slice('/blocks/'.length));
      return {};
    }
    throw new Error(`未定义的 Notion 接缝 ${method} ${path}`);
  });
  return { pages, calls, request, create, edit, currentTime };
}

const sync = () => runRelayProjection(pool, { token: 'fake-token', notionReq: notion.request,
  now: notion.currentTime, log: { warn: vi.fn() } });
async function insertProject({ name = 'Brain 项目', status = 'active', remark = '', due = null } = {}) {
  return (await client.query(`INSERT INTO projects(name,status,custom_props,end_date)
    VALUES($1,$2,$3::jsonb,$4) RETURNING *`, [name, status, JSON.stringify({ remark, retained: 1 }), due])).rows[0];
}
const readProject = async id => (await client.query('SELECT *, end_date::text AS due_text FROM projects WHERE id=$1', [id])).rows[0];
const pageFor = id => [...notion.pages.values()].find(p => notionText(p.properties['Run ID']?.rich_text) === `brain:${id}`);

beforeAll(async () => {
  await client.connect();
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}"`);
  await client.query(`CREATE TABLE projects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
    description text, status text DEFAULT 'active', custom_props jsonb NOT NULL DEFAULT '{}', metadata jsonb,
    brief jsonb NOT NULL DEFAULT '{}', notion_props jsonb NOT NULL DEFAULT '{}', end_date date,
    created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
    CREATE TABLE tasks (id uuid PRIMARY KEY, project_id uuid, title text, status text, task_type text,
      sequence_no int, result jsonb, created_at timestamptz, completed_at timestamptz);
    CREATE TABLE decisions (id uuid PRIMARY KEY, status text, trigger text, context jsonb, created_at timestamptz,
      topic text, decision text, priority text, reason text, notion_id text, notion_synced_at timestamptz);
    CREATE TABLE ops_notion_ingest_cursor(db_key text PRIMARY KEY,last_seen timestamptz,updated_at timestamptz);
    CREATE TABLE schema_version(version text PRIMARY KEY,description text);`);
  await client.query(readFileSync(new URL('../../../migrations/554_projects_ai_tier.sql', import.meta.url), 'utf8'));
});
beforeEach(async () => {
  await client.query('TRUNCATE projects, tasks, decisions, ops_notion_ingest_cursor');
  notion = notionFixture();
});
afterAll(async () => {
  await client.query('ROLLBACK');
  await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await client.end();
});

describe.sequential('Projects 双向同步：真实 PG 与有状态 Notion 接缝', () => {
  it('超过30行全量推送、两轮幂等、双改人赢、导入人工正文始终保留', async () => {
    const roots = [];
    for (let i = 0; i < 35; i++) roots.push(await insertProject({ name: `项目 ${i}`, status: i === 34 ? 'archived' : 'active' }));
    const human = notion.create({ Name: { title: text('人建的项目') }, 'Run ID': { rich_text: [] }, Archive: { checkbox: false },
      ...humanProps({ ...initialHuman, remark: '手写备注', ai_tier: '盯着' }) },
    [{ type: 'paragraph', paragraph: { rich_text: text('人工正文绝不能被机器替换') } }]);
    const originalBody = structuredClone(human.children);
    const first = await sync();
    expect(first.ok).toBe(true); expect(first.projects.pushed).toBe(36); expect(first.pulled.imported).toBe(1);
    expect(notion.pages.size).toBe(36);
    expect(pageFor(roots[34].id).properties.Status.status.name).toBe('Discard');
    expect(human.children).toEqual(originalBody);
    expect((await client.query('SELECT count(*)::int AS count FROM projects')).rows[0].count).toBe(36);
    const second = await sync();
    expect(second.ok).toBe(true); expect(second.projects.pushed).toBe(0); expect(second.pulled.imported).toBe(0);
    expect(notion.pages.size).toBe(36); expect(human.children).toEqual(originalBody);
    await client.query("UPDATE projects SET status='paused',ai_tier='介入',custom_props=custom_props || '{\"remark\":\"机器改动\"}' WHERE id=$1", [roots[0].id]);
    notion.edit(pageFor(roots[0].id), humanProps({ ...initialHuman, status: 'Completed', remark: '人工拍板', ai_tier: '盯着' }));
    expect((await sync()).ok).toBe(true);
    const merged = await readProject(roots[0].id);
    expect(merged).toMatchObject({ status: 'completed', ai_tier: '盯着', custom_props: { retained: 1, remark: '人工拍板' } });
    expect(merged.metadata.notion_overrides.map(o => o.field)).toEqual(expect.arrayContaining(['status', 'remark', 'ai_tier']));
    expect(human.children).toEqual(originalBody);
  });

  it('长人工备注完整往返，不把机器截断误认成人工覆盖', async () => {
    const remark = '完整备注'.repeat(700), root = await insertProject({ remark });
    expect((await sync()).ok).toBe(true);
    expect(notionText(pageFor(root.id).properties.Remark.rich_text)).toBe(remark);
    expect((await sync()).ok).toBe(true);
    expect((await readProject(root.id)).custom_props.remark).toBe(remark);
  });

  it('远端建页成功、本地记账失败后，待推回声不得覆盖较新的 Brain 值且不重复建页', async () => {
    const root = await insertProject({ remark: '初次推送' });
    let failedOnce = false;
    const faultPool = { connect: async () => ({ release() {}, query: async (sql, args) => {
      if (!failedOnce && sql.includes("jsonb_build_object('human_baseline'")) {
        failedOnce = true;
        throw new Error('模拟远端写入后数据库记账失败');
      }
      return client.query(sql, args);
    } }) };
    const failed = await runRelayProjection(faultPool, { token: 'fake-token', notionReq: notion.request,
      now: notion.currentTime, log: { warn: vi.fn() } });
    expect(failed.ok).toBe(false); expect(failed.projects.failed).toBe(1);
    expect(notion.pages.size).toBe(1);
    expect((await readProject(root.id)).notion_props.pending_human_push.remark).toBe('初次推送');
    await client.query("UPDATE projects SET ai_tier='介入',custom_props=custom_props || '{\"remark\":\"较新的API更新\"}' WHERE id=$1", [root.id]);
    expect((await sync()).ok).toBe(true);
    expect(notion.pages.size).toBe(1);
    const recovered = await readProject(root.id);
    expect(recovered).toMatchObject({ ai_tier: '介入', custom_props: { remark: '较新的API更新' } });
    expect(recovered.notion_props.pending_human_push).toBeUndefined();
    expect(notionText(pageFor(root.id).properties.Remark.rich_text)).toBe('较新的API更新');
    expect((await sync()).ok).toBe(true);
    expect((await readProject(root.id)).custom_props.remark).toBe('较新的API更新');
  });

  it.each(['UTC', 'Asia/Shanghai'])('DATE 在进程时区 %s 下两轮同步不变成前一天', async timezone => {
    const prior = process.env.TZ;
    process.env.TZ = timezone;
    try {
      const root = await insertProject({ due: '2030-10-20' });
      expect((await sync()).ok).toBe(true);
      expect(pageFor(root.id).properties['Due Date'].date.start).toBe('2030-10-20');
      expect((await sync()).ok).toBe(true);
      expect((await readProject(root.id)).due_text).toBe('2030-10-20');
    } finally {
      if (prior === undefined) delete process.env.TZ;
      else process.env.TZ = prior;
    }
  });
});
