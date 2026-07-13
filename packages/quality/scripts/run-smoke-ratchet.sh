#!/usr/bin/env bash
# run-smoke-ratchet.sh — Smoke 棘轮闸执行器
#
# 三档分类：
#   ALLOWLIST → 失败即 CI 红（基线保护）
#   DENYLIST  → 跳过（环境不兼容）
#   DEBT      → 失败仅报告（存量债，不阻塞）
#
# 新脚本规则：未登记到三档之任意一档 → CI 红（新债不许欠）
#
# 用法：bash packages/quality/scripts/run-smoke-ratchet.sh
#   环境变量（可选，有默认值）：
#     BRAIN_URL         默认 http://localhost:5221
#     BRAIN_CONTAINER   默认 cecelia-brain-smoke（docker exec 脚本用）
#     SMOKE_DIR         默认 packages/brain/scripts/smoke

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
QUALITY_DIR="$REPO_ROOT/packages/quality"
ALLOWLIST="$QUALITY_DIR/smoke-allowlist.txt"
DENYLIST="$QUALITY_DIR/smoke-denylist.txt"
DEBT_LIST="$QUALITY_DIR/smoke-debt.txt"
SMOKE_DIR="${SMOKE_DIR:-$REPO_ROOT/packages/brain/scripts/smoke}"

export BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
export BRAIN_CONTAINER="${BRAIN_CONTAINER:-cecelia-brain-smoke}"

# ── 前置检查 ────────────────────────────────────────────────────
for f in "$ALLOWLIST" "$DENYLIST" "$DEBT_LIST"; do
  [ -f "$f" ] || { echo "::error::缺少分类文件: $f"; exit 1; }
done
[ -d "$SMOKE_DIR" ] || { echo "::error::SMOKE_DIR 不存在: $SMOKE_DIR"; exit 1; }

# 读取各分类（去注释、去空行）
_load_list() { grep -v '^#' "$1" | grep -v '^[[:space:]]*$' | sort; }
ALLOWLIST_ENTRIES=$(_load_list "$ALLOWLIST")
DENYLIST_ENTRIES=$(_load_list "$DENYLIST")
DEBT_ENTRIES=$(_load_list "$DEBT_LIST")

_in_list() { echo "$2" | grep -qxF "$1"; }

echo "══════════════════════════════════════════════"
echo "🔬 Smoke Ratchet Gate"
echo "   ALLOWLIST : $(echo "$ALLOWLIST_ENTRIES" | grep -c . || echo 0) 个（必须通过）"
echo "   DENYLIST  : $(echo "$DENYLIST_ENTRIES"  | grep -c . || echo 0) 个（跳过）"
echo "   DEBT      : $(echo "$DEBT_ENTRIES"      | grep -c . || echo 0) 个（存量债）"
echo "   Brain URL : $BRAIN_URL"
echo "══════════════════════════════════════════════"
echo ""

# ── 执行循环 ────────────────────────────────────────────────────
PASS=0; FAIL_BASELINE=0; FAIL_DEBT=0; SKIP=0; UNREGISTERED=0; TOTAL=0
BASELINE_FAIL_NAMES=()
DEBT_FAIL_NAMES=()
UNREGISTERED_NAMES=()

for script in "$SMOKE_DIR"/*.sh; do
  [ -f "$script" ] || continue
  fname=$(basename "$script")
  TOTAL=$((TOTAL + 1))

  # 1. DENYLIST → skip
  if _in_list "$fname" "$DENYLIST_ENTRIES"; then
    SKIP=$((SKIP + 1))
    echo "⏭  SKIP  [denylist] $fname"
    continue
  fi

  # 2. 未登记检测（既不在 allowlist 也不在 debt）
  IN_ALLOWLIST=false; IN_DEBT=false
  _in_list "$fname" "$ALLOWLIST_ENTRIES" && IN_ALLOWLIST=true || true
  _in_list "$fname" "$DEBT_ENTRIES"      && IN_DEBT=true      || true

  if ! $IN_ALLOWLIST && ! $IN_DEBT; then
    UNREGISTERED=$((UNREGISTERED + 1))
    UNREGISTERED_NAMES+=("$fname")
    echo "::error::❌ UNREGISTERED: $fname（新脚本未登记，见 packages/quality/README）"
    continue
  fi

  # 3. 运行脚本
  echo "── ▶  $fname"
  if bash "$script" 2>&1; then
    PASS=$((PASS + 1))
    echo "── ✅ PASS: $fname"
  else
    EXIT_CODE=$?
    if $IN_ALLOWLIST; then
      FAIL_BASELINE=$((FAIL_BASELINE + 1))
      BASELINE_FAIL_NAMES+=("$fname")
      echo "::error::❌ BASELINE FAIL (exit $EXIT_CODE): $fname"
    else
      FAIL_DEBT=$((FAIL_DEBT + 1))
      DEBT_FAIL_NAMES+=("$fname")
      echo "::warning::⚠  DEBT FAIL (exit $EXIT_CODE): $fname"
    fi
  fi
done

# ── 汇报 ────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════"
echo "📊 Smoke Ratchet 结果（$(date -u +%Y-%m-%dT%H:%MZ)）"
printf "   %-20s %d\n" "TOTAL:"       "$TOTAL"
printf "   %-20s %d\n" "PASS:"        "$PASS"
printf "   %-20s %d\n" "SKIP(deny):"  "$SKIP"
printf "   %-20s %d\n" "FAIL(基线):"  "$FAIL_BASELINE"
printf "   %-20s %d\n" "FAIL(债务):"  "$FAIL_DEBT"
printf "   %-20s %d\n" "UNREGISTERED:" "$UNREGISTERED"
echo "══════════════════════════════════════════════"

if [ "$FAIL_BASELINE" -gt 0 ]; then
  echo ""
  echo "❌ 基线脚本失败（必须修复后才能合并）："
  for s in "${BASELINE_FAIL_NAMES[@]}"; do echo "   - $s"; done
fi

if [ "$UNREGISTERED" -gt 0 ]; then
  echo ""
  echo "❌ 未登记脚本（新增脚本必须加入 allowlist 或 denylist，不允许欠新债）："
  for s in "${UNREGISTERED_NAMES[@]}"; do echo "   - $s"; done
  echo "   → 请将以上脚本加入 packages/quality/smoke-allowlist.txt"
  echo "   → 或因 CI 环境限制加入 packages/quality/smoke-denylist.txt"
fi

if [ "$FAIL_DEBT" -gt 0 ]; then
  echo ""
  echo "⚠  存量债脚本失败（不阻塞合并，待后续清偿）："
  for s in "${DEBT_FAIL_NAMES[@]}"; do echo "   - $s"; done
  echo "   → 修复后从 smoke-debt.txt 移入 smoke-allowlist.txt"
fi

# ── 最终判定 ────────────────────────────────────────────────────
FINAL_FAIL=0
[ "$FAIL_BASELINE"  -gt 0 ] && FINAL_FAIL=$((FINAL_FAIL + 1))
[ "$UNREGISTERED"   -gt 0 ] && FINAL_FAIL=$((FINAL_FAIL + 1))

if [ "$FINAL_FAIL" -gt 0 ]; then
  echo ""
  echo "❌ GATE FAILED"
  exit 1
fi

echo ""
echo "✅ GATE PASSED（基线全通，债务 ${FAIL_DEBT} 个待清偿）"
exit 0
