#!/usr/bin/env bash
# PostToolUse Hook: post-pr-create v2.0
# 在 gh pr create 成功后触发 auto-merge；rewrite/* 分支跳过。
#
# v2.0: fail-closed — gh 失败时用 git branch --show-current 兜底；
#       两者均失败 → 保守跳过 auto-merge（不因信息缺失静默放行）。
# v1.0: fail-open（已废弃）

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

# ===== 解析 --repo 参数 =====
REPO=""
if [[ "$COMMAND" =~ --repo[=[:space:]]+([^[:space:]\"\']+) ]]; then
  REPO="${BASH_REMATCH[1]}"
elif [[ "$COMMAND" =~ -R[[:space:]]+([^[:space:]\"\']+) ]]; then
  REPO="${BASH_REMATCH[1]}"
fi

# ===== 获取分支名（fail-closed 兜底） =====
HEAD_BRANCH=""

# 优先：gh pr view（最权威）
if [[ -n "$REPO" ]]; then
  HEAD_BRANCH=$(gh pr view "$PR_NUMBER" --repo "$REPO" --json headRefName -q .headRefName 2>/dev/null || echo "")
else
  HEAD_BRANCH=$(gh pr view "$PR_NUMBER" --json headRefName -q .headRefName 2>/dev/null || echo "")
fi

# 兜底：本地 git branch --show-current
if [[ -z "$HEAD_BRANCH" ]]; then
  HEAD_BRANCH=$(git branch --show-current 2>/dev/null || echo "")
fi

# 两者均失败 → fail-closed
if [[ -z "$HEAD_BRANCH" ]]; then
  echo "[post-pr-create] 无法获取分支名（gh 和 git 均失败），保守跳过 auto-merge (fail-closed)" >&2
  exit 0
fi

# ===== rewrite/* 跳过 auto-merge =====
if [[ "$HEAD_BRANCH" == rewrite/* ]]; then
  echo "[post-pr-create] rewrite/* 分支（${HEAD_BRANCH}）：跳过 auto-merge，等主理人批准。" >&2
  exit 0
fi

# ===== 触发 auto-merge =====
echo "[post-pr-create] PR #${PR_NUMBER}（${HEAD_BRANCH}）→ 触发 auto-merge" >&2
if [[ -n "$REPO" ]]; then
  gh pr merge "$PR_NUMBER" --repo "$REPO" --auto --squash >&2 2>&1 || true
else
  gh pr merge "$PR_NUMBER" --auto --squash >&2 2>&1 || true
fi

exit 0
