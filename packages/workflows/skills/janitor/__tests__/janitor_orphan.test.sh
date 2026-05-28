#!/usr/bin/env bash
# 测试 janitor.sh v4.0 frequent 模式
# 验证：基础函数、claude孤儿检测逻辑、资源压力变量

set -euo pipefail

PASS=0
FAIL=0

ok() { echo "PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

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

# 验证 3: 包含 claude 孤儿检测相关函数（v4.0）
for fn in is_claude_orphan has_brain_inprogress_task has_active_dev_lock kill_if_claude_orphan; do
  if grep -qE "^\s+${fn}\(\)" "$JANITOR" 2>/dev/null; then
    ok "v4.0 函数定义存在: $fn"
  else
    fail "v4.0 函数定义缺失: $fn"
  fi
done

# 验证 4: 阈值为 600（正常值）
if grep -q "THRESHOLD_SEC=600" "$JANITOR"; then
  ok "THRESHOLD_SEC=600 (10分钟)"
else
  fail "THRESHOLD_SEC 不是 600"
fi

# 验证 5: 内存高压阈值为 300
if grep -q "MEM_HIGH_THRESHOLD_SEC=300" "$JANITOR"; then
  ok "MEM_HIGH_THRESHOLD_SEC=300 (内存高压5分钟)"
else
  fail "MEM_HIGH_THRESHOLD_SEC 不是 300"
fi

# 验证 6: CPU 告警阈值存在
if grep -q "CPU_ALERT_THRESHOLD" "$JANITOR"; then
  ok "CPU_ALERT_THRESHOLD 定义存在"
else
  fail "CPU_ALERT_THRESHOLD 未定义"
fi

# 验证 7: 有头进程保护（TTY != ?? 返回 1）
if grep -q 'tty" != "??"' "$JANITOR" 2>/dev/null || grep -q '"$tty" != "\?\?"' "$JANITOR" 2>/dev/null; then
  ok "有头进程保护逻辑存在（TTY != ??）"
else
  fail "有头进程保护逻辑缺失"
fi

# 验证 8: 白名单保护（brain/server 等）
if grep -q "brain/server" "$JANITOR"; then
  ok "白名单保护存在（brain/server）"
else
  fail "白名单保护缺失"
fi

# 验证 9: Brain API 查询（双重验证之一）
if grep -q "brain/tasks?status=in_progress" "$JANITOR"; then
  ok "Brain DB 查询逻辑存在"
else
  fail "Brain DB 查询逻辑缺失"
fi

# 验证 10: .dev-lock 查询（双重验证之二）
if grep -q ".dev-lock." "$JANITOR"; then
  ok ".dev-lock 检查逻辑存在"
else
  fail ".dev-lock 检查逻辑缺失"
fi

# 验证 11: 软链接（CI 环境跳过）
if [ -n "${CI:-}" ]; then
  ok "~/bin/janitor.sh 软链接（CI 环境跳过，本地部署时验证）"
elif [ -L "$HOME/bin/janitor.sh" ]; then
  ok "~/bin/janitor.sh 是软链接"
else
  fail "~/bin/janitor.sh 不是软链接"
fi

# 验证 12: 软链接指向 repo 内文件（CI 环境跳过）
if [ -n "${CI:-}" ]; then
  ok "软链接指向 cecelia repo（CI 环境跳过）"
else
  LINK_TARGET=$(readlink "$HOME/bin/janitor.sh" 2>/dev/null || echo "")
  if echo "$LINK_TARGET" | grep -q "cecelia"; then
    ok "软链接指向 cecelia repo"
  else
    fail "软链接未指向 cecelia repo: $LINK_TARGET"
  fi
fi

# 验证 13: notify_brain_orphan_killed 函数存在（v4.1 Brain 回报）
if grep -qE "^\s+notify_brain_orphan_killed\(\)" "$JANITOR" 2>/dev/null; then
  ok "v4.1 函数定义存在: notify_brain_orphan_killed"
else
  fail "v4.1 函数定义缺失: notify_brain_orphan_killed"
fi

# 验证 14: orphan_killed_by_janitor 字符串存在
if grep -q "orphan_killed_by_janitor" "$JANITOR"; then
  ok "orphan_killed_by_janitor 标识符存在"
else
  fail "orphan_killed_by_janitor 标识符缺失"
fi

# 验证 15: kill_if_claude_orphan 调用了回报函数
if grep -A 40 "kill_if_claude_orphan()" "$JANITOR" 2>/dev/null | grep -q "notify_brain_orphan_killed"; then
  ok "kill_if_claude_orphan 调用了 notify_brain_orphan_killed"
else
  fail "kill_if_claude_orphan 未调用 notify_brain_orphan_killed"
fi

echo ""
echo "结果: $PASS 通过 / $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
