/** 公司经营 KR 的来源、原值与公式；不从项目/任务比例推导经营指标。 */
export const COMPANY_METRIC_MODE = 'company_formula_v1';
export const COMPANY_KR_DATABASE = '684c40c2-ba63-83a7-b6ba-8161f110a18c';
export const COMPANY_GOALS = [
  { page_id: '3dbc40c2-ba63-8102-8d02-dcc5181489d3', title: 'O1 获客到交付的钱路打通' },
  { page_id: '3dbc40c2-ba63-81fb-9622-fdfc4e8199f3', title: 'O2 发布引擎产能化' },
  { page_id: '3dbc40c2-ba63-81d1-afe4-c9a6d1abb61b', title: 'O3 公司自转（活体达成）' },
];
export const COMPANY_KR_CATALOG = [
  ['3dbc40c2-ba63-811d-89cc-c17863d7ba80', 0, 'KR1.1 抖音链路周产合格线索（条/周）', '条/周'],
  ['3dbc40c2-ba63-81d0-a417-c8e2919f77f1', 0, 'KR1.2 FDE 晨报线连续非 GREY（周）', '周'],
  ['3dbc40c2-ba63-8116-bace-debc4c74d6e5', 0, 'KR1.3 首个客户完整走完 商机→交付→验收（例）', '例'],
  ['3dbc40c2-ba63-81fd-a7da-d7c8e57fbc5f', 1, 'KR2.1 九平台真机发布周产出（条/周，带证据）', '条/周'],
  ['3dbc40c2-ba63-81b4-b5ab-e27542cba851', 1, 'KR2.2 发布任务审批+证据覆盖率（%）', '%'],
  ['3dbc40c2-ba63-8158-808a-e81bd769eb6b', 2, 'KR3.1 活体 DoD 达标条数（连续7天）', '达标条数（连续7天）'],
  ['3dbc40c2-ba63-811c-bbb7-f4e0e040098e', 2, 'KR3.2 老板审批健康：批准率下限（%，区间60-95）', '%'],
  ['3dbc40c2-ba63-812c-a185-e8eab139502a', 2, 'KR3.3 晨报成本行上线（0/1）', '0/1'],
].map(([page_id, goal, title, unit]) => ({ page_id, goal_id: COMPANY_GOALS[goal].page_id, title, unit }));
export const COMPANY_FORMULA = 'if(prop("Start")>prop("Target"), round((prop("Start")-prop("Current"))/ (prop("Start")-prop("Target")) * 1000) / 1000, round(((prop("Current") - prop("Start")) / (prop("Target") - prop("Start"))) * 1000) / 1000)';
export const COMPANY_KR_SQL_GUARD = "COALESCE(metadata->>'metric_mode','') <> 'company_formula_v1' AND NOT (COALESCE(custom_props,'{}'::jsonb) ? 'company_notion')";

export function isCompanyKr(row) {
  return row?.metadata?.metric_mode === COMPANY_METRIC_MODE || Boolean(row?.custom_props?.company_notion);
}

/** 原 decimal 字符串避免 numeric(12,2) 的舍入成为公式输入。 */
export function rawDecimal(value) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return null;
  const text = String(value);
  if (/^[+-]?\d+(?:\.\d+)?$/.test(text)) return text.replace(/^\+/, '');
  // Notion 数值使用有限 IEEE number；指数形式展开后仍保留其观测值。
  if (/^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i.test(text)) {
    const [mantissa, exp] = text.toLowerCase().split('e');
    const negative = mantissa.startsWith('-');
    const digits = mantissa.replace(/^[+-]/, '').replace('.', '');
    const position = mantissa.replace(/^[+-]/, '').split('.')[0].length + Number(exp);
    return (negative ? '-' : '') + (position <= 0 ? '0.' + '0'.repeat(-position) + digits : position >= digits.length ? digits + '0'.repeat(position - digits.length) : digits.slice(0, position) + '.' + digits.slice(position));
  }
  return null;
}

export function companyMetric(start, current, target) {
  const values = [start, current, target].map(rawDecimal);
  const base = { start: values[0], current: values[1], target: values[2], ratio: null, ratio_state: 'undefined' };
  if (values.some(v => v == null)) return base;
  const places = Math.max(...values.map(v => (v.split('.')[1] || '').length));
  const integers = values.map(v => { const [a, b = ''] = v.split('.'); return BigInt(a + b.padEnd(places, '0')); });
  const [s, c, t] = integers;
  let numerator = s > t ? s - c : c - s;
  let denominator = s > t ? s - t : t - s;
  if (denominator === 0n) return base;
  if (denominator < 0n) { numerator = -numerator; denominator = -denominator; }
  // round(x*1000)/1000，按 nearest、half 向 +∞；负比值不 clamp。
  const scaled = numerator * 1000n;
  let rounded = scaled / denominator;
  const remainder = scaled % denominator;
  if (remainder >= 0n && remainder * 2n >= denominator) rounded++;
  if (remainder < 0n && -remainder * 2n > denominator) rounded--;
  const ratio = Number(rounded) / 1000;
  return Number.isFinite(ratio) ? { ...base, ratio, ratio_state: 'defined' } : base;
}

/** typed 列为兼容显示；超出既有 numeric(12,2) 范围时保留 raw、兼容列置空。 */
export function compatibleValue(raw) { return raw == null || Math.abs(Number(raw)) >= 9999999999.995 ? null : raw; }
export function compatibleProgress(metric) {
  const pct = metric.ratio == null ? null : metric.ratio * 100;
  return { progress: pct == null || Math.abs(pct) > 2147483647 ? null : Math.round(pct), progress_pct: pct == null || Math.abs(pct) >= 999.995 ? null : Number(pct.toFixed(1)) };
}

/** PG Date解析会丢掉微秒；SQL附带文本版本，接口原样保留其六位精度。 */
export function companyVersion(kr) {
  if (!kr.observation_version) return new Date(kr.updated_at).toISOString();
  return kr.observation_version.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
}
export function canonicalCompanyVersion(value) {
  const fraction = String(value).match(/\.(\d+)/)?.[1] || '';
  return new Date(value).toISOString().slice(0, 19) + '.' + fraction.padEnd(6, '0') + 'Z';
}

export function companyKrView(kr) {
  const metric = kr.metadata?.company_metric || {};
  const source = kr.custom_props?.company_notion || {};
  return {
    id: kr.id, title: kr.title, source_page_id: source.page_id, source_goal_id: source.goal_id,
    objective: { id: kr.objective_id || null, title: kr.objective_title || null }, source_area_ids: source.area_ids || [],
    unit: kr.unit, metric_mode: COMPANY_METRIC_MODE, start_value: metric.start ?? null,
    current_value: metric.current ?? null, target_value: metric.target ?? null,
    progress_ratio: metric.ratio ?? null, progress_pct: metric.ratio == null ? null : Number((metric.ratio * 100).toFixed(1)),
    validation_state: kr.metadata?.validation_state || 'unverified', status: kr.metadata?.company_status || kr.status,
    updated_at: companyVersion(kr),
  };
}

export function companyPatchIsReserved(body) {
  return ['metadata', 'custom_props'].some(key => key in body && (body[key] === null || typeof body[key] !== 'object' || Array.isArray(body[key])))
    || ['current_value', 'target_value', 'unit', 'objective_id'].some(key => key in body)
    || ['metric_mode', 'company_metric', 'company_status', 'validation_state', 'progress_source', 'unit_source', 'last_observation', 'source_system', 'company_current_baseline', 'company_formula', 'imported_snapshot', 'metric_window', 'last_target_inlet', 'last_current_inlet'].some(key => key in (body.metadata || {}))
    || 'company_notion' in (body.custom_props || {});
}

export async function assertCompanyPatch(pool, id, body, table = 'key_results') {
  if (body.custom_props?.company_notion || body.metadata?.metric_mode === COMPANY_METRIC_MODE || body.metadata?.source_system === 'notion-company-okr') {
    const error = new Error('公司来源身份须走幂等导入入口'); error.status = 409; throw error;
  }
  if (!companyPatchIsReserved(body)) return;
  for (const name of table === 'both' ? ['objectives', 'key_results'] : [table]) {
    if (!['objectives', 'key_results'].includes(name)) throw new Error('非法公司来源表');
    const { rows } = await pool.query(`SELECT metadata, custom_props FROM ${name} WHERE id=$1`, [id]);
    if (isCompanyKr(rows[0])) { const error = new Error('公司KR/Objective保留字段须走指标观察或人工入口'); error.status = 409; throw error; }
  }
}
