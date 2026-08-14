#!/usr/bin/env bash
# kernel-controller-lease-renewal-smoke.sh
# 验收（sprint 08132021-controller-lease-renewal-r2 —— 修 Controller heartbeat 不续租致 30 分钟杀跑）：
#   1. buildKernelLaunchArgs 把创建端 controllerSessionId 透传成 --controller-session-id（真 import，纯函数）
#   2. run.js parseArgs 认 --controller-session-id（真 import，纯函数）
#   3. heartbeat.js writeHeartbeat 续租 SQL：GREATEST + CAS（controller_session_id + phase NOT IN）（真源码断言）
#   4. migration：initiative_runs 有 controller_lease_expires_at 续租载体列（真 PG）
#   5. Brain liveness（真 curl 现网 Brain）
set -uo pipefail

API="${BRAIN_URL:-http://localhost:5221}/api/brain"
DB_URL="${DATABASE_URL:-postgresql://cecelia@localhost:5432/cecelia_test}"
PASS=0; FAIL=0
ok()   { echo "✅ $1"; PASS=$((PASS + 1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL + 1)); }

# 1. buildKernelLaunchArgs 透传 controllerSessionId（真 orchestrator 装配 seam，纯函数无 DB）
echo "── buildKernelLaunchArgs 透传 --controller-session-id ──"
if node --input-type=module -e '
import { buildKernelLaunchArgs } from "./packages/brain/src/harness-skill-relay.js";
const argv = buildKernelLaunchArgs({ runner: "/x/run.js", taskId: "t-1", runId: "r-1", controllerSessionId: "sess-abc" });
const i = argv.indexOf("--controller-session-id");
if (i < 0 || argv[i + 1] !== "sess-abc" || !argv.includes("--run-id")) {
  console.error("argv mismatch:", JSON.stringify(argv)); process.exit(1);
}
'; then
  ok "buildKernelLaunchArgs 产出 --controller-session-id <sid>（续租身份随参数落地）"
else
  fail "buildKernelLaunchArgs 未透传 controllerSessionId"
fi

# 2. parseArgs 认 --controller-session-id（真 import run.js，纯函数）
echo "── parseArgs 认 --controller-session-id ──"
if node --input-type=module -e '
import { parseArgs } from "./packages/brain/src/orchestrator/run.js";
const a = parseArgs(["--task-id", "t-1", "--run-id", "r-1", "--controller-session-id", "sess-abc"]);
if (a.controllerSessionId !== "sess-abc") { console.error("parseArgs:", JSON.stringify(a)); process.exit(1); }
'; then
  ok "parseArgs.controllerSessionId 解析正确（心跳不再仅凭 run_id）"
else
  fail "parseArgs 未解析 --controller-session-id"
fi

# 3. writeHeartbeat 续租 SQL：GREATEST + CAS（真源码断言）
echo "── writeHeartbeat 续租 CAS SQL ──"
if node -e '
const c = require("fs").readFileSync("./packages/brain/src/orchestrator/heartbeat.js", "utf8");
if (!(c.includes("controller_lease_expires_at") && c.includes("GREATEST")
      && c.includes("controller_session_id") && /phase\s+NOT\s+IN/i.test(c))) {
  console.error("heartbeat renew SQL missing GREATEST/CAS"); process.exit(1);
}
if (/\b1800\b/.test(c)) { console.error("heartbeat hardcodes 1800 (INV-2 violated)"); process.exit(1); }
'; then
  ok "heartbeat.js 续租 SQL 含 GREATEST + CAS（session+phase），不写死 1800"
else
  fail "heartbeat.js 续租 SQL 缺 GREATEST/CAS 或写死 1800"
fi

# 4. migration：initiative_runs 续租载体列（真 PG）
echo "── initiative_runs.controller_lease_expires_at 续租载体列（真 PG）──"
COLS=$(psql "$DB_URL" -tAc "SELECT string_agg(column_name, ',') FROM information_schema.columns WHERE table_name='initiative_runs' AND column_name IN ('controller_session_id','controller_lease_expires_at')" 2>/dev/null || echo "")
if echo "$COLS" | grep -q "controller_lease_expires_at" && echo "$COLS" | grep -q "controller_session_id"; then
  ok "initiative_runs 有 controller_session_id + controller_lease_expires_at（续租 UPDATE 载体）"
else
  fail "initiative_runs 缺续租载体列（得: '$COLS'）"
fi

# 5. Brain liveness（真 curl 现网 Brain）
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
