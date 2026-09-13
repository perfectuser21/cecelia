#!/usr/bin/env bash
# Smoke: local_execution.enabled=false 的 Brain 必须 fleet_transport 就绪——
# 否则调度器既不本机执行也无处远程派发 = harness 全类任务静默停摆
# （96054a8b「us-vps 纯调度器」铁律的反面：闸关了却没接远程通道，等于把
# kernel-v1 任务全部拍死在原地，且这种"死"是静默的，从外部看不出来）。
#
# 断言：
#   1. health 返回 200
#   2. 含 local_execution.enabled（布尔）
#   3. enabled=false 时，fleet_transport.enabled 必须为 true 且 worker_machines 非空
#
# 依赖约束：bash+curl+node，禁 jq（同 local-execution-guard-smoke.sh）。
set -euo pipefail
URL="${BRAIN_URL:-http://localhost:5221}/api/brain/health"
OUT=/tmp/smoke-orchestrator-remote-launch.json
printf '%s\n' "▶️  smoke: orchestrator-remote-launch-smoke.sh"
printf '%s\n' "   target: $URL"

HTTP_CODE=$(curl -sS -o "$OUT" -w "%{http_code}" "$URL")
[ "$HTTP_CODE" = "200" ] || { echo "❌ HTTP $HTTP_CODE (expected 200)"; cat "$OUT"; exit 1; }

node -e '
const fs = require("fs");
let j; try { j = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
catch (e) { console.error("❌ 响应不是合法 JSON: " + e.message); process.exit(1); }
const fail = (m) => { console.error("❌ " + m); process.exit(1); };

const le = j.local_execution;
const ft = j.fleet_transport;
if (!le || typeof le.enabled !== "boolean") fail("缺 local_execution.enabled");
if (le.enabled === false) {
  if (!ft || ft.enabled !== true) fail("闸关着（local_execution.enabled=false）但 fleet_transport 未就绪——调度器无任何执行路径");
  if (!Array.isArray(ft.worker_machines) || ft.worker_machines.length === 0) fail("fleet_transport 已启用但无 worker 机器（worker_machines 为空）");
}
console.log("   ✅ orchestrator-remote-launch: local_execution.enabled=" + le.enabled + (ft ? (" fleet_transport.enabled=" + ft.enabled) : ""));
' "$OUT"

printf '%s\n' "✅ orchestrator-remote-launch-smoke.sh OK"
