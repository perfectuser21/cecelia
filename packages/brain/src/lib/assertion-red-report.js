/**
 * assertion-red-report.js — 业务断言红灯的读取与渲染（晨报一行 / 日报板块）。
 * 链 bf5088a3 棒4 消费（决策 702949b6）：棒3a 探针执行体（business_probe_runner）把
 * PASS/FAIL 回执写进 journey_assertion_receipts；这里读过去 24h 的 FAIL，经
 * journey_step_links → journey_steps / journeys 取步名/路名，按 路径/步骤/探针 key 分组计数。
 * 分级：任一 scenario_evidence.severity=error → 🔴 RED；只有 warn（或缺失）→ 🟡 AMBER。
 * best-effort：空集、查询失败、超时都返回 null（不出行/不出板块，不拖垮晨报/日报）。
 */

export const PROBE_EXECUTOR_KIND = 'business_probe_runner';
export const WINDOW_HOURS = 24;
const QUERY_TIMEOUT_MS = 10_000;
const MAX_GROUPS = 50;
const LINE_MAX_STEPS = 3;
const SECTION_MAX_GROUPS = 20;
const PROBE_PREFIX = 'probe:';

const FAIL_GROUPS_SQL = `
  SELECT j.name AS journey,
         s.name AS step,
         r.assertion_ref_snapshot AS assertion_ref,
         COUNT(*)::int AS fail_count,
         BOOL_OR(r.scenario_evidence->>'severity' = 'error') AS has_error,
         MAX(r.created_at) AS last_at
  FROM journey_assertion_receipts r
  JOIN journey_step_links l ON l.id = r.journey_step_link_id
  JOIN journey_steps s ON s.id = l.step_id
  JOIN journeys j ON j.id = l.journey_id
  WHERE r.executor_kind = $1
    AND r.verdict = 'FAIL'
    AND r.created_at >= NOW() - ($2::int * INTERVAL '1 hour')
  GROUP BY j.name, s.name, r.assertion_ref_snapshot
  ORDER BY has_error DESC NULLS LAST, fail_count DESC, j.name, s.name, r.assertion_ref_snapshot
  LIMIT ${MAX_GROUPS}`;

/** `probe:<key>` → `<key>`；非探针 ref 原样返回。 */
export function probeKeyOf(ref) {
  const s = String(ref ?? '');
  return s.startsWith(PROBE_PREFIX) ? s.slice(PROBE_PREFIX.length) : s;
}

const isTrue = (v) => v === true || v === 't';

/**
 * @returns {Promise<{level:'RED'|'AMBER', total:number, window_hours:number,
 *   groups:Array<{journey:string, step:string, probe_key:string, fail_count:number,
 *   severity:'error'|'warn', last_at:string|null}>}|null>} 无 FAIL / 查询失败 / 超时 → null
 */
export async function readAssertionRedState(pool, { windowHours = WINDOW_HOURS } = {}) {
  let timer;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('query timeout')), QUERY_TIMEOUT_MS);
    });
    const res = await Promise.race([
      pool.query(FAIL_GROUPS_SQL, [PROBE_EXECUTOR_KIND, windowHours]),
      timeout,
    ]);
    const rows = Array.isArray(res?.rows) ? res.rows : [];
    if (!rows.length) return null;
    const groups = rows.map((r) => ({
      journey: String(r.journey ?? '?'),
      step: String(r.step ?? '?'),
      probe_key: probeKeyOf(r.assertion_ref),
      fail_count: Number(r.fail_count) || 0,
      severity: isTrue(r.has_error) ? 'error' : 'warn',
      last_at: r.last_at ? new Date(r.last_at).toISOString() : null,
    }));
    return {
      level: groups.some((g) => g.severity === 'error') ? 'RED' : 'AMBER',
      total: groups.reduce((n, g) => n + g.fail_count, 0),
      window_hours: windowHours,
      groups,
    };
  } catch (err) {
    console.warn(`[assertion-red-report] 读取失败（非阻断）: ${err.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const BADGE = { RED: '🔴 RED', AMBER: '🟡 AMBER' };
const DOT = { error: '🔴', warn: '🟡' };

/** 按 路径/步骤 归拢各探针组，保持查询顺序。 */
function groupByStep(groups) {
  const map = new Map();
  for (const g of groups) {
    const key = `${g.journey}/${g.step}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(g);
  }
  return [...map];
}

/** 晨报一行；无 FAIL 返回 null。 */
export function renderAssertionRedLine(state) {
  if (!state?.groups?.length) return null;
  const steps = groupByStep(state.groups);
  const parts = steps
    .slice(0, LINE_MAX_STEPS)
    .map(([key, gs]) => `${key} ${gs.map((g) => `${g.probe_key}×${g.fail_count}`).join(', ')}`);
  const more = steps.length > LINE_MAX_STEPS ? ' …' : '';
  return `${BADGE[state.level] ?? BADGE.AMBER} 断言红灯：${parts.join('；')}${more}（${state.window_hours}h）`;
}

/** 日报板块；无 FAIL 返回空串。 */
export function renderAssertionRedSection(state) {
  if (!state?.groups?.length) return '';
  const lines = [`== 业务断言红灯（${state.window_hours}h）==`];
  lines.push(state.level === 'RED'
    ? `🔴 RED 共 ${state.total} 次 FAIL（含 error 级）`
    : `🟡 AMBER 共 ${state.total} 次 FAIL（仅 warn 级）`);
  for (const g of state.groups.slice(0, SECTION_MAX_GROUPS)) {
    lines.push(`  - ${DOT[g.severity] ?? DOT.warn} ${g.journey} / ${g.step} · ${g.probe_key} ×${g.fail_count}（${g.severity}）`);
  }
  if (state.groups.length > SECTION_MAX_GROUPS) {
    lines.push(`  …另有 ${state.groups.length - SECTION_MAX_GROUPS} 组未列出`);
  }
  return lines.join('\n');
}
