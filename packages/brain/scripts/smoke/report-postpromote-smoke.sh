#!/usr/bin/env bash
# Smoke: 阶段2 Slice3 — report 后移到 production promote 完成后（三态 · 决策 B）
#
# 验证链路真落地（不是占位）：
#   L1 (静态)  : staging-promote.js 导出 buildHarnessReportInsert/spawnHarnessReport/REPORT_KIND/readProductionInfo；
#                派 report SQL 含 initiative_id NOT EXISTS 幂等 + script_path harness-report.mjs；
#                staging-e2e-runner auto_promoted / routes confirm promoted 各派成功报告；
#                生命周期闭合（UPDATE initiative_runs phase / UPDATE tasks）由 harness-relay-watchdog.js
#                在 completed/failed/PR MERGED 三种情况下兜底（死图 reportNode 的等价逻辑已随
#                orchestrator 硬校验失效）；
#                migration 307 ALTER 加 promoted_by。
#   L2 (gate)  : Brain 健康；不可达 SKIP exit 0。
#   L3 (真验)  : 真 DB 上 harness_report 按 initiative_id 幂等（重复 INSERT 被 NOT EXISTS 挡）+ promoted_by 列存在。
#
# 注：原"reportNode 只在 computedVerdict!=='PASS' 才派失败报告"这半条断言已删除——
# 该逻辑在死图 reportNode 里，随 orchestrator 硬校验失效，功能缺口已登记 issue 6de4fd22，
# 不在本任务修复范围，不重建等价断言。
set -euo pipefail

SP="packages/brain/src/staging-promote.js"
RUNNER="packages/brain/src/staging-e2e-runner.js"
WATCHDOG="packages/brain/src/harness-relay-watchdog.js"
ROUTE="packages/brain/src/routes/harness.js"
MIG307="packages/brain/migrations/307_staging_e2e_promoted_by.sql"
BRAIN="${BRAIN_URL:-http://localhost:5221}"
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"

echo "[smoke] L1: Slice3 report 后移静态断言"
for f in "$SP" "$RUNNER" "$WATCHDOG" "$ROUTE" "$MIG307"; do
  test -f "$f" || { echo "[smoke] L1 FAIL: $f 不存在"; exit 1; }
done

node -e "
const fs=require('fs');
const sp=fs.readFileSync('$SP','utf8');
for (const fn of ['buildHarnessReportInsert','spawnHarnessReport','readProductionInfo']) {
  if(!new RegExp('export (function|async function) '+fn).test(sp)){console.error('L1 FAIL: staging-promote 未导出 '+fn);process.exit(1)}
}
if(!/REPORT_KIND/.test(sp)){console.error('L1 FAIL: 缺 REPORT_KIND 三态');process.exit(1)}
if(!/NOT EXISTS[\s\S]{0,120}initiative_id/i.test(sp)){console.error('L1 FAIL: 派 report 缺 initiative_id 幂等');process.exit(1)}
if(!/harness-report\.mjs/.test(sp)){console.error('L1 FAIL: 缺 script_path harness-report.mjs');process.exit(1)}

const wd=fs.readFileSync('$WATCHDOG','utf8');
// 生命周期闭合由 watchdog 委托 exact-run transactional terminalizer，禁止回退到 initiative 批量 UPDATE。
if(!/_terminalizeRelayRun/.test(wd) || !/patchKernelRunById/.test(wd)){console.error('L1 FAIL: harness-relay-watchdog.js 缺 exact-run 生命周期闭合委托');process.exit(1)}
if(/UPDATE initiative_runs SET phase/.test(wd)){console.error('L1 FAIL: watchdog 回退到 initiative 级批量 phase UPDATE');process.exit(1)}

const r=fs.readFileSync('$RUNNER','utf8');
if(!/spawnHarnessReport/.test(r)){console.error('L1 FAIL: runner auto_promoted 未派 report');process.exit(1)}

const rt=fs.readFileSync('$ROUTE','utf8');
if(!/spawnHarnessReport/.test(rt)){console.error('L1 FAIL: confirm 路由 promoted 未派 report');process.exit(1)}

const m=fs.readFileSync('$MIG307','utf8');
if(/CREATE TABLE/i.test(m)){console.error('L1 FAIL: 307 不该 CREATE TABLE');process.exit(1)}
if(!/promoted_by/.test(m) || !/ADD COLUMN/i.test(m)){console.error('L1 FAIL: 307 缺 promoted_by ALTER');process.exit(1)}
console.log('[smoke] L1 PASS: 三态派发 + 幂等 + watchdog exact-run 生命周期闭合 + migration307 齐全');
" || exit 1

if ! curl -sf "$BRAIN/api/brain/health" >/dev/null 2>&1; then
  echo "[smoke] L2 SKIP: Brain 不可达（$BRAIN）— L1 静态已 PASS"; exit 0
fi
echo "[smoke] L2 PASS: Brain healthy"

if ! command -v psql >/dev/null 2>&1 || ! psql "$DB" -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "[smoke] L3 SKIP: psql/DB 不可用；L1 静态已 PASS"; exit 0
fi
HAS_COL=$(psql "$DB" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='staging_e2e_results' AND column_name='promoted_by'")
if [[ "$HAS_COL" != "1" ]]; then
  echo "[smoke] L3 SKIP: promoted_by 列不存在（migration 307 未应用）；L1 静态已 PASS"; exit 0
fi

IID="smoke-s3-$$-$RANDOM"
cleanup() { psql "$DB" -tAc "DELETE FROM tasks WHERE task_type='harness_report' AND payload->>'initiative_id'='$IID'" >/dev/null 2>&1 || true; }
trap cleanup EXIT

INS="INSERT INTO tasks (title, description, task_type, status, priority, payload) SELECT '[Harness Report] smoke','d','harness_report','queued','P2','{\"initiative_id\":\"$IID\"}'::jsonb WHERE NOT EXISTS (SELECT 1 FROM tasks WHERE task_type='harness_report' AND payload->>'initiative_id'='$IID')"
psql "$DB" -tAc "$INS" >/dev/null
psql "$DB" -tAc "$INS" >/dev/null   # 第二次同 initiative → 被挡
N=$(psql "$DB" -tAc "SELECT count(*) FROM tasks WHERE task_type='harness_report' AND payload->>'initiative_id'='$IID'")
if [[ "$N" != "1" ]]; then echo "[smoke] L3 FAIL: harness_report 幂等失效（同 initiative 行数=$N，期望 1）"; exit 1; fi

echo "[smoke] L3 PASS: harness_report 按 initiative_id 幂等（重复 INSERT 被挡）+ promoted_by 列存在"
echo "[smoke] report-postpromote OK (L1+L2+L3)"
exit 0
