#!/usr/bin/env bash
# Smoke: business-probe-judge — run.finished → 探针比对 → 回执 → cell 翻色（棒3a 判定，任务 33aa2bc4）
# 验证（全程注入 mock pool，不连库）：
#   1. 事件线：finishRun UPDATE 命中 → emit run.finished；event-bus on() 订阅者收到同一 payload
#   2. 判定线：handleRunFinished 三种结局——PASS→green / FAIL(error)→red / 缺 observed→FAIL probe_missing 且 warn 档→pending
#   3. 回执约定：executor_kind=business_probe_runner、argv ["probe",key]、source_sha NULL、assertion_ref probe:<key>
#   4. 接线：server.js 注册 judge；迁移 475 放行两值 executor_kind；合并闸 SQL 仍只认 brain_assertion_runner
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "[business-probe-judge-smoke] 1. finishRun → run.finished → 订阅者"
node --input-type=module -e "
import { finishRun } from './src/lib/task-run.js';
const got = [];
const emit = async (type, source, payload) => { got.push({ type, source, payload }); };
const pool = { query: async () => ({ rows: [{ id: 'x', task_id: 't1', status: 'success', result: { stage: 'preflight', probes: [{ key: 'k', observed: 1 }] } }] }) };
const out = await finishRun({ runId: 'r1', status: 'completed', exitCode: 0 }, { pool, emit });
if (!out.updated || got.length !== 1 || got[0].type !== 'run.finished' || got[0].payload.taskId !== 't1' || got[0].payload.result.stage !== 'preflight') {
  console.error('FAIL finishRun 未发 run.finished: ' + JSON.stringify({ out, got })); process.exit(1);
}
const none = await finishRun({ runId: 'r1', status: 'completed' }, { pool: { query: async () => ({ rows: [] }) }, emit });
if (none.updated || got.length !== 1) { console.error('FAIL 已终态不应再发事件'); process.exit(1); }
console.log('finishRun 单点发事件 / 已终态不发 ✓');
"

echo "[business-probe-judge-smoke] 2-3. 判定三结局 + 回执约定"
node --input-type=module -e "
import { handleRunFinished } from './src/lib/business-probe-judge.js';
import { persistBusinessProbeReceipt } from './src/impact-contract/assertion-receipts.js';
const H = 'a'.repeat(64);
const LINK = '11111111-1111-4111-8111-111111111111';
const LINK2 = '22222222-2222-4222-8222-222222222222';
const spec = (key, expect, sev = 'error', link = LINK) => ({ probe_key: key, stage: 'preflight', severity: sev, spec_hash: H, journey_step_link_id: link, assertion_revision: 1, spec: { key, stage: 'preflight', expect, severity: sev } });
function mkPool(probes) {
  const inserts = []; const updates = [];
  const pool = { query: async (sql, p) => {
    if (/FROM tasks/.test(sql)) return { rows: [{ journey_id: 'j' }] };
    if (/FROM step_probes/.test(sql)) return { rows: probes };
    if (/INSERT INTO journey_assertion_receipts/.test(sql)) { inserts.push({ sql, p }); return { rows: [{ id: 'rcpt-' + inserts.length }] }; }
    if (/UPDATE journey_step_links/.test(sql)) { updates.push(p); return { rows: [] }; }
    return { rows: [] };
  } };
  return { pool, inserts, updates };
}
const run = (probesResult, specs) => { const m = mkPool(specs); return handleRunFinished({ runId: 'run-1', taskId: 't', status: 'success', result: { stage: 'preflight', metrics: { want: 2 }, probes: probesResult } }, { pool: m.pool, persist: persistBusinessProbeReceipt }).then((out) => ({ out, ...m })); };

let r = await run([{ key: 'ok', observed: 3, probed_at: '2026-09-26T00:00:00.000Z' }], [spec('ok', { op: '>=', ref: 'metrics.want' })]);
if (r.out.cells[LINK] !== 'green' || r.inserts.length !== 1) { console.error('FAIL PASS 应 green: ' + JSON.stringify(r.out)); process.exit(1); }
const p = r.inserts[0].p; const sql = r.inserts[0].sql;
if (!/'business_probe_runner'/.test(sql) || p[3] !== 'probe:ok' || p[6] !== null || p[7] !== JSON.stringify(['probe', 'ok']) || p[9] !== 'PASS' || p[10] !== 0 || p[5] !== 'zenithjoy-workspace') {
  console.error('FAIL 回执约定不符: ' + JSON.stringify(p)); process.exit(1);
}
r = await run([{ key: 'bad', observed: 1 }], [spec('bad', { op: '==', value: 2 })]);
if (r.out.cells[LINK] !== 'red' || r.inserts[0].p[9] !== 'FAIL' || r.inserts[0].p[10] !== 1 || JSON.parse(r.inserts[0].p[8]).reason !== 'value_mismatch') { console.error('FAIL error 档 FAIL 应 red: ' + JSON.stringify(r.out)); process.exit(1); }
r = await run([], [spec('missing', { op: '>=', value: 1 }, 'warn', LINK2)]);
if (r.out.cells[LINK2] !== 'pending' || JSON.parse(r.inserts[0].p[8]).reason !== 'probe_missing') { console.error('FAIL 缺 observed+warn 应 pending/probe_missing: ' + JSON.stringify(r.out)); process.exit(1); }
const skip = await handleRunFinished({ runId: 'r', taskId: 't', result: { stage: 'preflight' } }, { pool: mkPool([]).pool, persist: persistBusinessProbeReceipt });
if (skip.skipped !== 'no_probes') { console.error('FAIL 无探针应 skipped no_probes'); process.exit(1); }
console.log('PASS→green / FAIL→red / 缺探针 warn→pending / 无探针跳过 / 回执约定 ✓');
"

echo "[business-probe-judge-smoke] 4. 接线"
node -e "
const fs = require('fs');
const checks = [
  ['server.js', ['registerBusinessProbeJudge', \"import('./src/event-bus.js')\"]],
  ['src/event-bus.js', ['function on(eventType, handler)', 'await dispatch(eventType, source, payload)']],
  ['src/lib/task-run.js', [\"emit('run.finished', 'task-run'\", 'RETURNING id, task_id, status, result']],
  ['migrations/475_business_probe_receipts.sql', [\"CHECK (executor_kind IN ('brain_assertion_runner', 'business_probe_runner'))\", \"executor_kind = 'business_probe_runner'\"]],
  ['src/impact-contract/harness-gates.js', [\"receipt.executor_kind = 'brain_assertion_runner'\"]],
  ['src/lib/map-state-resolver.js', [\"executor_kind === 'business_probe_runner'\", 'probe_receipt_pass']],
  ['src/map/state-resolver.js', ['export function resolveReceiptState', 'probe_fail']],
];
let fail = false;
for (const [file, needles] of checks) {
  const src = fs.readFileSync(file, 'utf8');
  for (const n of needles) if (!src.includes(n)) { console.error('FAIL ' + file + ' 缺少: ' + n); fail = true; }
}
if (fs.readFileSync('src/impact-contract/harness-gates.js', 'utf8').includes('business_probe_runner')) { console.error('FAIL 合并闸不得认 business_probe_runner'); fail = true; }
if (fail) process.exit(1);
console.log('server / event-bus / task-run / 迁移 475 / 合并闸 / 两处 resolver 全部接线 ✓');
"

echo "[business-probe-judge-smoke] PASS"
