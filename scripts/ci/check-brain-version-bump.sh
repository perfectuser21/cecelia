#!/usr/bin/env bash
# check-brain-version-bump.sh
#
# 门禁：PR diff 含 packages/brain/src/** 时，要求 PR 的 brain version 严格大于 main。
# 仅改 tests/__tests__/sprints/docs/*.md 时跳过（exit 0）。
#
# 用法：
#   BASE_REF=origin/main bash scripts/ci/check-brain-version-bump.sh
#
# 环境变量：
#   BASE_REF  基准分支引用（默认 origin/main）
#
# 退出码：
#   0  版本已 bump（或无 src 变更，跳过）
#   1  src 有变更但未 bump 版本
#
# Task ID: d8189a83-3bd3-4da3-ac70-f0ed2ba4ece4

set -euo pipefail

BASE_REF="${BASE_REF:-origin/main}"

# ─── 1. 检测 PR diff 是否包含 packages/brain/src/** ───────────────────────
CHANGED=$(git diff --name-only "${BASE_REF}...HEAD" 2>/dev/null \
  || git diff --name-only "${BASE_REF}" HEAD 2>/dev/null \
  || echo "")

SRC_CHANGED=$(echo "$CHANGED" | grep -E '^packages/brain/src/' || true)

if [ -z "$SRC_CHANGED" ]; then
  echo "跳过版本检查：本次 diff 不含 packages/brain/src/** 变更（skip）"
  exit 0
fi

echo "检测到 packages/brain/src/ 变更："
echo "$SRC_CHANGED" | head -10

# ─── 2. 读取 PR 分支的 version ────────────────────────────────────────────
BRAIN_PKG="packages/brain/package.json"

if [ ! -f "$BRAIN_PKG" ]; then
  echo "::error::找不到 $BRAIN_PKG"
  exit 1
fi

PR_VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('${BRAIN_PKG}','utf8')).version)" 2>/dev/null || true)

# ─── 3. 读取 BASE 分支的 version ──────────────────────────────────────────
BASE_PKG_CONTENT=$(git show "${BASE_REF}:${BRAIN_PKG}" 2>/dev/null || true)

if [ -z "$BASE_PKG_CONTENT" ]; then
  echo "::warning::无法读取 ${BASE_REF}:${BRAIN_PKG}，跳过版本比对"
  exit 0
fi

BASE_VERSION=$(echo "$BASE_PKG_CONTENT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).version))" 2>/dev/null || true)

echo "Base version (${BASE_REF}): ${BASE_VERSION}"
echo "PR version:                 ${PR_VERSION}"

# ─── 4. semver 严格大于比对 ───────────────────────────────────────────────
# 将 semver 分解为三段整数，依次比较 major > minor > patch
semver_gt() {
  local a="$1" b="$2"
  local a_major a_minor a_patch b_major b_minor b_patch
  IFS='.' read -r a_major a_minor a_patch <<< "$a"
  IFS='.' read -r b_major b_minor b_patch <<< "$b"
  if [ "$a_major" -gt "$b_major" ]; then return 0; fi
  if [ "$a_major" -lt "$b_major" ]; then return 1; fi
  if [ "$a_minor" -gt "$b_minor" ]; then return 0; fi
  if [ "$a_minor" -lt "$b_minor" ]; then return 1; fi
  if [ "$a_patch" -gt "$b_patch" ]; then return 0; fi
  return 1
}

if semver_gt "$PR_VERSION" "$BASE_VERSION"; then
  echo "✅ 版本已 bump：${BASE_VERSION} → ${PR_VERSION}"
  exit 0
else
  echo "::error::❌ brain src 有变更但版本未 bump（base=${BASE_VERSION}，PR=${PR_VERSION}）"
  echo ""
  echo "请在 packages/brain/ 目录运行以下命令 bump 版本："
  echo "  cd packages/brain && npm version patch --no-git-tag-version"
  echo ""
  echo "然后 git add packages/brain/package.json 并 commit 到本次 PR 中。"
  exit 1
fi
