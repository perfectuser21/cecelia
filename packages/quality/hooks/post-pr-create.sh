#!/usr/bin/env bash
# PostToolUse Hook: post-pr-create v3.0
# PR 创建后只做审计提示；所有分支一律交给 Kernel exact-SHA merge gate。
# 标题、分支、环境变量与 provider 输出都不能授予 merge authority。

set -uo pipefail

# ===== JSON 输入处理 =====
INPUT=$(cat)

if ! command -v jq &>/dev/null; then
  exit 0
fi

if ! echo "$INPUT" | jq empty >/dev/null 2>&1; then
  exit 0
fi

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null || echo "")
if [[ "$TOOL_NAME" != "Bash" ]]; then
  exit 0
fi

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null || echo "")
if [[ "$COMMAND" != *"gh pr create"* ]]; then
  exit 0
fi

# ===== 从输出中提取 PR 号 =====
TOOL_OUTPUT=$(echo "$INPUT" | jq -r '.tool_response.output // .tool_response // ""' 2>/dev/null || echo "")
PR_NUMBER=""
if [[ "$TOOL_OUTPUT" =~ /pull/([0-9]+) ]]; then
  PR_NUMBER="${BASH_REMATCH[1]}"
fi
if [[ -z "$PR_NUMBER" ]]; then
  echo "[post-pr-create] 无法从输出提取 PR 号，跳过 auto-merge" >&2
  exit 0
fi

# ===== 永久 Kernel-only =====
echo "[post-pr-create] PR #${PR_NUMBER} 已创建；auto-merge authority 已撤销，等待 Kernel exact-SHA merge gate。" >&2
exit 0
