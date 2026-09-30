#!/usr/bin/env bash
# Smoke: 地图翻色扩到 step/enabler 级格子（任务 45e5db42，决策 3e867cad；迁移 496 三级格子的翻色接线）
# 验证（全程注入 mock pool，不连库）：
#   1. 探针 target_type=step 的回执落到 step:<key> 格（journeyStepLinkId/assertionRevision 都是子格的）并翻子格
#   2. 活动格 = 自身探针 ∪ 其下 step/enabler 格最坏值：step FAIL → step 红 + 活动红；全 PASS → 全绿
#   3. 子格缺失 → 退回活动格；纯活动级探针不发子格解析查询（行为与从前一致）
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "[cell-color-step-level-smoke] 1-3. step 级翻色 + 活动汇总 + 退回"
node --input-type=module -e "
import { handleRunFinished } from './src/lib/business-probe-judge.js';
const H = 'a'.repeat(64);
const J = 'j-1', ACT = 'aaaaaaaa-0000-4000-8000-00000000000a', STEP = 'bbbbbbbb-0000-4000-8000-00000000000b';
const ACT_LINK = '11111111-1111-4111-8111-111111111111', STEP_LINK = '33333333-3333-4333-8333-333333333333';
const probe = (key, target_type, expect, severity = 'error') => ({
  probe_key: key, stage: 'collection', severity, spec_hash: H, journey_step_link_id: ACT_LINK, assertion_revision: 2,
  journey_id: J, target_type, target_id: target_type === 'step' ? STEP : ACT, activity_step_id: ACT,
  spec: { key, stage: 'collection', probe: { kind: 'metric' }, expect, severity },
});
function pool(probes, cells) {
  const rows = cells.map((c) => ({ ...c })); const calls = [];
  return { rows, calls, query: async (sql, params) => {
    calls.push(sql);
    if (/UPDATE journey_step_links/.test(sql)) { const r = rows.find((x) => x.id === params[1]); if (r) r.cell_status = params[0]; return { rows: [] }; }
    if (/step_id_ref = ANY/.test(sql)) return { rows: rows.filter((r) => r.cell_level !== 'activity' && params[1].includes(r.step_id_ref)) };
    if (/SELECT cell_status FROM journey_step_links/.test(sql)) return { rows: rows.filter((r) => r.cell_level !== 'activity' && r.step_id === params[1]) };
    if (/FROM tasks/.test(sql)) return { rows: [{ journey_id: J }] };
    if (/FROM step_probes/.test(sql)) return { rows: probes };
    return { rows: [] };
  } };
}
const actCell = { id: ACT_LINK, journey_id: J, step_id: ACT, cell_level: 'activity', assertion_revision: 2, cell_status: 'gray' };
const stepCell = { id: STEP_LINK, journey_id: J, step_id: ACT, cell_level: 'step', step_id_ref: STEP, assertion_revision: 1, cell_status: 'gray' };
const persisted = [];
const persist = async (_p, r) => { persisted.push(r); return { persisted: true, receipt: { id: 'r' } }; };
const run = (probes) => ({ runId: 'r', taskId: 't', result: { stage: 'collection', stage_status: 'ok', probes } });
const fail = (m) => { console.error('FAIL ' + m); process.exit(1); };

// 1+2a: step FAIL → step 红、活动红；回执落 step 格 revision=1
let p = pool([probe('coll_rescan_rate', 'step', { op: '<=', value: 0.3 })], [actCell, stepCell]);
let out = await handleRunFinished(run({ coll_rescan_rate: { observed: 1 } }), { pool: p, persist });
if (out.cells?.[STEP_LINK] !== 'red' || out.cells?.[ACT_LINK] !== 'red') fail('step FAIL 应 step 红+活动红: ' + JSON.stringify(out));
if (persisted[0].journeyStepLinkId !== STEP_LINK || persisted[0].assertionRevision !== 1) fail('回执应落 step 格: ' + JSON.stringify(persisted[0]));
// 2b: 全 PASS → 全绿
p = pool([probe('coll_count', 'activity', { op: '>=', value: 1 }), probe('coll_rescan_rate', 'step', { op: '<=', value: 0.3 })], [actCell, stepCell]);
out = await handleRunFinished(run({ coll_count: { observed: 4 }, coll_rescan_rate: { observed: 0 } }), { pool: p, persist });
if (out.cells?.[STEP_LINK] !== 'green' || out.cells?.[ACT_LINK] !== 'green') fail('全 PASS 应全绿: ' + JSON.stringify(out));
// 3a: 子格缺失 → 退回活动格
p = pool([probe('coll_rescan_rate', 'step', { op: '<=', value: 0.3 })], [actCell]);
out = await handleRunFinished(run({ coll_rescan_rate: { observed: 1 } }), { pool: p, persist });
if (JSON.stringify(out.cells) !== JSON.stringify({ [ACT_LINK]: 'red' })) fail('子格缺失应退回活动格: ' + JSON.stringify(out));
// 3b: 纯活动级 → 不发子格解析
p = pool([probe('coll_count', 'activity', { op: '>=', value: 1 })], [actCell]);
out = await handleRunFinished(run({ coll_count: { observed: 4 } }), { pool: p, persist });
if (out.cells?.[ACT_LINK] !== 'green' || p.calls.some((s) => /step_id_ref = ANY/.test(s))) fail('纯活动级不应发子格解析: ' + JSON.stringify(out));
console.log('step 级翻色 / 活动汇总 / 退回活动格 / 纯活动级不查子格 ✓');
"

echo "[cell-color-step-level-smoke] 全部检查通过 ✓"
