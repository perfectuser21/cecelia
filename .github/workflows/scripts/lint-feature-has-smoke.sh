#!/usr/bin/env bash
# lint-feature-has-smoke.sh
# 验证：feature PR 必须新增 packages/brain/scripts/smoke/<feature>-smoke.sh 真环境验证脚本
#
# 触发条件（任一即认定为 feature PR）：
#   - PR_LABELS 含 feature
#   - PR commits 含 feat: 或 feat(...): 前缀
#
# 范围限定：仅当 PR 触及 packages/brain/src/ 时才强制要求 smoke.sh
#   非 brain runtime 的 feat（如 feat(ci)/feat(engine)）跳过
#
# 使用：bash lint-feature-has-smoke.sh [BASE_REF]
# 环境变量：PR_LABELS（GH Actions 注入）
#
# 退出码：0 = 通过/跳过，1 = 失败
set -euo pipefail

BASE_REF="${1:-origin/main}"
PR_LABELS="${PR_LABELS:-}"
echo "🔍 lint-feature-has-smoke — base: $BASE_REF"

git fetch origin "${BASE_REF#origin/}" --quiet 2>/dev/null || true

# 判断是否 feature PR
HAS_FEAT=0
if echo "$PR_LABELS" | grep -qiwE 'feature'; then
  HAS_FEAT=1
fi

COMMIT_MSGS=$(git log --pretty=%s "${BASE_REF}..HEAD" 2>/dev/null || echo "")
if echo "$COMMIT_MSGS" | grep -qE '^feat(\([^)]+\))?:'; then
  HAS_FEAT=1
fi

if [ "$HAS_FEAT" -eq 0 ]; then
  echo "⏭️  非 feature PR（无 feature label / 无 feat: commit），跳过"
  exit 0
fi

# 仅当 brain runtime 改动时才要求 smoke.sh
BRAIN_CHANGED=$(git diff --name-only --diff-filter=AM "${BASE_REF}...HEAD" 2>/dev/null \
  | grep -E '^packages/brain/src/' \
  | grep -vE '\.(test|spec)\.js$|/__tests__/' \
  || true)

if [ -z "$BRAIN_CHANGED" ]; then
  echo "⏭️  feat: PR 但未触及 packages/brain/src，跳过 smoke.sh 检查"
  exit 0
fi

# 检查 PR 含新增 packages/brain/scripts/smoke/*.sh
NEW_SMOKE=$(git diff --name-only --diff-filter=A "${BASE_REF}...HEAD" 2>/dev/null \
  | grep -E '^packages/brain/scripts/smoke/.+\.sh$' \
  || true)

if [ -z "$NEW_SMOKE" ]; then
  echo "::error::lint-feature-has-smoke 失败 — 此 feat: PR 触及 packages/brain/src 但未新增 smoke.sh"
  echo "  规则（见 packages/engine/skills/dev/SKILL.md）："
  echo "    feat: + brain/src 改动 → 必须配套 packages/brain/scripts/smoke/<feature>-smoke.sh"
  echo "  brain 改动的文件:"
  echo "$BRAIN_CHANGED" | sed 's/^/    /'
  exit 1
fi

echo "✅ lint-feature-has-smoke 通过 — 新增 smoke.sh:"
echo "$NEW_SMOKE" | sed 's/^/  /'
