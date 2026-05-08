#!/usr/bin/env bash
# idempotency-check.sh — LangGraph 节点幂等门审计
#
# 静态扫描 packages/brain/src/workflows/harness-initiative.graph.js 中所有
# `export (async )?function ...Node` 顶层声明，校验前 30 行内含 short circuit。
#
# 豁免：
#   - spawnGeneratorNode（Layer 3 重构，本审计豁免）
#   - advanceTaskIndexNode / retryTaskNode（counter 节点，按设计每次 +1）
#   - fanoutSubTasksNode（router，返 Send[]）
#   - fanoutPassthroughNode（passthrough，return {} 天然幂等）
#
# Spec: docs/superpowers/specs/2026-05-08-langgraph-fix-sprint.md Stream 4
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GRAPH="$(cd "$SCRIPT_DIR/../.." && pwd)/src/workflows/harness-initiative.graph.js"
[ -f "$GRAPH" ] || { echo "FAIL: $GRAPH 不存在"; exit 1; }

# 豁免清单
EXEMPT_LAYER3="spawnGeneratorNode"
EXEMPT_COUNTER="advanceTaskIndexNode retryTaskNode"
EXEMPT_TRIVIAL="fanoutSubTasksNode fanoutPassthroughNode"

# 找所有顶层 export node function（注意函数名可含数字，如 finalE2eNode）
FUNCTIONS=$(grep -E "^export (async )?function [a-zA-Z0-9_]+Node" "$GRAPH" \
  | sed -E 's/.*function ([a-zA-Z0-9_]+Node).*/\1/')

TOTAL=0
PASS=0
FAIL_LIST=""

for fn in $FUNCTIONS; do
  TOTAL=$((TOTAL + 1))

  # 豁免分支
  if [ "$fn" = "$EXEMPT_LAYER3" ]; then
    PASS=$((PASS + 1))
    echo "✓ $fn (Layer 3 待重构，本审计豁免)"
    continue
  fi
  if echo " $EXEMPT_COUNTER " | grep -qw "$fn"; then
    PASS=$((PASS + 1))
    echo "✓ $fn (counter 节点，按设计每次 +1，本审计豁免)"
    continue
  fi
  if echo " $EXEMPT_TRIVIAL " | grep -qw "$fn"; then
    PASS=$((PASS + 1))
    echo "✓ $fn (router/passthrough 天然幂等，本审计豁免)"
    continue
  fi

  # 提取该函数前 30 行（从 ^export ... function $fn 起）
  HEAD=$(awk -v name="$fn" '
    BEGIN { capturing=0; lines=0 }
    /^export (async )?function / {
      if (capturing) exit
      if ($0 ~ ("function " name "[ \\(]")) capturing = 1
    }
    capturing { print; lines++; if (lines >= 30) exit }
  ' "$GRAPH")

  # 在前 30 行中找 `if (...) ... return {` 形式的 short circuit
  if echo "$HEAD" | grep -qE 'if[[:space:]]*\([^)]+\)[[:space:]]*(\{[^}]*)?return[[:space:]]*[\{(]' \
     || echo "$HEAD" | tr '\n' ' ' | grep -qE 'if[[:space:]]*\([^)]+\)[[:space:]]*\{[[:space:]]*[^{}]*return[[:space:]]*[\{(]'; then
    echo "✓ $fn 含 short circuit"
    PASS=$((PASS + 1))
  else
    echo "✗ $fn 缺 short circuit"
    FAIL_LIST="$FAIL_LIST $fn"
  fi
done

echo ""
echo "审计: PASS=$PASS / TOTAL=$TOTAL"
if [ -n "$FAIL_LIST" ]; then
  echo "缺幂等门:$FAIL_LIST"
  exit 1
fi
echo "✅ 全部节点都有幂等门（spawnGeneratorNode 待 Layer 3）"
exit 0
