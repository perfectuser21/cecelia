/**
 * skill-registry-projection（Skill 台账投影 PR1b，任务 47def5bb）：skill_registry → Notion Skill Registry。
 * 覆盖：逐列引导建列 / 删列不补建 / 改列类型跳过 / 人管列三方基线（人改不覆盖）/ 没变化不推 /
 *       建页前按标题查重认领 / 普通 400 退避不解绑 / 404 解绑重建 / 孤儿页只归档机器人建的。
 * 取代 notion-push-sync.pushSkillRegistry（其 insert-only 回归守卫迁到这里：内容变更必重推）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runSkillRegistryProjection, COLUMNS_KEY } from '../skill-registry-projection.js';
import { SKILL_REGISTRY_DB } from '../lib/skill-registry-notion-props.js';

const DB = SKILL_REGISTRY_DB;
const BOT = 'bot-user';

function fakeNotion() {
  const state = {
    db: {
      description: [{ plain_text: '🔒 只读镜子：由 Brain skill_registry 经 notion-push-sync 推送' }],
      properties: {
        Name: { id: 'title', name: 'Name', type: 'title' },
        Description: { id: 'desc', name: 'Description', type: 'rich_text' },
        Status: { id: 'stat', name: 'Status', type: 'select' },
        Source: { id: 'src', name: 'Source', type: 'select' },
      },
    },
    pages: new Map(), calls: [], seq: 0, failNext: null,
  };
  const norm = (props) => {
    const out = {};
    for (const [k, v] of Object.entries(props || {})) {
      const col = Object.values(state.db.properties).find((p) => p.name === k);
      const type = col?.type || Object.keys(v)[0];
      const val = v[type];
      out[k] = { type, [type]: Array.isArray(val) && (type === 'title' || type === 'rich_text')
        ? val.map((t) => ({ plain_text: t.text.content })) : val };
    }
    return out;
  };
  const req = async (_token, path, method = 'GET', body = null) => {
    state.calls.push({ path, method, body });
    if (state.failNext && method === 'PATCH' && path.startsWith('/pages/')) {
      const e = state.failNext; state.failNext = null; throw e;
    }
    if (path === `/databases/${DB}` && method === 'GET') return { id: DB, ...state.db };
    if (path === `/databases/${DB}` && method === 'PATCH') {
      for (const [name, def] of Object.entries(body.properties || {})) {
        state.db.properties[name] = { id: `col_${name}`, name, type: Object.keys(def)[0] };
      }
      if (body.description) state.db.description = body.description.map((t) => ({ plain_text: t.text.content }));
      return { id: DB, ...state.db };
    }
    if (path === `/databases/${DB}/query`) {
      const title = body?.filter?.title?.equals;
      const results = [...state.pages.values()].filter((p) => !p.archived
        && (title === undefined || p.properties.Name?.title?.[0]?.plain_text === title));
      return { results, has_more: false };
    }
    if (path === '/pages' && method === 'POST') {
      const id = `page-${++state.seq}`;
      const page = { id, created_by: { id: BOT }, created_time: new Date(Date.now() + state.seq).toISOString(), properties: norm(body.properties) };
      state.pages.set(id, page);
      return page;
    }
    if (path === '/users/me') return { id: BOT };
    const m = /^\/pages\/(.+)$/.exec(path);
    if (m) {
      const page = state.pages.get(m[1]);
      if (!page) { const e = new Error(`Notion ${method} ${path} → 404: not found`); e.status = 404; throw e; }
      if (method === 'PATCH') {
        if (body.archived) page.archived = true;
        Object.assign(page.properties, norm(body.properties));
      }
      return page;
    }
    throw new Error(`unexpected ${method} ${path}`);
  };
  return { state, req };
}

function fakePool(rows) {
  const wm = new Map();
  const q = async (sql, params = []) => {
    if (/pg_try_advisory_lock/.test(sql)) return { rows: [{ locked: true }] };
    if (/pg_advisory_unlock/.test(sql)) return { rows: [] };
    if (/SELECT value_json FROM working_memory/.test(sql)) return { rows: wm.has(params[0]) ? [{ value_json: wm.get(params[0]) }] : [] };
    if (/INSERT INTO working_memory/.test(sql)) { wm.set(params[0], JSON.parse(params[1])); return { rows: [] }; }
    if (/FROM skill_registry/.test(sql) && /^\s*SELECT/.test(sql)) return { rows: rows.map((r) => ({ ...r })) };
    const r = rows.find((x) => x.id === params[0]);
    if (/SET notion_id = \$2/.test(sql)) {
      Object.assign(r, { notion_id: params[1], notion_baseline: JSON.parse(params[2]), notion_push_attempts: 0, notion_next_retry_at: null });
      r.metadata = { ...(r.metadata || {}), pushed_digest: params[3] };
      return { rows: [] };
    }
    if (/SET notion_id = NULL/.test(sql)) {
      Object.assign(r, { notion_id: null, notion_baseline: {} });
      const { pushed_digest: _d, ...rest } = r.metadata || {};
      r.metadata = rest;
      return { rows: [] };
    }
    if (/notion_push_attempts = notion_push_attempts \+ 1/.test(sql)) {
      r.notion_push_attempts += 1; r.notion_next_retry_at = params[1];
      return { rows: [] };
    }
    if (/INSERT INTO notion_sync_log/.test(sql)) return { rows: [] };
    throw new Error(`unexpected sql: ${sql.slice(0, 80)}`);
  };
  const client = { query: q, release: () => {} };
  return { pool: { connect: async () => client, query: q }, wm };
}

const skill = (over = {}) => ({
  id: over.id || 'r1', name: 'nas', description: 'NAS 管理', location: 'claude-code', status: 'active', metadata: {},
  notion_id: null, platforms_installed: ['claude-code'], presence: 'present', last_seen_at: new Date('2026-09-30T00:00:00Z'),
  source_path: '/x/nas/SKILL.md', source_kind: 'repo', assigned_agents: [], drift_copies: 0, platforms_target: [],
  openclaw_tier: null, tier_suggested: 'A', business_line: null, category: '运维', note: null, notion_baseline: {},
  notion_push_attempts: 0, notion_next_retry_at: null, updated_at: new Date(), ...over,
});

const run = (pool, notion, extra = {}) => runSkillRegistryProjection(pool, { token: 't', notionReq: notion.req, force: true, botUserId: BOT, ...extra });
const pagePatches = (n) => n.state.calls.filter((c) => c.method === 'PATCH' && c.path.startsWith('/pages/') && !c.body.archived);

describe('runSkillRegistryProjection', () => {
  let notion;
  beforeEach(() => { notion = fakeNotion(); });

  it('无 token → 跳过，不碰 Notion', async () => {
    const { pool } = fakePool([skill()]);
    const r = await runSkillRegistryProjection(pool, { token: null, notionReq: notion.req, force: true });
    expect(r.skipped).toBe(true);
    expect(notion.state.calls).toEqual([]);
  });

  it('首轮：补建 13 个新列、认领 4 个原列、改掉「只读镜子」描述，新行建页并记基线与指纹', async () => {
    const rows = [skill()];
    const { pool, wm } = fakePool(rows);
    const r = await run(pool, notion);
    expect(r.ok).toBe(true);
    const names = Object.keys(notion.state.db.properties);
    for (const n of ['已装平台', '存在性', '最后扫描', '原件路径', '分配Agent', '评测分', '不一致副本数', '目标平台', '转OpenClaw难度', '业务线', '负责人', '分类', '备注']) {
      expect(names).toContain(n);
    }
    expect(notion.state.db.description[0].plain_text).not.toMatch(/只读镜子/);
    expect(Object.keys(wm.get(COLUMNS_KEY))).toContain('presence');
    expect(rows[0].notion_id).toBe('page-1');
    const page = notion.state.pages.get('page-1');
    expect(page.properties['存在性'].select.name).toBe('在用');
    expect(page.properties['分类'].select.name).toBe('运维');
    expect(page.properties['转OpenClaw难度'].select.name).toBe('A');
    expect(rows[0].notion_baseline.category).toBe('运维');
    expect(rows[0].metadata.pushed_digest).toBeTruthy();
  });

  it('没变化不推；描述变了必重推（insert-only 缺陷回归守卫）', async () => {
    const rows = [skill()];
    const { pool } = fakePool(rows);
    await run(pool, notion);
    const before = pagePatches(notion).length;
    await run(pool, notion);
    expect(pagePatches(notion).length).toBe(before);
    rows[0].description = '改过的描述';
    await run(pool, notion);
    const last = pagePatches(notion).at(-1);
    expect(last.body.properties.Description.rich_text[0].text.content).toBe('改过的描述');
  });

  it('人管列：Notion 被人改过（≠基线）→ Brain 改了也不覆盖，基线跟上 Brain', async () => {
    const rows = [skill()];
    const { pool } = fakePool(rows);
    await run(pool, notion);
    notion.state.pages.get('page-1').properties['备注'] = { type: 'rich_text', rich_text: [{ plain_text: '人写的' }] };
    rows[0].note = 'Brain 写的';
    await run(pool, notion);
    expect(notion.state.pages.get('page-1').properties['备注'].rich_text[0].plain_text).toBe('人写的');
    expect(rows[0].notion_baseline.note).toBe('Brain 写的');
    rows[0].category = '研发';
    await run(pool, notion);
    expect(notion.state.pages.get('page-1').properties['分类'].select.name).toBe('研发');
  });

  it('人删掉的列不补建、不再写；人改列名照写；人改列类型就跳过该列', async () => {
    const rows = [skill()];
    const { pool, wm } = fakePool(rows);
    await run(pool, notion);
    delete notion.state.db.properties['存在性'];
    const p = notion.state.db.properties['原件路径']; delete notion.state.db.properties['原件路径'];
    notion.state.db.properties['路径'] = { ...p, name: '路径' };
    notion.state.db.properties['分类'].type = 'rich_text';
    rows[0].presence = 'gone'; rows[0].source_path = '/y/nas/SKILL.md'; rows[0].category = '研发';
    const r = await run(pool, notion);
    expect(r.ok).toBe(true);
    expect(Object.keys(notion.state.db.properties)).not.toContain('存在性');
    expect(wm.get(COLUMNS_KEY).presence.deleted_at).toBeTruthy();
    const last = pagePatches(notion).at(-1);
    expect(last.body.properties).not.toHaveProperty('存在性');
    expect(last.body.properties).not.toHaveProperty('分类');
    expect(last.body.properties['路径'].rich_text[0].text.content).toBe('/y/nas/SKILL.md');
    expect(rows[0].notion_id).toBe('page-1');
  });

  it('建页前按标题查重：认领最早一页，其余机器人建的重复页归档', async () => {
    const { pool } = fakePool([skill({ id: 'r1', name: 'dup' })]);
    const mk = (id, t) => notion.state.pages.set(id, { id, created_by: { id: BOT }, created_time: t, properties: { Name: { type: 'title', title: [{ plain_text: 'dup' }] } } });
    mk('old', '2026-09-28T10:03:00Z'); mk('new', '2026-09-28T10:04:00Z');
    await run(pool, notion);
    expect(notion.state.calls.some((c) => c.path === '/pages' && c.method === 'POST')).toBe(false);
    expect(notion.state.pages.get('new').archived).toBe(true);
    expect(notion.state.pages.get('old').archived).toBeFalsy();
  });

  it('普通 400（列类型不符）→ 退避计数、不解绑；404 → 解绑下轮重建', async () => {
    const rows = [skill({ notion_id: 'page-x', metadata: { pushed_digest: 'stale' } })];
    notion.state.pages.set('page-x', { id: 'page-x', created_by: { id: BOT }, created_time: 't', properties: {} });
    const { pool } = fakePool(rows);
    notion.state.failNext = new Error('Notion PATCH /pages/page-x → 400: Status is expected to be select.');
    await run(pool, notion);
    expect(rows[0].notion_id).toBe('page-x');
    expect(rows[0].notion_push_attempts).toBe(1);
    expect(rows[0].notion_next_retry_at).toBeTruthy();
    rows[0].notion_next_retry_at = null;
    notion.state.pages.delete('page-x');
    await run(pool, notion);
    expect(rows[0].notion_id).toBeNull();
  });

  it('孤儿页清理：只归档机器人建且未被任何行绑定的页，人建的不动', async () => {
    const rows = [skill({ notion_id: 'bound', metadata: {} })];
    const set = (id, by) => notion.state.pages.set(id, { id, created_by: { id: by }, created_time: 't', properties: { Name: { type: 'title', title: [{ plain_text: id }] } } });
    set('bound', BOT); set('orphan-bot', BOT); set('orphan-human', 'alex');
    const { pool } = fakePool(rows);
    await run(pool, notion, { sweepOrphans: true });
    expect(notion.state.pages.get('orphan-bot').archived).toBe(true);
    expect(notion.state.pages.get('orphan-human').archived).toBeFalsy();
    expect(notion.state.pages.get('bound').archived).toBeFalsy();
  });
});
