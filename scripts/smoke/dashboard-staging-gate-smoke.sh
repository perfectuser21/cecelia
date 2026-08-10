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
NOTIFY="$DASH/.staging-notify.log"
PORT="${SMOKE_STAGING_PORT:-5251}"

GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
FAILED=0
pass() { echo -e "${GREEN}[OK]${NC} $1"; }
fail() { echo -e "${RED}[X]${NC} $1"; FAILED=$((FAILED + 1)); }

TMP="$(mktemp -d -t staging-gate-smoke.XXXXXX)"
FIXTURE_NEW="$TMP/fixture-new"
RELEASE_FILE="$ROOT_DIR/.production-release"
RELEASES_DIR="$DASH/.dist-releases"

cleanup() {
  [[ -f "$PID_FILE" ]] && kill "$(cat "$PID_FILE" 2>/dev/null)" 2>/dev/null || true
  [[ -f "$DASH/.dev-preview.pid" ]] && kill "$(cat "$DASH/.dev-preview.pid" 2>/dev/null)" 2>/dev/null || true
  # 复原 promote 副产物：.production-release（指针文件）备份恢复 / smoke 前不存在则删
  if [[ "${REL_FILE_PREEXISTED:-0}" == "1" ]]; then
    cp "$TMP/.production-release.bak" "$RELEASE_FILE" 2>/dev/null || true
  else
    rm -f "$RELEASE_FILE" 2>/dev/null || true
  fi
  # .dist-releases：smoke 前已存在 → 只删 smoke 期间新增的条目（保真实回滚留存不被 fixture 污染/prune 挤掉）；
  #                 smoke 前不存在 → 整删。
  if [[ "${RELEASES_DIR_PREEXISTED:-0}" == "1" ]]; then
    if [[ -d "$RELEASES_DIR" && -f "$TMP/dist-releases.snapshot" ]]; then
      while IFS= read -r entry; do
        [[ -n "$entry" ]] || continue
        grep -qxF "$entry" "$TMP/dist-releases.snapshot" 2>/dev/null || rm -rf "${RELEASES_DIR:?}/$entry" 2>/dev/null || true
      done < <(ls -1 "$RELEASES_DIR" 2>/dev/null)
    fi
  else
    rm -rf "$RELEASES_DIR" 2>/dev/null || true
  fi
  rm -rf "$TMP" "$STAGING_DIST" "$PENDING" "$PID_FILE" "$NOTIFY" "$DASH/.dist-dev" "$DASH/.dev-preview.pid" "$DASH/.dev-preview.log" 2>/dev/null || true
  # 复原 live dist/ 为 smoke 之前不存在的状态（live dist/ 是 gitignore 构建产物）
  [[ "${LIVE_DIST_PREEXISTED:-0}" == "0" ]] && rm -rf "$LIVE_DIST" 2>/dev/null || true
}
trap cleanup EXIT

[[ -d "$LIVE_DIST" ]] && LIVE_DIST_PREEXISTED=1 || LIVE_DIST_PREEXISTED=0
if [[ -d "$RELEASES_DIR" ]]; then
  RELEASES_DIR_PREEXISTED=1
  ls -1 "$RELEASES_DIR" > "$TMP/dist-releases.snapshot" 2>/dev/null || true
else
  RELEASES_DIR_PREEXISTED=0
fi
if [[ -f "$RELEASE_FILE" ]]; then cp "$RELEASE_FILE" "$TMP/.production-release.bak"; REL_FILE_PREEXISTED=1; else REL_FILE_PREEXISTED=0; fi

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
  printf '{"git_sha":"fixture-fake-sha","built_at":"1970-01-01T00:00:00Z"}' > "$dir/build-info.json"
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
# Bark 待放行通知（测试模式写 .staging-notify.log，不真推送）
if [[ -f "$NOTIFY" ]] && grep -q "$PORT" "$NOTIFY" 2>/dev/null && grep -qi "promote" "$NOTIFY" 2>/dev/null; then
  pass "已发 staging 待放行通知（含端口 + promote 提示）"
else
  fail "未发 staging 待放行通知（Bark 推送缺失）"
fi
# 外部可达（slot 必须绑 0.0.0.0 像 5211，不能只绑回环——否则你电脑打不开，跳百度）
HOSTIP=$(python3 -c 'import socket
s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
try:
    s.connect(("8.8.8.8",80)); print(s.getsockname()[0])
except Exception:
    print("")' 2>/dev/null)
if [[ -n "$HOSTIP" ]]; then
  H_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://$HOSTIP:$PORT/" --max-time 6 2>/dev/null || echo 000)
  [[ "$H_CODE" == "200" ]] && pass "staging 对外可达（${HOSTIP}:${PORT}，绑 0.0.0.0 像 5211）" \
    || fail "staging 只绑回环、外部不可达（${HOSTIP}:${PORT} HTTP ${H_CODE}）——你电脑打不开"
else
  echo "  [-] 取不到本机非回环 IP，跳过外部可达检查"
fi
# staging 标识运行时注入（右上角斜角 STAGING 小旗，一眼知道是 staging）
if grep -q "__staging_banner__" "$TMP/staging-index.html" 2>/dev/null && grep -q "STAGING" "$TMP/staging-index.html" 2>/dev/null; then
  pass "staging 页面已注入 STAGING 角旗标识"
else
  fail "staging 页面缺 STAGING 标识（STAGING_BANNER 注入未生效）"
fi
# 角旗必须不挡点击（pointer-events:none，纯视觉标识）
grep -q "pointer-events:none" "$TMP/staging-index.html" 2>/dev/null \
  && pass "角旗 pointer-events:none（不挡 dashboard 点击）" || fail "角旗可能挡点击（缺 pointer-events:none）"
# 标识只运行时注入、不写进 dist 文件（promote 后生产干净，不带标识）
grep -q "__staging_banner__" "$STAGING_DIST/index.html" 2>/dev/null \
  && fail "标识写进了 .dist-staging 文件（会漏到生产）" || pass "标识不在 dist 文件里（生产不会带标识）"
echo ""

# ════════════════════════════════════════════════════════════════════════════
echo "[B] promote：人工放行才换入生产"
CECELIA_DEPLOY_ROOT="$ROOT_DIR" CECELIA_SKIP_BRAIN_PROMOTE=1 CECELIA_SKIP_FRONTEND_RECREATE=1 CECELIA_SKIP_HK=1 CECELIA_SKIP_FINGERPRINT=1 CECELIA_SKIP_GIT_TAG=1 DASHBOARD_STAGING_PORT="$PORT" bash "$PROMOTE" > "$TMP/b.log" 2>&1
B_RC=$?
[[ $B_RC -eq 0 ]] && pass "promote-dashboard.sh 退 0" || { fail "promote-dashboard.sh 退 $B_RC"; sed 's/^/    /' "$TMP/b.log" | tail -20; }
grep -q "NEW_VERSION_SENTINEL" "$LIVE_DIST/index.html" 2>/dev/null \
  && pass "live dist/ 已换成新版（5211 生效）" || fail "live dist/ 未换成新版（promote 没生效）"
[[ ! -f "$PENDING" ]] && pass ".staging-pending 已清（防重复 promote）" || fail ".staging-pending 未清"
# CECELIA_SKIP_HK=1 → HK rsync/指纹校验被跳过；smoke 只验本机 dist/ swap。
# 断言：smoke 环境 promote 日志不含旧式 HK 同步特征串（tar+ssh / 明文 IP）
grep -qE "HK VPS|tar -czf.*ssh|100\.86\.118" "$TMP/b.log" 2>/dev/null \
  && fail "promote 日志含旧式 HK 同步特征（CECELIA_SKIP_HK=1 应已跳过）" || pass "promote HK 同步已跳过（CECELIA_SKIP_HK=1）"
echo ""

# 放行走命令行 promote-dashboard.sh（页面零交互，已在 [B] 覆盖），无页面 endpoint。

# ════════════════════════════════════════════════════════════════════════════
echo "[C] proven-to-fire：自检红 → 生产纹丝不动 + 报红"
seed_old_live
rm -f "$PENDING" "$NOTIFY"; rm -rf "$STAGING_DIST"
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
[[ ! -f "$NOTIFY" ]] && pass "无待放行通知（自检红不通知）" || fail "自检红却发了通知"
F_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$C_PORT/" --max-time 5 2>/dev/null || echo 000)
[[ "$F_CODE" != "200" ]] && pass "staging 端口未起（自检红不预览）" || fail "自检红却起了 staging 服务"
echo ""

# ════════════════════════════════════════════════════════════════════════════
echo "[D] dev 即时预览：dev-preview.sh → 蓝 DEV 旗（独立端口/产物，不碰 staging/生产）"
DEVP="$ROOT_DIR/scripts/dev-preview.sh"
DEV_PORT=$((PORT + 3))
DEV_PID_FILE="$DASH/.dev-preview.pid"
[[ -f "$DEV_PID_FILE" ]] && kill "$(cat "$DEV_PID_FILE" 2>/dev/null)" 2>/dev/null || true
if [[ -f "$DEVP" ]]; then
  pass "dev-preview.sh 存在"
  CECELIA_DEPLOY_ROOT="$ROOT_DIR" DEV_FIXTURE_DIST="$FIXTURE_NEW" DEV_PREVIEW_PORT="$DEV_PORT" bash "$DEVP" > "$TMP/d.log" 2>&1
  D_CODE=$(curl -s -o "$TMP/dev.html" -w "%{http_code}" "http://localhost:$DEV_PORT/" --max-time 8 2>/dev/null || echo 000)
  [[ "$D_CODE" == "200" ]] && pass "dev 预览端口可达" || fail "dev 预览打不开（HTTP ${D_CODE}）"
  grep -q ">DEV<" "$TMP/dev.html" 2>/dev/null && pass "dev 预览是 DEV 旗（非 STAGING）" || fail "dev 预览旗文字不是 DEV"
  grep -q "#3b82f6" "$TMP/dev.html" 2>/dev/null && pass "DEV 旗是蓝色" || fail "DEV 旗颜色不对"
  grep -q ">STAGING<" "$TMP/dev.html" 2>/dev/null && fail "dev 预览误显示 STAGING" || pass "dev 预览不误显示 STAGING（与 staging 区分）"
  [[ -d "$DASH/.dist-dev" ]] && pass "dev 用独立 .dist-dev（不碰 staging/生产产物）" || fail "dev 未用独立 .dist-dev"
  [[ -f "$DEV_PID_FILE" ]] && kill "$(cat "$DEV_PID_FILE" 2>/dev/null)" 2>/dev/null || true
else
  fail "dev-preview.sh 不存在"
fi
echo ""

echo "========================================"
if [[ "$FAILED" -eq 0 ]]; then
  echo -e "${GREEN}STAGING_GATE_SMOKE_OK${NC} — 放行闸 + dev 预览全绿"
  exit 0
else
  echo -e "${RED}STAGING_GATE_SMOKE_FAIL${NC} — ${FAILED} 项红"
  exit 1
fi
