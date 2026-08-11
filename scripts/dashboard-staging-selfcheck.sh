#!/usr/bin/env bash
# dashboard-staging-selfcheck.sh — Cecelia 轻量 staging：部署前自检 gate
#
# 用途：
#   在把 dashboard 新版本 promote 到生产（perfect21:5211 + HK）之前，
#   先把构建产物（dist/）拉到一个【本机非生产端口的 staging slot】里跑起来，
#   做 5 项部署前自检。全绿才允许 promote；任一项红 → 退出码 1，调用方不得碰生产。
#
# 5 项自检（对照 PrepPRD Golden Path step 3）：
#   1 服务/页面起得来      — slot http server 能 listen 并响应
#   2 关键 env 齐          — 关键变量已设置（缺了/空了就红）
#   3 首页真 URL 200 不白屏 — GET / 返回 200 且 index.html 引用的 JS/CSS 资产都 200
#                            （白屏的真因 = 入口 bundle 404）
#   4 核心路由 smoke       — 深层路由（/clips）返回 SPA shell 不被打回错误页；
#                            命名静态页（line04-customer-service.html）能打开
#   5 build-info.json 守卫 — 产物必含 build-info.json 且带 git_sha（判变对账数据源）
#
# 用法：
#   bash scripts/dashboard-staging-selfcheck.sh <DIST_DIR> [PORT]
#   DIST_DIR 默认 apps/dashboard/dist，PORT 默认 5251（非生产）
#
# 退出码：
#   0 = STAGING_SELFCHECK_OK（全绿，可 promote）
#   1 = STAGING_SELFCHECK_FAIL（有红，禁止碰生产）

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

DIST_DIR="${1:-$ROOT_DIR/apps/dashboard/dist}"
SLOT_PORT="${2:-5251}"

# 关键 env：缺了/空了 dashboard 会功能受损（Vite 在 build 时把 import.meta.env 内联进 bundle，
# 所以"缺 env"= bundle 里对应位置是空串/undefined）。
#
# 关键 env 列表【从真实消费点驱动，不靠硬编码猜】：
#   - 默认：扫 apps/dashboard/src 里真正用到的 import.meta.env.VITE_* 名（只有被代码读的才算"必需"）。
#     当前 apps/dashboard/src 不消费任何 VITE_* → 默认无必需 env（正常路径不会被误红）。
#   - 可覆盖：DASHBOARD_REQUIRED_ENV="VITE_A VITE_B" 显式指定（部署链路注入；供加厚/客户机定制）。
# 这样既不误红正常路径，又能在"代码真用了某 env 但部署没给"时戳红（proven-to-fire）。
# 注：用 read 循环而非 mapfile —— macOS 自带 bash 3.2 无 mapfile，本机部署也跑这脚本。
DASHBOARD_SRC="${DASHBOARD_SRC_DIR:-$ROOT_DIR/apps/dashboard/src}"
REQUIRED_ENV_KEYS=()
if [[ -n "${DASHBOARD_REQUIRED_ENV:-}" ]]; then
  read -r -a REQUIRED_ENV_KEYS <<< "$DASHBOARD_REQUIRED_ENV"
elif [[ -d "$DASHBOARD_SRC" ]]; then
  # 从源码里抽取真正被读的 import.meta.env.VITE_XXX 名（只有被代码读的才算"必需"）
  while IFS= read -r k; do
    [[ -n "$k" ]] && REQUIRED_ENV_KEYS+=("$k")
  done < <(
    grep -rhoE 'import\.meta\.env\.(VITE_[A-Z0-9_]+)' "$DASHBOARD_SRC" 2>/dev/null \
      | sed -E 's/.*\.(VITE_[A-Z0-9_]+)/\1/' | sort -u
  )
fi

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

FAILED=0
SLOT_PID=""

pass() { echo -e "${GREEN}[OK]${NC} $1"; }
fail() { echo -e "${RED}[X]${NC} $1"; FAILED=$((FAILED + 1)); }
info() { echo -e "${YELLOW}[-]${NC} $1"; }

cleanup() {
  if [[ -n "$SLOT_PID" ]] && kill -0 "$SLOT_PID" 2>/dev/null; then
    kill "$SLOT_PID" 2>/dev/null || true
    wait "$SLOT_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "=== Dashboard Staging 部署前自检 (slot port=${SLOT_PORT}) ==="
echo "  dist: ${DIST_DIR}"
echo ""

# ── 前置：dist 必须存在且含 index.html ────────────────────────────────────────
if [[ ! -d "$DIST_DIR" ]]; then
  fail "dist 目录不存在: ${DIST_DIR}（构建未产出，无法自检）"
  echo ""
  echo "STAGING_SELFCHECK_FAIL"
  exit 1
fi
if [[ ! -f "$DIST_DIR/index.html" ]]; then
  fail "dist/index.html 不存在（构建残缺）"
  echo ""
  echo "STAGING_SELFCHECK_FAIL"
  exit 1
fi

# ── 2 关键 env 齐（先于起服务，因为 env 已 bake 进静态产物）──────────────────
echo "[2] 关键 env 检查（缺了就红）"
if [[ "${#REQUIRED_ENV_KEYS[@]}" -eq 0 ]]; then
  info "无必需 env（dashboard 源码未消费任何 import.meta.env.VITE_*）"
else
  for key in "${REQUIRED_ENV_KEYS[@]}"; do
    [[ -z "$key" ]] && continue
    val="${!key:-}"
    if [[ -z "$val" ]]; then
      fail "关键 env 缺失或为空: ${key}（dashboard 将功能受损）"
    else
      pass "关键 env 已设置: ${key}"
    fi
  done
fi
echo ""

# ── 1 起 staging slot（与生产同款静态 server 行为：SPA fallback）────────────
echo "[1] 起 staging slot 服务"
SLOT_LOG="$(mktemp "${TMPDIR:-/tmp}/dashboard-slot.XXXXXX")"
DIST_DIR="$DIST_DIR" SLOT_PORT="$SLOT_PORT" node "$SCRIPT_DIR/dashboard-slot-server.cjs" > "$SLOT_LOG" 2>&1 &
SLOT_PID=$!

SLOT_UP=0
for _ in $(seq 1 15); do
  if curl -sf "http://localhost:${SLOT_PORT}/" -o /dev/null 2>/dev/null; then
    SLOT_UP=1
    break
  fi
  if ! kill -0 "$SLOT_PID" 2>/dev/null; then
    break
  fi
  sleep 1
done

if [[ "$SLOT_UP" -eq 1 ]]; then
  pass "staging slot 已起 (localhost:${SLOT_PORT})"
else
  fail "staging slot 起不来（服务/页面起不来）"
  echo "  --- slot 日志 ---"
  sed 's/^/  /' "$SLOT_LOG" || true
  echo ""
  echo "STAGING_SELFCHECK_FAIL"
  exit 1
fi
echo ""

BASE="http://localhost:${SLOT_PORT}"

# ── 3 首页真 URL 200 + 不白屏（入口资产可达）────────────────────────────────
echo "[3] 首页 200 + 不白屏（入口资产可达）"
INDEX_HTML="$(mktemp "${TMPDIR:-/tmp}/slot-index.XXXXXX")"
HTTP_CODE=$(curl -s -o "$INDEX_HTML" -w "%{http_code}" "${BASE}/" --max-time 10 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" == "200" ]]; then
  pass "GET / -> HTTP 200"
else
  fail "GET / -> HTTP ${HTTP_CODE}（期望 200）"
fi

if grep -q 'id="root"' "$INDEX_HTML"; then
  pass "index.html 含 #root 挂载点"
else
  fail "index.html 缺 #root 挂载点（外壳残缺，必白屏）"
fi

# 白屏真因检测：index.html 引用的 JS/CSS 资产必须都能 200
ASSET_REFS=$(grep -oE '(src|href)="(/assets/[^"]+)"' "$INDEX_HTML" \
  | sed -E 's/.*"(\/assets\/[^"]+)"/\1/' | sort -u || true)
if [[ -z "$ASSET_REFS" ]]; then
  fail "index.html 未引用任何 /assets 入口 bundle（构建残缺，必白屏）"
else
  ASSET_FAIL=0
  ASSET_TOTAL=0
  while IFS= read -r asset; do
    [[ -z "$asset" ]] && continue
    ASSET_TOTAL=$((ASSET_TOTAL + 1))
    A_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE}${asset}" --max-time 10 2>/dev/null || echo "000")
    if [[ "$A_CODE" != "200" ]]; then
      fail "入口资产 ${asset} -> HTTP ${A_CODE}（白屏：浏览器拉不到 bundle）"
      ASSET_FAIL=$((ASSET_FAIL + 1))
    fi
  done <<< "$ASSET_REFS"
  if [[ "$ASSET_FAIL" -eq 0 ]]; then
    pass "全部入口资产可达（${ASSET_TOTAL} 个 JS/CSS 都 200，不白屏）"
  fi
fi
echo ""

# ── 4 核心路由 smoke（深层路由不被打回错误页 + 命名静态页可开）───────────────
echo "[4] 核心路由 smoke"
ROUTE_HTML="$(mktemp "${TMPDIR:-/tmp}/slot-route.XXXXXX")"
R_CODE=$(curl -s -o "$ROUTE_HTML" -w "%{http_code}" "${BASE}/clips" --max-time 10 2>/dev/null || echo "000")
if [[ "$R_CODE" == "200" ]] && grep -q 'id="root"' "$ROUTE_HTML"; then
  pass "深层路由 /clips -> 200 + SPA shell（未被打回错误页）"
else
  fail "深层路由 /clips -> HTTP ${R_CODE}（未回退 SPA shell，路由被打断）"
fi

if [[ -f "$DIST_DIR/line04-customer-service.html" ]]; then
  L_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE}/line04-customer-service.html" --max-time 10 2>/dev/null || echo "000")
  if [[ "$L_CODE" == "200" ]]; then
    pass "命名静态页 line04-customer-service.html -> 200"
  else
    fail "命名静态页 line04-customer-service.html -> HTTP ${L_CODE}"
  fi
else
  info "dist 无 line04-customer-service.html，跳过该页检查（非硬要求）"
fi
echo ""

# ── 5 build-info.json 生成守卫（判变对账的数据源，缺失=对账退化为保守构建）────
echo "[5] build-info.json 生成守卫"
BUILD_INFO="$DIST_DIR/build-info.json"
if [[ ! -f "$BUILD_INFO" ]]; then
  fail "产物缺 build-info.json（vite build-info 插件没生效？判变对账将退化为保守构建）"
else
  BI_SHA=$(node -e "let s=require('fs').readFileSync('$BUILD_INFO','utf8');try{process.stdout.write(JSON.parse(s).git_sha||'')}catch{process.stdout.write('')}" 2>/dev/null || echo "")
  if [[ -z "$BI_SHA" ]]; then
    fail "build-info.json 无 git_sha 字段（对账缺数据源）"
  else
    pass "build-info.json git_sha=${BI_SHA:0:12}"
  fi
fi
echo ""

rm -f "$INDEX_HTML" "$ROUTE_HTML" "$SLOT_LOG" 2>/dev/null || true

# ── 总结 ──────────────────────────────────────────────────────────────────────
echo "========================================"
if [[ "$FAILED" -eq 0 ]]; then
  echo -e "${GREEN}STAGING_SELFCHECK_OK${NC} — 全部自检通过，可以 promote 到生产 (5211 + HK)"
  exit 0
else
  echo -e "${RED}STAGING_SELFCHECK_FAIL${NC} — ${FAILED} 项自检失败，禁止 promote（生产保持旧版本）"
  exit 1
fi
