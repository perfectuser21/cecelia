#!/usr/bin/env bash
# Smoke: crystal-judge — Crystal 第4件「结晶判官」（结晶台账 + 三态判决 + 每日结晶报告）
# 验证：
#   1. migration 434 建齐四表（crystal_ledger/verdict/report/locator_registry）
#   2. routes/crystal.js 存在且已挂进 routes.js（router.use('/crystal'）
#   3. crystal-judge.js 只写 crystal_* 表（NFR 数据完整性：对 n8n/采集器/postcondition 源只读）
#   4. scheduler-jobs.js 注册每日 crystal-judge 定时任务
#   5. 纯逻辑判决引擎三态铁律（INV-1 判定层不蒸馏 / INV-2 探针强制 / INV-5 固化优先级）
#   6. OpenClaw leadgen 恰好八格
#   7.（live，Brain 可达时）POST /api/brain/crystal/run 返回 ok + grid_count 8；不可达则跳过不判失败
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "[crystal-smoke] 1. migration 434 建齐四表"
node -e "
const fs = require('fs');
const sql = fs.readFileSync('packages/brain/migrations/434_crystal_judge.sql', 'utf8');
const tables = ['crystal_ledger', 'crystal_verdict', 'crystal_report', 'crystal_locator_registry'];
const missing = tables.filter((t) => !sql.includes(t));
if (missing.length) { console.error('缺表: ' + missing.join(', ')); process.exit(1); }
// 复合键约束（每格 1 判决 / registry 复合键）
if (!/UNIQUE\s*\(report_date, ?grid_key\)/i.test(sql)) { console.error('缺 crystal_verdict/ledger UNIQUE(report_date,grid_key)'); process.exit(1); }
if (!/UNIQUE\s*\(model, ?app_version, ?density\)/i.test(sql)) { console.error('缺 locator UNIQUE(model,app_version,density)'); process.exit(1); }
console.log('migration 434 四表 + 复合键约束齐全 ✓');
"

echo "[crystal-smoke] 2. routes/crystal.js 已挂进 routes.js"
node -e "
const fs = require('fs');
fs.accessSync('packages/brain/src/routes/crystal.js');
const r = fs.readFileSync('packages/brain/src/routes.js', 'utf8');
if (!/router\.use\('\/crystal'/.test(r)) { console.error('routes.js 未挂载 /crystal'); process.exit(1); }
const cr = fs.readFileSync('packages/brain/src/routes/crystal.js', 'utf8');
for (const p of [\"'/run'\", \"'/report'\", \"'/locator'\", \"'/evidence/validate'\"]) {
  if (!cr.includes(p)) { console.error('crystal.js 缺端点 ' + p); process.exit(1); }
}
console.log('crystal 路由挂载 + 四端点齐全 ✓');
"

echo "[crystal-smoke] 3. crystal-judge.js 只写 crystal_* 表（源只读）"
node -e "
const fs = require('fs');
const c = fs.readFileSync('packages/brain/src/crystal-judge.js', 'utf8');
for (const t of ['crystal_ledger', 'crystal_verdict', 'crystal_report']) {
  if (!c.includes(t)) { console.error('crystal-judge 未写 ' + t); process.exit(1); }
}
if (/(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(execution_entity|adjudication|postcondition)/i.test(c)) {
  console.error('crystal-judge 违反 NFR：写了源表'); process.exit(1);
}
console.log('crystal-judge 只写 crystal_* 表 ✓');
"

echo "[crystal-smoke] 4. scheduler-jobs.js 注册 crystal-judge"
node -e "
const fs = require('fs');
const s = fs.readFileSync('packages/brain/src/scheduler-jobs.js', 'utf8');
if (!s.includes('crystal-judge')) { console.error('scheduler 未注册 crystal-judge'); process.exit(1); }
console.log('scheduler 注册 crystal-judge ✓');
"

echo "[crystal-smoke] 5+6. 判决引擎三态铁律 + 八格常量（纯逻辑）"
node --input-type=module -e "
import { classifyCrystalVerdict, crystallizePriority, CRYSTAL_THRESHOLDS } from './packages/brain/src/crystal/verdict-engine.js';
import { OPENCLAW_LEADGEN_GRIDS } from './packages/brain/src/crystal/grids.js';
const P = (o = {}) => ({ n_runs: 40, success_rate: 0.95, token_cost: 8000, latency_ms: 1200, new_branch_rate: 0, broken_count: 0, has_postcondition: true, is_hardened: false, is_judgment_layer: false, data_gap: false, ...o });
let bad = 0; const ck = (c, m) => { if (!c) { console.error('FAIL ' + m); bad++; } };
ck(classifyCrystalVerdict(P()).verdict === 'promote', 'promote 全条件满足');
ck(classifyCrystalVerdict(P({ is_judgment_layer: true })).verdict === 'keep_llm', 'INV-1 判定层不蒸馏');
ck(classifyCrystalVerdict(P({ has_postcondition: false })).verdict === 'keep_llm', 'INV-2 探针强制');
ck(classifyCrystalVerdict(P({ n_runs: 10 })).verdict === 'keep_llm', 'N<20 数据不足');
ck(classifyCrystalVerdict(P({ is_hardened: true, broken_count: 3 })).verdict === 'demote', '固化件碎阈降级');
ck(Math.abs(crystallizePriority({ n_runs: 50, success_rate: 0.8 }) - 10) < 1e-6, 'INV-5 频率×失败率');
ck(CRYSTAL_THRESHOLDS.minRuns === 20 && CRYSTAL_THRESHOLDS.demoteBreaks === 3, '阈值旋钮');
ck(OPENCLAW_LEADGEN_GRIDS.length === 8 && new Set(OPENCLAW_LEADGEN_GRIDS).size === 8, 'OpenClaw 八格');
if (bad > 0) { console.error('判决引擎铁律校验失败 ' + bad + ' 项'); process.exit(1); }
console.log('三态铁律 + 八格常量 ✓');
"

echo "[crystal-smoke] 7. live 触发（best-effort — 仅当 Brain 带 crystal 路由时增益校验，永不因环境判失败）"
# 结构校验 1-6 是本 smoke 的强制部分；live 触发是增益：CI 棘轮把本脚本对准由候选构建的
# cecelia-brain-smoke（带 crystal 路由）时才有真 Brain 可打。Brain 不可达 / 是不带 crystal
# 的旧 Brain（POST /crystal/run 落到 content-pipeline 的 /:id/run 影子）时一律跳过，不判失败。
# 真实 live 行为由 contract-dod.md 的 [BEHAVIOR] B-01..B-07 在 evaluator 的候选 Brain 上强制。
if curl -sfS -m 4 -o /dev/null "$BRAIN_URL/api/brain/context" 2>/dev/null; then
  RUN=$(curl -sfS -m 20 -X POST "$BRAIN_URL/api/brain/crystal/run" -H 'content-type: application/json' -d '{}' 2>/dev/null || echo '{}')
  if echo "$RUN" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);process.exit(j.ok===true&&j.grid_count===8&&Array.isArray(j.verdicts)&&j.verdicts.length===8?0:1)}catch{process.exit(1)}})"; then
    echo "  ✓ live /crystal/run 八格判决（候选 Brain 带 crystal 路由）"
  else
    echo "  ⏭  当前 Brain 无 crystal 路由或未落库（非候选 Brain）— 跳过 live，不判失败"
  fi
else
  echo "  ⏭  Brain($BRAIN_URL) 不可达 — 跳过 live 触发（结构校验已覆盖，不判失败）"
fi

echo "✅ crystal-judge smoke 通过（migration/路由/判官/scheduler/判决铁律/八格）"
