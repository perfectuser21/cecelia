#!/usr/bin/env bash
# Smoke: crystal-coding-evidence — 判官口粮第二铲（编码线九格证据接线）
#
# 单测用假 pool 断言聚合规则，测不到真 schema 这条接缝：列名/表名写错、迁移没跑，
# 假 pool 照样绿。本 smoke 专门在真库上跑两条源 SELECT 与证据 upsert，再走一次
# 「证据 → 判决」闭环，验证成本缺口在真 DB 上确实落成了 cost_gap 而不是 data_gap。
#
# 验证：
#   1. migration 440 给 crystal_ledger 加了 cost_gap 列
#   2. 九格常量与 home-sequencer STAGE_ORDER 一致（纯逻辑，防硬编码副本漂移）
#   3. scheduler 注册 crystal-coding-evidence 且排在 crystal-judge 之前（先喂饭再判案）
#   4. 真库跑 syncCodingEvidence：两源 SELECT + 证据 upsert 在真 schema 上通
#   5. 真库闭环：写一行探针证据（无 baseline_tokens）→ judgeUnit →
#      basis=cost_evidence_missing 且 n_runs 保真（不被抹成 0）→ 清理探针行
set -euo pipefail

cd "$(dirname "$0")/../../../.."

echo "[coding-evidence-smoke] 1. migration 440 cost_gap 列"
node -e "
const fs = require('fs');
const sql = fs.readFileSync('packages/brain/migrations/440_crystal_ledger_cost_gap.sql', 'utf8');
if (!/ADD COLUMN IF NOT EXISTS cost_gap BOOLEAN/i.test(sql)) { console.error('440 未加 cost_gap 列'); process.exit(1); }
console.log('  ✓ 440 cost_gap 列齐');
"

echo "[coding-evidence-smoke] 2. 九格派生自 STAGE_ORDER（不留硬编码副本）"
node --input-type=module -e "
const { CODING_GRIDS, codingUnitKey, gridForKernelPhase } = await import('./packages/brain/src/crystal/coding-grids.js');
const { STAGE_ORDER } = await import('./packages/brain/src/orchestrator/home-sequencer.js');
const derived = STAGE_ORDER.filter((s) => !s.startsWith('__'));
if (JSON.stringify(CODING_GRIDS) !== JSON.stringify(derived)) { console.error('九格与序列器格序漂移'); process.exit(1); }
if (CODING_GRIDS.length !== 9) { console.error('格数不是九: ' + CODING_GRIDS.length); process.exit(1); }
if (codingUnitKey('plan') !== 'coding:plan') { console.error('单位键前缀丢了'); process.exit(1); }
if (gridForKernelPhase('review') !== null) { console.error('认不出的相被硬塞进了某一格'); process.exit(1); }
console.log('  ✓ 九格=' + CODING_GRIDS.join(','));
"

echo "[coding-evidence-smoke] 3. scheduler 注册且排在 crystal-judge 之前"
node --input-type=module -e "
const { JOBS } = await import('./packages/brain/src/scheduler-jobs.js');
const names = JOBS.map((j) => j.name);
const i = names.indexOf('crystal-coding-evidence');
const j = names.indexOf('crystal-judge');
if (i < 0) { console.error('crystal-coding-evidence 未注册'); process.exit(1); }
if (!(i < j)) { console.error('喂饭排在判案之后，判官吃的是上一轮旧账'); process.exit(1); }
console.log('  ✓ job 已注册且位序正确');
process.exit(0);
"

echo "[coding-evidence-smoke] 4+5. 真库：两源取数 + 证据 upsert + 成本缺口判决闭环"
node --input-type=module -e "
const pool = (await import('./packages/brain/src/db.js')).default;
const { syncCodingEvidence, verifiedAtForDate } = await import('./packages/brain/src/crystal/coding-evidence.js');
const { judgeUnit } = await import('./packages/brain/src/crystal-judge.js');

const PROBE = 'coding:__smoke_probe';
const DATE = '2026-01-02';
let code = 0;
try {
  const r = await syncCodingEvidence({ dbPool: pool, days: 7, force: true });
  if (typeof r.evidence_rows !== 'number') { console.error('sync 未返回行数'); process.exit(1); }
  console.log('  ✓ 真库两源取数+upsert 通过 (源 attempts=' + r.source_records.harness_attempts + ', 证据行=' + r.evidence_rows + ')');

  await pool.query(
    \"INSERT INTO crystal_run_evidence (unit_key, report_date, runs, passes, baseline_tokens, avg_ms, has_postcondition, broken_count, raw, verified_at) VALUES (\$1,\$2,30,24,NULL,1000,true,6,'{}'::jsonb,\$3) ON CONFLICT (unit_key, verified_at) DO UPDATE SET runs=EXCLUDED.runs\",
    [PROBE, DATE, verifiedAtForDate(DATE)],
  );
  const v = await judgeUnit(pool, PROBE, DATE);
  if (v.basis.rule !== 'cost_evidence_missing') { console.error('缺 token 的真实跑量未判成本缺口: ' + JSON.stringify(v.basis)); code = 1; }
  else if (v.metrics.n_runs !== 30) { console.error('真实跑量被抹掉: n_runs=' + v.metrics.n_runs); code = 1; }
  else console.log('  ✓ 真库闭环: basis=cost_evidence_missing n_runs=30（跑量保真）');
} catch (e) {
  console.error('  真库校验失败: ' + e.message);
  code = 1;
} finally {
  await pool.query('DELETE FROM crystal_run_evidence WHERE unit_key = \$1', [PROBE]).catch(() => {});
  await pool.query('DELETE FROM crystal_ledger WHERE grid_key = \$1', [PROBE]).catch(() => {});
  await pool.query('DELETE FROM crystal_verdict WHERE grid_key = \$1', [PROBE]).catch(() => {});
  await pool.end();
}
process.exit(code);
"

echo "[coding-evidence-smoke] ✅ 全部通过"
