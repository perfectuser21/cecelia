/**
 * skill-registry-notion-props.js — Skill Registry 投影的列定义与取值映射（纯函数，Skill 台账投影 PR1b，任务 47def5bb）
 *
 * 列级分权（决策 19391396，同 Tasks）：
 *  machine 列：Brain 单向覆盖（扫描入账写的机器列）
 *  human 列：主理人在 Notion 改，推送走三方基线合并（判定点 24736022），PR3 回拉进 Brain
 *  none 列：只建列不写值（负责人，people 类型由人在 Notion 直接选）
 * 列按「键」管理，Notion 侧的名字/有无/类型以列账为准（见 skill-registry-projection.js），这里的 name 只是首建时的名字。
 */
import { createHash } from 'node:crypto';

export const SKILL_REGISTRY_DB = '353c40c2-ba63-81bf-ae3e-f0e6fa3753d7';

const PLATFORM_LABEL = { 'claude-code': 'Claude Code', openclaw: 'OpenClaw', codex: 'Codex' };
const PRESENCE_LABEL = { present: '在用', broken: '断链', gone: '已下线', unknown: '未扫描' };
const TEXT_LIMIT = 2000;

const opts = (names) => ({ options: names.map((name) => ({ name })) });

/** 列定义：key → Notion 列。existing=true 的四列库里原本就有，首轮按名字认领不新建。 */
export const COLUMNS = Object.freeze([
  { key: 'name', name: 'Name', type: 'title', owner: 'machine', existing: true },
  { key: 'description', name: 'Description', type: 'rich_text', owner: 'machine', existing: true },
  { key: 'source', name: 'Source', type: 'select', owner: 'machine', existing: true },
  { key: 'status', name: 'Status', type: 'select', owner: 'human', existing: true },
  { key: 'platforms', name: '已装平台', type: 'multi_select', owner: 'machine', def: opts(Object.values(PLATFORM_LABEL)) },
  { key: 'presence', name: '存在性', type: 'select', owner: 'machine', def: opts(Object.values(PRESENCE_LABEL)) },
  { key: 'lastScan', name: '最后扫描', type: 'date', owner: 'machine' },
  { key: 'sourcePath', name: '原件路径', type: 'rich_text', owner: 'machine' },
  { key: 'agents', name: '分配Agent', type: 'multi_select', owner: 'machine' },
  { key: 'evalScore', name: '评测分', type: 'rich_text', owner: 'machine' },
  { key: 'driftCopies', name: '不一致副本数', type: 'number', owner: 'machine' },
  { key: 'targets', name: '目标平台', type: 'multi_select', owner: 'human', def: opts(Object.values(PLATFORM_LABEL)) },
  { key: 'tier', name: '转OpenClaw难度', type: 'select', owner: 'human', def: opts(['A', 'B', 'C']) },
  { key: 'businessLine', name: '业务线', type: 'select', owner: 'human' },
  { key: 'owner', name: '负责人', type: 'people', owner: 'none' },
  { key: 'category', name: '分类', type: 'select', owner: 'human' },
  { key: 'note', name: '备注', type: 'rich_text', owner: 'human' },
]);

export const HUMAN_KEYS = COLUMNS.filter((c) => c.owner === 'human').map((c) => c.key);

const labels = (codes, map) => [...new Set((codes || []).map((c) => map[c] || c))].sort();
const homeShort = (p) => (p ? String(p).replace(/^\/(Users|home)\/[^/]+/, '~') : null);
const dateOnly = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

export function machineValues(row) {
  const evalScore = row.metadata?.eval_score;
  return {
    name: row.name,
    description: row.description || null,
    source: row.source_kind || row.location || null,
    platforms: labels(row.platforms_installed, PLATFORM_LABEL),
    presence: PRESENCE_LABEL[row.presence] || PRESENCE_LABEL.unknown,
    lastScan: dateOnly(row.last_seen_at),
    sourcePath: homeShort(row.source_path),
    agents: [...(row.assigned_agents || [])].sort(),
    evalScore: evalScore == null ? null : String(evalScore).slice(0, 200),
    driftCopies: Number.isFinite(row.drift_copies) ? row.drift_copies : 0,
  };
}

export function humanValues(row) {
  return {
    status: row.status || null,
    targets: labels(row.platforms_target, PLATFORM_LABEL),
    tier: row.openclaw_tier || row.tier_suggested || null,
    businessLine: row.business_line || null,
    category: row.category || null,
    note: row.note || null,
  };
}

function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])]));
  return v;
}

export function machineDigest(values) {
  return createHash('md5').update(JSON.stringify(stable(values))).digest('hex');
}

const chunks = (s) => {
  const text = String(s);
  const out = [];
  for (let i = 0; i < text.length; i += TEXT_LIMIT) out.push({ type: 'text', text: { content: text.slice(i, i + TEXT_LIMIT) } });
  return out;
};
// Notion 选项名不许含逗号，且长度上限 100
const optionName = (s) => String(s).replace(/,/g, ' ').slice(0, 100);

export function toNotionProp(type, value) {
  const empty = value == null || value === '' || (Array.isArray(value) && value.length === 0);
  switch (type) {
    case 'title': return { title: empty ? [] : chunks(value).slice(0, 1) };
    case 'rich_text': return { rich_text: empty ? [] : chunks(value) };
    case 'select': return { select: empty ? null : { name: optionName(value) } };
    case 'multi_select': return { multi_select: empty ? [] : value.map((v) => ({ name: optionName(v) })) };
    case 'number': return { number: empty ? null : Number(value) };
    case 'date': return { date: empty ? null : { start: value } };
    default: throw new Error(`不支持的列类型：${type}`);
  }
}

export function fromNotionProp(prop) {
  if (!prop) return null;
  const v = prop[prop.type];
  switch (prop.type) {
    case 'title':
    case 'rich_text': return (v || []).map((t) => t.plain_text ?? t.text?.content ?? '').join('') || null;
    case 'select': return v?.name ?? null;
    case 'multi_select': return (v || []).map((o) => o.name).sort();
    case 'number': return v ?? null;
    case 'date': return v?.start ? String(v.start).slice(0, 10) : null;
    case 'people': return (v || []).map((p) => p.id).sort();
    default: return v ?? null;
  }
}

const canon = (v) => {
  if (v == null || v === '') return null;
  if (Array.isArray(v)) return v.length ? JSON.stringify([...v].map(String).sort()) : null;
  return String(v);
};

export function sameValue(a, b) {
  return canon(a) === canon(b);
}

/** 把 {key: value} 按列账（key → {name,type}）转成 properties；列账里没有的键不发。 */
export function buildProps(values, colMap) {
  const props = {};
  for (const [key, value] of Object.entries(values)) {
    const col = colMap[key];
    if (!col) continue;
    props[col.name] = toNotionProp(col.type, value);
  }
  return props;
}
