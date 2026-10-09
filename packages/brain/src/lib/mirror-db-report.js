/**
 * mirror-db-report.js — 镜子库失联的读取与渲染（晨报一行 / 日报板块），决策 24a37029。
 * 数据源：promise-map-nightly 每日 UTC 02:00 把全部断言写进 working_memory[promise-map-nightly].results，
 * 其中 key=mirror_db_reachable（lib/notion-projection-watch.js A11）带 lost 清单。
 * 形状沿 assertion-red-report：有失联 → 🔴 RED「镜子库失联：<title>×N」；无失联 / 无数据 / 读取失败 → null，不拖垮晨报/日报。
 */

export const MIRROR_DB_SENTINEL_KEY = 'promise-map-nightly';
export const MIRROR_DB_ASSERTION_KEY = 'mirror_db_reachable';
const QUERY_TIMEOUT_MS = 10_000;
const LINE_MAX_TITLES = 3;

/** @returns {Promise<{checked_at:string|null, lost:Array<{title,table,dbId,reason}>}|null>} 无失联/无数据/失败 → null */
export async function readMirrorDbState(pool) {
  let timer;
  try {
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('query timeout')), QUERY_TIMEOUT_MS); });
    const res = await Promise.race([
      pool.query('SELECT value_json FROM working_memory WHERE key = $1 LIMIT 1', [MIRROR_DB_SENTINEL_KEY]),
      timeout,
    ]);
    let v = res?.rows?.[0]?.value_json;
    if (typeof v === 'string') v = JSON.parse(v);
    const a = Array.isArray(v?.results) ? v.results.find((r) => r?.key === MIRROR_DB_ASSERTION_KEY) : null;
    if (!a || a.ok !== false || !Array.isArray(a.lost) || !a.lost.length) return null;
    return { checked_at: typeof v.last_run_at === 'string' ? v.last_run_at : null, lost: a.lost };
  } catch (err) {
    console.warn(`[mirror-db-report] 读取失败（非阻断）: ${err.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function summary(lost) {
  const titles = lost.slice(0, LINE_MAX_TITLES).map((l) => l.title);
  return `${titles.join('、')}${lost.length > LINE_MAX_TITLES ? ' …' : ''} ×${lost.length}`;
}

/** 晨报一行；无失联返回 null。 */
export function renderMirrorDbLine(state) {
  if (!state?.lost?.length) return null;
  return `🔴 RED 镜子库失联：${summary(state.lost)}（Notion 回收站/404，推送已停）`;
}

/** 日报板块；无失联返回空串。 */
export function renderMirrorDbSection(state) {
  if (!state?.lost?.length) return '';
  const lines = ['== 镜子库失联 =='];
  lines.push(`🔴 RED 镜子库失联：${summary(state.lost)}（Notion 回收站/404，写入必败；停推走迁移归档，换库走 scripts/ops/create-*-notion-dbs.js）`);
  for (const l of state.lost) lines.push(`  - ${l.title}（${l.table ?? '?'}）：${l.reason}`);
  if (state.checked_at) lines.push(`守夜核对时间：${state.checked_at}`);
  return lines.join('\n');
}
