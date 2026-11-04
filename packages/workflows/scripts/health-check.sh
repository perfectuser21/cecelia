#!/bin/bash
# 健康检查：检查美国和香港的 N8N + AI Gateway
# 失败时发送飞书通知
#
# 用法: ./health-check.sh
# 建议 cron: 0 * * * * /home/xx/dev/cecelia-workflows/scripts/health-check.sh

FEISHU_WEBHOOK="${FEISHU_WEBHOOK_URL:-}"
ERRORS=""

check_service() {
    local name=$1
    local url=$2
    local result
    if ! result=$(curl --fail --silent --max-time 10 "$url" 2>/dev/null) || ! grep -q "ok" <<< "$result"; then
        ERRORS="$ERRORS\n❌ $name 不可用"
        return 1
    fi
    echo "✅ $name"
    return 0
}

echo "========== 健康检查 $(date) =========="
echo ""

echo "🇺🇸 美国:"
check_service "N8N" "http://localhost:5679/healthz"
check_service "AI Gateway" "http://localhost:9876/health"

echo ""
echo "🇭🇰 香港:"
ssh hk "curl -s http://localhost:5679/healthz" 2>/dev/null | grep -q "ok" && echo "✅ N8N" || { echo "❌ N8N"; ERRORS="$ERRORS\n❌ 香港 N8N 不可用"; }
ssh hk "curl -s http://localhost:9876/health" 2>/dev/null | grep -q "ok" && echo "✅ AI Gateway" || { echo "❌ AI Gateway"; ERRORS="$ERRORS\n❌ 香港 AI Gateway 不可用"; }

# 如果有错误且配置了飞书，发送通知
if [[ -n "$ERRORS" ]] && [[ -n "$FEISHU_WEBHOOK" ]]; then
    echo ""
    echo "⚠️ 发现问题，发送飞书通知..."

    curl -s -X POST "$FEISHU_WEBHOOK" \
        -H "Content-Type: application/json" \
        -d "{
            \"msg_type\": \"text\",
            \"content\": {
                \"text\": \"🚨 Cecelia Workflows 健康检查失败\\n$(echo -e $ERRORS)\\n\\n时间: $(date)\"
            }
        }"
fi

if [[ -n "$ERRORS" ]]; then
    echo ""
    echo "❌ 检查失败"
    exit 1
else
    echo ""
    echo "✅ 所有服务正常"
fi
