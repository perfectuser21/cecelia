#!/usr/bin/env bash
# Smoke: notion-probe-projection — 验证层探针/判定回执/格子颜色投影到 Notion（链 bf5088a3 棒4-2，任务 bf8d6ffb，决策 10a68212）
# 验证（假池 + 假 notionReq，不打真 Notion、不连库）：
#   1. 探针：库登记 → 补缺列 → POST 建页 → 回写 notion_id/指纹；同行二次推送指纹相同 → 不打 Notion 只抬 synced
#   2. 判定回执：SELECT 只捞 business_probe_runner；批次去 <workflow>-crontab- 前缀；FAIL 行带原因
#   3. 格子行：cell_status 翻色后指纹变 → PATCH 既有页（引擎更新路径），props 带 CellStatus
#   4. 接线：主链末尾挂 runProbeProjection；step_links SELECT 走 updated_at 增量；迁移 478 与回滚存在；两库登记为 push/active
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "[notion-probe-projection-smoke] 1-3. 三根血管（假池 + 假 Notion）"
node --input-type=module -e "
import { pushStepProbes, pushProbeReceipts, buildStepLinkNotionProperties, stripCrontabPrefix } from './src/notion-probe-projection.js';
import { pushRegisteredRows, propsDigest } from './src/lib/notion-projection-engine.js';

const notionCalls = [];
const notionReq = async (token, path, method, body) => {
  notionCalls.push({ path, method, body });
  if (method === 'GET') return { properties: { '探针键': { type: 'title' }, '名称': { type: 'title' } } };
  if (path === '/pages' && method === 'POST') return { id: 'page-' + notionCalls.length };
  return {};
};
const probeRow = { id: 'p1', probe_key: 'videos_readback', workflow: 'social-keyword-leadgen', stage: 'delivery', severity: 'warn', active: true,
  spec_hash: '7f88e04b'.padEnd(64, '0'), spec: { probe: { type: 'sql', target: 'pg_zenithjoy', query: 'SELECT 1' }, expect: { op: '>=', ref: 'metrics.videos_processed' } },
  cell_key: 'stage:delivery', journey_name: '客户智能获客路径', notion_id: null, notion_digest: null };
const receiptRow = { id: 'r1', run_id: 'social-keyword-leadgen-crontab-auto09262230__a1.delivery', assertion_ref_snapshot: 'probe:videos_readback', verdict: 'FAIL',
  scenario_evidence: { op: '>=', reason: 'value_mismatch', expected: 7, observed: '6', severity: 'warn' }, completed_at: '2026-09-27T00:35:05.197Z',
  cell_key: 'stage:delivery', journey_name: '客户智能获客路径', notion_id: null, notion_digest: null };
const store = { step_probes: [probeRow], journey_assertion_receipts: [receiptRow] };
const sqls = [];
const pool = { query: async (sql, params = []) => {
  sqls.push(sql);
  if (/FROM notion_projection_map/.test(sql)) return { rows: [{ notion_db_id: 'db-' + params[0] }] };
  if (/FROM step_probes sp/.test(sql)) return { rows: store.step_probes };
  if (/FROM journey_assertion_receipts r/.test(sql)) return { rows: store.journey_assertion_receipts };
  const m = /UPDATE (\w+) SET notion_id = \\\$2, notion_digest = \\\$3/.exec(sql);
  if (m) { const row = store[m[1]].find((r) => r.id === params[0]); row.notion_id = params[1]; row.notion_digest = params[2]; }
  return { rows: [] };
} };

// 1. 探针：首推建页 + 回写；二次推送指纹相同不打 Notion
let st = await pushStepProbes(pool, 't', { notionReq });
if (st.created !== 1) { console.error('FAIL 探针首推应 created=1: ' + JSON.stringify(st)); process.exit(1); }
if (!notionCalls.some((c) => c.path === '/databases/db-step_probes' && c.method === 'PATCH' && c.body.properties['关联格子'])) { console.error('FAIL 探针库应补缺列'); process.exit(1); }
const post = notionCalls.find((c) => c.path === '/pages' && c.method === 'POST');
if (post.body.parent.database_id !== 'db-step_probes' || post.body.properties['期望'].rich_text[0].text.content !== '>= metrics.videos_processed') { console.error('FAIL 探针页 props'); process.exit(1); }
if (!/^page-\d+$/.test(probeRow.notion_id || '')) { console.error('FAIL 探针未回写 notion_id: ' + probeRow.notion_id); process.exit(1); }
const before = notionCalls.filter((c) => c.path.startsWith('/pages')).length;
st = await pushStepProbes(pool, 't', { notionReq });
const after = notionCalls.filter((c) => c.path.startsWith('/pages')).length;
if (st.skipped !== 1 || after !== before) { console.error('FAIL 二次推送指纹相同应 skipped=1 且不打 Notion'); process.exit(1); }
if (!sqls.some((s) => /UPDATE step_probes SET notion_synced_at = NOW\(\)/.test(s))) { console.error('FAIL 指纹相同应抬 synced'); process.exit(1); }
console.log('探针：建页/补列/回写/指纹去重 ✓');

// 2. 判定回执：业务行过滤 + 渲染
st = await pushProbeReceipts(pool, 't', { notionReq });
const rq = sqls.find((s) => /FROM journey_assertion_receipts r/.test(s));
if (!/executor_kind = 'business_probe_runner'/.test(rq) || !/notion_synced_at IS NULL/.test(rq)) { console.error('FAIL 回执 SELECT 应只捞业务行且只增'); process.exit(1); }
const rp = notionCalls.filter((c) => c.path === '/pages' && c.method === 'POST').pop().body.properties;
if (rp['批次'].rich_text[0].text.content !== 'auto09262230__a1.delivery' || rp['判定'].select.name !== 'FAIL' || rp['原因'].rich_text[0].text.content !== 'value_mismatch') { console.error('FAIL 回执 props: ' + JSON.stringify(rp)); process.exit(1); }
if (stripCrontabPrefix('plain') !== 'plain') { console.error('FAIL 无前缀 run_id 应原样'); process.exit(1); }
console.log('判定回执：业务行过滤/批次前缀/判定原因 ✓');

// 3. 格子行翻色 → 指纹变 → PATCH 既有页
const link = { id: 'l1', journey_name: '客户智能获客路径', step_name: 'delivery', step_order: 4, status: 'planned', cell_kind: 'element', cell_key: 'stage:delivery', cell_status: 'gray', assertion_ref: 'probe:videos_readback', journey_notion_id: 'jn-1' };
link.notion_id = 'page-link'; link.notion_digest = propsDigest(buildStepLinkNotionProperties(link, {}));
link.cell_status = 'pending';
const lp = { query: async () => ({ rows: [] }) };
st = await pushRegisteredRows(lp, 't', { table: 'journey_step_links', dbId: 'db-links', rows: [link], notionReq, buildProps: (l) => buildStepLinkNotionProperties(l, {}) });
const patch = notionCalls.find((c) => c.path === '/pages/page-link' && c.method === 'PATCH');
if (st.patched !== 1 || !patch || patch.body.properties.CellStatus.select.name !== 'pending') { console.error('FAIL 格子翻色应 PATCH 既有页且 CellStatus=pending'); process.exit(1); }
console.log('格子行：翻色 → PATCH CellStatus=pending ✓');
"

echo "[notion-probe-projection-smoke] 4. 接线钉子"
node -e "
const fs = require('fs');
const checks = [
  ['src/notion-push-sync.js', [\"import('./notion-probe-projection.js')\", 'await runProbeProjection(pool, { token, logSyncError })', 'l.updated_at > l.notion_synced_at', 'buildStepLinkDbProps()', 'buildStepLinkNotionProperties(l, schemaProps)', \"STEP_LINKS_DB      = '3e8c40c2-ba63-8194-a47c-dcf5f4b508bb'\"]],
  ['migrations/479_step_links_notion_db.sql', [\"'3e8c40c2-ba63-8194-a47c-dcf5f4b508bb'\", \"status = 'archived'\"]],
  ['migrations/478_notion_projection_probe_receipts.sql', ['ALTER TABLE step_probes ADD COLUMN IF NOT EXISTS notion_id', 'ALTER TABLE journey_assertion_receipts ADD COLUMN IF NOT EXISTS notion_digest', 'trg_touch_journey_step_links_updated_at', \"'step_probes', 'push'\", \"'journey_assertion_receipts', 'push'\"]],
  ['migrations/rollback/478_notion_projection_probe_receipts.down.sql', [\"DELETE FROM schema_version WHERE version = '478'\"]],
  ['src/ops-notion-schema.js', ['PROBE_DB_PROPS', 'buildStepLinkDbProps']],
  ['../../scripts/ops/create-probe-notion-dbs.js', ['3dbc40c2-ba63-810e-b96f-f7523838b411', \"'/databases', 'POST'\"]],
];
let fail = false;
for (const [file, needles] of checks) {
  const src = fs.readFileSync(file, 'utf8');
  for (const n of needles) if (!src.includes(n)) { console.error('FAIL ' + file + ' 缺少: ' + n); fail = true; }
}
if (!/notion_synced_at IS NULL[\s\S]*cell_kind IS NULL/.test(fs.readFileSync('src/notion-push-sync.js', 'utf8')) ) console.log('step_links 不再排除格子行 ✓');
else { console.error('FAIL step_links SELECT 仍排除格子行'); fail = true; }
if (fail) process.exit(1);
console.log('主链挂接 / 迁移 478 / 列定义 / 建库脚本 全部接线 ✓');
"

echo "[notion-probe-projection-smoke] PASS"
