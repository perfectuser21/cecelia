#!/usr/bin/env bash
# lint-contract-test-immutability.sh
#
# 校验 sprints/<sprint_dir>/tests/ 下测试树在最终 Red commit 后不得修改。
# GAN 提案轮允许在 Red 前迭代；无 canonical red-evidence 的 legacy sprint
# 回退到首次引入 commit 的旧语义。
#
# 用法：
#   bash lint-contract-test-immutability.sh <repo_root> <sprint_dir>
#
# 参数：
#   repo_root   仓库根目录的绝对路径
#   sprint_dir  sprint 目录名（例如 07141333-contract-test-immutability-ci）
#
# 退出码：
#   0 — 全部通过（或无测试文件，或无法定位首次 commit）
#   1 — 发现测试文件在首次 commit 后被修改

set -euo pipefail

REPO_ROOT="${1:-}"
SPRINT_DIR="${2:-}"

if [ -z "$REPO_ROOT" ] || [ -z "$SPRINT_DIR" ]; then
  echo "ERROR: 用法: $0 <repo_root> <sprint_dir>" >&2
  exit 1
fi

TESTS_PATH="sprints/${SPRINT_DIR}/tests"

# 切换到仓库根目录进行 git 操作
cd "$REPO_ROOT"

# 检查 tests 目录是否存在
if [ ! -d "$TESTS_PATH" ]; then
  echo "INFO: tests 目录不存在: $TESTS_PATH — 跳过检查 (exit 0)"
  exit 0
fi

# canonical Red：Generator 在最终 Red commit 首次写入本 sprint 的 red-evidence.md。
RED_EVIDENCE_PATH="sprints/${SPRINT_DIR}/red-evidence.md"
RED_HISTORY=$(git log --format=%H -- "$RED_EVIDENCE_PATH" 2>/dev/null || true)
if [ -n "$RED_HISTORY" ]; then
  RED_ADDS=$(git log --diff-filter=A --format=%H -- "$RED_EVIDENCE_PATH" 2>/dev/null || true)
  RED_ADD_COUNT=$(printf '%s\n' "$RED_ADDS" | grep -cE '^[0-9a-f]{40}$' || true)
  if [ "$RED_ADD_COUNT" -ne 1 ]; then
    echo "ERROR: canonical red-evidence 必须且只能有一个 add commit，实际 ${RED_ADD_COUNT}" >&2
    exit 1
  fi

  RED_COMMIT="$RED_ADDS"
  RED_SUBJECT=$(git log -1 --format=%s "$RED_COMMIT" 2>/dev/null || true)
  if [[ ! "$RED_SUBJECT" =~ \(Red\) ]] && [[ ! "$RED_SUBJECT" =~ ^test\( ]]; then
    echo "ERROR: canonical red-evidence add commit 不是 Red commit: ${RED_COMMIT} ${RED_SUBJECT}" >&2
    exit 1
  fi

  TREE_CHANGES=$(git diff --name-status "$RED_COMMIT" HEAD -- "$TESTS_PATH" 2>/dev/null || true)
  if [ -n "$TREE_CHANGES" ]; then
    echo "ERROR: 以下测试树变更发生在最终 Red commit 之后:" >&2
    echo "$TREE_CHANGES" | sed 's/^/  /' >&2
    exit 1
  fi
  echo "OK: 测试树自最终 Red commit 后未修改 (exit 0)"
  exit 0
fi

echo "WARN: 未找到 canonical red-evidence Red commit，按 legacy 首次引入锚点检查"

# legacy fallback：收集测试文件列表（.test.ts 和 .test.js）
TEST_FILES=$(find "$TESTS_PATH" -maxdepth 1 \( -name "*.test.ts" -o -name "*.test.js" \) 2>/dev/null || true)

if [ -z "$TEST_FILES" ]; then
  echo "INFO: $TESTS_PATH 下无测试文件 — 跳过检查 (exit 0)"
  exit 0
fi

VIOLATIONS=()

while IFS= read -r TEST_FILE; do
  # 相对路径（相对仓库根）
  REL_PATH="${TEST_FILE#./}"
  REL_PATH="${REL_PATH#/}"
  # 确保路径不以 ./ 开头
  REL_PATH=$(echo "$REL_PATH" | sed 's|^\./||')

  # 找到首次引入该文件的 commit（--diff-filter=A = Added）
  FIRST_COMMIT=$(git log --diff-filter=A --format="%H" -- "$REL_PATH" 2>/dev/null | tail -1 || true)

  if [ -z "$FIRST_COMMIT" ]; then
    echo "WARN: 无法定位文件首次 commit: ${REL_PATH}（可能历史截断或未提交）— 跳过此文件 (exit 0)"
    continue
  fi

  # 获取首次 commit 的 blob hash
  FIRST_BLOB=$(git ls-tree "$FIRST_COMMIT" -- "$REL_PATH" 2>/dev/null | awk '{print $3}' || true)

  if [ -z "$FIRST_BLOB" ]; then
    echo "WARN: 无法获取文件首次 blob: $REL_PATH — 跳过此文件 (exit 0)"
    continue
  fi

  # 获取当前 HEAD 的 blob hash
  CURRENT_BLOB=$(git ls-tree HEAD -- "$REL_PATH" 2>/dev/null | awk '{print $3}' || true)

  if [ -z "$CURRENT_BLOB" ]; then
    # legacy 行为：文件在 HEAD 不存在时跳过；canonical Red 路径已对删除 fail-closed。
    echo "INFO: 文件在 HEAD 已不存在: $REL_PATH — 跳过"
    continue
  fi

  if [ "$FIRST_BLOB" != "$CURRENT_BLOB" ]; then
    VIOLATIONS+=("$REL_PATH")
  fi

done <<< "$TEST_FILES"

if [ "${#VIOLATIONS[@]}" -gt 0 ]; then
  echo "ERROR: 以下 legacy 测试文件在首次 commit 后被非法修改:" >&2
  for v in "${VIOLATIONS[@]}"; do
    echo "  $v" >&2
  done
  exit 1
fi

echo "OK: 所有 legacy 测试文件均未被修改 (exit 0)"
exit 0
