#!/usr/bin/env bash
# Smoke: 阶段2 Slice1 — staging_e2e 任务（harness merge 后 staging 部署 + 自动 E2E + verdict 落库）
#
# 3 层验证：
#   L1 (静态)  : staging-e2e-runner.js 导出 runStagingE2E/deployStaging；
#                executor.js 含 staging_e2e native 短路；
#                routes/harness.js POST /staging-e2e 端点按 payload->>'pr_url' WHERE NOT EXISTS 幂等去重；
#                migration 304 含 staging_e2e_results 表 + task_type 约束追加。
#   L2 (gate)  : Brain 健康；不可达 SKIP exit 0。
#   L3 (真验)  : DB 里 staging_e2e_results 表存在 + task_type 约束接受 'staging_e2e'
#                + 能写入并读回一条 verdict='PASS' 记录 → cleanup。
set -euo pipefail

RUNNER_FILE="packages/brain/src/staging-e2e-runner.js"
EXECUTOR_FILE="packages/brain/src/executor.js"
ROUTE_FILE="packages/brain/src/routes/harness.js"
MIGRATION_FILE="packages/brain/migrations/304_staging_e2e_results.sql"
MIGRATION305_FILE="packages/brain/migrations/305_staging_e2e_pr_url_unique.sql"
BRAIN="${BRAIN_URL:-http://localhost:5221}"
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"

# ── L1 静态断言（无网络，永远跑）─────────────────────────────────────────
echo "[smoke] L1: 静态拓扑断言"
for f in "$RUNNER_FILE" "$EXECUTOR_FILE" "$ROUTE_FILE" "$MIGRATION_FILE" "$MIGRATION305_FILE"; do
  test -f "$f" || { echo "[smoke] L1 FAIL: $f 不存在"; exit 1; }
done

node -e "
const fs=require('fs');
const runner=fs.readFileSync('$RUNNER_FILE','utf8');
if(!/export async function runStagingE2E/.test(runner)){console.error('L1 FAIL: runStagingE2E 未导出');process.exit(1)}
if(!/export (?:async )?function deployStaging/.test(runner)){console.error('L1 FAIL: deployStaging 未导出');process.exit(1)}
if(!/staging_e2e_results/.test(runner)){console.error('L1 FAIL: runner 未写 staging_e2e_results');process.exit(1)}
// 修正3：verdict 落库幂等 ON CONFLICT(pr_url) DO NOTHING
if(!/INSERT INTO staging_e2e_results[\s\S]{0,400}ON CONFLICT[\s\S]{0,40}pr_url[\s\S]{0,40}DO NOTHING/i.test(runner)){
  console.error('L1 FAIL: recordResult 缺 ON CONFLICT(pr_url) DO NOTHING 幂等');process.exit(1)}
// 皇冠断言：staging 端口 5222（不是 production 5221）
if(!/STAGING_PORT\s*=\s*5222/.test(runner)){console.error('L1 FAIL: STAGING_PORT 非 5222');process.exit(1)}

const exec=fs.readFileSync('$EXECUTOR_FILE','utf8');
if(!/task_type === 'staging_e2e'/.test(exec) || !/staging-e2e-runner\.js/.test(exec)){
  console.error('L1 FAIL: executor 缺 staging_e2e native 短路');process.exit(1)}

// staging_e2e 派生在 routes/harness.js POST /staging-e2e：先精确查 pr_url，
// 再以 Work Router source_id 作事务幂等权威。
const route=fs.readFileSync('$ROUTE_FILE','utf8');
const ri=route.indexOf(\"router.post('/staging-e2e'\");
if(ri<0){console.error('L1 FAIL: routes/harness.js 缺 POST /staging-e2e 端点');process.exit(1)}
const rh=route.slice(ri, route.indexOf('router.', ri+20));
if(!/payload->>'pr_url'/.test(rh) || !/source_id:\s*[^\n]*staging-e2e:/.test(rh)){
  console.error('L1 FAIL: POST /staging-e2e 缺 pr_url 预检或 Router source_id 幂等');process.exit(1)}
if(!/task_type\s*=\s*'staging_e2e'/.test(rh)){
  console.error('L1 FAIL: POST /staging-e2e 未派生 task_type=staging_e2e');process.exit(1)}

const mig=fs.readFileSync('$MIGRATION_FILE','utf8');
if(!/CREATE TABLE IF NOT EXISTS staging_e2e_results/.test(mig)){console.error('L1 FAIL: migration 缺建表');process.exit(1)}
if(!/'staging_e2e'/.test(mig)){console.error('L1 FAIL: migration 未把 staging_e2e 加进 task_type 约束');process.exit(1)}
// 修正4：migration 305 在已合 304 表上 ALTER 加 pr_url UNIQUE（不 CREATE TABLE）
const mig305=fs.readFileSync('$MIGRATION305_FILE','utf8');
if(/CREATE TABLE/i.test(mig305)){console.error('L1 FAIL: 305 不该 CREATE TABLE（应 ALTER 已合 304 表）');process.exit(1)}
if(!/UNIQUE/i.test(mig305) || !/pr_url/.test(mig305)){console.error('L1 FAIL: 305 缺 pr_url UNIQUE');process.exit(1)}
console.log('[smoke] L1 PASS: runner+executor+POST /staging-e2e(pr_url幂等)+migration304/305 拓扑齐全');
" || exit 1

# ── L2 Brain health gate ───────────────────────────────────────────────
if ! curl -sf "$BRAIN/api/brain/health" >/dev/null 2>&1; then
  echo "[smoke] L2 SKIP: Brain 不可达（$BRAIN）— L1 静态已 PASS，L3 跳过"
  exit 0
fi
echo "[smoke] L2 PASS: Brain healthy"

# ── L3 真环境验证 ─────────────────────────────────────────────────────
if ! command -v psql >/dev/null 2>&1; then
  echo "[smoke] L3 SKIP: psql 不可用（L1 静态已 PASS）"
  exit 0
fi
if ! psql "$DB" -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "[smoke] L3 SKIP: DB 连接失败（CI 凭据/host 不对）；L1 静态已 PASS"
  exit 0
fi

TID=$(uuidgen 2>/dev/null | tr 'A-Z' 'a-z' || node -e "console.log(require('crypto').randomUUID())")
IID=$(uuidgen 2>/dev/null | tr 'A-Z' 'a-z' || node -e "console.log(require('crypto').randomUUID())")
echo "[smoke] L3: 真验证 task=$TID"

cleanup() {
  psql "$DB" -tAc "DELETE FROM staging_e2e_results WHERE task_id='$TID'::uuid" >/dev/null 2>&1 || true
  psql "$DB" -tAc "DELETE FROM tasks WHERE id='$TID'::uuid" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# 1) 表存在
HAS_TABLE=$(psql "$DB" -tAc "SELECT to_regclass('public.staging_e2e_results') IS NOT NULL")
if [[ "$HAS_TABLE" != "t" ]]; then
  echo "[smoke] L3 FAIL: staging_e2e_results 表不存在（migration 304 未应用）"; exit 1
fi

# 2) task_type 约束接受 'staging_e2e'（直插，模拟 reportNode 路径）
if ! psql "$DB" -tAc "INSERT INTO tasks(id, title, status, task_type, priority, created_at, updated_at) VALUES ('$TID'::uuid, '[smoke] staging_e2e', 'queued', 'staging_e2e', 'P2', NOW(), NOW())" >/dev/null 2>&1; then
  echo "[smoke] L3 FAIL: tasks.task_type 约束拒绝 'staging_e2e'（migration 304 约束未追加）"; exit 1
fi

# 3) verdict 能落库并读回
SMOKE_PR="https://pr/smoke-$TID"
psql "$DB" -tAc "INSERT INTO staging_e2e_results(task_id, initiative_id, pr_url, verdict, reason, scenarios_total, scenarios_passed) VALUES ('$TID'::uuid, '$IID'::uuid, '$SMOKE_PR', 'PASS', NULL, 1, 1) ON CONFLICT (pr_url) DO NOTHING" >/dev/null
VERDICT=$(psql "$DB" -tAc "SELECT verdict FROM staging_e2e_results WHERE task_id='$TID'::uuid")
if [[ "$VERDICT" != "PASS" ]]; then
  echo "[smoke] L3 FAIL: staging_e2e_results.verdict='$VERDICT'（期望 'PASS'）"; exit 1
fi

# 4) 修正4：pr_url UNIQUE（migration 305）—— 同 pr_url 重复 INSERT 被挡，不新增行
psql "$DB" -tAc "INSERT INTO staging_e2e_results(initiative_id, pr_url, verdict, scenarios_total, scenarios_passed) VALUES ('$IID'::uuid, '$SMOKE_PR', 'FAIL', 0, 0) ON CONFLICT (pr_url) DO NOTHING" >/dev/null
DUP_ROWS=$(psql "$DB" -tAc "SELECT count(*) FROM staging_e2e_results WHERE pr_url='$SMOKE_PR'")
if [[ "$DUP_ROWS" != "1" ]]; then
  echo "[smoke] L3 FAIL: pr_url 幂等失效（同 pr_url 行数=$DUP_ROWS，期望 1）—— migration 305 UNIQUE 未生效"; exit 1
fi
DUP_VERDICT=$(psql "$DB" -tAc "SELECT verdict FROM staging_e2e_results WHERE pr_url='$SMOKE_PR'")
if [[ "$DUP_VERDICT" != "PASS" ]]; then
  echo "[smoke] L3 FAIL: 重复 INSERT 覆盖了既有 verdict（='$DUP_VERDICT'，期望仍 'PASS'）"; exit 1
fi
psql "$DB" -tAc "DELETE FROM staging_e2e_results WHERE pr_url='$SMOKE_PR'" >/dev/null 2>&1 || true

echo "[smoke] L3 PASS: 表存在 + 约束接受 staging_e2e + verdict 落库读回 + pr_url UNIQUE 幂等生效"
echo "[smoke] staging-e2e OK (L1+L2+L3)"
exit 0
