/**
 * notion-probe-projection.js — 验证层三样证据投影到 Notion 驾驶舱（链 bf5088a3 棒4-2，决策 10a68212）
 *
 * 三根血管，全部走 lib/notion-projection-engine.js 的统一引擎（指纹去重 / PATCH 或 POST / 记账列回写）：
 *   1. step_probes 全行            →「探针」库（列名中文，主理人口径）
 *   2. journey_assertion_receipts   →「判定回执」库——只投 executor_kind='business_probe_runner'，
 *      harness 代码断言回执（brain_assertion_runner）不投；行 append-only，按 notion_synced_at IS NULL 只增
 *   3. journey_step_links 格子行    → Backbone-Step Map 库（buildStepLinkNotionProperties 由
 *      notion-push-sync.pushJourneyStepLinks 使用；cell_status 翻色 → 迁移 478 触发器抬 updated_at → 指纹变 → PATCH）
 *
 * 血管注册制：库 id 只认 notion_projection_map（direction push/both 且 active），未登记整段跳过（flag-off 安全）。
 * 推前缺列即补（Notion 缺列 400 的血训）；失败只记日志，Postgres 才是真相源。
 */
import { notionReq as defaultNotionReq, getToken } from './recurring-notion-sync.js';
import { pushRegisteredRows, resolveDbId } from './lib/notion-projection-engine.js';
import { ensureOpsDbProps } from './ops-quota-notion.js';
import { PROBE_DB_PROPS } from './ops-notion-schema.js';

const RT_MAX = 1900;
const CRONTAB_MARK = '-crontab-';

function rt(text) {
  const s = text === null || text === undefined ? '' : String(text);
  return s === '' ? [] : [{ type: 'text', text: { content: s.slice(0, RT_MAX) } }];
}
const rich = (text) => ({ rich_text: rt(text) });
const sel = (v) => ({ select: { name: String(v ?? 'unknown').slice(0, 100) } });
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const show = (v) => (v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v));

/** 「查什么」：type@target [→ reduce]: sql 原文 / http url，一句话。 */
export function describeProbe(probe) {
  if (!probe || typeof probe !== 'object') return '';
  const head = `${probe.type || '?'}@${probe.target || '?'}${probe.reduce ? ` → ${probe.reduce}` : ''}`;
  const body = probe.type === 'sql' ? probe.query : probe.type === 'http' ? probe.url : JSON.stringify(probe);
  return `${head}: ${oneLine(body)}`;
}

/** 「期望」：op + ref|value；not_null_all 只有 op。 */
export function describeExpect(expect) {
  if (!expect || typeof expect !== 'object') return '';
  const op = expect.op || '?';
  if (expect.ref !== undefined) return `${op} ${expect.ref}`;
  if (expect.value !== undefined) return `${op} ${JSON.stringify(expect.value)}`;
  return op;
}

/** step_probes ⋈ journey_step_links(cell_key) ⋈ journeys(name) 一行 →「探针」库 properties。 */
export function buildStepProbeProps(r) {
  const spec = r.spec && typeof r.spec === 'object' ? r.spec : {};
  const cell = r.cell_key ? `${r.journey_name ? `${r.journey_name} · ` : ''}${r.cell_key}` : '';
  return {
    '探针键': { title: rt(r.probe_key) },
    '工作流': sel(r.workflow),
    '步骤': sel(r.stage),
    '查什么': rich(describeProbe(spec.probe)),
    '期望': rich(describeExpect(spec.expect)),
    '严重级': sel(r.severity ?? spec.severity ?? 'error'),
    '启用': { checkbox: r.active !== false },
    '哈希前缀': rich(String(r.spec_hash || '').slice(0, 8)),
    '关联格子': rich(cell),
    '说明': rich(oneLine(spec.note)),
  };
}

/** zenithjoy workflow-result.sh 的 run_id 形如 `<workflow>-crontab-<TAG>__a<N>.<stage>`，批次 = 去前缀。 */
export function stripCrontabPrefix(runId) {
  const s = String(runId ?? '');
  const i = s.indexOf(CRONTAB_MARK);
  return i > 0 ? s.slice(i + CRONTAB_MARK.length) : s;
}

/** 业务探针回执一行 →「判定回执」库 properties。没发生的事不编造：无 completed_at 无「时间」。 */
export function buildProbeReceiptProps(r) {
  const ev = r.scenario_evidence && typeof r.scenario_evidence === 'object' ? r.scenario_evidence : {};
  const probe = String(r.assertion_ref_snapshot || '').replace(/^probe:/, '');
  const batch = stripCrontabPrefix(r.run_id);
  const p = {
    '名称': { title: rt(`${r.verdict} ${probe} · ${batch}`) },
    '批次': rich(batch),
    '路径名': rich(r.journey_name),
    '步骤名': rich(r.cell_key),
    '探针': rich(probe),
    '读回': rich(show(ev.observed)),
    '期望': rich(show(ev.expected)),
    '判定': sel(r.verdict),
    '严重级': sel(ev.severity || 'error'),
    '原因': rich(ev.reason || ''),
  };
  const at = r.completed_at ? new Date(r.completed_at) : null;
  if (at && !Number.isNaN(at.getTime())) p['时间'] = { date: { start: at.toISOString() } };
  return p;
}

/**
 * journey_step_links 一行 → Backbone-Step Map 库 properties。
 * 格子行（cell_kind 非空）带 CellKind/CellKey/CellStatus/AssertionRef；旧连接行只有 Name/Status。
 * 库里没有 Journey/Step 列（2026-09-27 实查：Name/Status/Order/Phase/Notes/Step 1/Legacy Step/…），
 * Journey relation 由 buildStepLinkDbProps 缺列即补，Step 不发。
 */
export function buildStepLinkNotionProperties(l, schemaProps = {}) {
  const label = l.cell_key || l.step_name || l.step_id || '';
  const properties = {
    Name: { title: [{ text: { content: `${l.journey_name} — ${label}`.slice(0, 200) } }] },
    Status: { select: { name: l.status || 'planned' } },
    ...('Order' in schemaProps && { Order: { number: l.step_order } }),
  };
  if (l.cell_kind) {
    properties.CellKind = sel(l.cell_kind);
    properties.CellKey = rich(l.cell_key);
    properties.CellStatus = sel(l.cell_status || 'gray');
    properties.AssertionRef = rich(l.assertion_ref || '');
  }
  if (l.journey_notion_id) properties.Journey = { relation: [{ id: l.journey_notion_id }] };
  return properties;
}

function isStaleRelationError(err) {
  return Boolean(err?.message && err.message.includes('Could not find page'));
}
function isWrongDatabaseError(err) {
  const m = err?.message || '';
  return /400/.test(m) && /is not a property that exists|is expected to be/.test(m);
}

async function ensureCols(pool, token, dbId, props, label, { notionReq, logSyncError }) {
  try {
    const { added } = await ensureOpsDbProps(token, dbId, props, { notionReq });
    if (added.length) console.log(`[probe-projection] ${label} 补列: ${added.join(', ')}`);
  } catch (err) {
    await logSyncError(pool, `[probe-projection] ${label} 补列失败: ${err.message}`);
  }
}

function resolveDeps(deps = {}) {
  return {
    notionReq: deps.notionReq ?? defaultNotionReq,
    logSyncError: deps.logSyncError ?? (async () => {}),
  };
}

/** step_probes 全行 →「探针」库。updated_at 由 routes/step-probes.js upsert 维护，增量 = 新行或改过的行。 */
export async function pushStepProbes(pool, token, deps = {}) {
  const d = resolveDeps(deps);
  const dbId = await resolveDbId(pool, 'step_probes');
  if (!dbId) return null;
  await ensureCols(pool, token, dbId, PROBE_DB_PROPS.step_probes, '探针库', d);
  const { rows } = await pool.query(
    `SELECT sp.*, jsl.cell_key, j.name AS journey_name
       FROM step_probes sp
       LEFT JOIN journey_step_links jsl ON jsl.id = sp.journey_step_link_id
       LEFT JOIN journeys j ON j.id = jsl.journey_id
      WHERE sp.notion_synced_at IS NULL OR sp.updated_at > sp.notion_synced_at
      ORDER BY sp.updated_at
      LIMIT 50`);
  if (rows.length === 0) return { created: 0, patched: 0, skipped: 0, failed: 0, cleared: 0 };
  return pushRegisteredRows(pool, token, {
    table: 'step_probes', dbId, rows, buildProps: buildStepProbeProps,
    notionReq: d.notionReq, logSyncError: d.logSyncError, isStaleRelationError, isWrongDatabaseError, label: 'step_probe',
  });
}

/** 业务探针回执 →「判定回执」库。行不可变（append-only），只增：notion_synced_at IS NULL。 */
export async function pushProbeReceipts(pool, token, deps = {}) {
  const d = resolveDeps(deps);
  const dbId = await resolveDbId(pool, 'journey_assertion_receipts');
  if (!dbId) return null;
  await ensureCols(pool, token, dbId, PROBE_DB_PROPS.probe_receipts, '判定回执库', d);
  const { rows } = await pool.query(
    `SELECT r.id, r.run_id, r.assertion_ref_snapshot, r.scenario_evidence, r.verdict, r.completed_at,
            r.notion_id, r.notion_digest, jsl.cell_key, j.name AS journey_name
       FROM journey_assertion_receipts r
       LEFT JOIN journey_step_links jsl ON jsl.id = r.journey_step_link_id
       LEFT JOIN journeys j ON j.id = jsl.journey_id
      WHERE r.executor_kind = 'business_probe_runner'
        AND r.notion_synced_at IS NULL
      ORDER BY r.completed_at DESC
      LIMIT 50`);
  if (rows.length === 0) return { created: 0, patched: 0, skipped: 0, failed: 0, cleared: 0 };
  return pushRegisteredRows(pool, token, {
    table: 'journey_assertion_receipts', dbId, rows, buildProps: buildProbeReceiptProps,
    notionReq: d.notionReq, logSyncError: d.logSyncError, isStaleRelationError, isWrongDatabaseError, label: 'probe_receipt',
  });
}

/** 两根血管各自吞错，不连坐；供 notion-push-sync.runNotionPushSync 末尾挂接。 */
export async function runProbeProjection(pool, { token, notionReq, logSyncError } = {}) {
  const t = token ?? getToken();
  const out = {};
  for (const [key, fn] of [['step_probes', pushStepProbes], ['probe_receipts', pushProbeReceipts]]) {
    try {
      out[key] = await fn(pool, t, { notionReq, logSyncError });
    } catch (err) {
      console.warn(`[probe-projection] ${key} 投影失败（非阻断）: ${err.message}`);
      out[key] = { error: err.message };
    }
  }
  return out;
}
