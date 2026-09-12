#!/usr/bin/env bash
# Smoke: /api/brain/health 必须声明本机执行角色（us-vps 纯调度器化，决策 96054a8b）
#
# 为什么需要这条 smoke：
#   闸本身（harness-skill-relay.spawnSkillRelaySession 拒绝派发）在正常运行时是"什么都
#   不发生"，从外部看不出来它在不在。2026-09-12 那次追查就是吃了这个亏——调度器和执行体
#   挤在同一台 2 核机上跑了很久，没有任何一处能一眼看出"这台机不该自己干活"。
#   所以把角色声明进 /health，让它成为可观测事实，再用本 smoke 锁住这个字段不许消失。
#
# 断言：
#   1. health 返回 200
#   2. 含 local_execution.enabled（布尔）与 local_execution.role
#   3. role 与 enabled 一致：enabled=false ⇒ 'scheduler_only'，true ⇒ 'executor'
#   4. enabled=false 时必须带非空 reason（禁静默——同类病见「282 条 failed 只 35 条有原因」）
#   5. 该字段不参与 degraded 判定：scheduler_only 下 status 仍应是 healthy
#      （us-vps 上就该是 scheduler_only，若它导致 degraded 会让告警永久常红）
#
# 依赖约束（蓝绿 pre-swap 在 brain 容器内跑）：只许 bash+curl+node，禁 jq。
set -euo pipefail

URL="${BRAIN_URL:-http://localhost:5221}/api/brain/health"
OUT=/tmp/smoke-local-execution-guard.json

printf '%s\n' "▶️  smoke: local-execution-guard-smoke.sh"
printf '%s\n' "   target: $URL"

HTTP_CODE=$(curl -sS -o "$OUT" -w "%{http_code}" "$URL")

if [ "$HTTP_CODE" != "200" ]; then
  printf '%s\n' "❌ HTTP $HTTP_CODE (expected 200)"
  cat "$OUT"
  exit 1
fi

node -e '
const fs=require("fs");
let j; try { j=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); }
catch(e){ console.error("❌ 响应不是合法 JSON: "+e.message); process.exit(1); }
const fail=m=>{ console.error("❌ "+m); console.error(JSON.stringify(j.local_execution??j,null,2)); process.exit(1); };

const le=j.local_execution;
if(!le || typeof le!=="object") fail("缺 local_execution 字段（本机执行角色未声明）");
if(typeof le.enabled!=="boolean") fail("local_execution.enabled 不是布尔");
if(typeof le.role!=="string") fail("local_execution.role 不是字符串");

const expectRole = le.enabled ? "executor" : "scheduler_only";
if(le.role!==expectRole) fail(`role 与 enabled 不一致：enabled=${le.enabled} 期望 role=${expectRole}，实际 ${le.role}`);

if(le.enabled===false){
  if(typeof le.reason!=="string" || le.reason.trim()==="") fail("enabled=false 却没给 reason（禁静默拒绝）");
  // 关闭本机执行是正常形态，不该把整个 Brain 判成 degraded
  if(j.status!=="healthy" && j.status!=="degraded") fail("status 取值异常: "+j.status);
}

console.log(`   ✅ local_execution: role=${le.role} enabled=${le.enabled}`);
if(le.reason) console.log(`   ℹ️  reason: ${le.reason}`);
' "$OUT"

printf '%s\n' "✅ local-execution-guard-smoke.sh OK"
