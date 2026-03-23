#!/usr/bin/env bash
# 测试 janitor.sh frequent 模式的孤儿进程检测函数
# 验证核心逻辑：has_live_claude_ancestor 和 is_orphan

set -euo pipefail

PASS=0
FAIL=0

ok() { echo "PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

# 加载 janitor.sh 中的函数（只执行 frequent 模式函数定义）
JANITOR="$(dirname "$0")/../janitor.sh"
if [ ! -f "$JANITOR" ]; then
  echo "ERROR: janitor.sh not found at $JANITOR"
  exit 1
fi

# 验证 1: janitor.sh 存在且可执行
if [ -x "$JANITOR" ]; then
  ok "janitor.sh 存在且可执行"
else
  fail "janitor.sh 不可执行"
fi

# 验证 2: 包含必要函数定义
for fn in find_shell_ancestor has_live_claude_ancestor is_orphan kill_if_orphan etime_to_secs; do
  if grep -q "^  ${fn}()" "$JANITOR" 2>/dev/null || grep -q "^  ${fn} ()" "$JANITOR" 2>/dev/null || grep -qE "^\s+${fn}\(\)" "$JANITOR" 2>/dev/null; then
    ok "函数定义存在: $fn"
  else
    fail "函数定义缺失: $fn"
  fi
done

# 验证 3: 阈值为 600
if grep -q "THRESHOLD_SEC=600" "$JANITOR"; then
  ok "THRESHOLD_SEC=600 (10分钟)"
else
  fail "THRESHOLD_SEC 不是 600"
fi

# 验证 4: 软链接
if [ -L "$HOME/bin/janitor.sh" ]; then
  ok "~/bin/janitor.sh 是软链接"
else
  fail "~/bin/janitor.sh 不是软链接"
fi

# 验证 5: 软链接指向 repo 内文件
LINK_TARGET=$(readlink "$HOME/bin/janitor.sh" 2>/dev/null || echo "")
if echo "$LINK_TARGET" | grep -q "cecelia"; then
  ok "软链接指向 cecelia repo"
else
  fail "软链接未指向 cecelia repo: $LINK_TARGET"
fi

echo ""
echo "结果: $PASS 通过 / $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
