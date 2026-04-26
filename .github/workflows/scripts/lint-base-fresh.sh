#!/usr/bin/env bash
# lint-base-fresh.sh
# 验证：PR 分支落后 origin/main 不超过 MAX_BEHIND 个 commit
# 落后过多 → 必须 rebase / merge main 才能合并
#
# 使用：bash lint-base-fresh.sh [BASE_REF]
# 环境变量：MAX_BEHIND（默认 5）
#
# 退出码：0 = 通过，1 = 失败
set -euo pipefail

BASE_REF="${1:-origin/main}"
MAX_BEHIND="${MAX_BEHIND:-5}"
echo "🔍 lint-base-fresh — base: $BASE_REF, max-behind: $MAX_BEHIND"

git fetch origin "${BASE_REF#origin/}" --quiet 2>/dev/null || true

# main 中不在 HEAD 的 commits = 我们落后多少
BEHIND=$(git rev-list --count "HEAD..${BASE_REF}" 2>/dev/null || echo "0")

if [ "$BEHIND" -gt "$MAX_BEHIND" ]; then
  echo "::error::lint-base-fresh 失败 — 落后 ${BASE_REF} ${BEHIND} commits（>${MAX_BEHIND}）"
  echo "  执行: git fetch origin main && git rebase origin/main"
  exit 1
fi

echo "✅ lint-base-fresh 通过（落后 main ${BEHIND} commits ≤ ${MAX_BEHIND}）"
