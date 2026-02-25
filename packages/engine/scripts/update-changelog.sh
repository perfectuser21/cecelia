#!/bin/bash
# 更新 CHANGELOG.md

set -e

NEW_VERSION="$1"

if [[ -z "$NEW_VERSION" ]]; then
    echo "❌ 用法: $0 <new_version>"
    exit 1
fi

if [[ ! -f "CHANGELOG.md" ]]; then
    echo "⚠️  CHANGELOG.md 不存在，跳过"
    exit 0
fi

# 获取最近的 commit 消息
RECENT_COMMITS=$(git log develop..HEAD --oneline | head -10)

# 生成 changelog 条目
DATE=$(date +%Y-%m-%d)
ENTRY="## [$NEW_VERSION] - $DATE

### Changes
$RECENT_COMMITS

"

# 在 CHANGELOG.md 顶部插入新条目（在第一个 ## 之前）
# 使用临时文件避免 sed 多行插入问题
TEMP_FILE=$(mktemp)
echo "$ENTRY" > "$TEMP_FILE"

if grep -q "^## \[" CHANGELOG.md; then
    # 在第一个版本条目之前插入
    awk '/^## \[/{if(!done){system("cat '"$TEMP_FILE"'"); done=1}} {print}' CHANGELOG.md > "${TEMP_FILE}.new"
    mv "${TEMP_FILE}.new" CHANGELOG.md
else
    # 如果没有版本条目，在文件开头插入
    cat "$TEMP_FILE" CHANGELOG.md > "${TEMP_FILE}.new"
    mv "${TEMP_FILE}.new" CHANGELOG.md
fi

rm -f "$TEMP_FILE"

echo "✅ CHANGELOG.md 已更新: $NEW_VERSION"
