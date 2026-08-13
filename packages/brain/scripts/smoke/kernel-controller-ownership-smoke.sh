#!/usr/bin/env bash
# kernel-controller-ownership-smoke.sh
# 验收（sprint 08131104 Harness 入口统一）：
#   1. 四档 change_kind 驱动 derive 执行 Profile（纯函数，真 import orchestrator/derive.js）
#   2. migration 413：initiative_runs 有 controller_session_id + controller_lease_expires_at 列（真 PG）
#   3. Brain liveness（真 curl 现网 Brain）
set -uo pipefail

API="${BRAIN_URL:-http://localhost:5221}/api/brain"
DB_URL="${DATABASE_URL:-postgresql://cecelia@localhost:5432/cecelia_test}"
PASS=0; FAIL=0
ok()   { echo "✅ $1"; PASS=$((PASS + 1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL + 1)); }

# 1. 四档 change_kind 驱动 derive 执行 Profile（真 orchestrator/derive.js 纯函数状态机）
echo "── derive 四档 change_kind Profile ──"
if node --input-type=module -e '
import { derive } from "./packages/brain/src/orchestrator/derive.js";
const base = () => ({
  run: { phase: "planning" }, task: { status: "in_progress" },
  prdExists: false, contract: { approved: false }, pr: null,
  inflight: { containers: [], host_pids: [], attempts: [] },
  lastAgentExit: null, proposeBranchRn: null, ganLatestRoundVerdict: null,
  generatorSpawned: false, evaluateVerdict: null, judgeVerdict: null,
  reviewRequired: false, reviewApproved: false,
  counters: { hop: 1, noPushStreak: 0, noVerdictStreak: 0 },
  decisionLog: [], gear: "default",
});
const bug = derive({ ...base(), change_kind: "bugfix" }).phase;
const par = derive({ ...base(), change_kind: "parameter_only" }).phase;
const cap = derive({ ...base(), change_kind: "new_capability" }).phase;
if (bug !== "generate" || par !== "generate" || cap !== "planning") {
  console.error("derive profile mismatch:", JSON.stringify({ bug, par, cap }));
  process.exit(1);
}
'; then
  ok "四档 change_kind Profile 分派正确（bugfix/parameter_only→generate；new_capability→planning）"
else
  fail "四档 change_kind Profile 分派错误"
fi

# 2. migration 413：initiative_runs controller ownership 列（真 PG）
echo "── initiative_runs controller ownership 列（migration 413）──"
COLS=$(psql "$DB_URL" -tAc "SELECT string_agg(column_name, ',') FROM information_schema.columns WHERE table_name='initiative_runs' AND column_name IN ('controller_session_id','controller_lease_expires_at')" 2>/dev/null || echo "")
if echo "$COLS" | grep -q "controller_session_id" && echo "$COLS" | grep -q "controller_lease_expires_at"; then
  ok "initiative_runs 有 controller_session_id + controller_lease_expires_at 列"
else
  fail "initiative_runs 缺 controller ownership 列（得: '$COLS'）"
fi

# 3. Brain liveness（真 curl 现网 Brain）
echo "── Brain liveness ──"
code=$(curl -s -o /dev/null -w "%{http_code}" "$API/tick/status")
if [[ "$code" == "200" ]]; then
  ok "GET /tick/status → 200（Brain 存活）"
else
  fail "GET /tick/status → 期望 200，得 $code"
fi

echo "────────────"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
