#!/usr/bin/env bash
# check-branch-naming.sh — /dev 工作流分支命名规范校验
# 从 .github/workflows/ci.yml 的 branch-naming job 抽取，供 CI 复用 + 单测覆盖
set -euo pipefail

BRANCH="${1:?usage: check-branch-naming.sh <branch-name>}"

# 基础分支直接跳过
if echo "$BRANCH" | grep -qE '^(main|master|develop|staging|release)$'; then
  echo "✅ 基础分支，跳过命名检查: $BRANCH"
  exit 0
fi

# 兼容 8 位 (MMDDHHNN) 与 10 位 (MMDDHHMMSS) 时间戳
if echo "$BRANCH" | grep -qE '^cp-[0-9]{8,10}-[a-z0-9-]+$'; then
  echo "✅ 分支命名规范: $BRANCH"
else
  echo "::error::分支名 '$BRANCH' 不符合 /dev 工作流规范"
  echo "  当前分支: $BRANCH"
  echo "  要求格式: cp-XXXXXXXX-task-name（8 或 10 位时间戳）"
  echo "  所有代码改动必须通过 /dev 工作流创建分支"
  exit 1
fi
