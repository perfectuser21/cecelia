#!/usr/bin/env bash
# lint-test-quality.sh — 拦"假测试 stub"
#
# 4 agent 审计发现 brain 单测可信度 28/100：最近 10 个 feat PR 测试质量平均 1.8/5，
# 其中"建空 test 文件骗 lint-test-pairing"是常见绕过路径。
# 例：dispatcher.test.js 10 个 expect 全是 src.toContain('foo')，0 个真行为调用。
#
# 规则（仅作用于新增 test 文件，老测试 grandfather 不动）：
#
#   Rule A (HARD FAIL)：file 用 readFileSync(src/...) 做 grep 验 + 无任何 await fn()
#                      / await mod.X() 业务调用 → fail
#                      原因：这是"读 src 文件抓字符串就算 test"的 stub 签名
#
#   Rule B (HARD FAIL)：file 完全没 expect 调用 → fail
#                      原因：根本不算 test
#
#   Rule C (HARD FAIL)：file 用 .skip 包了所有 it/test → fail（与 lint-test-pairing 重叠保险）
#
# 用法：bash lint-test-quality.sh [BASE_REF]
# 退出码：0 = 通过，1 = 失败

set -euo pipefail

BASE_REF="${1:-origin/main}"
echo "🔍 lint-test-quality — base: $BASE_REF"

git fetch origin "${BASE_REF#origin/}" --quiet 2>/dev/null || true

# 新增 test 文件（diff-filter=A 只看新增，不动老的）
NEW_TESTS=$(git diff --name-only --diff-filter=A "${BASE_REF}...HEAD" 2>/dev/null \
  | grep -E '\.(test|spec)\.(js|ts)$' \
  || true)

if [ -z "$NEW_TESTS" ]; then
  echo "⏭️  无新增 test 文件，跳过"
  exit 0
fi

BAD_STUB=()
BAD_EMPTY=()
BAD_SKIPPED=()

while IFS= read -r tf; do
  [ -z "$tf" ] && continue
  [ ! -f "$tf" ] && continue

  # ── Rule A: stub 签名（读 src grep + 无 await 业务调用）──
  HAS_FS_SRC=$(grep -cE "readFileSync\s*\([^)]*src/" "$tf" 2>/dev/null || true)
  HAS_FS_SRC="${HAS_FS_SRC:-0}"
  # await 业务调用：const x = await fn() / await mod.fn() / await xxx()
  # 排除 await import('...') 这种纯 module load
  HAS_AWAIT_CALL=$(grep -E "(const|let|var)\s+\w+\s*=\s*await\s|^\s+await\s+[a-zA-Z_]" "$tf" 2>/dev/null \
    | grep -vE "await\s+import\s*\(" \
    | wc -l | tr -d ' ') || true
  HAS_AWAIT_CALL="${HAS_AWAIT_CALL:-0}"

  if [ "$HAS_FS_SRC" -gt 0 ] && [ "$HAS_AWAIT_CALL" -eq 0 ]; then
    BAD_STUB+=("$tf  (readFileSync(src/)=$HAS_FS_SRC, await fn()=0)")
    continue
  fi

  # ── Rule B: 完全无 expect ──
  EXPECTS=$(grep -cE "expect\s*\(" "$tf" 2>/dev/null || true)
  EXPECTS="${EXPECTS:-0}"
  if [ "$EXPECTS" -eq 0 ]; then
    BAD_EMPTY+=("$tf")
    continue
  fi

  # ── Rule C: 全 .skip ──
  IT_TEST=$(grep -cE "(^|[^a-zA-Z\.])(it|test)\s*\(" "$tf" 2>/dev/null || true)
  IT_TEST="${IT_TEST:-0}"
  SKIPS=$(grep -cE "(it|test|describe)\.skip\s*\(" "$tf" 2>/dev/null || true)
  SKIPS="${SKIPS:-0}"
  if [ "$IT_TEST" -gt 0 ] && [ "$SKIPS" -ge "$IT_TEST" ]; then
    BAD_SKIPPED+=("$tf")
    continue
  fi
done <<< "$NEW_TESTS"

FAILED=0

if [ "${#BAD_STUB[@]}" -gt 0 ]; then
  echo ""
  echo "::error::lint-test-quality 失败 — Rule A stub 签名（读 src 文件 grep + 无 await 业务调用）"
  printf "  ❌ %s\n" "${BAD_STUB[@]}"
  echo ""
  echo "  此模式 = 'expect(content).toContain(literal)' 占主导，没有真调函数验行为"
  echo "  反例：    expect(src).toContain('Phase 2.5')"
  echo "  正例：    const result = await dispatchNextTask(['goal-1']); expect(result.dispatched).toBe(true)"
  FAILED=1
fi

if [ "${#BAD_EMPTY[@]}" -gt 0 ]; then
  echo ""
  echo "::error::lint-test-quality 失败 — Rule B 完全没 expect 调用"
  printf "  ❌ %s\n" "${BAD_EMPTY[@]}"
  FAILED=1
fi

if [ "${#BAD_SKIPPED[@]}" -gt 0 ]; then
  echo ""
  echo "::error::lint-test-quality 失败 — Rule C 100% .skip 包围"
  printf "  ❌ %s\n" "${BAD_SKIPPED[@]}"
  FAILED=1
fi

if [ "$FAILED" -eq 1 ]; then
  exit 1
fi

COUNT=$(echo "$NEW_TESTS" | wc -l | tr -d ' ')
echo "✅ lint-test-quality 通过（${COUNT} 个新增 test 全部含真行为断言）"
