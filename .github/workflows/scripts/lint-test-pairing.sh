#!/usr/bin/env bash
# lint-test-pairing.sh
# 验证：PR 中新增/修改的 packages/brain/src/**/*.js（非测试）必须配套 *.test.js
# 候选测试位置：同目录 <name>.test.js / __tests__/<name>.test.js / .spec.js 同名
#
# 盲区修复（v2）：检测"删除 test 文件"绕过 pairing 的路径
#   - 若 PR 删了 *.test.js 且对应 src 文件仍然存在 → FAIL
#   - src 也被同 PR 删除（模块整体移除）→ 放行
#
# 使用：bash lint-test-pairing.sh [BASE_REF]
# 默认 BASE_REF=origin/main
#
# 退出码：0 = 通过，1 = 失败
set -euo pipefail

BASE_REF="${1:-origin/main}"
echo "🔍 lint-test-pairing — base: $BASE_REF"

# fetch base 以便 diff 在 CI 拿到完整历史
git fetch origin "${BASE_REF#origin/}" --quiet 2>/dev/null || true

# ── 盲区修复：检测删除 test 文件 ──────────────────────────────────────────────
DELETED_TESTS=$(git diff --name-only --diff-filter=D "${BASE_REF}...HEAD" 2>/dev/null \
  | grep -E '^packages/brain/src/.*\.(test|spec)\.js$' \
  || true)

DELETED_SRC=$(git diff --name-only --diff-filter=D "${BASE_REF}...HEAD" 2>/dev/null \
  | grep -E '^packages/brain/src/.*\.js$' \
  | grep -v '/__tests__/' \
  | grep -vE '\.(test|spec)\.js$' \
  || true)

ORPHANED_DELETES=()
if [ -n "$DELETED_TESTS" ]; then
  while IFS= read -r tf; do
    [ -z "$tf" ] && continue
    # 推算对应的 src 文件路径
    base=$(basename "$tf" | sed 's/\.test\.js$//' | sed 's/\.spec\.js$//')
    dir=$(dirname "$tf")
    # 处理 __tests__/ 子目录
    src_dir=$(echo "$dir" | sed 's|/__tests__$||')
    src_cand="${src_dir}/${base}.js"

    # src 在同 PR 里被删除 → 模块整体移除 → 放行
    if echo "$DELETED_SRC" | grep -qxF "$src_cand"; then
      continue
    fi
    # src 文件仍然存在 → 删了测试但没删源码 → FAIL
    if [ -f "$src_cand" ]; then
      ORPHANED_DELETES+=("$tf  (src: $src_cand 仍存在)")
    fi
  done <<< "$DELETED_TESTS"
fi

if [ "${#ORPHANED_DELETES[@]}" -gt 0 ]; then
  echo ""
  echo "::error::lint-test-pairing 失败 — PR 删除了 test 文件但对应 src 仍存在（绕过配对检测）:"
  printf "  ❌ %s\n" "${ORPHANED_DELETES[@]}"
  echo ""
  echo "  修复选项："
  echo "    1. 恢复被删除的 test 文件"
  echo "    2. 若 src 也不再需要，同 PR 一并删除 src 文件"
  exit 1
fi
# ─────────────────────────────────────────────────────────────────────────────

# 新增/修改的 brain src js（排除 __tests__/ 和 *.test.js / *.spec.js）
ADDED_SRC=$(git diff --name-only --diff-filter=AM "${BASE_REF}...HEAD" 2>/dev/null \
  | grep -E '^packages/brain/src/.*\.js$' \
  | grep -v '/__tests__/' \
  | grep -vE '\.(test|spec)\.js$' \
  || true)

if [ -z "$ADDED_SRC" ]; then
  echo "⏭️  无新增/修改 brain src js，跳过"
  exit 0
fi

# PR 自身已添加/修改的测试文件（diff 内可见）
PR_TESTS=$(git diff --name-only --diff-filter=AM "${BASE_REF}...HEAD" 2>/dev/null \
  | grep -E '\.(test|spec)\.js$|/__tests__/' \
  || true)

MISSING=()
while IFS= read -r src; do
  [ -z "$src" ] && continue
  base=$(basename "$src" .js)
  dir=$(dirname "$src")
  # 候选测试路径
  cand1="${dir}/${base}.test.js"
  cand2="${dir}/__tests__/${base}.test.js"
  cand3="${dir}/${base}.spec.js"

  found=0
  for cand in "$cand1" "$cand2" "$cand3"; do
    # PR diff 内含 OR 仓库已存在
    if echo "$PR_TESTS" | grep -qxF "$cand" || [ -f "$cand" ]; then
      found=1
      break
    fi
  done

  if [ "$found" -eq 0 ]; then
    MISSING+=("$src")
  fi
done <<< "$ADDED_SRC"

if [ "${#MISSING[@]}" -gt 0 ]; then
  echo "::error::lint-test-pairing 失败 — 以下 brain src 缺配套 test:"
  for f in "${MISSING[@]}"; do
    base=$(basename "$f" .js)
    dir=$(dirname "$f")
    echo "  ❌ $f"
    echo "     候选: ${dir}/${base}.test.js  或  ${dir}/__tests__/${base}.test.js"
  done
  exit 1
fi

# 内容校验（Tier 1 加牙）：配套 test 文件必须含真断言，不能纯 skip / 空 / 注释
# 防止"建空 test 文件就过 lint"的绕过路径
EMPTY_TESTS=()
SKIPPED_ONLY=()
while IFS= read -r src; do
  [ -z "$src" ] && continue
  base=$(basename "$src" .js)
  dir=$(dirname "$src")
  for cand in "${dir}/${base}.test.js" "${dir}/__tests__/${base}.test.js" "${dir}/${base}.spec.js"; do
    if [ ! -f "$cand" ]; then continue; fi
    # 必须含 ≥1 个 it/test/expect
    if ! grep -qE "(^|[^a-zA-Z])(it|test|expect)\s*\(" "$cand"; then
      EMPTY_TESTS+=("$cand")
      break
    fi
    # 不能 100% 是 skip — 至少 1 个非 skip 的 it/test
    NONSKIP=$(grep -cE "(^|[^a-zA-Z\.])(it|test)\s*\(" "$cand" 2>/dev/null || echo 0)
    SKIPS=$(grep -cE "(it|test|describe)\.skip\s*\(" "$cand" 2>/dev/null || echo 0)
    if [ "$NONSKIP" -gt 0 ] && [ "$SKIPS" -ge "$NONSKIP" ]; then
      SKIPPED_ONLY+=("$cand")
    fi
    break
  done
done <<< "$ADDED_SRC"

if [ "${#EMPTY_TESTS[@]}" -gt 0 ]; then
  echo "::error::lint-test-pairing 失败 — 以下 test 文件无任何 it/test/expect 调用（空架子绕过）:"
  printf "  ❌ %s\n" "${EMPTY_TESTS[@]}"
  exit 1
fi

if [ "${#SKIPPED_ONLY[@]}" -gt 0 ]; then
  echo "::error::lint-test-pairing 失败 — 以下 test 文件 100% skip（it.skip / test.skip / describe.skip）:"
  printf "  ❌ %s\n" "${SKIPPED_ONLY[@]}"
  exit 1
fi

COUNT=$(echo "$ADDED_SRC" | wc -l | tr -d ' ')

# ── 盲区修复（v3）：test 文件必须引用被测 src 模块 ──────────────────────────
# 防止"新增 executor.test.js 但全部测的是 selfcheck.js"的绕过路径。
# 检查：新增的 test 文件（PR diff 内）必须包含对应 src 文件 basename 的 import/require。
# 例：executor.js → test 文件须含 'executor' 字符串（import 或 describe 名称）
# 放行：basename 含连字符/点（如 dev-task.graph.js → 检查 dev-task 或 devTask 或 graph）
#       test 文件在 integration/ 下（集成测试可能跨模块）
UNRELATED_TESTS=()
NEW_TEST_FILES=$(git diff --name-only --diff-filter=A "${BASE_REF}...HEAD" 2>/dev/null \
  | grep -E '^packages/brain/src/.*\.(test|spec)\.js$' \
  || true)

if [ -n "$NEW_TEST_FILES" ]; then
  while IFS= read -r tf; do
    [ -z "$tf" ] && continue
    [ ! -f "$tf" ] && continue
    # integration test 跳过
    echo "$tf" | grep -q '/integration/' && continue

    # 推算对应 src 的 basename（去掉 .test.js / .spec.js）
    raw=$(basename "$tf" | sed 's/\.test\.js$//' | sed 's/\.spec\.js$//')
    # dev-task.graph → 检查 dev-task 和 graph 和 devTask（camelCase 变体）
    # 取第一个 segment（点或连字符前）和最后一个 segment
    first=$(echo "$raw" | sed 's/[.\-].*//')
    last=$(echo "$raw" | sed 's/.*[.\-]//')
    # camelCase 变体：dev-task → devTask
    camel=$(echo "$raw" | sed 's/[-\.]\([a-z]\)/\U\1/g')

    # 检查 test 文件是否含任一变体（import/require/describe 名称均可）
    if grep -qiE "(import|require|describe|from)[^'\"]*['\"][^'\"]*${first}" "$tf" 2>/dev/null; then
      continue
    fi
    if [ "$first" != "$last" ] && grep -qiE "(import|require|describe|from)[^'\"]*['\"][^'\"]*${last}" "$tf" 2>/dev/null; then
      continue
    fi
    if grep -qiE "(import|require|describe|from)[^'\"]*['\"][^'\"]*${camel}" "$tf" 2>/dev/null; then
      continue
    fi
    # 宽松兜底：文件内任意出现 basename（避免误报复合名模块）
    if grep -qE "${raw}" "$tf" 2>/dev/null; then
      continue
    fi

    UNRELATED_TESTS+=("$tf  (应含对 '${raw}' 的 import/require，但未找到)")
  done <<< "$NEW_TEST_FILES"
fi

if [ "${#UNRELATED_TESTS[@]}" -gt 0 ]; then
  echo ""
  echo "::error::lint-test-pairing 失败 — 新增 test 文件未引用对应 src 模块（内容不相关）:"
  printf "  ❌ %s\n" "${UNRELATED_TESTS[@]}"
  echo ""
  echo "  说明：test 文件的 import/require/describe 中应出现被测模块的名称。"
  echo "  反例：executor.test.js 里全是 import { runSelfCheck } from '../selfcheck.js'"
  echo "  正例：executor.test.js 里含 import { getEffectiveMaxSeats } from '../executor.js'"
  exit 1
fi
# ─────────────────────────────────────────────────────────────────────────────
echo "✅ lint-test-pairing 通过（${COUNT} 个 src 文件全部配套真 test）"
