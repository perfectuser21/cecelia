#!/usr/bin/env bash
# watchdog-pr-title-smoke.sh — _discoverPrFromGithub 标题匹配 smoke 验证
# 验证修复后 harness-relay-watchdog.js 的 gh pr list --json 含 title 字段
set -euo pipefail

echo "[smoke] watchdog PR 标题匹配验证..."

# 确认 gh pr list --json 参数包含 title
SRC="packages/brain/src/harness-relay-watchdog.js"
if ! grep -q 'title' "$SRC"; then
  echo "❌ harness-relay-watchdog.js 未包含 title 字段"
  exit 1
fi

# 确认过滤条件包含标题匹配
if ! grep -q "title.includes" "$SRC"; then
  echo "❌ _discoverPrFromGithub 过滤条件未包含 title.includes"
  exit 1
fi

echo "✅ watchdog PR 标题匹配 smoke 通过"
