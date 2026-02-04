#!/usr/bin/env bash
# 自动更新版本号（根据 commit 类型）

set -e

# 检测 commit 类型（基于第一个 commit）
FIRST_COMMIT=$(git log develop..HEAD --oneline | tail -1)

# 检查是否有 commit
if [[ -z "$FIRST_COMMIT" ]]; then
    echo "⚠️  当前分支没有新 commit，跳过版本号更新"
    exit 0
fi

if [[ "$FIRST_COMMIT" =~ feat! ]]; then
    TYPE="major"
elif [[ "$FIRST_COMMIT" =~ ^feat: ]] || [[ "$FIRST_COMMIT" =~ ^feat\( ]]; then
    TYPE="minor"
elif [[ "$FIRST_COMMIT" =~ ^fix: ]] || [[ "$FIRST_COMMIT" =~ ^fix\( ]]; then
    TYPE="patch"
else
    echo "⚠️  非功能性改动（$FIRST_COMMIT），跳过版本号更新"
    exit 0
fi

# 检查 package.json 是否存在
if [[ ! -f "package.json" ]]; then
    echo "⚠️  package.json 不存在，跳过版本号更新"
    exit 0
fi

# 更新 package.json
CURRENT=$(jq -r '.version' package.json)
NEW=$(npm version "$TYPE" --no-git-tag-version 2>/dev/null | tr -d 'v')

if [[ -z "$NEW" ]]; then
    echo "❌ npm version 失败"
    exit 1
fi

echo "✅ 版本号: $CURRENT → $NEW ($TYPE)"

# 同步 VERSION 文件
if [[ -f "VERSION" ]]; then
    echo "$NEW" > VERSION
    echo "✅ VERSION 已更新"
fi

# 同步 hook-core/VERSION（如果存在）
if [[ -d "hook-core" ]]; then
    echo "$NEW" > hook-core/VERSION
    echo "✅ hook-core/VERSION 已更新"
fi

# 同步 .hook-core-version（如果存在）
if [[ -f ".hook-core-version" ]]; then
    echo "$NEW" > .hook-core-version
    echo "✅ .hook-core-version 已更新"
fi

# 同步 package-lock.json
npm install --package-lock-only 2>/dev/null
echo "✅ package-lock.json 已同步"

# 更新 CHANGELOG
if [[ -f "scripts/update-changelog.sh" ]]; then
    bash scripts/update-changelog.sh "$NEW"
fi

echo "✅ 版本号更新完成"
