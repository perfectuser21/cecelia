#!/usr/bin/env bash
# watchdog-pr-title-smoke.sh — _discoverPrFromGithub 标题匹配 smoke 验证
# 验证 watchdog 接到共享 GitHub PR discovery，且 discovery 查询并匹配 title。
set -euo pipefail

echo "[smoke] watchdog PR 标题匹配验证..."

# 确认 watchdog 使用共享 discovery，不在 watchdog 内复制 GitHub 解析逻辑
WATCHDOG_SRC="packages/brain/src/harness-relay-watchdog.js"
DISCOVERY_SRC="packages/brain/src/orchestrator/github-pr-discovery.js"
if ! grep -q "discoverPrFromGithub as _discoverPrFromGithub" "$WATCHDOG_SRC"; then
  echo "❌ harness-relay-watchdog.js 未接入共享 discoverPrFromGithub"
  exit 1
fi

# 确认 gh pr list --json 参数包含 title
if ! grep -q 'headRefName,title,url,state' "$DISCOVERY_SRC"; then
  echo "❌ github-pr-discovery.js 查询字段未包含 title"
  exit 1
fi

# 确认共享过滤条件包含标题匹配
if ! grep -q "pr\.title\.includes" "$DISCOVERY_SRC"; then
  echo "❌ _discoverPrFromGithub 过滤条件未包含 title.includes"
  exit 1
fi

echo "✅ watchdog PR 标题匹配 smoke 通过"
