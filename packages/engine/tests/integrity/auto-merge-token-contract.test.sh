#!/usr/bin/env bash
# packages/engine/tests/integrity/auto-merge-token-contract.test.sh
#
# auto-merge GH_TOKEN → GH_PAT_BOT 修复 — 静态契约断言
# 由 engine-tests-shell job 的 "Run integrity meta-tests" step 自动接线（glob 扫描）
#
# TDD 先红后绿：
#   Commit-1（TDD 红）阶段：ci.yml 未修复时，预期 PASS=0 FAIL=3，exit 1
#   Commit-2（TDD 绿）阶段：ci.yml 修复后，预期 PASS=3 FAIL=0，exit 0
#
# 铁律遵守：
#   [字段核实] 使用 awk 动态定位 auto-merge job 块，不硬编码行号
#   [语义字段] 断言 GH_TOKEN 字段在 env: 块内（非注释），非仅文件级 grep
#   [枚举完整性] 本 sprint 不涉及 status 枚举，N/A
#
# 用法：bash packages/engine/tests/integrity/auto-merge-token-contract.test.sh

set -uo pipefail

# 定位 ci.yml（从 REPO_ROOT 或当前目录向上找）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
CI_YML="$REPO_ROOT/.github/workflows/ci.yml"

PASS=0
FAIL=0

_pass() { echo "  PASS  $1"; PASS=$((PASS + 1)); }
_fail() { echo "  FAIL  $1"; FAIL=$((FAIL + 1)); }

echo "[auto-merge-token-contract] 开始静态契约断言..."
echo "[auto-merge-token-contract] ci.yml 路径：$CI_YML"

if [[ ! -f "$CI_YML" ]]; then
  echo "[auto-merge-token-contract] ERROR: $CI_YML 不存在，中止"
  exit 1
fi

# ── 铁律：字段核实 — 动态提取 auto-merge job 块（非硬编码行号）──────────────
# 提取从 "  auto-merge:" 开始，到下一个顶层 job 定义之间的内容
AUTO_MERGE_BLOCK=$(awk '
  /^  auto-merge:/ { found=1 }
  found && /^  [a-z]/ && !/^  auto-merge:/ { exit }
  found { print }
' "$CI_YML")

if [[ -z "$AUTO_MERGE_BLOCK" ]]; then
  echo "[auto-merge-token-contract] ERROR: 未能提取 auto-merge job 块，中止"
  exit 1
fi

# ── 断言 1：auto-merge job 的 GH_TOKEN 字段引用了 GH_PAT_BOT ─────────────────
# [语义字段] 铁律：检查 GH_TOKEN 字段本身引用 GH_PAT_BOT，非注释行
# 过滤注释行后 grep GH_TOKEN.*GH_PAT_BOT
if echo "$AUTO_MERGE_BLOCK" | grep -v "^[[:space:]]*#" | grep -qE "GH_TOKEN[[:space:]]*:.*GH_PAT_BOT"; then
  _pass "ASSERT-1: auto-merge job GH_TOKEN 引用了 GH_PAT_BOT（loop-prevention bypass 已启用）"
else
  _fail "ASSERT-1: auto-merge job GH_TOKEN 未引用 GH_PAT_BOT — main push 事件因 loop-prevention 仍被抑制"
fi

# ── 断言 2：GH_TOKEN 使用了降级写法（|| secrets.GITHUB_TOKEN）──────────────
# 确认格式为 GH_PAT_BOT || secrets.GITHUB_TOKEN（或等效写法），保证 PAT 不存在时不崩溃
if echo "$AUTO_MERGE_BLOCK" | grep -v "^[[:space:]]*#" | grep -qE "GH_TOKEN[[:space:]]*:.*GH_PAT_BOT.*\|\|.*GITHUB_TOKEN"; then
  _pass "ASSERT-2: GH_TOKEN 值含降级写法 || secrets.GITHUB_TOKEN（GH_PAT_BOT 不存在时安全回退）"
else
  _fail "ASSERT-2: GH_TOKEN 值缺少降级写法 || secrets.GITHUB_TOKEN — PAT 不存在时 auto-merge 会失败"
fi

# ── 断言 3：原有 GITHUB_TOKEN 单一写法已被替换（无遗留旧写法）──────────────
# [语义字段] 确认 auto-merge job env 块中 GH_TOKEN 不再是纯 GITHUB_TOKEN 单一写法
# 即：GH_TOKEN: ${{ secrets.GITHUB_TOKEN }} 这一行已不存在（已被改为降级写法）
if echo "$AUTO_MERGE_BLOCK" | grep -v "^[[:space:]]*#" | grep -qE "GH_TOKEN[[:space:]]*:[[:space:]]*\\\$\{\{[[:space:]]*secrets\.GITHUB_TOKEN[[:space:]]*\}\}[[:space:]]*$"; then
  _fail "ASSERT-3: auto-merge job GH_TOKEN 仍是纯 secrets.GITHUB_TOKEN 单一写法（旧写法未被替换）"
else
  _pass "ASSERT-3: auto-merge job GH_TOKEN 已不再是纯 GITHUB_TOKEN 单一写法（旧写法已替换）"
fi

# ── 汇总 ─────────────────────────────────────────────────────────────────────
echo ""
echo "[auto-merge-token-contract] PASS=$PASS FAIL=$FAIL"

if [[ "$FAIL" -gt 0 ]]; then
  echo "[auto-merge-token-contract] ❌ 合同断言失败：$FAIL 条未通过"
  exit 1
else
  echo "[auto-merge-token-contract] ✅ 全部合同断言通过"
  exit 0
fi
