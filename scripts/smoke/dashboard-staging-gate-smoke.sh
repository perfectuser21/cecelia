#!/usr/bin/env bash
# dashboard-staging-gate-smoke.sh — Cecelia dashboard 部署「人工放行闸」真链路守卫
#
# 守的是 handoff(06250811-cecelia-staging-verify) §4 的两段式部署：
#   build → 自检 → 起常驻 staging(可打开) + 写 pending 标记 → 【停住】→ 人工 promote
#
# 三段断言（真链路，不 mock；用 fixture 假 dist 跳过慢 vite build）：
#   A happy-gate     ：跑 deploy-local.sh → 停在 staging。断言 live dist/ 纹丝不动、
#                      .dist-staging=新版、.staging-pending 写入、staging 端口可达且是新版。
#   B promote        ：跑 promote-dashboard.sh → live dist/ 才换成新版、标记清掉。
#   C proven-to-fire ：强制 selfcheck 红（required env 缺）→ deploy-local.sh 退非0、
#                      不写标记、live dist/ 仍是旧版、staging 端口不可达。
#
# 测试钩子（实现侧需支持）：
#   STAGING_FIXTURE_DIST=<dir>  deploy-local.sh 跳过 npm build，直接把该目录当构建产物
#   CECELIA_SKIP_HK=1           promote 跳过 HK ssh 同步（smoke 只验本机 dist/ swap）
#   DASHBOARD_STAGING_PORT=<p>  常驻 staging 端口（默认 5223）
#
# 用法： bash scripts/smoke/dashboard-staging-gate-smoke.sh
# 退出码： 0=全绿  1=有红

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEPLOY="$ROOT_DIR/scripts/deploy-local.sh"
PROMOTE="$ROOT_DIR/scripts/promote-dashboard.sh"
DASH="$ROOT_DIR/apps/dashboard"
LIVE_DIST="$DASH/dist"
STAGING_DIST="$DASH/.dist-staging"
PENDING="$DASH/.staging-pending"
PID_FILE="$DASH/.staging-slot.pid"
PORT="${SMOKE_STAGING_PORT:-5251}"

GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
FAILED=0
pass() { echo -e "${GREEN}[OK]${NC} $1"; }
fail() { echo -e "${RED}[X]${NC} $1"; FAILED=$((FAILED + 1)); }

TMP="$(mktemp -d -t staging-gate-smoke.XXXXXX)"
FIXTURE_NEW="$TMP/fixture-new"

cleanup() {
  [[ -f "$PID_FILE" ]] && kill "$(cat "$PID_FILE" 2>/dev/null)" 2>/dev/null || true
  rm -rf "$TMP" "$STAGING_DIST" "$PENDING" "$PID_FILE" 2>/dev/null || true
  # 复原 live dist/ 为 smoke 之前不存在的状态（live dist/ 是 gitignore 构建产物）
  [[ "${LIVE_DIST_PREEXISTED:-0}" == "0" ]] && rm -rf "$LIVE_DIST" 2>/dev/null || true
}
trap cleanup EXIT

[[ -d "$LIVE_DIST" ]] && LIVE_DIST_PREEXISTED=1 || LIVE_DIST_PREEXISTED=0

# ── 造 fixture：一个能通过 selfcheck 的最小合法 dist（含 #root + 可达入口资产）──
make_fixture() {
  local dir="$1" marker="$2"
  rm -rf "$dir"; mkdir -p "$dir/assets"
  echo "console.log('$marker');" > "$dir/assets/app.js"
  cat > "$dir/index.html" <<HTML
<!doctype html><html><head>
<script type="module" src="/assets/app.js"></script>
</head><body><div id="root"></div><!-- $marker --></body></html>
HTML
}

# ── 造 live dist/ 旧版本哨兵 ──
seed_old_live() {
  make_fixture "$LIVE_DIST" "OLD_VERSION_SENTINEL"
}

echo "=== Dashboard 放行闸 smoke (port=$PORT) ==="
echo ""

# 前置：脚本与钩子必须存在
[[ -f "$DEPLOY" ]]  && pass "deploy-local.sh 存在" || fail "deploy-local.sh 不存在"
[[ -f "$PROMOTE" ]] && pass "promote-dashboard.sh 存在" || fail "promote-dashboard.sh 不存在（人工放行步骤未实现）"
echo ""

make_fixture "$FIXTURE_NEW" "NEW_VERSION_SENTINEL"

# ════════════════════════════════════════════════════════════════════════════
echo "[A] happy-gate：deploy 停在 staging，不碰生产"
seed_old_live
rm -f "$PENDING"; rm -rf "$STAGING_DIST"
CECELIA_DEPLOY_ROOT="$ROOT_DIR" STAGING_FIXTURE_DIST="$FIXTURE_NEW" CECELIA_SKIP_HK=1 DASHBOARD_STAGING_PORT="$PORT" \
  bash "$DEPLOY" --changed="apps/dashboard/src/App.tsx" > "$TMP/a.log" 2>&1
A_RC=$?
[[ $A_RC -eq 0 ]] && pass "deploy-local.sh 退 0（自检绿停在 staging）" || { fail "deploy-local.sh 退 $A_RC"; sed 's/^/    /' "$TMP/a.log" | tail -20; }
# live dist/ 必须纹丝不动 = 仍是旧版
if grep -q "OLD_VERSION_SENTINEL" "$LIVE_DIST/index.html" 2>/dev/null && ! grep -q "NEW_VERSION_SENTINEL" "$LIVE_DIST/index.html" 2>/dev/null; then
  pass "live dist/ 未被 promote（仍是旧版，生产未触碰）"
else
  fail "live dist/ 已被改动——闸没拦住，自动 promote 了"
fi
# .dist-staging 是新版
grep -q "NEW_VERSION_SENTINEL" "$STAGING_DIST/index.html" 2>/dev/null \
  && pass ".dist-staging = 新版本" || fail ".dist-staging 缺失或非新版"
# pending 标记写入
[[ -f "$PENDING" ]] && pass ".staging-pending 放行标记已写入" || fail ".staging-pending 未写入（promote 无从知道放行什么）"
# staging 端口可达且是新版
S_CODE=$(curl -s -o "$TMP/staging-index.html" -w "%{http_code}" "http://localhost:$PORT/" --max-time 8 2>/dev/null || echo 000)
if [[ "$S_CODE" == "200" ]] && grep -q "NEW_VERSION_SENTINEL" "$TMP/staging-index.html" 2>/dev/null; then
  pass "staging 网址 localhost:$PORT 可打开且是新版（可私密预览）"
else
  fail "staging 网址 localhost:${PORT} 打不开或非新版（HTTP ${S_CODE}）"
fi
echo ""

# ════════════════════════════════════════════════════════════════════════════
echo "[B] promote：人工放行才换入生产"
CECELIA_DEPLOY_ROOT="$ROOT_DIR" CECELIA_SKIP_HK=1 DASHBOARD_STAGING_PORT="$PORT" bash "$PROMOTE" > "$TMP/b.log" 2>&1
B_RC=$?
[[ $B_RC -eq 0 ]] && pass "promote-dashboard.sh 退 0" || { fail "promote-dashboard.sh 退 $B_RC"; sed 's/^/    /' "$TMP/b.log" | tail -20; }
grep -q "NEW_VERSION_SENTINEL" "$LIVE_DIST/index.html" 2>/dev/null \
  && pass "live dist/ 已换成新版（5211 生效）" || fail "live dist/ 未换成新版（promote 没生效）"
[[ ! -f "$PENDING" ]] && pass ".staging-pending 已清（防重复 promote）" || fail ".staging-pending 未清"
echo ""

# ════════════════════════════════════════════════════════════════════════════
echo "[C] proven-to-fire：自检红 → 生产纹丝不动 + 报红"
seed_old_live
rm -f "$PENDING"; rm -rf "$STAGING_DIST"
[[ -f "$PID_FILE" ]] && kill "$(cat "$PID_FILE" 2>/dev/null)" 2>/dev/null || true
C_PORT=$((PORT + 1))
# 强制 selfcheck 红：要求一个绝不存在的 required env
CECELIA_DEPLOY_ROOT="$ROOT_DIR" STAGING_FIXTURE_DIST="$FIXTURE_NEW" CECELIA_SKIP_HK=1 DASHBOARD_STAGING_PORT="$C_PORT" \
  DASHBOARD_REQUIRED_ENV="VITE_DEPLOY_GATE_PROVEN_FIRE" \
  bash "$DEPLOY" --changed="apps/dashboard/src/App.tsx" > "$TMP/c.log" 2>&1
C_RC=$?
[[ $C_RC -ne 0 ]] && pass "deploy-local.sh 退非0（自检红，报红）" || fail "deploy-local.sh 退 0——自检红却没报红"
if grep -q "OLD_VERSION_SENTINEL" "$LIVE_DIST/index.html" 2>/dev/null && ! grep -q "NEW_VERSION_SENTINEL" "$LIVE_DIST/index.html" 2>/dev/null; then
  pass "live dist/ 纹丝不动（生产保持旧版）"
else
  fail "live dist/ 被改——自检红仍碰了生产"
fi
[[ ! -f "$PENDING" ]] && pass "无 .staging-pending（自检红不放行）" || fail "自检红却写了放行标记"
F_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$C_PORT/" --max-time 5 2>/dev/null || echo 000)
[[ "$F_CODE" != "200" ]] && pass "staging 端口未起（自检红不预览）" || fail "自检红却起了 staging 服务"
echo ""

echo "========================================"
if [[ "$FAILED" -eq 0 ]]; then
  echo -e "${GREEN}STAGING_GATE_SMOKE_OK${NC} — 放行闸三段全绿"
  exit 0
else
  echo -e "${RED}STAGING_GATE_SMOKE_FAIL${NC} — ${FAILED} 项红"
  exit 1
fi
