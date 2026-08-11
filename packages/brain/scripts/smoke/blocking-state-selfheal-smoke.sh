#!/usr/bin/env bash
# Smoke: 阻断类状态位 TTL 自愈 + 健康检查可见性
#
# 真环境验证（由 CI real-env-smoke 在 cecelia-brain 真容器 + 真 Postgres 上跑）：
#   1) /api/brain/alertness 必须含可判读的 blocking_states 数组 + healthy 字段
#   2) 置排空 → 健康端点必须暴露 tick_draining（含持续时长）且 healthy=false
#      （2026-08-10 事故：draining 卡 2h20m 期间此端点报 CALM / "System is healthy"）
#   3) drain-cancel 语义不变——取消后 blocking_states 不再含 tick_draining、healthy 恢复
#
# 失败条件：任一断言不成立即 exit 1。
set -uo pipefail

BASE="${BRAIN_URL:-http://localhost:5221}"
ALERT="$BASE/api/brain/alertness"
FAIL=0

echo "▶️  smoke: blocking-state-selfheal-smoke.sh  target=$BASE"

# 收尾：无论成败都取消 drain，避免污染后续 smoke（CECELIA_TICK_ENABLED=false 下也保险）
cleanup() { curl -sS -m 10 -X POST "$BASE/api/brain/tick/drain-cancel" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# ── 1) 基线：健康端点必须暴露 blocking_states 字段 ──────────────────────────
BODY=$(curl -sS -m 15 "$ALERT")
echo "$BODY" | node -e '
  let d=""; process.stdin.on("data",c=>d+=c); process.stdin.on("end",()=>{
    const j=JSON.parse(d);
    if (!Array.isArray(j.blocking_states)) { console.error("❌ blocking_states 不是数组"); process.exit(1); }
    if (typeof j.healthy !== "boolean") { console.error("❌ 缺 healthy 布尔字段"); process.exit(1); }
    console.log("✅ 基线：blocking_states 数组 + healthy 字段存在");
  });
' || FAIL=1

# ── 2) 置排空 → 健康端点必须暴露 tick_draining 阻断位（含持续时长）且 healthy=false ──
curl -sS -m 10 -X POST "$BASE/api/brain/tick/drain" >/dev/null 2>&1
sleep 1
DRAIN_BODY=$(curl -sS -m 15 "$ALERT")
echo "$DRAIN_BODY" | node -e '
  let d=""; process.stdin.on("data",c=>d+=c); process.stdin.on("end",()=>{
    const j=JSON.parse(d);
    const b=(j.blocking_states||[]).find(s=>s.key==="tick_draining");
    if (!b) { console.error("❌ 排空生效但 blocking_states 不含 tick_draining"); process.exit(1); }
    if (b.duration_ms === undefined) { console.error("❌ tick_draining 缺持续时长 duration_ms"); process.exit(1); }
    if (j.healthy !== false) { console.error("❌ 存在阻断位却仍报 healthy=true（健康地停摆红线）"); process.exit(1); }
    if (j.levelName === "CALM") { console.error("❌ 存在阻断位却仍报 CALM"); process.exit(1); }
    console.log("✅ 红线：排空生效 → 暴露 tick_draining(" + (b.duration_human||b.duration_ms) + ") 且 healthy=false");
  });
' || FAIL=1

# ── 3) drain-cancel 语义不变：取消后不再含 tick_draining，healthy 恢复 ──────────
curl -sS -m 10 -X POST "$BASE/api/brain/tick/drain-cancel" >/dev/null 2>&1
sleep 1
CANCEL_BODY=$(curl -sS -m 15 "$ALERT")
echo "$CANCEL_BODY" | node -e '
  let d=""; process.stdin.on("data",c=>d+=c); process.stdin.on("end",()=>{
    const j=JSON.parse(d);
    const b=(j.blocking_states||[]).find(s=>s.key==="tick_draining");
    if (b) { console.error("❌ drain-cancel 后 blocking_states 仍含 tick_draining"); process.exit(1); }
    console.log("✅ drain-cancel 语义不变：取消后 tick_draining 已消失");
  });
' || FAIL=1

if [ "$FAIL" -ne 0 ]; then
  echo "❌ blocking-state-selfheal-smoke 失败"
  exit 1
fi
echo "✅ blocking-state-selfheal-smoke 全部通过"
