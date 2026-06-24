#!/usr/bin/env bash
# dashboard-staging-selfcheck-smoke.sh — 轻量 staging 部署前自检 gate 的 E2E smoke
#
# 定义"什么叫完成"（E2E-first commit-1）：
#   验证 scripts/dashboard-staging-selfcheck.sh 这道 gate 真能区分
#   "好构建产物" 和 "会让生产白屏/缺 env 的坏产物"：
#     A. 好 dist + env 齐  → gate 退出 0，输出 STAGING_SELFCHECK_OK（可 promote）
#     B. 坏 dist（入口 bundle 缺失 = 白屏）→ gate 退出 1，输出 STAGING_SELFCHECK_FAIL
#     C. 关键 env 缺失      → gate 退出 1，输出 STAGING_SELFCHECK_FAIL（proven-to-fire 的点）
#
# 不依赖 Brain / DB / docker —— 纯 node http + curl，造小 dist fixture 自检 gate 本身。
#
# 退出码：0 = 全部断言通过，1 = 任一断言失败

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# packages/brain/scripts/smoke → 回到 repo root
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
GATE="$ROOT_DIR/scripts/dashboard-staging-selfcheck.sh"

GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
FAILED=0
ok()   { echo -e "${GREEN}✓${NC} $1"; }
bad()  { echo -e "${RED}✗${NC} $1"; FAILED=$((FAILED + 1)); }

echo "=== dashboard-staging-selfcheck gate E2E smoke ==="

if [[ ! -f "$GATE" ]]; then
  bad "gate 脚本不存在: ${GATE}（实现未到位）"
  echo "STAGING_SELFCHECK_SMOKE_FAIL"
  exit 1
fi

WORK="$(mktemp -d -t staging-selfcheck-smoke.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

# ── 造一个"好"的 dist fixture（含 index.html + 真实可达的入口 bundle）──────────
GOOD="$WORK/good-dist"
mkdir -p "$GOOD/assets"
echo 'console.log("app");' > "$GOOD/assets/index-good.js"
echo 'body{margin:0}'      > "$GOOD/assets/index-good.css"
cat > "$GOOD/index.html" <<'HTML'
<!DOCTYPE html>
<html lang="zh-CN"><head><title>Perfect21</title>
<script type="module" crossorigin src="/assets/index-good.js"></script>
<link rel="stylesheet" crossorigin href="/assets/index-good.css"></head>
<body><div id="root"></div></body></html>
HTML

# ── 造一个"坏"的 dist fixture（index.html 引用的入口 bundle 不存在 = 白屏）─────
BAD="$WORK/bad-dist"
mkdir -p "$BAD/assets"
# 故意不创建 index-missing.js → 浏览器拉不到 bundle → 白屏
cat > "$BAD/index.html" <<'HTML'
<!DOCTYPE html>
<html lang="zh-CN"><head><title>Perfect21</title>
<script type="module" crossorigin src="/assets/index-missing.js"></script></head>
<body><div id="root"></div></body></html>
HTML

# ── 断言 A：好 dist + env 齐 → OK（退出 0）────────────────────────────────────
echo ""
echo "[A] 好 dist + 关键 env 齐 → 期望 OK"
OUT_A="$(VITE_N8N_WEBHOOK_BASE="https://n8n.example/webhook" bash "$GATE" "$GOOD" 5231 2>&1)"
RC_A=$?
if [[ $RC_A -eq 0 ]] && echo "$OUT_A" | grep -q "STAGING_SELFCHECK_OK"; then
  ok "好 dist 通过自检（退出 0 + STAGING_SELFCHECK_OK）"
else
  bad "好 dist 未通过（rc=$RC_A）"
  echo "$OUT_A" | sed 's/^/    /'
fi

# ── 断言 B：坏 dist（白屏：入口 bundle 缺失）→ FAIL（退出 1）──────────────────
echo ""
echo "[B] 坏 dist（入口 bundle 404 = 白屏）→ 期望 FAIL"
OUT_B="$(VITE_N8N_WEBHOOK_BASE="https://n8n.example/webhook" bash "$GATE" "$BAD" 5232 2>&1)"
RC_B=$?
if [[ $RC_B -ne 0 ]] && echo "$OUT_B" | grep -q "STAGING_SELFCHECK_FAIL"; then
  ok "坏 dist 被拦下（退出 $RC_B + STAGING_SELFCHECK_FAIL）"
else
  bad "坏 dist 未被拦下（rc=$RC_B，gate 漏判白屏！）"
  echo "$OUT_B" | sed 's/^/    /'
fi

# ── 断言 C：关键 env 缺失 → FAIL（proven-to-fire 的点）────────────────────────
echo ""
echo "[C] 好 dist 但关键 env 缺失 → 期望 FAIL"
OUT_C="$(env -u VITE_N8N_WEBHOOK_BASE bash "$GATE" "$GOOD" 5233 2>&1)"
RC_C=$?
if [[ $RC_C -ne 0 ]] && echo "$OUT_C" | grep -q "STAGING_SELFCHECK_FAIL"; then
  ok "缺 env 被拦下（退出 $RC_C + STAGING_SELFCHECK_FAIL）"
else
  bad "缺 env 未被拦下（rc=$RC_C，gate 漏判缺 env！）"
  echo "$OUT_C" | sed 's/^/    /'
fi

echo ""
echo "========================================"
if [[ "$FAILED" -eq 0 ]]; then
  echo -e "${GREEN}STAGING_SELFCHECK_SMOKE_OK${NC} — gate 能正确区分好/坏产物 + 缺 env"
  exit 0
else
  echo -e "${RED}STAGING_SELFCHECK_SMOKE_FAIL${NC} — ${FAILED} 项断言失败"
  exit 1
fi
