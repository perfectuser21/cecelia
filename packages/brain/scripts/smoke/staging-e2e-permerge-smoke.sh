#!/usr/bin/env bash
# Smoke: Slice1 修正（决策 C）— per-merge 触发 + pr_url 幂等
#
# 验证修正真正落地（不是占位）：
#   L1 (静态)  : routes/harness.js POST /staging-e2e 端点按 payload->>'pr_url' WHERE NOT EXISTS
#                去重派生 staging_e2e 任务；recordResult ON CONFLICT(pr_url)；
#                migration 305 ALTER 加 pr_url UNIQUE（不 CREATE TABLE）。
#   L2 (gate)  : Brain 健康；不可达 SKIP exit 0。
#   L3 (真验)  : 真 DB 上 pr_url UNIQUE 生效 —— 同 pr_url 重复 INSERT 被挡、不覆盖 verdict。
set -euo pipefail

ROUTE="packages/brain/src/routes/harness.js"
RUNNER="packages/brain/src/staging-e2e-runner.js"
MIG305="packages/brain/migrations/305_staging_e2e_pr_url_unique.sql"
BRAIN="${BRAIN_URL:-http://localhost:5221}"
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"

echo "[smoke] L1: per-merge 修正静态断言"
for f in "$ROUTE" "$RUNNER" "$MIG305"; do
  test -f "$f" || { echo "[smoke] L1 FAIL: $f 不存在"; exit 1; }
done

node -e "
const fs=require('fs');
const rt=fs.readFileSync('$ROUTE','utf8');
const si=rt.indexOf(\"router.post('/staging-e2e'\");
if(si<0){console.error('L1 FAIL: routes/harness.js 缺 POST /staging-e2e 端点');process.exit(1)}
const sh=rt.slice(si, rt.indexOf('router.', si+20));
if(!/payload->>'pr_url'/.test(sh) || !/source_id:\s*[^\n]*staging-e2e:/.test(sh)){
  console.error('L1 FAIL: POST /staging-e2e 缺 pr_url 预检或 Router source_id 幂等');process.exit(1)}
if(!/task_type\s*=\s*'staging_e2e'/.test(sh)){
  console.error('L1 FAIL: POST /staging-e2e 未派生 task_type=staging_e2e');process.exit(1)}

const r=fs.readFileSync('$RUNNER','utf8');
if(!/INSERT INTO staging_e2e_results[\s\S]{0,400}ON CONFLICT[\s\S]{0,40}pr_url[\s\S]{0,40}DO NOTHING/i.test(r)){
  console.error('L1 FAIL: recordResult 缺 ON CONFLICT(pr_url) DO NOTHING');process.exit(1)}

const m=fs.readFileSync('$MIG305','utf8');
if(/CREATE TABLE/i.test(m)){console.error('L1 FAIL: 305 不该 CREATE TABLE');process.exit(1)}
if(!/UNIQUE/i.test(m) || !/pr_url/.test(m)){console.error('L1 FAIL: 305 缺 pr_url UNIQUE');process.exit(1)}
console.log('[smoke] L1 PASS: POST /staging-e2e 幂等去重 + recordResult/305 幂等齐全');
" || exit 1

if ! curl -sf "$BRAIN/api/brain/health" >/dev/null 2>&1; then
  echo "[smoke] L2 SKIP: Brain 不可达（$BRAIN）— L1 静态已 PASS"
  exit 0
fi
echo "[smoke] L2 PASS: Brain healthy"

if ! command -v psql >/dev/null 2>&1 || ! psql "$DB" -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "[smoke] L3 SKIP: psql/DB 不可用；L1 静态已 PASS"
  exit 0
fi
if [[ "$(psql "$DB" -tAc "SELECT to_regclass('public.staging_e2e_results') IS NOT NULL")" != "t" ]]; then
  echo "[smoke] L3 SKIP: staging_e2e_results 表不存在（migration 未应用）；L1 静态已 PASS"
  exit 0
fi

PR="https://pr/permerge-smoke-$$-$RANDOM"
IID=$(node -e "console.log(require('crypto').randomUUID())")
cleanup() { psql "$DB" -tAc "DELETE FROM staging_e2e_results WHERE pr_url='$PR'" >/dev/null 2>&1 || true; }
trap cleanup EXIT

psql "$DB" -tAc "INSERT INTO staging_e2e_results(initiative_id, pr_url, verdict, scenarios_total, scenarios_passed) VALUES ('$IID'::uuid, '$PR', 'PASS', 1, 1) ON CONFLICT (pr_url) DO NOTHING" >/dev/null
# 同 pr_url 重复 INSERT（verdict 改 FAIL）→ 被 UNIQUE 挡
psql "$DB" -tAc "INSERT INTO staging_e2e_results(initiative_id, pr_url, verdict, scenarios_total, scenarios_passed) VALUES ('$IID'::uuid, '$PR', 'FAIL', 0, 0) ON CONFLICT (pr_url) DO NOTHING" >/dev/null
ROWS=$(psql "$DB" -tAc "SELECT count(*) FROM staging_e2e_results WHERE pr_url='$PR'")
VERD=$(psql "$DB" -tAc "SELECT verdict FROM staging_e2e_results WHERE pr_url='$PR'")
if [[ "$ROWS" != "1" || "$VERD" != "PASS" ]]; then
  echo "[smoke] L3 FAIL: pr_url 幂等失效（rows=$ROWS verdict=$VERD，期望 1/PASS）"; exit 1
fi
echo "[smoke] L3 PASS: pr_url UNIQUE 幂等生效（重复 INSERT 被挡，verdict 不被覆盖）"
echo "[smoke] staging-e2e-permerge OK (L1+L2+L3)"
exit 0
