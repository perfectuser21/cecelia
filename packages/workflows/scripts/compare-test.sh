#!/bin/bash
# 对比测试：同时在美国和香港执行相同 prompt，对比结果
# 用于验证两个环境的一致性
#
# 用法: ./compare-test.sh "你的测试 prompt"

set -e

PROMPT="${1:-respond with the word PONG}"

echo "=========================================="
echo "  研发版 vs 生产版 对比测试"
echo "=========================================="
echo ""
echo "Prompt: $PROMPT"
echo ""

# 提交任务到美国
echo "🇺🇸 美国 (Claude Code)..."
US_RESULT=$(curl -s -X POST http://localhost:9876/execute \
    -H "Content-Type: application/json" \
    -d "{\"prompt\": \"$PROMPT\"}")
US_TASK_ID=$(echo "$US_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('taskId',''))" 2>/dev/null)
echo "   Task ID: $US_TASK_ID"

# 提交任务到香港
echo "🇭🇰 香港 (MiniMax)..."
HK_RESULT=$(ssh hk "curl -s -X POST http://localhost:9876/execute \
    -H 'Content-Type: application/json' \
    -d '{\"prompt\": \"$PROMPT\"}'")
HK_TASK_ID=$(echo "$HK_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('taskId',''))" 2>/dev/null)
echo "   Task ID: $HK_TASK_ID"

# 等待执行
echo ""
echo "⏳ 等待执行..."
sleep 10

# 获取结果
echo ""
echo "========== 结果对比 =========="
echo ""

echo "🇺🇸 美国结果:"
US_FINAL=$(curl -s "http://localhost:9876/result/$US_TASK_ID" 2>/dev/null)
US_STATUS=$(echo "$US_FINAL" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','unknown'))" 2>/dev/null)
echo "   状态: $US_STATUS"
if [[ "$US_STATUS" == "completed" ]]; then
    echo "   结果: $(echo "$US_FINAL" | python3 -c "import sys,json; r=json.load(sys.stdin).get('result',''); print(r[:200] + '...' if len(r)>200 else r)" 2>/dev/null)"
fi

echo ""
echo "🇭🇰 香港结果:"
HK_FINAL=$(ssh hk "curl -s 'http://localhost:9876/result/$HK_TASK_ID'" 2>/dev/null)
HK_STATUS=$(echo "$HK_FINAL" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','unknown'))" 2>/dev/null)
echo "   状态: $HK_STATUS"
if [[ "$HK_STATUS" == "completed" ]]; then
    echo "   结果: $(echo "$HK_FINAL" | python3 -c "import sys,json; r=json.load(sys.stdin).get('result',''); print(r[:200] + '...' if len(r)>200 else r)" 2>/dev/null)"
fi

echo ""
echo "=========================================="
if [[ "$US_STATUS" == "completed" ]] && [[ "$HK_STATUS" == "completed" ]]; then
    echo "✅ 两个环境都执行成功"
else
    echo "⚠️ 有环境执行失败，请检查"
fi
