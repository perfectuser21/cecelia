#!/usr/bin/env bash
# lint-no-fake-test.sh — 拦"AI 写假测试"
#
# Gate 1 升级补丁：补 lint-test-quality.sh / lint-no-mock-only-test.sh
# 漏网的"假覆盖"模式。教训样本（PR #2670/#2671/#2672）：
# implementer 给 executor.js / cortex.js / thalamus.js 加的 stub test 全是
# expect(handler).toBeDefined() 这类零行为断言 — coverage 100% 但 prod 改坏不挂。
#
# 与现有 lint 分工：
#   lint-test-quality.sh        ：拦 readFileSync(src/) + 全 .skip + 0 expect
#   lint-no-mock-only-test.sh   ：拦 heavy mock (≥30) 无配套真覆盖
#   lint-no-fake-test.sh（本）  ：拦弱断言占 100% / mock-heavy + 低 expect
#
# 规则（仅作用于新增 *.test.{js,ts} / *.spec.{js,ts}，老文件 grandfather）：
#
#   Rule 1 (HARD FAIL)：file 所有 expect 全是"弱断言"（占 100% 且至少 1 个）：
#     - .toBeDefined()
#     - .toBeNull() / .toBeUndefined()
#     - .toEqual(null) / .toEqual(undefined)
#     - .not.toThrow(...)
#     反例：    expect(handler).toBeDefined();          // 只验存在不验行为
#     正例：    const r = await handler({task});
#               expect(r.ok).toBe(true);
#               expect(r.dispatched).toBe('agent-x');
#
#   Rule 2 (HARD FAIL)：vi.mock 数 > 5 且 expect 数 < 3
#     说明：mock 一堆但几乎不断言 = "走过场"测试。
#
# 用法：bash lint-no-fake-test.sh [BASE_REF]
# 退出码：0 = 通过，1 = 失败

set -euo pipefail

BASE_REF="${1:-origin/main}"
echo "🔍 lint-no-fake-test — base: $BASE_REF"

git fetch origin "${BASE_REF#origin/}" --quiet 2>/dev/null || true

NEW_TESTS=$(git diff --name-only --diff-filter=A "${BASE_REF}...HEAD" 2>/dev/null \
  | grep -E '\.(test|spec)\.(js|ts)$' \
  || true)

if [ -z "$NEW_TESTS" ]; then
  echo "⏭️  无新增 test 文件，跳过"
  exit 0
fi

BAD_WEAK=()
BAD_MOCK_LOW_EXPECT=()

while IFS= read -r tf; do
  [ -z "$tf" ] && continue
  [ ! -f "$tf" ] && continue

  EXPECTS=$(grep -cE "expect\s*\(" "$tf" 2>/dev/null || true)
  EXPECTS="${EXPECTS:-0}"

  # 0 expect 由 lint-test-quality 的 Rule B 接管，本脚本不重叠
  if [ "$EXPECTS" -eq 0 ]; then
    continue
  fi

  # 弱断言（每行至多算一次，匹配 expect 总数维度）
  WEAK=$(grep -cE "\.(toBeDefined|toBeNull|toBeUndefined)\s*\(\s*\)|\.toEqual\s*\(\s*(null|undefined)\s*\)|\.not\.toThrow\s*\(" "$tf" 2>/dev/null || true)
  WEAK="${WEAK:-0}"

  # Rule 1: weak == total expects（且至少 1 个）
  if [ "$WEAK" -ge "$EXPECTS" ]; then
    BAD_WEAK+=("$tf  (expect=$EXPECTS weak=$WEAK)")
    continue
  fi

  # Rule 2: mock > 5 且 expect < 3
  MOCKS=$(grep -cE "vi\.mock\s*\(" "$tf" 2>/dev/null || true)
  MOCKS="${MOCKS:-0}"
  if [ "$MOCKS" -gt 5 ] && [ "$EXPECTS" -lt 3 ]; then
    BAD_MOCK_LOW_EXPECT+=("$tf  (vi.mock=$MOCKS expect=$EXPECTS)")
    continue
  fi
done <<< "$NEW_TESTS"

FAILED=0

if [ "${#BAD_WEAK[@]}" -gt 0 ]; then
  echo ""
  echo "::error::lint-no-fake-test 失败 — Rule 1 全部弱断言（toBeDefined / toBe(Null|Undefined) / toEqual(null|undefined) / not.toThrow）"
  printf "  ❌ %s\n" "${BAD_WEAK[@]}"
  echo ""
  echo "  反例：    expect(handler).toBeDefined();           // 只验函数存在"
  echo "  正例：    const r = await handler({task});"
  echo "            expect(r.ok).toBe(true);"
  echo "            expect(r.dispatched).toBe('agent-x');"
  echo "  说明：    弱断言让 coverage 100% 但 prod 改坏不挂 — 假覆盖。"
  FAILED=1
fi

if [ "${#BAD_MOCK_LOW_EXPECT[@]}" -gt 0 ]; then
  echo ""
  echo "::error::lint-no-fake-test 失败 — Rule 2 mock 数 > 5 但 expect 数 < 3"
  printf "  ❌ %s\n" "${BAD_MOCK_LOW_EXPECT[@]}"
  echo ""
  echo "  说明：mock 一堆但几乎不断言 = 走过场测试。"
  echo "  修复：减 mock（聚焦 unit）或加 expect（验真行为）。"
  FAILED=1
fi

if [ "$FAILED" -eq 1 ]; then
  exit 1
fi

COUNT=$(echo "$NEW_TESTS" | wc -l | tr -d ' ')
echo "✅ lint-no-fake-test 通过（${COUNT} 个新增 test 全部含真断言）"
