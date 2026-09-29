/**
 * notion-mirror-labels.js — 镜子库「只读」说明由注册表生成（交接单第 5 步，任务 a7a6b8b4）
 *
 * 对 notion_projection_map 里 face=mirror、status=active、direction∈{push,both} 的每个 Notion 库，
 * 把库 description 开头一行设为固定格式说明：
 *   🔒 只读镜子：由 Brain <brain_table> 经 <vessel> 推送，改数据请改 Brain，不要在 Notion 手改。
 * 规则：
 *  - 只改 description，库标题不碰；人写的原说明保留在标签下方，旧版标签行被替换不叠加；
 *  - 开头已是同样说明 → 跳过（幂等，零写）；
 *  - 一库多表合并成一条（AI Notes = decisions、initiative_contracts、notes）；
 *  - 同库还登记了 inlet/truth 面（如 Projects）→ 跳过（人可以写，贴「只读」是假话）；
 *  - 没有 brain_table 的镜子（真身在飞书/脚本/设备）→ 跳过（「改数据请改 Brain」不成立）。
 * 调度：scheduler JOBS 的 notion-mirror-labels，进程内 20h 自 gate（每天一次）。
 * 手动跑：scripts/ops/notion-mirror-labels.mjs。
 */
import { loadProjectionMap, normalizeNotionId } from './lib/notion-projection-registry.js';
import { notionReq as defaultNotionReq } from './recurring-notion-sync.js';

export const MIRROR_LABEL_PREFIX = '🔒 只读镜子：';
const GATE_MS = 20 * 3600 * 1000;
let lastRunAt = 0;

export function resetMirrorLabelGateForTest() {
  lastRunAt = 0;
}

// 排序：注册表同库多行的返回顺序不稳定，不排序会让同一说明反复重写
const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort();

export function buildMirrorLabel({ brainTables = [], vessels = [] }) {
  const via = vessels.length ? ` 经 ${vessels.join('、')}` : '';
  return `${MIRROR_LABEL_PREFIX}由 Brain ${brainTables.join('、')}${via} 推送，改数据请改 Brain，不要在 Notion 手改。`;
}

/**
 * @param {Array<object>} rows notion_projection_map 全部行
 * @returns {{targets: Array<{dbId,title,label}>, skipped: Array<{dbId,title,reason}>}}
 */
export function planMirrorLabels(rows) {
  const otherFace = new Set(
    rows.filter((r) => r.status === 'active' && r.face !== 'mirror').map((r) => normalizeNotionId(r.notion_db_id)),
  );
  const groups = new Map();
  for (const r of rows) {
    if (r.face !== 'mirror' || r.status !== 'active' || !['push', 'both'].includes(r.direction)) continue;
    if (String(r.notion_db_id).startsWith('unmapped:')) continue;
    const k = normalizeNotionId(r.notion_db_id);
    if (!groups.has(k)) groups.set(k, { dbId: r.notion_db_id, title: r.title, rows: [] });
    groups.get(k).rows.push(r);
  }
  const targets = [];
  const skipped = [];
  for (const [k, g] of groups) {
    const brainTables = uniq(g.rows.map((r) => r.brain_table));
    if (otherFace.has(k)) { skipped.push({ dbId: g.dbId, title: g.title, reason: 'dual_face' }); continue; }
    if (!brainTables.length) { skipped.push({ dbId: g.dbId, title: g.title, reason: 'no_brain_table' }); continue; }
    targets.push({ dbId: g.dbId, title: g.title, label: buildMirrorLabel({ brainTables, vessels: uniq(g.rows.map((r) => r.vessel)) }) });
  }
  return { targets, skipped };
}

const plainOf = (el) => el?.plain_text ?? el?.text?.content ?? '';

/** Notion 回读的 rich_text 元素 → 可写回的 text 元素（保留链接与样式） */
function toWritable(el, content = plainOf(el)) {
  const href = el?.href ?? el?.text?.link?.url ?? null;
  const out = { type: 'text', text: { content, link: href ? { url: href } : null } };
  if (el?.annotations) out.annotations = el.annotations;
  return out;
}

/**
 * @param {Array<object>} richText 库当前 description
 * @param {string} label
 * @returns {Array<object>|null} 新 description；已是同样说明开头返回 null
 */
export function mergeDescription(richText, label) {
  const els = Array.isArray(richText) ? richText : [];
  if (els.map(plainOf).join('').startsWith(label)) return null;
  const rest = els.map((el) => toWritable(el));
  // 旧版标签行（开头以前缀起、到第一个换行为止）替换掉，不叠加
  if (rest.length && rest[0].text.content.startsWith(MIRROR_LABEL_PREFIX)) {
    const nl = rest[0].text.content.indexOf('\n');
    if (nl === -1) rest.shift();
    else rest[0].text.content = rest[0].text.content.slice(nl + 1);
  }
  const kept = rest.filter((el) => el.text.content !== '');
  return [{ type: 'text', text: { content: kept.length ? `${label}\n` : label, link: null } }, ...kept];
}

/**
 * @returns {Promise<{updated:string[], unchanged:string[], skipped:object[], failed:object[]}>}
 */
export async function syncMirrorLabels(pool, { notionReq = defaultNotionReq, token, dryRun = false } = {}) {
  const { rows } = await loadProjectionMap(pool);
  const { targets, skipped } = planMirrorLabels(rows);
  const result = { updated: [], unchanged: [], skipped, failed: [] };
  for (const t of targets) {
    try {
      const db = await notionReq(token, `/databases/${t.dbId}`, 'GET');
      if (db?.in_trash === true || db?.archived === true) {
        result.failed.push({ title: t.title, dbId: t.dbId, error: 'in_trash' });
        continue;
      }
      const next = mergeDescription(db?.description, t.label);
      if (!next) { result.unchanged.push(t.title); continue; }
      if (!dryRun) await notionReq(token, `/databases/${t.dbId}`, 'PATCH', { description: next });
      result.updated.push(t.title);
    } catch (err) {
      result.failed.push({ title: t.title, dbId: t.dbId, error: String(err?.message || err).slice(0, 200) });
    }
  }
  return result;
}

/** scheduler 入口：无 token 静默跳过；进程内 20h 自 gate */
export async function runMirrorLabelJob(pool, { token = process.env.NOTION_API_KEY, notionReq, now = Date.now() } = {}) {
  if (!token) return { skipped: true, reason: 'no_token' };
  if (lastRunAt && now - lastRunAt < GATE_MS) return { skipped: true, reason: 'interval_gate' };
  lastRunAt = now;
  const r = await syncMirrorLabels(pool, { token, ...(notionReq ? { notionReq } : {}) });
  console.log(`[notion-mirror-labels] 更新 ${r.updated.length} / 不变 ${r.unchanged.length} / 跳过 ${r.skipped.length} / 失败 ${r.failed.length}`);
  return r;
}
