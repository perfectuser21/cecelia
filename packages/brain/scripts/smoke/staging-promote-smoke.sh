#!/usr/bin/env bash
# Smoke: 阶段2 Slice2 — 人工放行闸 + production promote
#
# 验证链路真落地（不是占位）：
#   L1 (静态)  : staging-promote.js 导出 resolveLine/decidePromote/runInternalPromote；
#                runStagingE2E finalize 接 handlePromote；_spawnStagingE2eTask payload 带 base_repo；
#                harness.js 有 POST /promote/:resultId 幂等回流接口；
#                migration 306 ALTER 加 promote_status（不 CREATE TABLE）。
#   L2 (gate)  : Brain 健康；不可达 SKIP exit 0。
#   L3 (真验)  : 真 DB 上 promote_status CHECK 约束生效 + 放行状态机 pending→promoted + 幂等
#                （重复 confirm WHERE pending 不命中）。**绝不真跑 promote-dashboard.sh（不打 :5211 live）。**
set -euo pipefail

PROMOTE="packages/brain/src/staging-promote.js"
RUNNER="packages/brain/src/staging-e2e-runner.js"
TASK_GRAPH="packages/brain/src/workflows/harness-task.graph.js"
ROUTE="packages/brain/src/routes/harness.js"
MIG306="packages/brain/migrations/306_staging_e2e_promote_status.sql"
BRAIN="${BRAIN_URL:-http://localhost:5221}"
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"

echo "[smoke] L1: Slice2 放行闸静态断言"
for f in "$PROMOTE" "$RUNNER" "$TASK_GRAPH" "$ROUTE" "$MIG306"; do
  test -f "$f" || { echo "[smoke] L1 FAIL: $f 不存在"; exit 1; }
done

node -e "
const fs=require('fs');
const p=fs.readFileSync('$PROMOTE','utf8');
for (const fn of ['resolveLine','decidePromote','runInternalPromote']) {
  if(!new RegExp('export (function|async function) '+fn).test(p)){console.error('L1 FAIL: staging-promote 未导出 '+fn);process.exit(1)}
}
// fail-safe：无 promoteExec 注入时不打真生产
if(!/no promoteExec injected/.test(p)){console.error('L1 FAIL: runInternalPromote 缺 fail-safe（无注入拒绝跑真脚本）');process.exit(1)}

const r=fs.readFileSync('$RUNNER','utf8');
if(!/handlePromote/.test(r)){console.error('L1 FAIL: runStagingE2E 未接 handlePromote');process.exit(1)}
if(!/base_repo/.test(r)){console.error('L1 FAIL: runner 未读 base_repo');process.exit(1)}

const tg=fs.readFileSync('$TASK_GRAPH','utf8');
const i=tg.indexOf('async function _spawnStagingE2eTask');
const h=tg.slice(i, tg.indexOf('export async function mergePrNode', i));
if(!/base_repo/.test(h)){console.error('L1 FAIL: _spawnStagingE2eTask payload 未带 base_repo');process.exit(1)}

const rt=fs.readFileSync('$ROUTE','utf8');
if(!/\/promote\/:resultId/.test(rt)){console.error('L1 FAIL: harness.js 缺 POST /promote/:resultId');process.exit(1)}
if(!/pending_promote/.test(rt) || !/409/.test(rt)){console.error('L1 FAIL: 回流接口缺幂等校验（pending_promote + 409）');process.exit(1)}

const m=fs.readFileSync('$MIG306','utf8');
if(/CREATE TABLE/i.test(m)){console.error('L1 FAIL: 306 不该 CREATE TABLE（应 ALTER 已合表）');process.exit(1)}
if(!/promote_status/.test(m) || !/ADD COLUMN/i.test(m)){console.error('L1 FAIL: 306 缺 promote_status ALTER');process.exit(1)}
console.log('[smoke] L1 PASS: staging-promote + runner分流 + base_repo + 回流接口幂等 + migration306 齐全');
" || exit 1

if ! curl -sf "$BRAIN/api/brain/health" >/dev/null 2>&1; then
  echo "[smoke] L2 SKIP: Brain 不可达（$BRAIN）— L1 静态已 PASS"; exit 0
fi
echo "[smoke] L2 PASS: Brain healthy"

if ! command -v psql >/dev/null 2>&1 || ! psql "$DB" -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "[smoke] L3 SKIP: psql/DB 不可用；L1 静态已 PASS"; exit 0
fi
HAS_COL=$(psql "$DB" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='staging_e2e_results' AND column_name='promote_status'")
if [[ "$HAS_COL" != "1" ]]; then
  echo "[smoke] L3 SKIP: promote_status 列不存在（migration 306 未应用）；L1 静态已 PASS"; exit 0
fi

PR="https://pr/s2-smoke-$$-$RANDOM"
cleanup() { psql "$DB" -tAc "DELETE FROM staging_e2e_results WHERE pr_url='$PR'" >/dev/null 2>&1 || true; }
trap cleanup EXIT

IID=$(node -e "console.log(require('crypto').randomUUID())")
psql "$DB" -tAc "INSERT INTO staging_e2e_results(initiative_id, pr_url, verdict, staging_port, promote_status) VALUES ('$IID'::uuid, '$PR', 'PASS', 5222, 'pending_promote') ON CONFLICT (pr_url) DO NOTHING" >/dev/null

# ① CHECK 约束拒绝非法 promote_status
if psql "$DB" -tAc "UPDATE staging_e2e_results SET promote_status='bogus' WHERE pr_url='$PR'" >/dev/null 2>&1; then
  echo "[smoke] L3 FAIL: CHECK 约束未拒绝非法 promote_status"; exit 1
fi

# ② 放行状态机 pending→promoting→promoted
psql "$DB" -tAc "UPDATE staging_e2e_results SET promote_status='promoting' WHERE pr_url='$PR' AND promote_status='pending_promote'" >/dev/null
psql "$DB" -tAc "UPDATE staging_e2e_results SET promote_status='promoted', promoted_at=now() WHERE pr_url='$PR' AND promote_status='promoting'" >/dev/null
ST=$(psql "$DB" -tAc "SELECT promote_status FROM staging_e2e_results WHERE pr_url='$PR'")
if [[ "$ST" != "promoted" ]]; then echo "[smoke] L3 FAIL: 状态机未到 promoted（=$ST）"; exit 1; fi

# ③ 幂等：重复 confirm（已 promoted，WHERE pending 不命中）→ 0 行
AFF=$(psql "$DB" -tAc "WITH u AS (UPDATE staging_e2e_results SET promote_status='promoting' WHERE pr_url='$PR' AND promote_status='pending_promote' RETURNING 1) SELECT count(*) FROM u")
if [[ "$AFF" != "0" ]]; then echo "[smoke] L3 FAIL: 重复 confirm 仍生效（非幂等，affected=$AFF）"; exit 1; fi

echo "[smoke] L3 PASS: CHECK 约束 + 放行状态机 pending→promoted + 重复 confirm 幂等"
echo "[smoke] staging-promote OK (L1+L2+L3)"
exit 0
