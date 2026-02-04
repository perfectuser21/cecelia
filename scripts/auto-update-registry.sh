#!/usr/bin/env bash
# 自动更新 Feature Registry（检测核心文件变更）

set -e

# 检测是否修改了核心文件
CORE_FILES_CHANGED=$(git diff --name-only develop...HEAD | grep -E '^(hooks/|skills/|scripts/)' || true)

if [[ -z "$CORE_FILES_CHANGED" ]]; then
    echo "⚠️  未修改核心文件，跳过 registry 更新"
    exit 0
fi

echo "📝 检测到核心文件修改："
echo "$CORE_FILES_CHANGED"

# 检查 feature-registry.yml 是否存在
if [[ ! -f "features/feature-registry.yml" ]]; then
    echo "⚠️  features/feature-registry.yml 不存在，跳过"
    exit 0
fi

# 这里应该调用实际的 registry 更新逻辑
# 目前只是占位符，实际逻辑需要根据项目需求实现

echo "✅ Registry 检查完成"
echo "ℹ️  如需更新 Feature Registry，请手动编辑 FEATURES.md"
