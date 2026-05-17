#!/usr/bin/env bash
# lint-learning-constraint-coverage.sh
# 验证：cortex.js 必须集成 insight-to-constraint 模块，
#       让每条 cortex_insight learning 写入时同步尝试抽取 dispatch_constraint。
# 闭合 Cortex Insight 6a569a1e（learning_id a4941b23）：
#   "rumination learnings 必须在同次 session 中转化为 CI 门禁或 dispatch 约束"。
#
# 退出码：0 = 通过，1 = 失败
set -euo pipefail

CORTEX_SRC="packages/brain/src/cortex.js"
MODULE_SRC="packages/brain/src/insight-to-constraint.js"

echo "🔍 lint-learning-constraint-coverage"

if [ ! -f "$MODULE_SRC" ]; then
  echo "❌ FAIL: $MODULE_SRC 不存在 — 缺 insight-to-constraint 模块"
  exit 1
fi

if [ ! -f "$CORTEX_SRC" ]; then
  echo "❌ FAIL: $CORTEX_SRC 不存在"
  exit 1
fi

if ! grep -qE "from\s+['\"]\./insight-to-constraint" "$CORTEX_SRC"; then
  echo "❌ FAIL: $CORTEX_SRC 未 import ./insight-to-constraint"
  echo "   PRD 要求：learning 写入时同步抽取约束，不能跳过。"
  exit 1
fi

if ! grep -q "autoExtractAndPersist" "$CORTEX_SRC"; then
  echo "❌ FAIL: $CORTEX_SRC 未调用 autoExtractAndPersist"
  echo "   每条 cortex_insight 入库时必须尝试 constraint 抽取（同次 session）。"
  exit 1
fi

echo "✅ cortex.js 已集成 insight-to-constraint，覆盖 PRD 要求"
