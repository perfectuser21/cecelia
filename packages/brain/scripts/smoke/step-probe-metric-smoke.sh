#!/usr/bin/env bash
# Smoke: step-probe metric 型探针（决策 f425e3fd 过程指标；任务 8345a8dc）
# 09-30 生产 sync 报 STEP_PROBE_TYPE_INVALID：workspace social-keyword-leadgen.yaml 里 8 条 metric 探针
# （preflight/cleanup 四件 + collection 归位一次做对率）进不了 Brain。本 smoke 不连库、不发网络，验证：
#   1. metric 探针归一化为 {type, ref}，缺 ref / 带 target / ref 非 metrics.<k> 三种拒收；sql/http 不退化
#   2. workspace 现网 YAML 快照 18 条全过、8 条 metric，describeProbe 给 metric 出文案
#   3. 接线：PROBE_TYPES 含 metric、fixture 存在、smoke 登记 allowlist
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "[step-probe-metric-smoke] 1. metric 归一化 + 三类拒收"
node --input-type=module -e "
import { normalizeProbe, PROBE_TYPES } from './src/lib/step-probe-spec.js';
const wf = 'social-keyword-leadgen';
const base = { key: 'coll_rescan_rate', stage: 'collection', journey_cell: 'stage:collection', expect: { op: '<=', value: 0.3 }, severity: 'error' };
const spec = normalizeProbe({ ...base, probe: { type: 'metric', ref: 'metrics.rescan_rate' } }, { workflow: wf });
if (JSON.stringify(spec.probe) !== JSON.stringify({ type: 'metric', ref: 'metrics.rescan_rate' })) { console.error('FAIL 归一化: ' + JSON.stringify(spec.probe)); process.exit(1); }
for (const [probe, code] of [
  [{ type: 'metric' }, 'STEP_PROBE_TARGET_INVALID'],
  [{ type: 'metric', ref: 'metrics.rescan_rate', target: 'ledger' }, 'STEP_PROBE_TARGET_INVALID'],
  [{ type: 'metric', ref: 'rescan_rate' }, 'STEP_PROBE_TARGET_INVALID'],
  [{ type: 'ledger', ref: 'metrics.x' }, 'STEP_PROBE_TYPE_INVALID'],
  [{ type: 'sql', query: 'SELECT 1' }, 'STEP_PROBE_TARGET_INVALID'],
]) {
  try { normalizeProbe({ ...base, probe }, { workflow: wf }); console.error('FAIL 应拒收 ' + JSON.stringify(probe)); process.exit(1); }
  catch (e) { if (e.code !== code) { console.error('FAIL 错误码应为 ' + code + ' 实际 ' + e.code); process.exit(1); } }
}
if (!PROBE_TYPES.includes('metric')) { console.error('FAIL PROBE_TYPES 缺 metric'); process.exit(1); }
console.log('metric {type,ref} / 缺ref·带target·ref非法拒收 / sql 不退化 ✓');
"

echo "[step-probe-metric-smoke] 2. workspace 现网 YAML 18 条全过（8 条 metric）+ describeProbe"
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { parseProbesDocument } from './src/lib/step-probe-spec.js';
import { describeProbe } from './src/notion-probe-projection.js';
const doc = yaml.load(readFileSync('src/__tests__/fixtures/social-keyword-leadgen.checks.yaml', 'utf8'));
const parsed = parseProbesDocument(doc);
if (parsed.probes.length !== 18) { console.error('FAIL 应 18 条，实际 ' + parsed.probes.length); process.exit(1); }
const metric = parsed.probes.filter(p => p.spec.probe.type === 'metric');
if (metric.length !== 8) { console.error('FAIL 应 8 条 metric，实际 ' + metric.length); process.exit(1); }
if (!metric.some(p => p.spec.key === 'coll_rescan_rate' && p.spec.expect.value === 0.3)) { console.error('FAIL 缺 coll_rescan_rate <= 0.3'); process.exit(1); }
const text = describeProbe(metric[0].spec.probe);
if (!/^metric: metrics\./.test(text)) { console.error('FAIL describeProbe metric 文案: ' + text); process.exit(1); }
console.log('18 条全过 / 8 条 metric / coll_rescan_rate<=0.3 / describeProbe=' + text + ' ✓');
"

echo "[step-probe-metric-smoke] 3. 接线"
node -e "
const fs = require('fs');
const checks = [
  ['src/lib/step-probe-spec.js', [\"'metric'\", 'METRIC_REF_RE.test(raw.ref)']],
  ['src/notion-probe-projection.js', [\"probe.type === 'metric'\"]],
  ['src/__tests__/fixtures/social-keyword-leadgen.checks.yaml', ['coll_rescan_rate', 'type: metric']],
  ['../quality/smoke-allowlist.txt', ['step-probe-metric-smoke.sh']],
];
let fail = false;
for (const [file, needles] of checks) {
  const src = fs.readFileSync(file, 'utf8');
  for (const n of needles) if (!src.includes(n)) { console.error('FAIL ' + file + ' 缺少: ' + n); fail = true; }
}
if (fail) process.exit(1);
console.log('PROBE_TYPES / 投影文案 / fixture / allowlist 全部接线 ✓');
"

echo "[step-probe-metric-smoke] PASS"
