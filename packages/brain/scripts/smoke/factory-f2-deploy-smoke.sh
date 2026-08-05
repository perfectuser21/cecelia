#!/usr/bin/env bash
# factory-f2-deploy-smoke.sh — 工厂 GP 五件套第一刀：F2 部署 最薄守卫
#
# ⚠️ 诚实声明（假绿灯纪律）：本闸为结构/契约级为主 + 少量运行时断言的最薄层。
#   - [结构] 断言只证明代码/注册表形态存在，不代表运行时行为已验证
#   - CI 环境 CECELIA_TICK_ENABLED=false：不断言任何"调度已真实执行"
#   - 决策 2a8bf656：工厂 journey 的 mvp 标签自此开始有机器背书，加厚走后续刀
# FIRE_TEST=1 为开发期自炸口（proven-to-fire 验证守卫非恒真），CI 不设。
#
# ⚠️ 钉子断言（commit-1 proven-to-fire 实弹，预期必红）：
#   issue 53e7ee4b — scripts/lib/bluegreen-sidecar.sh 是 blue 被删后唯一活路径，
#   必须由它收 drain-cancel；现状 0 处引用。红在此断言，修复留给 commit-2（同 PR）。
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
PASS=0; FAIL=0
ok()   { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }
psql_q() { psql -qtAc "$1"; }

echo "== F2 部署：蓝绿 sidecar drain 回路 =="

grep -Eq '^[^#]*curl[^#]*tick/drain-cancel' scripts/lib/bluegreen-sidecar.sh \
  && ok "[结构·钉子] bluegreen-sidecar.sh 含真实 curl 调用 tick/drain-cancel" \
  || fail "[结构·钉子] bluegreen-sidecar.sh 未含真实 curl 调用 tick/drain-cancel（issue 53e7ee4b：blue 被删后唯一活路径必须由它收 drain；注意本断言只认真实 curl 调用行，日志 echo 行不算数）"

grep -q "drain_before_swap" scripts/brain-deploy.sh && grep -q "drain_cancel_with_retry" scripts/brain-deploy.sh \
  && ok "[结构] brain-deploy.sh 含 drain_before_swap + drain_cancel_with_retry" || fail "brain-deploy.sh 缺 drain_before_swap 或 drain_cancel_with_retry"

# [运行时] drain 开关幂等回路（先例 smoke-runtime.sh:138-168）：跑完必须复原为 draining:false
#   注意零数据环境（CI/本机常见 in_progress=0）：GET drain-status 会 auto-complete
#   （drain.js:143 tasks.length===0 分支）把 draining 直接归 false 并返回 drain_completed:true，
#   永远看不到 draining:true 落地的窗口。因此：
#   ① POST /tick/drain 的响应体断言（drainTick 无条件返回 draining:true，drain.js:113-115），
#      不受 auto-complete 影响；
#   ② 紧随其后的 GET drain-status 断言放宽为 draining:true 或 drain_completed:true 二择命中
#      （有 in_progress 残留 → 前者；零数据 auto-complete → 后者），两条分支都代表 drain 生效过。
curl -fsm 5 -X POST "$BRAIN_URL/api/brain/tick/drain" | grep -q '"draining":true' \
  && ok "[运行时] POST /tick/drain 响应体 draining:true（drainTick 无条件返回）" || fail "POST /tick/drain 响应体未含 draining:true"

DRAIN_STATUS_BODY="$(curl -fsm 5 "$BRAIN_URL/api/brain/tick/drain-status")"
if echo "$DRAIN_STATUS_BODY" | grep -q '"draining":true' || echo "$DRAIN_STATUS_BODY" | grep -q '"drain_completed":true'; then
  ok "[运行时] drain-status 命中 draining:true 或 drain_completed:true（drain 生效，零数据环境 auto-complete 也算数）"
else
  fail "drain-status 既非 draining:true 也非 drain_completed:true"
fi

curl -fsm 5 -X POST "$BRAIN_URL/api/brain/tick/drain-cancel" >/dev/null \
  && ok "[运行时] POST /tick/drain-cancel 可达" || fail "POST /tick/drain-cancel 失败"

curl -fsm 5 "$BRAIN_URL/api/brain/tick/drain-status" | grep -q '"draining":false' \
  && ok "[运行时] drain-status.draining=false（已复原）" || fail "drain-status 未复原为 false"

grep -q "DRAIN_RESTORE_MAX_AGE_MS" packages/brain/src/drain.js \
  && ok "[结构] drain.js 导出 DRAIN_RESTORE_MAX_AGE_MS" || fail "drain.js 缺 DRAIN_RESTORE_MAX_AGE_MS"

[ -f scripts/smoke/e2e/deploy-daily-drill.sh ] \
  && ok "[结构] scripts/smoke/e2e/deploy-daily-drill.sh 存在" || fail "deploy-daily-drill.sh 缺失"

if [ "${FIRE_TEST:-0}" = "1" ]; then
  fail "FIRE_TEST 自炸（proven-to-fire 验证口）"
fi

echo "结果: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
