#!/usr/bin/env bash
set -euo pipefail

# CI Preflight Check (Smart)
# 只检查 qa:gate 证据是否新鲜，不重跑测试
# 认知原则：只有 qa:gate 跑测试，preflight 只判断"是否需要跑 qa:gate"

echo "======================================"
echo "CI Preflight Check"
echo "======================================"
echo ""

# 检查 .quality-gate-passed 是否存在且新鲜（5 分钟内）
if [[ -f ".quality-gate-passed" ]]; then
  # 获取文件修改时间
  if [[ "$(uname)" == "Darwin" ]]; then
    # macOS
    GATE_TIME=$(stat -f %m .quality-gate-passed)
  else
    # Linux
    GATE_TIME=$(stat -c %Y .quality-gate-passed)
  fi

  NOW=$(date +%s)
  AGE=$((NOW - GATE_TIME))

  if [ $AGE -lt 300 ]; then
    echo "✅ .quality-gate-passed 是新鲜的（${AGE}s 前）"

    # 验证 SHA 是否匹配当前 HEAD 或 HEAD~1
    # 证据可以引用 HEAD（代码和证据在同一commit）或 HEAD~1（证据commit引用代码commit）
    GATE_SHA=$(grep "^# Commit:" .quality-gate-passed | awk '{print $3}' 2>/dev/null || echo "")
    CURRENT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "")
    PARENT_SHA=$(git rev-parse --short HEAD~1 2>/dev/null || echo "")

    if [[ -n "$GATE_SHA" && ("$GATE_SHA" == "$CURRENT_SHA" || "$GATE_SHA" == "$PARENT_SHA") ]]; then
      if [[ "$GATE_SHA" == "$CURRENT_SHA" ]]; then
        echo "✅ SHA 匹配当前 HEAD ($CURRENT_SHA)"
      else
        echo "✅ SHA 匹配 HEAD~1 ($PARENT_SHA，证据commit模式)"
      fi
      echo ""
      echo "======================================"
      echo "✅ Preflight 通过（证据新鲜且 SHA 匹配）"
      echo "⏱️ 耗时: < 1s"
      echo "======================================"
      exit 0
    else
      echo "⚠️ SHA 不匹配（证据: $GATE_SHA, HEAD: $CURRENT_SHA, HEAD~1: $PARENT_SHA）"
      echo "   需要重新运行 qa:gate"
    fi
  else
    echo "⚠️ .quality-gate-passed 已过期（${AGE}s 前 > 5min）"
    echo "   需要重新运行 qa:gate"
  fi
else
  echo "⚠️ .quality-gate-passed 不存在"
  echo "   需要运行 qa:gate"
fi

echo ""
echo "======================================"
echo "❌ Preflight 失败"
echo "======================================"
echo ""
echo "请运行: npm run qa:gate"
echo ""

exit 1
