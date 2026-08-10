#!/usr/bin/env bash
# Repo 断言 — packages/workflows/skills/janitor/ 死化石已删除
# BEHAVIOR-07

set -euo pipefail

PASS=0
FAIL=0
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

ok()   { echo "[PASS] $1"; PASS=$((PASS+1)); }
fail() { echo "[FAIL] $1"; FAIL=$((FAIL+1)); }

echo "── 死化石删除 Repo 断言（BEHAVIOR-07） ──"

FOSSIL_DIR="packages/workflows/skills/janitor"

# Test 1: git ls-files 输出为空
GIT_FILE_COUNT=$(git ls-files "$FOSSIL_DIR/" 2>/dev/null | wc -l | tr -d ' ')
if [ "$GIT_FILE_COUNT" -eq 0 ]; then
  ok "git ls-files $FOSSIL_DIR/ 输出为空（已从版本控制中删除）"
else
  fail "git ls-files $FOSSIL_DIR/ 仍有 $GIT_FILE_COUNT 个文件（未删除死化石）"
  git ls-files "$FOSSIL_DIR/" | head -10
fi

# Test 2: 文件系统层面也不存在
if [ ! -d "$FOSSIL_DIR" ]; then
  ok "$FOSSIL_DIR 目录不存在于文件系统"
else
  # 目录可能存在但未被 git 追踪（.gitignore 或 untracked）
  FS_FILE_COUNT=$(find "$FOSSIL_DIR" -type f 2>/dev/null | wc -l | tr -d ' ')
  if [ "$FS_FILE_COUNT" -eq 0 ]; then
    ok "$FOSSIL_DIR 存在但为空目录（可接受）"
  else
    fail "$FOSSIL_DIR 目录存在且含 $FS_FILE_COUNT 个文件"
    find "$FOSSIL_DIR" -type f | head -10
  fi
fi

# Test 3: scripts/ops/janitor.sh 已存在（新家）
if [ -f "scripts/ops/janitor.sh" ]; then
  ok "scripts/ops/janitor.sh 已存在（迁入新家）"
else
  fail "scripts/ops/janitor.sh 不存在（迁入未完成）"
fi

echo ""
echo "死化石删除测试结果: $PASS 通过 / $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
