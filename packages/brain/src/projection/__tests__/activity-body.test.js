/**
 * Activity 页面正文的机器区块：一个折叠块装 9 段标准项（小标题 + 内容，没写的写「（未写）」）；
 * 只换自己的折叠块，人写的其它正文不碰；旧契约推送器整页生成的只读正文首次接管时清掉；指纹不变零调用。
 */
import { describe, it, expect } from 'vitest';
import { buildActivityBodyBlock, replaceActivityBody, syncActivityBodies, BODY_MARKER } from '../activity-body.js';

const plain = b => (b[b.type].rich_text || []).map(t => t.text.content).join('');
const row = (extra = {}) => ({ id: 'a1', page_id: 'page-1', preconditions: ['设备在线'], invariants: null, nfr: { timeout_s: 600 }, failure: null,
  readback: null, judgment: null, adversarial: '平台改版', shelf_life_days: 7, notion_body_digest: null, uses: [{ item_name: '设备锁', role: 'uses' }], ...extra });

function fakeNotion(children = []) {
  const calls = [];
  const notionReq = async (_t, path, method, body) => {
    calls.push({ path, method, body });
    if (method === 'GET' && path.includes('/children')) return { results: children, has_more: false };
    return {};
  };
  return { notionReq, calls };
}
function fakePool(rows) {
  const updates = [], sql = [];
  return { updates, sql, async query(text, params) {
    sql.push(text);
    if (/FROM activities a/.test(text)) return { rows };
    if (/UPDATE activities SET notion_body_digest/.test(text)) updates.push(params);
    return { rows: [] };
  } };
}

describe('Activity 正文机器区块', () => {
  it('一个折叠块，标题带「机器维护」标记，里面 9 段：小标题 + 内容，没写的写（未写）', () => {
    const block = buildActivityBodyBlock(row(), row().uses);
    expect(block.type).toBe('toggle');
    expect(plain(block).startsWith(BODY_MARKER)).toBe(true);
    const kids = block.toggle.children;
    expect(kids.filter(k => k.type === 'heading_3').map(plain)).toEqual(['前提', '不变量', 'NFR', '失败语义', '读回', '判定点', '对抗', '保质期', '用料']);
    const after = label => plain(kids[kids.findIndex(k => k.type === 'heading_3' && plain(k) === label) + 1]);
    expect(after('前提')).toBe('设备在线');
    expect(after('不变量')).toBe('（未写）');
    expect(after('保质期')).toBe('7 天');
    expect(after('用料')).toBe('设备锁（uses）');
  });

  it('只换自己的折叠块：删旧机器块、人写的段落不动，新块追加到页尾', async () => {
    const n = fakeNotion([{ id: 'human', type: 'paragraph', paragraph: { rich_text: [{ plain_text: '主理人笔记' }] } },
      { id: 'old', type: 'toggle', toggle: { rich_text: [{ plain_text: `${BODY_MARKER}：旧` }] } }]);
    await replaceActivityBody('tok', 'page-1', buildActivityBodyBlock(row(), []), n.notionReq);
    expect(n.calls.filter(c => c.method === 'DELETE').map(c => c.path)).toEqual(['/blocks/old']);
    const append = n.calls.find(c => c.method === 'PATCH');
    expect(append.path).toBe('/blocks/page-1/children');
    expect(append.body.children).toHaveLength(1);
  });

  it('旧契约推送器整页生成的只读正文（首块「只读镜子」）首次接管时整页清掉', async () => {
    const n = fakeNotion([{ id: 'c', type: 'callout', callout: { rich_text: [{ plain_text: '只读镜子：本页由契约自动生成，手改会被覆盖。' }] } },
      { id: 'h', type: 'heading_2', heading_2: { rich_text: [{ plain_text: '对外承诺' }] } }]);
    await replaceActivityBody('tok', 'page-1', buildActivityBodyBlock(row(), []), n.notionReq);
    expect(n.calls.filter(c => c.method === 'DELETE').map(c => c.path)).toEqual(['/blocks/c', '/blocks/h']);
  });

  it('指纹没变零 Notion 调用；变了才写并记指纹；页 id 只取目录链接', async () => {
    const first = fakePool([row()]);
    const n1 = fakeNotion();
    expect(await syncActivityBodies(first, { token: 'tok', notionReq: n1.notionReq })).toMatchObject({ rewritten: 1 });
    expect(first.updates).toHaveLength(1);
    expect(first.sql[0]).toMatch(/JOIN projection_links pl ON pl\.target = 'notion-directory' AND pl\.entity_type = 'activities'/);
    const n2 = fakeNotion();
    expect(await syncActivityBodies(fakePool([row({ notion_body_digest: first.updates[0][1] })]), { token: 'tok', notionReq: n2.notionReq })).toMatchObject({ unchanged: 1, rewritten: 0 });
    expect(n2.calls).toEqual([]);
  });

  it('每轮限页数；写失败不记指纹（下轮重来）；没 token 不跑', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => row({ id: `a${i}`, page_id: `p${i}` }));
    const pool = fakePool(rows);
    expect(await syncActivityBodies(pool, { token: 'tok', notionReq: fakeNotion().notionReq, limit: 2 })).toMatchObject({ rewritten: 2 });
    const failing = fakePool([row()]);
    const r = await syncActivityBodies(failing, { token: 'tok', notionReq: async () => { throw new Error('503'); } });
    expect(r).toMatchObject({ failed: 1, rewritten: 0 }); expect(failing.updates).toEqual([]);
    expect(await syncActivityBodies(fakePool([row()]), { token: null })).toBeNull();
  });
});
