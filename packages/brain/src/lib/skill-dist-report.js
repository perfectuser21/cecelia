/**
 * skill-dist-report.js — skill 分发漂移的读取与渲染（晨报一行 / 日报板块）。
 * 数据由 skill-dist-drift.js 每 30min 写入 working_memory[skill_manifest_drift]；
 * 形状沿棒 7 的 skill 绑定漂移（lib/skill-binding-registry.js）：有漂移/未核对/数据过期 → 🟡 AMBER，
 * 无数据（job 从未跑）→ 不出；读取 best-effort，失败返回 null，不拖垮晨报/日报。
 */

export const SKILL_DIST_KEY = 'skill_manifest_drift';
/** 数据超过这个时长没刷新：检测本身停了，也要 AMBER。job 每 30min 跑一次，6h = 错过 12 轮。 */
export const STALE_MS = 6 * 60 * 60 * 1000;
const QUERY_TIMEOUT_MS = 10_000;

/** @returns {Promise<object|null>} 最近一次核对结果；缺失/查询失败/超时 → null */
export async function readSkillDistState(pool) {
  let timer;
  try {
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('query timeout')), QUERY_TIMEOUT_MS); });
    const res = await Promise.race([
      pool.query('SELECT value_json FROM working_memory WHERE key = $1', [SKILL_DIST_KEY]),
      timeout,
    ]);
    let v = res?.rows?.[0]?.value_json;
    if (typeof v === 'string') v = JSON.parse(v);
    // 形状校验：别的 key/夹具的 value_json 不是本 job 的结果，宁可当无数据也不出错误的 AMBER
    return v && typeof v.checked_at === 'string' && Array.isArray(v.machines) && v.truth ? v : null;
  } catch (err) {
    console.warn(`[skill-dist-report] 读取失败（非阻断）: ${err.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const isDriftStatus = (s) => s === 'drift' || s === 'dir_missing';
const isUnverifiedStatus = (s) => s === 'unreachable' || s === 'invalid';

function ageHours(state, now) {
  const t = Date.parse(state?.checked_at);
  return Number.isFinite(t) ? (now - t) / 3600_000 : Infinity;
}

const TRUTH_TEXT = {
  unreachable: '不可达',
  invalid: '清单输出无效',
  dir_missing: '目录不存在',
};

function truthProblem(state) {
  const st = state?.truth?.status;
  return st && st !== 'ok' ? (TRUTH_TEXT[st] || st) : null;
}

function sample(list, n = 3) {
  return list.slice(0, n).join('、') + (list.length > n ? ' …' : '');
}

function dirDriftText(d) {
  if (d.status === 'dir_missing') return '目录不存在';
  const parts = [];
  if (d.missing_total) parts.push(`缺${d.missing_total}`);
  if (d.extra_total) parts.push(`多${d.extra_total}`);
  if (d.changed_total) parts.push(`异${d.changed_total}`);
  if (d.broken_total) parts.push(`坏链${d.broken_total}`);
  const names = [...(d.changed || []), ...(d.missing || []), ...(d.extra || []), ...(d.broken || [])];
  return names.length ? `${parts.join(' ')}（如 ${sample(names)}）` : parts.join(' ');
}

/** 晨报一行；无需告警返回 null。 */
export function renderSkillDistLine(state, now = Date.now()) {
  if (!state) return null;
  const age = ageHours(state, now);
  if (age > STALE_MS / 3600_000) {
    return `🟡 AMBER skill 分发漂移检测已过期：上次核对在 ${Number.isFinite(age) ? Math.floor(age) : '?'} 小时前未更新（检测 job 停了？）`;
  }
  const tp = truthProblem(state);
  if (tp) return `🟡 AMBER skill 分发漂移：真身（MMV）${tp}，本轮无法核对各跑场机`;
  const parts = [];
  for (const m of state.machines || []) {
    for (const d of m.dirs || []) {
      if (isDriftStatus(d.status)) parts.push(`${m.id}/${d.label} ${dirDriftText(d)}`);
      else if (isUnverifiedStatus(d.status)) parts.push(`${m.id}/${d.label} 未核对（${TRUTH_TEXT[d.status] || d.status}，不计零个）`);
    }
  }
  return parts.length ? `🟡 AMBER skill 分发漂移：${parts.join('；')}` : null;
}

/** 日报板块；无数据返回空串。 */
export function renderSkillDistSection(state, now = Date.now()) {
  if (!state) return '';
  const lines = ['== skill 分发漂移 =='];
  const tr = state.truth || {};
  if (tr.status === 'ok') {
    lines.push(`真身（MMV）：${tr.count} 个 skill，tree_hash ${String(tr.tree_hash || '').slice(0, 12)}；上次核对 ${state.checked_at}`);
    if (tr.broken_total) {
      lines.push(`真身有 ${tr.broken_total} 个悬空 skill 链接（无内容，未参与比对）：${sample(tr.broken || [], 8)}`);
    }
  }
  const age = ageHours(state, now);
  if (age > STALE_MS / 3600_000) {
    lines.push(`🟡 AMBER 检测已过期：上次核对在 ${Number.isFinite(age) ? Math.floor(age) : '?'} 小时前，检测 job 可能停了`);
  }
  const tp = truthProblem(state);
  if (tp) {
    lines.push(`🟡 AMBER 真身（MMV）${tp}，本轮无法核对各跑场机`);
    return lines.join('\n');
  }
  let anyProblem = false;
  for (const m of state.machines || []) {
    for (const d of m.dirs || []) {
      if (d.status === 'ok') lines.push(`  ✓ ${m.id}/${d.label} 与真身一致`);
      else if (isDriftStatus(d.status)) { anyProblem = true; lines.push(`  - 🟡 AMBER ${m.id}/${d.label}：${dirDriftText(d)}`); }
      else if (isUnverifiedStatus(d.status)) { anyProblem = true; lines.push(`  - 🟡 AMBER ${m.id}/${d.label} 未核对（${TRUTH_TEXT[d.status] || d.status}）——不是零个 skill，也不计入漂移`); }
    }
  }
  if (!anyProblem && !(age > STALE_MS / 3600_000)) lines.push('各跑场机 skill 清单哈希与真身一致。');
  return lines.join('\n');
}
