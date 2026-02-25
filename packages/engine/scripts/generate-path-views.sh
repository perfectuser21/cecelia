#!/usr/bin/env bash
# ============================================================================
# 从 feature-registry.yml 生成派生视图
# ============================================================================
# 输入: features/feature-registry.yml
# 输出: docs/paths/MINIMAL-PATHS.md
#       docs/paths/GOLDEN-PATHS.md
#       docs/paths/OPTIMAL-PATHS.md
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

REGISTRY_FILE="$PROJECT_ROOT/features/feature-registry.yml"
MINIMAL_OUTPUT="$PROJECT_ROOT/docs/paths/MINIMAL-PATHS.md"
GOLDEN_OUTPUT="$PROJECT_ROOT/docs/paths/GOLDEN-PATHS.md"
OPTIMAL_OUTPUT="$PROJECT_ROOT/docs/paths/OPTIMAL-PATHS.md"

# 检查依赖
if ! command -v yq &>/dev/null; then
    echo "❌ 需要安装 yq (YAML 处理工具)"
    echo "   macOS: brew install yq"
    echo "   Linux: snap install yq 或 https://github.com/mikefarah/yq"
    exit 1
fi

if [[ ! -f "$REGISTRY_FILE" ]]; then
    echo "❌ 找不到 feature-registry.yml"
    exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  从 feature-registry.yml 生成派生视图"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "输入: $REGISTRY_FILE"
echo "输出:"
echo "  - $MINIMAL_OUTPUT"
echo "  - $GOLDEN_OUTPUT"
echo "  - $OPTIMAL_OUTPUT"
echo ""

# 读取版本和更新时间
VERSION=$(yq '.version' "$REGISTRY_FILE")
UPDATED=$(yq '.updated' "$REGISTRY_FILE")
# Use the updated date from registry instead of current date to avoid timezone drift
TODAY="$UPDATED"

# ============================================================================
# 生成 MINIMAL-PATHS.md
# ============================================================================
echo "生成 MINIMAL-PATHS.md..."

cat > "$MINIMAL_OUTPUT" << EOF
---
id: minimal-paths
version: $VERSION
created: $UPDATED
updated: $TODAY
source: features/feature-registry.yml
generation: auto-generated (scripts/generate-path-views.sh)
changelog:
  - $VERSION: 从 feature-registry.yml 自动生成
---

# Minimal Paths - 最小验收路径

**来源**: \`features/feature-registry.yml\` (单一事实源)
**用途**: 每个 feature 的"必须覆盖的 1-3 条"最小路径
**生成**: 自动生成，不要手动编辑

---

## Platform Core 5 - 平台基础设施

EOF

# 提取 Platform Core features
PLATFORM_COUNT=$(yq '.platform_features | length' "$REGISTRY_FILE")

for i in $(seq 0 $((PLATFORM_COUNT - 1))); do
    FEATURE_ID=$(yq ".platform_features[$i].id" "$REGISTRY_FILE")
    FEATURE_NAME=$(yq ".platform_features[$i].name" "$REGISTRY_FILE")

    # 写入章节标题
    cat >> "$MINIMAL_OUTPUT" << EOF
### $FEATURE_ID: $FEATURE_NAME

EOF

    # 提取 minimal_paths
    MINIMAL_PATHS_COUNT=$(yq ".platform_features[$i].minimal_paths | length" "$REGISTRY_FILE")

    if [[ "$MINIMAL_PATHS_COUNT" -gt 0 ]]; then
        for j in $(seq 0 $((MINIMAL_PATHS_COUNT - 1))); do
            PATH_TEXT=$(yq ".platform_features[$i].minimal_paths[$j]" "$REGISTRY_FILE")
            echo "$((j + 1)). ✅ **$PATH_TEXT**" >> "$MINIMAL_OUTPUT"
        done
    else
        echo "（暂无 minimal paths）" >> "$MINIMAL_OUTPUT"
    fi

    # 添加 RCI 覆盖
    RCIS=$(yq ".platform_features[$i].rcis[]" "$REGISTRY_FILE" 2>/dev/null | tr '\n' ', ' | sed 's/,$//')
    if [[ -n "$RCIS" ]]; then
        echo "" >> "$MINIMAL_OUTPUT"
        echo "**RCI 覆盖**: $RCIS" >> "$MINIMAL_OUTPUT"
    fi

    echo "" >> "$MINIMAL_OUTPUT"
    echo "---" >> "$MINIMAL_OUTPUT"
    echo "" >> "$MINIMAL_OUTPUT"
done

# Product Core features
cat >> "$MINIMAL_OUTPUT" << EOF
## Product Core 5 - 引擎核心能力

EOF

PRODUCT_COUNT=$(yq '.product_features | length' "$REGISTRY_FILE")

for i in $(seq 0 $((PRODUCT_COUNT - 1))); do
    FEATURE_ID=$(yq ".product_features[$i].id" "$REGISTRY_FILE")
    FEATURE_NAME=$(yq ".product_features[$i].name" "$REGISTRY_FILE")

    cat >> "$MINIMAL_OUTPUT" << EOF
### $FEATURE_ID: $FEATURE_NAME

EOF

    MINIMAL_PATHS_COUNT=$(yq ".product_features[$i].minimal_paths | length" "$REGISTRY_FILE")

    if [[ "$MINIMAL_PATHS_COUNT" -gt 0 ]]; then
        for j in $(seq 0 $((MINIMAL_PATHS_COUNT - 1))); do
            PATH_TEXT=$(yq ".product_features[$i].minimal_paths[$j]" "$REGISTRY_FILE")
            echo "$((j + 1)). ✅ **$PATH_TEXT**" >> "$MINIMAL_OUTPUT"
        done
    else
        echo "（暂无 minimal paths）" >> "$MINIMAL_OUTPUT"
    fi

    RCIS=$(yq ".product_features[$i].rcis[]" "$REGISTRY_FILE" 2>/dev/null | tr '\n' ', ' | sed 's/,$//')
    if [[ -n "$RCIS" ]]; then
        echo "" >> "$MINIMAL_OUTPUT"
        echo "**RCI 覆盖**: $RCIS" >> "$MINIMAL_OUTPUT"
    fi

    echo "" >> "$MINIMAL_OUTPUT"
    echo "---" >> "$MINIMAL_OUTPUT"
    echo "" >> "$MINIMAL_OUTPUT"
done

# Footer
cat >> "$MINIMAL_OUTPUT" << EOF
## 更新规则

**本文件自动生成，不要手动编辑**。

所有变更必须：
1. 先更新 \`features/feature-registry.yml\`
2. 运行: \`bash scripts/generate-path-views.sh\`
3. 提交生成的视图文件

---

**来源**: features/feature-registry.yml
**版本**: $VERSION
**生成时间**: $TODAY
EOF

echo "✅ 生成完成: $MINIMAL_OUTPUT"

# ============================================================================
# 生成 GOLDEN-PATHS.md
# ============================================================================
echo "生成 GOLDEN-PATHS.md..."

cat > "$GOLDEN_OUTPUT" << EOF
---
id: golden-paths
version: $VERSION
created: $UPDATED
updated: $TODAY
source: features/feature-registry.yml
generation: auto-generated (scripts/generate-path-views.sh)
changelog:
  - $VERSION: 从 feature-registry.yml 自动生成
---

# Golden Paths - 端到端成功路径

**来源**: \`features/feature-registry.yml\` (单一事实源)
**用途**: 每个 feature 的"端到端成功路径"（最关键的完整流程）
**生成**: 自动生成，不要手动编辑

---

EOF

GP_INDEX=1

# Platform Core Golden Paths
for i in $(seq 0 $((PLATFORM_COUNT - 1))); do
    FEATURE_ID=$(yq ".platform_features[$i].id" "$REGISTRY_FILE")
    FEATURE_NAME=$(yq ".platform_features[$i].name" "$REGISTRY_FILE")
    PRIORITY=$(yq ".platform_features[$i].priority" "$REGISTRY_FILE")
    GOLDEN_PATH=$(yq ".platform_features[$i].golden_path" "$REGISTRY_FILE")

    cat >> "$GOLDEN_OUTPUT" << EOF
## GP-$(printf "%03d" $GP_INDEX): $FEATURE_NAME ($FEATURE_ID)

**Feature**: $FEATURE_ID - $FEATURE_NAME
**Priority**: $PRIORITY

### Golden Path

\`\`\`
$GOLDEN_PATH
\`\`\`

EOF

    RCIS=$(yq ".platform_features[$i].rcis[]" "$REGISTRY_FILE" 2>/dev/null | tr '\n' ', ' | sed 's/,$//')
    if [[ -n "$RCIS" ]]; then
        echo "**RCI 覆盖**: $RCIS" >> "$GOLDEN_OUTPUT"
        echo "" >> "$GOLDEN_OUTPUT"
    fi

    echo "---" >> "$GOLDEN_OUTPUT"
    echo "" >> "$GOLDEN_OUTPUT"

    GP_INDEX=$((GP_INDEX + 1))
done

# Product Core Golden Paths
for i in $(seq 0 $((PRODUCT_COUNT - 1))); do
    FEATURE_ID=$(yq ".product_features[$i].id" "$REGISTRY_FILE")
    FEATURE_NAME=$(yq ".product_features[$i].name" "$REGISTRY_FILE")
    PRIORITY=$(yq ".product_features[$i].priority" "$REGISTRY_FILE")
    GOLDEN_PATH=$(yq ".product_features[$i].golden_path" "$REGISTRY_FILE")

    cat >> "$GOLDEN_OUTPUT" << EOF
## GP-$(printf "%03d" $GP_INDEX): $FEATURE_NAME ($FEATURE_ID)

**Feature**: $FEATURE_ID - $FEATURE_NAME
**Priority**: $PRIORITY

### Golden Path

\`\`\`
$GOLDEN_PATH
\`\`\`

EOF

    RCIS=$(yq ".product_features[$i].rcis[]" "$REGISTRY_FILE" 2>/dev/null | tr '\n' ', ' | sed 's/,$//')
    if [[ -n "$RCIS" ]]; then
        echo "**RCI 覆盖**: $RCIS" >> "$GOLDEN_OUTPUT"
        echo "" >> "$GOLDEN_OUTPUT"
    fi

    echo "---" >> "$GOLDEN_OUTPUT"
    echo "" >> "$GOLDEN_OUTPUT"

    GP_INDEX=$((GP_INDEX + 1))
done

# Footer
cat >> "$GOLDEN_OUTPUT" << EOF
## 更新规则

**本文件自动生成，不要手动编辑**。

所有变更必须：
1. 先更新 \`features/feature-registry.yml\`
2. 运行: \`bash scripts/generate-path-views.sh\`
3. 提交生成的视图文件

---

**来源**: features/feature-registry.yml
**版本**: $VERSION
**生成时间**: $TODAY
EOF

echo "✅ 生成完成: $GOLDEN_OUTPUT"

# ============================================================================
# 生成 OPTIMAL-PATHS.md
# ============================================================================
echo "生成 OPTIMAL-PATHS.md..."

cat > "$OPTIMAL_OUTPUT" << EOF
---
id: optimal-paths
version: $VERSION
created: $TODAY
updated: $TODAY
source: features/feature-registry.yml
generation: auto-generated (scripts/generate-path-views.sh)
changelog:
  - $VERSION: 从 feature-registry.yml 自动生成
---

# Optimal Paths - 推荐体验路径

**来源**: \`features/feature-registry.yml\` (单一事实源)
**用途**: 每个 feature 的"推荐体验路径"（优化后的流程）
**生成**: 自动生成，不要手动编辑

---

## Platform Core 5 - 平台基础设施

EOF

# Platform Core Optimal Paths
for i in $(seq 0 $((PLATFORM_COUNT - 1))); do
    FEATURE_ID=$(yq ".platform_features[$i].id" "$REGISTRY_FILE")
    FEATURE_NAME=$(yq ".platform_features[$i].name" "$REGISTRY_FILE")
    OPTIMAL_PATH=$(yq ".platform_features[$i].optimal_path" "$REGISTRY_FILE" 2>/dev/null)

    cat >> "$OPTIMAL_OUTPUT" << EOF
### $FEATURE_ID: $FEATURE_NAME

EOF

    if [[ "$OPTIMAL_PATH" != "null" ]] && [[ -n "$OPTIMAL_PATH" ]]; then
        cat >> "$OPTIMAL_OUTPUT" << EOF
\`\`\`
$OPTIMAL_PATH
\`\`\`

EOF
    else
        # 如果没有 optimal_path，使用 golden_path
        GOLDEN_PATH=$(yq ".platform_features[$i].golden_path" "$REGISTRY_FILE")
        cat >> "$OPTIMAL_OUTPUT" << EOF
\`\`\`
$GOLDEN_PATH
\`\`\`

EOF
    fi

    echo "---" >> "$OPTIMAL_OUTPUT"
    echo "" >> "$OPTIMAL_OUTPUT"
done

# Product Core Optimal Paths
cat >> "$OPTIMAL_OUTPUT" << EOF
## Product Core 5 - 引擎核心能力

EOF

for i in $(seq 0 $((PRODUCT_COUNT - 1))); do
    FEATURE_ID=$(yq ".product_features[$i].id" "$REGISTRY_FILE")
    FEATURE_NAME=$(yq ".product_features[$i].name" "$REGISTRY_FILE")
    OPTIMAL_PATH=$(yq ".product_features[$i].optimal_path" "$REGISTRY_FILE" 2>/dev/null)

    cat >> "$OPTIMAL_OUTPUT" << EOF
### $FEATURE_ID: $FEATURE_NAME

EOF

    if [[ "$OPTIMAL_PATH" != "null" ]] && [[ -n "$OPTIMAL_PATH" ]]; then
        cat >> "$OPTIMAL_OUTPUT" << EOF
\`\`\`
$OPTIMAL_PATH
\`\`\`

EOF
    else
        GOLDEN_PATH=$(yq ".product_features[$i].golden_path" "$REGISTRY_FILE")
        cat >> "$OPTIMAL_OUTPUT" << EOF
\`\`\`
$GOLDEN_PATH
\`\`\`

EOF
    fi

    echo "---" >> "$OPTIMAL_OUTPUT"
    echo "" >> "$OPTIMAL_OUTPUT"
done

# Footer
cat >> "$OPTIMAL_OUTPUT" << EOF
## 更新规则

**本文件自动生成，不要手动编辑**。

所有变更必须：
1. 先更新 \`features/feature-registry.yml\`
2. 运行: \`bash scripts/generate-path-views.sh\`
3. 提交生成的视图文件

---

**来源**: features/feature-registry.yml
**版本**: $VERSION
**生成时间**: $TODAY
EOF

echo "✅ 生成完成: $OPTIMAL_OUTPUT"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ 全部生成完成"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "生成的文件:"
echo "  - $MINIMAL_OUTPUT"
echo "  - $GOLDEN_OUTPUT"
echo "  - $OPTIMAL_OUTPUT"
echo ""
echo "下一步: git add 这些文件并提交"
echo ""
