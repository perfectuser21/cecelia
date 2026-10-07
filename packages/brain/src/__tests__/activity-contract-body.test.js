/**
 * activity-contract-body.test.js — Backbone Activities 页面正文（主理人 2026-09-28：契约内容放 page content 给人读，任务 d852c852）
 *
 * 正文完全由 journey_steps.contract 生成（单向只读，决策 0834e2fb）：
 * 指纹没变不打 Notion；变了整段替换（先列旧块→逐块删→分批追加新块），成功才记 notion_body_digest；
 * 每轮最多处理 3 页，防 scheduler job 超时。
 */
import { describe, it, expect } from 'vitest';
import { buildBackboneActivityBody, syncBackboneBodies, BODY_PAGES_PER_RUN } from '../activity-contract-sync.js';

const contract = {
  key: 'preflight', name: '预检', order: 1, version: '1.0.0', compatibility: 'backward',
  owner: { department: 'line02 智能获客', agent: '获客采收员' },
  inputs: [{ type: 'Device', cardinality: 'one', fields: ['serial', 'host'] }],
  outputs: [{ type: 'Run', cardinality: 'one', effect: 'create', fields: ['run_tag'] }],
  preconditions: ['不在触达时窗 8-22 点'],
  postconditions: [{ probe: 'pf_lock_acquired', asserts: '本 run 持有设备锁' }],
  execution: { location: 'xian-m4', via: 'crontab → harvest-cron.sh' },
  budget: { max_duration_s: 300, heartbeat_s: 60 },
  resources: { locks: ['device:<serial>'], limits: [{ name: 'max_videos_per_word', value: 4 }] },
  idempotency: { dedupe_key: 'Run.run_tag', on_duplicate: 'reject' },
  failure: { empty_ok: [], retryable: ['lock_busy'], needs_human: { cases: ['device_offline'], alert: { channel: 'bark', object: '离线 → Bark' } }, fatal: ['run_tag 重复'] },
  side_effects: [{ kind: 'internal_write', target: '设备锁', description: '持锁期间独占手机' }],
  invokers: ['code'],
  model: [{ provider: 'openrouter', model: 'bytedance/ui-tars-1.5-7b', purpose: '视觉定位兜底' }],
  steps: [
    { key: 'read_account_mark', name: '读账号标记', order: 2, check: '我页抖音号 == sender_id', implementation: { status: 'missing', ref: '6b133a81' }, uses_llm: false },
    { key: 'acquire_device_lock', name: '拿设备锁', order: 1, check: 'lock-acquire rc=0', implementation: { status: 'implemented', ref: 'x' }, uses_llm: true },
  ],
  known_gaps: [{ gap: 'preflight 指标写死', task: '6b133a81' }],
};
const row = (extra = {}) => ({
  id: 'r1', notion_id: 'page-1', capability_key: 'keyword_acquisition', activity_key: 'preflight', contract,
  contract_sha256: 'a'.repeat(64), contract_source: 'https://github.com/perfectuser21/zenithjoy-workspace/blob/abc/product-map/contracts/keyword_acquisition.yaml',
  promise: '每次开工前中台显示当前可用小号数', status: 'planned', notion_body_digest: null, ...extra,
});
const text = (b) => (b[b.type].rich_text || []).map((t) => t.text.content).join('');

describe('buildBackboneActivityBody', () => {
  const blocks = buildBackboneActivityBody(row());
  const headings = blocks.filter((b) => b.type === 'heading_2').map(text);

  it('第一块是只读提示，链回 git 正本', () => {
    expect(blocks[0].type).toBe('callout');
    expect(text(blocks[0])).toMatch(/只读/);
    expect(blocks[0].callout.rich_text.some((t) => t.text.link?.url === row().contract_source)).toBe(true);
  });

  it('按人读顺序分段：承诺/输入输出/前提/判定/步骤/出错/预算/副作用与模型/缺口', () => {
    expect(headings).toEqual(['对外承诺', '输入 → 输出', '开工前提', '做完怎么判定', '步骤', '出错怎么办', '预算与限额', '副作用与模型', '已知缺口']);
  });

  it('步骤按 order 编号，未实现标 ⚠、调模型标 🤖', () => {
    const steps = blocks.filter((b) => b.type === 'numbered_list_item').map(text);
    expect(steps[0]).toMatch(/^拿设备锁 — 判定：lock-acquire rc=0.*🤖/);
    expect(steps[1]).toMatch(/读账号标记.*⚠ 未实现/);
  });

  it('后置条件带探针名；出错四类都在；末行带版本与指纹', () => {
    const all = blocks.map(text).join('\n');
    expect(all).toContain('探针 pf_lock_acquired：本 run 持有设备锁');
    expect(all).toMatch(/可重试：lock_busy/);
    expect(all).toMatch(/需人处理：device_offline → bark/);
    expect(text(blocks[blocks.length - 1])).toMatch(/版本 1\.0\.0.*指纹 aaaaaaaaaaaa/);
  });

  it('无承诺 / 无模型 / 无缺口时写「无」而不是空段', () => {
    const b = buildBackboneActivityBody(row({ promise: null, contract: { ...contract, model: undefined, known_gaps: undefined } }));
    const all = b.map(text).join('\n');
    expect(all).toMatch(/对外承诺[\s\S]*（内部活动，无直接客户承诺）/);
    expect(all).toContain('不调大模型');
  });

  it('单段文字超 2000 字截断（Notion rich_text 上限）', () => {
    const long = buildBackboneActivityBody(row({ promise: '长'.repeat(5000) }));
    for (const b of long) for (const t of b[b.type].rich_text || []) expect(t.text.content.length).toBeLessThanOrEqual(2000);
  });
});

/** 假 Notion：页面已有 oldIds 块；记录每次调用 */
function fakeNotion(oldIds = ['b1', 'b2'], { failOn } = {}) {
  const calls = [];
  const notionReq = async (_t, path, method, body) => {
    calls.push({ path, method, body });
    if (failOn && failOn(path, method)) throw new Error('Notion 503');
    if (method === 'GET' && path.includes('/children')) return { results: oldIds.map((id) => ({ id })), has_more: false };
    return {};
  };
  return { notionReq, calls };
}
function fakePool(rows) {
  const updates = [];
  return {
    updates,
    async query(text, params) {
      if (/FROM activities/.test(text)) return { rows };
      if (/UPDATE activities SET notion_body_digest/.test(text)) updates.push(params);
      return { rows: [] };
    },
  };
}

describe('syncBackboneBodies', () => {
  it('指纹变 → 删旧块、追加新块、记指纹', async () => {
    const pool = fakePool([row()]);
    const n = fakeNotion(['b1', 'b2']);
    const r = await syncBackboneBodies(pool, 'tok', { notionReq: n.notionReq });
    expect(n.calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual(['/blocks/b1', '/blocks/b2']);
    const append = n.calls.filter((c) => c.method === 'PATCH' && c.path === '/blocks/page-1/children');
    expect(append).toHaveLength(1);
    expect(append[0].body.children[0].type).toBe('callout');
    expect(pool.updates).toHaveLength(1);
    expect(pool.updates[0][0]).toBe('r1');
    expect(r).toMatchObject({ rewritten: 1, unchanged: 0, failed: 0 });
  });

  it('正文写在目录投影建的页上：页 id 先取目录链接（notion-directory），旧 notion_id 只兜底', async () => {
    const sql = [];
    const pool = { async query(text) { sql.push(text); return { rows: [] }; } };
    await syncBackboneBodies(pool, 'tok', { notionReq: fakeNotion().notionReq });
    expect(sql[0]).toMatch(/LEFT JOIN projection_links[\s\S]*'notion-directory'[\s\S]*entity_type\s*=\s*'activities'/);
    expect(sql[0]).toMatch(/COALESCE\(pl\.external_id,\s*a\.notion_id\)\s+AS notion_id/);
  });

  it('指纹没变 → 一次 Notion 调用都不打', async () => {
    const first = fakePool([row()]);
    await syncBackboneBodies(first, 'tok', { notionReq: fakeNotion().notionReq });
    const digest = first.updates[0][1];
    const n = fakeNotion();
    const r = await syncBackboneBodies(fakePool([row({ notion_body_digest: digest })]), 'tok', { notionReq: n.notionReq });
    expect(n.calls).toEqual([]);
    expect(r).toMatchObject({ rewritten: 0, unchanged: 1 });
  });

  it('追加失败 → 不记指纹（下轮重来），其它页照常', async () => {
    const pool = fakePool([row(), row({ id: 'r2', notion_id: 'page-2' })]);
    const n = fakeNotion(['b1'], { failOn: (p, m) => m === 'PATCH' && p === '/blocks/page-1/children' });
    const r = await syncBackboneBodies(pool, 'tok', { notionReq: n.notionReq });
    expect(pool.updates.map((u) => u[0])).toEqual(['r2']);
    expect(r).toMatchObject({ rewritten: 1, failed: 1 });
  });

  it(`每轮最多重写 ${BODY_PAGES_PER_RUN} 页`, async () => {
    const rows = Array.from({ length: 8 }, (_, i) => row({ id: `r${i}`, notion_id: `page-${i}` }));
    const pool = fakePool(rows);
    const r = await syncBackboneBodies(pool, 'tok', { notionReq: fakeNotion([]).notionReq });
    expect(r.rewritten).toBe(BODY_PAGES_PER_RUN);
    expect(pool.updates).toHaveLength(BODY_PAGES_PER_RUN);
  });

  it('无 token → 不做', async () => {
    expect(await syncBackboneBodies(fakePool([row()]), null, { notionReq: fakeNotion().notionReq })).toBeNull();
  });
});
