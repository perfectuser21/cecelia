#!/usr/bin/env bash
# Smoke: step-probes — 步级探针注册表 + probe:<key> 断言形状（链 bf5088a3 棒2，任务 ddf3fe8d，决策 702949b6）
# 验证（不连真库、不发网络；假 fetch 走 sync 脚本全链）：
#   1. spec 哈希确定性：键序无关、改一字节即变；非法 severity/expect 拒收
#   2. classify：probe:<k1>,<k2> → kind=probe/executor_kind=business_probe_runner；canonical 命令显式拒绝；cell 分类 runnable
#   3. sync 脚本：真 YAML → 假 Brain：upsert 带 journey_step_link_id、格子 PATCH assertion_ref=probe:...、缺格子报错不静默
#   4. 接线：server.js 挂路由、迁移 474 + 回滚存在、radius 排除 probe、smoke 登记 allowlist
set -euo pipefail
cd "$(dirname "$0")/../.."

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "[step-probes-smoke] 1. spec 哈希确定性 + 拒收"
node --input-type=module -e "
import { normalizeProbe, specHash, parseProbesDocument } from './src/lib/step-probe-spec.js';
const wf = 'social-keyword-leadgen';
const raw = { key: 'delivery.leads_count', stage: 'delivery', journey_cell: 'stage:delivery',
  probe: { type: 'sql', target: 'leadgen_db', query: 'SELECT count(*) AS n FROM leads' },
  expect: { op: '>=', ref: 'metrics.expected_leads' }, severity: 'error' };
const a = specHash(normalizeProbe(raw, { workflow: wf }));
const b = specHash(normalizeProbe({ severity: 'error', expect: raw.expect, probe: { query: raw.probe.query, target: 'leadgen_db', type: 'sql' }, journey_cell: raw.journey_cell, stage: 'delivery', key: raw.key }, { workflow: wf }));
if (a !== b) { console.error('FAIL 键序不同哈希应相同'); process.exit(1); }
const c = specHash(normalizeProbe({ ...raw, severity: 'warn' }, { workflow: wf }));
if (c === a) { console.error('FAIL 改一字节哈希应变'); process.exit(1); }
for (const [bad, code] of [[{ ...raw, severity: 'fatal' }, 'STEP_PROBE_SEVERITY_INVALID'], [{ ...raw, expect: { op: '>=' } }, 'STEP_PROBE_EXPECT_INVALID'], [{ ...raw, journey_cell: 'stage:scoring' }, 'STEP_PROBE_CELL_MISMATCH']]) {
  try { normalizeProbe(bad, { workflow: wf }); console.error('FAIL 应拒收 ' + code); process.exit(1); }
  catch (e) { if (e.code !== code) { console.error('FAIL 错误码应为 ' + code + ' 实际 ' + e.code); process.exit(1); } }
}
try { parseProbesDocument({ version: 1, workflow: wf, probes: [raw, raw] }); console.error('FAIL 重复 key 应拒收'); process.exit(1); } catch (e) { if (e.code !== 'STEP_PROBE_KEY_DUPLICATE') process.exit(1); }
console.log('哈希键序无关 / 改一字节即变 / 三类非法拒收 / 重复 key 拒收 ✓');
"

echo "[step-probes-smoke] 2. classify probe 形状 + canonical 命令拒绝 + cell 分类"
node --input-type=module -e "
import { classifyAssertionRef, canonicalAssertionCommandText, canonicalAssertionArgv } from './src/lib/gp-assertion-command.js';
import { classifyJourneyCellAssertion } from './src/lib/journey-cell-assertion.js';
const s = classifyAssertionRef('probe:delivery.leads_count,delivery.no_dup');
if (s.kind !== 'probe' || s.executor_kind !== 'business_probe_runner' || s.keys.length !== 2) { console.error('FAIL classify: ' + JSON.stringify(s)); process.exit(1); }
for (const fn of [canonicalAssertionCommandText, canonicalAssertionArgv]) {
  try { fn('probe:delivery.leads_count'); console.error('FAIL 探针不应有 shell 命令'); process.exit(1); }
  catch (e) { if (e.code !== 'ASSERTION_PROBE_NOT_RUNNABLE') { console.error('FAIL 错误码 ' + e.code); process.exit(1); } }
}
try { classifyAssertionRef('probe:\$(id)'); console.error('FAIL 非法 key 应拒收'); process.exit(1); } catch (e) { if (e.code !== 'ASSERTION_PROBE_KEY_INVALID') process.exit(1); }
const c = classifyJourneyCellAssertion({ assertion_ref: 'probe:delivery.leads_count' });
if (c.assertion_state !== 'probe' || c.runnable !== true || c.executor_kind !== 'business_probe_runner') { console.error('FAIL cell 分类: ' + JSON.stringify(c)); process.exit(1); }
if (classifyJourneyCellAssertion({ assertion_ref: 'probe:' }).assertion_state !== 'unknown') { console.error('FAIL 空 key 不该放行'); process.exit(1); }
if (classifyAssertionRef('packages/brain/src/x.test.js').kind !== 'vitest') { console.error('FAIL 既有 vitest 形状退化'); process.exit(1); }
console.log('probe 形状 / shell 拒绝 / 非法 key 拒收 / cell runnable / vitest 不退化 ✓');
"

echo "[step-probes-smoke] 3. sync 脚本全链（真 YAML + 假 Brain）"
cat > "$TMP/checks.yaml" <<'YAML'
version: 1
workflow: social-keyword-leadgen
probes:
  - key: delivery.leads_count
    stage: delivery
    journey_cell: "stage:delivery"
    probe: { type: sql, target: leadgen_db, query: "SELECT count(*) AS n FROM leads WHERE run_id = :run_id" }
    expect: { op: ">=", ref: metrics.expected_leads }
    severity: error
  - key: delivery.no_dup
    stage: delivery
    journey_cell: "stage:delivery"
    probe:
      type: http
      target: feishu_jinuo
      url: "https://open.feishu.cn/open-apis/bitable/v1/apps/GNuwbzY0da8GP0sv6MGcOTu9ntd/tables/tblmrJTyVgzTj89P/records"
      filter: { 运行批次: "$RUN_TAG" }
      reduce: count
      minus: { url: "https://open.feishu.cn/open-apis/bitable/v1/apps/GNuwbzY0da8GP0sv6MGcOTu9ntd/tables/tblmrJTyVgzTj89P/records", filter: { 进入最终线索: true }, reduce: count }
    expect: { op: "==", value: 0 }
    severity: warn
YAML
node --input-type=module -e "
import { loadProbesYaml, syncStepProbes } from '../../scripts/sync-step-probes.mjs';
const doc = loadProbesYaml('$TMP/checks.yaml');
const cell = { id: '97947882-52d7-410d-a503-40c860b63750', cell_key: 'stage:delivery', assertion_ref: null };
const calls = [];
const fetchFn = async (url, init = {}) => {
  const method = init.method || 'GET'; const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ method, url: String(url), body });
  const ok = (json) => ({ ok: true, status: 200, json: async () => json });
  if (method === 'GET') return ok([cell]);
  if (url.endsWith('/step-probes')) return ok({ upserted: body.probes.map(p => ({ probe_key: p.key, action: 'inserted' })) });
  return ok({});
};
const r = await syncStepProbes({ doc, journeyId: 'afa6abca-53c0-4815-8594-b7fb81ca547f', brainUrl: 'http://brain', fetchFn });
const up = calls.find(c => c.url.endsWith('/step-probes'));
if (!up || up.body.probes.some(p => p.journey_step_link_id !== cell.id)) { console.error('FAIL upsert 应带 journey_step_link_id'); process.exit(1); }
if (!/^[0-9a-f]{64}$/.test(up.body.source_sha256 || '')) { console.error('FAIL upsert 应带整文件 source_sha256'); process.exit(1); }
const http = up.body.probes.find(p => p.key === 'delivery.no_dup');
if (!http || http.probe.reduce !== 'count' || !http.probe.filter || !http.probe.minus || http.probe.minus.filter['进入最终线索'] !== true) { console.error('FAIL http 探针 filter/reduce/minus 应原样进 spec: ' + JSON.stringify(http && http.probe)); process.exit(1); }
const patch = calls.find(c => c.method === 'PATCH');
if (!patch || patch.body.assertion_ref !== 'probe:delivery.leads_count,delivery.no_dup') { console.error('FAIL 格子 assertion_ref: ' + JSON.stringify(patch)); process.exit(1); }
if (r.bound.length !== 1 || r.upserted.length !== 2) { console.error('FAIL 结果形状'); process.exit(1); }
try { await syncStepProbes({ doc, journeyId: 'afa6abca-53c0-4815-8594-b7fb81ca547f', brainUrl: 'http://brain', fetchFn: async () => ({ ok: true, status: 200, json: async () => [] }) }); console.error('FAIL 缺格子应报错'); process.exit(1); }
catch (e) { if (e.code !== 'STEP_PROBE_CELL_NOT_FOUND') { console.error('FAIL 错误码 ' + e.code); process.exit(1); } }
console.log('upsert 带 link_id + source_sha256 / http filter,reduce,minus 保留 / 格子 PATCH probe:k1,k2 / 缺格子报错 ✓');
"

echo "[step-probes-smoke] 4. 接线"
node -e "
const fs = require('fs');
const checks = [
  ['server.js', [\"import stepProbesRouter from './src/routes/step-probes.js'\", \"app.use('/api/brain', stepProbesRouter)\"]],
  ['migrations/474_step_probes.sql', ['CREATE TABLE IF NOT EXISTS step_probes', 'probe_key text NOT NULL UNIQUE', \"'474'\"]],
  ['migrations/rollback/474_step_probes.down.sql', ['DROP TABLE IF EXISTS step_probes']],
  ['migrations/476_step_probes_source_sha256.sql', ['ADD COLUMN IF NOT EXISTS source_sha256 text', \"'476'\"]],
  ['src/map/radius.js', ['PROBE_REF_PREFIX']],
  ['src/routes/step-probes.js', ['internalAuthOrLoopback', 'ON CONFLICT (probe_key) DO UPDATE', '/step-probes/drift-check']],
  ['../quality/smoke-allowlist.txt', ['step-probes-smoke.sh']],
];
let fail = false;
for (const [file, needles] of checks) {
  const src = fs.readFileSync(file, 'utf8');
  for (const n of needles) if (!src.includes(n)) { console.error('FAIL ' + file + ' 缺少: ' + n); fail = true; }
}
if (fail) process.exit(1);
console.log('路由挂载 / 迁移+回滚 / radius 排除 / allowlist 全部接线 ✓');
"

echo "[step-probes-smoke] PASS"
