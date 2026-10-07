/**
 * Activity 页面正文的机器区块（唯一写正文的地方）：一个折叠块，里面 9 段标准项（前提/不变量/NFR/失败语义/读回/判定点/对抗/保质期/用料），
 * 每段小标题 + 内容，没写的写「（未写）」。只动自己这个折叠块（按标题前缀认），人写的其它正文不碰；
 * 旧契约推送器整页生成的只读正文（首块「只读镜子：本页由契约自动生成」）整页都是机器写的，首次接管时清掉。
 * 指纹（activities.notion_body_digest）没变不打 Notion。
 */
import { propsDigest } from '../lib/notion-projection-engine.js';
import { activityBodySections } from './activity-card.js';

export const BODY_MARKER = '🤖 标准项（机器维护';
const BODY_TITLE = `${BODY_MARKER}：改内容请改 Brain，这里手改会被覆盖）`;
const LEGACY_MARKER = '只读镜子：本页由契约自动生成';
export const BODY_PAGES_PER_RUN = 8;
const plain = block => (block?.[block?.type]?.rich_text || []).map(t => t.plain_text ?? t.text?.content ?? '').join('');
const chunks = text => (text.match(/[\s\S]{1,1900}/g) || ['']).map(content => ({ type: 'text', text: { content } }));

/** 一个 Activity 的机器区块（一个 toggle，children = 9 段小标题 + 段落）。 */
export function buildActivityBodyBlock(a = {}, uses = []) {
  const children = activityBodySections(a, uses).flatMap(({ label, text }) => [
    { object: 'block', type: 'heading_3', heading_3: { rich_text: chunks(label) } },
    { object: 'block', type: 'paragraph', paragraph: { rich_text: chunks(text) } },
  ]);
  return { object: 'block', type: 'toggle', toggle: { rich_text: chunks(BODY_TITLE), children } };
}

async function listChildren(token, pageId, notionReq) {
  const all = [];
  let cursor = null;
  do {
    const res = await notionReq(token, `/blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`, 'GET');
    all.push(...(res?.results || []));
    cursor = res?.has_more ? res.next_cursor : null;
  } while (cursor);
  return all;
}

/** 换掉页上的机器区块：删旧折叠块（含旧契约整页正文），在页尾追加新折叠块。 */
export async function replaceActivityBody(token, pageId, block, notionReq) {
  const children = await listChildren(token, pageId, notionReq);
  const legacy = children[0]?.type === 'callout' && plain(children[0]).includes(LEGACY_MARKER);
  const stale = legacy ? children : children.filter(b => b.type === 'toggle' && plain(b).startsWith(BODY_MARKER));
  for (const b of stale) await notionReq(token, `/blocks/${b.id}`, 'DELETE');
  await notionReq(token, `/blocks/${pageId}/children`, 'PATCH', { children: [block] });
}

export async function syncActivityBodies(pool, { token, notionReq, limit = BODY_PAGES_PER_RUN } = {}) {
  if (!token) return null;
  const { rows } = await pool.query(
    `SELECT a.id, pl.external_id AS page_id, a.preconditions, a.invariants, a.nfr, a.failure, a.readback, a.judgment, a.adversarial,
            a.shelf_life_days, a.notion_body_digest,
            COALESCE((SELECT jsonb_agg(jsonb_build_object('item_name', i.name, 'role', u.role) ORDER BY i.name)
                        FROM activity_uses u JOIN warehouse_items i ON i.id = u.item_id WHERE u.activity_id = a.id), '[]'::jsonb) AS uses
       FROM activities a
       JOIN projection_links pl ON pl.target = 'notion-directory' AND pl.entity_type = 'activities' AND pl.entity_id = a.id
      ORDER BY a.id`);
  const stat = { rewritten: 0, unchanged: 0, failed: 0 };
  for (const r of rows) {
    const block = buildActivityBodyBlock(r, r.uses || []);
    const digest = propsDigest({}, [block]);
    if (r.notion_body_digest === digest) { stat.unchanged++; continue; }
    if (stat.rewritten + stat.failed >= limit) break;
    try {
      await replaceActivityBody(token, r.page_id, block, notionReq);
      await pool.query('UPDATE activities SET notion_body_digest = $2 WHERE id = $1', [r.id, digest]);
      stat.rewritten++;
    } catch (err) {
      stat.failed++;
      console.warn(`[activity-body] 正文写入失败 ${r.id}: ${err.message}`);
    }
  }
  return stat;
}
