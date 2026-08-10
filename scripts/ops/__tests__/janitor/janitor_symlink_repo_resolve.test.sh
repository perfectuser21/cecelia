#!/usr/bin/env bash
# 回归测试：janitor.sh 经软链调用时 CECELIA_REPO 必须解析到真实仓库根
#
# 事故（2026-08-10 真跑验收实证）：生产 cron 走 ~/bin/janitor.sh 软链调用，
# $0 = /Users/administrator/bin/janitor.sh，旧逻辑 `$(dirname "$0")/../..`
# 反推出 ${HOME}（无 .git）→ 步骤 8 "✗ 跳过（git 仓库不存在）"静默失效。
# CI 用真实路径调用测不到这个接缝——本测试用软链调用复现。
# 先例：packages/brain/scripts/cecelia-run.sh:417 同构 bug 的生产验证修法。

set -euo pipefail

PASS=0
FAIL=0

ok() { echo "PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

JANITOR="$(cd "$(dirname "$0")/../.." && pwd)/janitor.sh"
if [ ! -f "$JANITOR" ]; then
  echo "ERROR: janitor.sh not found at $JANITOR"
  exit 1
fi

# ── 搭建假仓库 + 软链调用环境 ─────────────────────────────────────
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/repo/scripts/ops" "$TMP/repo/.git" "$TMP/bin"
cp "$JANITOR" "$TMP/repo/scripts/ops/janitor.sh"
ln -s "$TMP/repo/scripts/ops/janitor.sh" "$TMP/bin/janitor.sh"

# 归一化路径（macOS mktemp 落在 /var/folders → 实际是 /private/var 的 firmlink）
REAL_REPO="$(cd "$TMP/repo" && pwd -P)"

# ── 从脚本头部提取 SCRIPT_PATH/CECELIA_REPO 解析逻辑（绑定真实代码，不测复制品）──
RESOLVE_LINES="$(sed -n '1,60p' "$TMP/bin/janitor.sh" | grep -E '^(SCRIPT_PATH=|\[\[ -L "\$SCRIPT_PATH" \]\]|CECELIA_REPO=)')"
if [ -z "$RESOLVE_LINES" ]; then
  fail "无法从 janitor.sh 头部提取 CECELIA_REPO 解析逻辑"
  echo "结果: PASS=$PASS FAIL=$FAIL"
  exit 1
fi

# 以软链为 $0 执行解析逻辑
RESOLVED="$(bash -c "${RESOLVE_LINES}; cd \"\$CECELIA_REPO\" 2>/dev/null && pwd -P" "$TMP/bin/janitor.sh" || echo "RESOLVE_FAILED")"

# 断言 1：软链调用下解析结果 == 真实仓库根
if [ "$RESOLVED" = "$REAL_REPO" ]; then
  ok "软链调用下 CECELIA_REPO 解析到真实仓库根"
else
  fail "软链调用下 CECELIA_REPO 解析错误：got='$RESOLVED' want='$REAL_REPO'"
fi

# 断言 2：真实路径直接调用也必须解析正确（防修复只顾软链、坏了直调）
RESOLVED_DIRECT="$(bash -c "${RESOLVE_LINES}; cd \"\$CECELIA_REPO\" 2>/dev/null && pwd -P" "$TMP/repo/scripts/ops/janitor.sh" || echo "RESOLVE_FAILED")"
if [ "$RESOLVED_DIRECT" = "$REAL_REPO" ]; then
  ok "真实路径直调下 CECELIA_REPO 解析正确"
else
  fail "真实路径直调下 CECELIA_REPO 解析错误：got='$RESOLVED_DIRECT' want='$REAL_REPO'"
fi

# 断言 3：步骤 8 的"仓库不存在"跳过必须计入 FAILED_STEPS（环境断裂不许静默 ✗）
if grep -A2 '跳过（git 仓库不存在）' "$JANITOR" | grep -q 'step_fail'; then
  ok "步骤8 仓库缺失跳过已计入 FAILED_STEPS（step_fail）"
else
  fail "步骤8 仓库缺失时静默跳过，未调 step_fail"
fi

echo ""
echo "结果: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
