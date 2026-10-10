/**
 * Activity / Step 卡片（树+仓库 v3.0，第二轮「人打开看得懂」）：Brain 真身 → Notion 目录库的机器列与 Activity 页面正文。
 * 列只放人一眼要看的：承诺（FR）/输入/输出/谁来执行/还缺什么；其余 9 项标准内容写进页面正文的机器区块（activity-body.js）。
 * 「还缺什么」一列人话替代 8 个格子列和登记缺口：没写的标准项 + 红/待判/未验的格子。
 */
// 与 directory-source.rich 同形（不 import 它，避免两模块互相引用）
const rich = value => ({ rich_text: value == null || value === '' ? [] : [{ text: { content: (typeof value === 'string' ? value : JSON.stringify(value)).slice(0, 1900) } }] });

const EXECUTORS = Object.freeze({ code: '代码', agent: 'AI', human: '人' });
/** executor_kind → 中文；没写 = 「未写」。 */
export const executorLabel = kind => EXECUTORS[kind] ?? '未写';

/** 13 个标准项：名字、真身字段、对应的格子（没有格子的项只查写没写）。 */
export const ACTIVITY_ITEMS = Object.freeze([
  { label: '承诺', field: 'promise', cell: 'promise' }, { label: '输入', field: 'inputs' }, { label: '输出', field: 'outputs' },
  { label: '前提', field: 'preconditions' }, { label: '不变量', field: 'invariants', cell: 'invariants' }, { label: 'NFR', field: 'nfr', cell: 'nfr' },
  { label: '失败语义', field: 'failure', cell: 'failure' }, { label: '读回', field: 'readback', cell: 'readback' },
  { label: '判定点', field: 'judgment', cell: 'judgment' }, { label: '对抗', field: 'adversarial', cell: 'adversarial' },
  { label: '保质期', field: 'shelf_life_days', cell: 'shelf_life' }, { label: '用料', field: null }, { label: '谁来执行', field: 'executor_kind' },
]);
/** 写在页面正文、不占列的 9 项（顺序即正文顺序）。 */
export const BODY_ITEMS = Object.freeze(['前提', '不变量', 'NFR', '失败语义', '读回', '判定点', '对抗', '保质期', '用料']);

const isEmpty = v => v == null || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

/** jsonb → 人话：带 type/fields 的数据描述写成「Video(line_key, video_id)」，数组一行一个，对象写「键：值」，其余原样。 */
export function humanize(value) {
  if (isEmpty(value)) return '';
  if (Array.isArray(value)) return value.map(humanize).filter(Boolean).join('\n');
  if (typeof value === 'object') {
    if (typeof value.type === 'string' && (Array.isArray(value.fields) || value.effect || value.cardinality)) {
      return `${value.type}${value.cardinality === 'many' ? '[]' : ''}${value.effect ? ` ${value.effect}` : ''}(${(value.fields || []).join(', ')})`;
    }
    return Object.entries(value).filter(([, v]) => !isEmpty(v)).map(([k, v]) => `${k}：${inline(v)}`).join('；');
  }
  return String(value);
}
/** 嵌套值写成一行：数组用「、」，对象写「键 值」用「，」。 */
function inline(value) {
  if (Array.isArray(value)) return value.map(inline).join('、');
  if (value && typeof value === 'object') return Object.entries(value).filter(([, v]) => !isEmpty(v)).map(([k, v]) => `${k} ${inline(v)}`).join('，');
  return String(value);
}

const itemValue = (a, uses, item) => (item.label === '用料' ? uses : a[item.field]);
const usesText = uses => uses.map(u => `${u.item_name}（${u.role}）`).join('；');

/**
 * 还缺什么（一列人话）：没写的标准项；格子红=「X：红」、待判=「X：待判」、内容写了但格子没判过=「X：未验」；外加调用方给的登记问题。
 * 全齐写「齐了」。
 */
export function activityMissing(a = {}, cells = [], uses = [], extra = []) {
  const status = new Map(cells.filter(c => !c.parent_cell_key).map(c => [c.cell_key, c.cell_status]));
  const blank = [], flagged = [];
  for (const item of ACTIVITY_ITEMS) {
    const written = item.label === '谁来执行' ? Boolean(EXECUTORS[a.executor_kind]) : !isEmpty(itemValue(a, uses, item));
    if (!written) { blank.push(item.label); continue; }
    if (!item.cell) continue;
    const s = status.get(item.cell);
    if (s === 'red') flagged.push(`${item.label}：红`);
    else if (s === 'pending') flagged.push(`${item.label}：待判`);
    else if (s !== 'green') flagged.push(`${item.label}：未验`);
  }
  const parts = [...(blank.length ? [`没写：${blank.join('、')}`] : []), ...flagged, ...extra];
  return parts.length ? parts.join('\n') : '齐了';
}

const VERDICTS = Object.freeze({ converged: '收敛', converging: '收敛中', diverged: '发散', no_data: '无数据' });
/** 裁判结论（activity_judgments 最新一条）→「收敛 · 连续绿 3/3」；没裁判过 =「未裁判」。 */
export function judgmentText(j) {
  if (!j) return '未裁判';
  return `${VERDICTS[j.verdict] ?? j.verdict} · 连续绿 ${j.consecutive_green ?? 0}/${j.required_green ?? '?'}`;
}

/** Activity 卡片列：承诺（FR）/输入/输出/谁来执行/还缺什么。 */
export function buildActivityCardProps(a = {}, cells = [], uses = [], extra = []) {
  return {
    '承诺（FR）': rich(humanize(a.promise) || null), '输入': rich(humanize(a.inputs) || null), '输出': rich(humanize(a.outputs) || null),
    '谁来执行': { select: { name: executorLabel(a.executor_kind) } }, '还缺什么': rich(activityMissing(a, cells, uses, extra)),
  };
}

/** 页面正文 9 段：每段一个小标题 + 内容，没写的写「（未写）」。返回 [{ label, text }]。 */
export function activityBodySections(a = {}, uses = []) {
  return BODY_ITEMS.map(label => {
    const item = ACTIVITY_ITEMS.find(i => i.label === label);
    const value = itemValue(a, uses, item);
    const text = label === '用料' ? usesText(uses) : label === '保质期' && Number.isFinite(value) ? `${value} 天` : humanize(value);
    return { label, text: text || '（未写）' };
  });
}

/** Step 卡片：做什么、失败了怎么办（名字/进出/验收在目录源里拼）。 */
export function buildStepCardProps(s = {}) {
  return { '做什么': rich(s.action ?? null), '失败了怎么办': rich(s.on_fail ?? null) };
}
