#!/bin/bash

# Brain Callback 功能验证脚本
# Task: cp-03201802-413e2524-27b8-4ade-963b-89e6f0

echo "验证 Brain callback 功能是否已实现..."

# 检查 Stage 4 是否包含 execution-callback API 调用
if grep -q "execution-callback" packages/engine/skills/dev/steps/04-ship.md; then
    echo "✅ Stage 4 包含 Brain execution-callback API 调用"
else
    echo "❌ Stage 4 缺少 Brain execution-callback API 调用"
fi

# 检查 stop-dev.sh 是否已移除 30 次重试限制
if ! grep -q "retry_count.*30.*exit" packages/engine/hooks/stop-dev.sh; then
    echo "✅ stop-dev.sh 已移除 30 次重试硬限制"
else
    echo "❌ stop-dev.sh 仍有 30 次重试硬限制"
fi

# 检查是否有 pipeline_rescue 机制
if grep -q "pipeline_rescue" packages/engine/hooks/stop-dev.sh; then
    echo "✅ stop-dev.sh 包含 pipeline_rescue 机制"
else
    echo "❌ stop-dev.sh 缺少 pipeline_rescue 机制"
fi

echo "验证完成"