/**
 * notion-mirror-labels：镜子库描述由注册表生成（交接单第 5 步，任务 a7a6b8b4）。
 * Notion 请求全部 mock，不发网络。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  MIRROR_LABEL_PREFIX,
  buildMirrorLabel,
  planMirrorLabels,
  mergeDescription,
  syncMirrorLabels,
  runMirrorLabelJob,
  resetMirrorLabelGateForTest,
} from '../notion-mirror-labels.js';

const row = (o) => ({ face: 'mirror', status: 'active', direction: 'push', brain_table: null, vessel: null, ...o });
const REGISTRY = [
  row({ notion_db_id: 'a17c40c2-ba63-82fb-9888-8152cefe29ec', title: 'Issues', brain_table: 'issues', vessel: 'notion-push-sync.pushIssues' }),
  row({ notion_db_id: '185c40c2-ba63-828c-973f-81a9c4582cd6', title: 'AI Notes', brain_table: 'decisions', vessel: 'notion-push-sync.pushDecisions' }),
  row({ notion_db_id: '185c40c2-ba63-828c-973f-81a9c4582cd6', title: 'AI Notes', brain_table: 'initiative_contracts', vessel: 'notion-push-sync.pushInitiativeContracts' }),
  // 两面库：Projects 既是入口又是镜子 → 不能贴「只读」
  row({ notion_db_id: 'd83c40c2-ba63-8323-8dc7-01cc291c4d9b', title: 'Projects', brain_table: 'tasks', vessel: 'notion-relay-projection.pushProjectRoots' }),
  row({ notion_db_id: 'd83c40c2-ba63-8323-8dc7-01cc291c4d9b', title: 'Projects', face: 'inlet', direction: 'both', brain_table: 'okr_projects' }),
  // 真身不在 Brain（飞书/脚本）→ 「改数据请改 Brain」是假话，跳过
  row({ notion_db_id: '3d6c40c2-ba63-811f-a83e-f981a044617d', title: 'OPC 经营对象', vessel: 'us-vps cron opc-objects-sync.py' }),
  // 非 active / 非推送 → 不碰
  row({ notion_db_id: '369c40c2-ba63-812c-9f35-e7e43db25014', title: 'AI Steps', brain_table: 'journey_steps', status: 'archived', direction: 'none' }),
  row({ notion_db_id: 'unmapped:task_runs', title: '（无 Notion 库）task_runs', brain_table: 'task_runs', status: 'pending_vessel', direction: 'none' }),
];

const rt = (s) => [{ type: 'text', plain_text: s, href: null, annotations: { bold: false }, text: { content: s, link: null } }];
const plain = (arr) => arr.map((x) => x.text?.content ?? x.plain_text ?? '').join('');

describe('buildMirrorLabel', () => {
  it('按固定格式生成：由 Brain <表> 经 <血管> 推送', () => {
    expect(buildMirrorLabel({ brainTables: ['issues'], vessels: ['notion-push-sync.pushIssues'] }))
      .toBe('🔒 只读镜子：由 Brain issues 经 notion-push-sync.pushIssues 推送，改数据请改 Brain，不要在 Notion 手改。');
    expect(buildMirrorLabel({ brainTables: ['issues'], vessels: [] }).startsWith(MIRROR_LABEL_PREFIX)).toBe(true);
  });
});

describe('planMirrorLabels', () => {
  it('只挑 active 推送镜子；一库多表合并；两面库与无 Brain 表的跳过并给原因', () => {
    const { targets, skipped } = planMirrorLabels(REGISTRY);
    expect(targets.map((t) => t.title).sort()).toEqual(['AI Notes', 'Issues']);
    const notes = targets.find((t) => t.title === 'AI Notes');
    expect(notes.label).toBe('🔒 只读镜子：由 Brain decisions、initiative_contracts 经 notion-push-sync.pushDecisions、notion-push-sync.pushInitiativeContracts 推送，改数据请改 Brain，不要在 Notion 手改。');
    expect(skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Projects', reason: 'dual_face' }),
      expect.objectContaining({ title: 'OPC 经营对象', reason: 'no_brain_table' }),
    ]));
    expect([...targets, ...skipped].some((t) => t.title === 'AI Steps' || t.title.includes('task_runs'))).toBe(false);
  });
});

describe('mergeDescription', () => {
  const label = buildMirrorLabel({ brainTables: ['issues'], vessels: ['notion-push-sync.pushIssues'] });
  it('空描述 → 只写标签', () => {
    expect(plain(mergeDescription([], label))).toBe(label);
  });
  it('已是同样说明开头 → null（幂等跳过）', () => {
    expect(mergeDescription(rt(`${label}\n原有说明`), label)).toBeNull();
    expect(mergeDescription(rt(label), label)).toBeNull();
  });
  it('人写的说明保留在标签下方', () => {
    expect(plain(mergeDescription(rt('公司当前在办的每一件事。'), label))).toBe(`${label}\n公司当前在办的每一件事。`);
  });
  it('旧版标签行被替换而不是叠加', () => {
    const out = mergeDescription(rt(`${MIRROR_LABEL_PREFIX}由 Brain old 经 x 推送，改数据请改 Brain，不要在 Notion 手改。\n人写的`), label);
    expect(plain(out)).toBe(`${label}\n人写的`);
  });
});

function fakeNotion(dbs) {
  const calls = [];
  const notionReq = vi.fn(async (_token, path, method = 'GET', body) => {
    calls.push({ path, method, body });
    const id = path.split('/')[2];
    if (method === 'GET') {
      if (!dbs[id]) { const e = new Error(`Notion GET ${path} → 404: not found`); e.status = 404; throw e; }
      return dbs[id];
    }
    if (method === 'PATCH') { dbs[id].description = body.description; return dbs[id]; }
    throw new Error('unexpected');
  });
  return { notionReq, calls };
}

const pool = { query: vi.fn(async () => ({ rows: REGISTRY })) };

describe('syncMirrorLabels', () => {
  it('第一次写入，第二次零写（幂等）；标题从不改', async () => {
    const dbs = {
      'a17c40c2-ba63-82fb-9888-8152cefe29ec': { id: 'a', title: rt('Issues'), description: [] },
      '185c40c2-ba63-828c-973f-81a9c4582cd6': { id: 'b', title: rt('AI Notes'), description: rt('人写的') },
    };
    const { notionReq, calls } = fakeNotion(dbs);
    const r1 = await syncMirrorLabels(pool, { notionReq, token: 't' });
    expect(r1.updated.sort()).toEqual(['AI Notes', 'Issues']);
    const patches = calls.filter((c) => c.method === 'PATCH');
    expect(patches).toHaveLength(2);
    for (const p of patches) expect(Object.keys(p.body)).toEqual(['description']);
    expect(plain(dbs['185c40c2-ba63-828c-973f-81a9c4582cd6'].description)).toMatch(/^🔒 只读镜子：[\s\S]*\n人写的$/);

    // 模拟 Notion 回读：写进去的 text.content 回来时是 plain_text
    for (const d of Object.values(dbs)) d.description = d.description.map((x) => ({ ...x, plain_text: x.text.content }));
    calls.length = 0;
    const r2 = await syncMirrorLabels(pool, { notionReq, token: 't' });
    expect(r2.updated).toEqual([]);
    expect(r2.unchanged.sort()).toEqual(['AI Notes', 'Issues']);
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
  });

  it('dryRun 不写；库进回收站/404 记 failed 不抛', async () => {
    const dbs = { 'a17c40c2-ba63-82fb-9888-8152cefe29ec': { id: 'a', description: [], in_trash: true } };
    const { notionReq, calls } = fakeNotion(dbs);
    const r = await syncMirrorLabels(pool, { notionReq, token: 't', dryRun: true });
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
    expect(r.failed.map((f) => f.title).sort()).toEqual(['AI Notes', 'Issues']);
  });
});

describe('runMirrorLabelJob', () => {
  it('无 token 静默跳过；有 token 每 20h 只跑一次', async () => {
    resetMirrorLabelGateForTest();
    expect(await runMirrorLabelJob(pool, { token: '' })).toMatchObject({ skipped: true, reason: 'no_token' });
    const { notionReq } = fakeNotion({
      'a17c40c2-ba63-82fb-9888-8152cefe29ec': { description: [] },
      '185c40c2-ba63-828c-973f-81a9c4582cd6': { description: [] },
    });
    const t0 = 1_000_000_000_000;
    const r1 = await runMirrorLabelJob(pool, { token: 't', notionReq, now: t0 });
    expect(r1.updated).toHaveLength(2);
    expect(await runMirrorLabelJob(pool, { token: 't', notionReq, now: t0 + 3600e3 })).toMatchObject({ skipped: true, reason: 'interval_gate' });
    const r3 = await runMirrorLabelJob(pool, { token: 't', notionReq, now: t0 + 21 * 3600e3 });
    expect(r3.skipped).toBeUndefined();
  });
});
