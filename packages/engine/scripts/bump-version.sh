#!/usr/bin/env bash
# bump-version.sh — Engine 版本一键同步
#
# 用法：
#   bash packages/engine/scripts/bump-version.sh          # patch bump (默认)
#   bash packages/engine/scripts/bump-version.sh minor    # minor bump
#   bash packages/engine/scripts/bump-version.sh major    # major bump
#   bash packages/engine/scripts/bump-version.sh 14.7.0   # 指定精确版本
#
# 会同步更新以下 6 个文件：
#   1. package.json
#   2. package-lock.json
#   3. VERSION
#   4. .hook-core-version
#   5. hooks/VERSION
#   6. regression-contract.yaml（version 字段）
#
# 不会自动更新 feature-registry.yml（需手动添加 changelog 条目）

set -e

# 定位 packages/engine 目录（无论从哪里调用）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ENGINE_DIR"

BUMP_TYPE="${1:-patch}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Engine Version Bump"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 读当前版本
if ! command -v node &>/dev/null; then
    echo "❌ node 未安装" && exit 1
fi

CURRENT=$( node -e "console.log(JSON.parse(require('fs').readFileSync('package.json','utf8')).version)" )
echo "当前版本: $CURRENT"

# 计算新版本
if [[ "$BUMP_TYPE" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    NEW_VERSION="$BUMP_TYPE"
else
    IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
    case "$BUMP_TYPE" in
        major) NEW_VERSION="$((MAJOR+1)).0.0" ;;
        minor) NEW_VERSION="${MAJOR}.$((MINOR+1)).0" ;;
        patch) NEW_VERSION="${MAJOR}.${MINOR}.$((PATCH+1))" ;;
        *)     echo "❌ 未知 bump 类型: $BUMP_TYPE (major/minor/patch 或精确版本号)" && exit 1 ;;
    esac
fi

echo "新版本:   $NEW_VERSION"
echo ""

# 1. package.json
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  pkg.version = '$NEW_VERSION';
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  console.log('✅ package.json → $NEW_VERSION');
"

# 2. package-lock.json
if [[ -f "package-lock.json" ]]; then
    node -e "
      const fs = require('fs');
      const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
      lock.version = '$NEW_VERSION';
      if (lock.packages && lock.packages['']) lock.packages[''].version = '$NEW_VERSION';
      fs.writeFileSync('package-lock.json', JSON.stringify(lock, null, 2) + '\n');
      console.log('✅ package-lock.json → $NEW_VERSION');
    "
fi

# 3. VERSION
if [[ -f "VERSION" ]]; then
    echo -n "$NEW_VERSION" > VERSION
    echo "✅ VERSION → $NEW_VERSION"
fi

# 4. .hook-core-version
if [[ -f ".hook-core-version" ]]; then
    echo -n "$NEW_VERSION" > .hook-core-version
    echo "✅ .hook-core-version → $NEW_VERSION"
fi

# 5. hooks/VERSION
if [[ -f "hooks/VERSION" ]]; then
    echo -n "$NEW_VERSION" > hooks/VERSION
    echo "✅ hooks/VERSION → $NEW_VERSION"
fi

# 6. regression-contract.yaml（替换 ^version: ... 行）
if [[ -f "regression-contract.yaml" ]]; then
    if command -v node &>/dev/null; then
        node -e "
          const fs = require('fs');
          const content = fs.readFileSync('regression-contract.yaml', 'utf8');
          const updated = content.replace(/^version:.*$/m, 'version: $NEW_VERSION');
          fs.writeFileSync('regression-contract.yaml', updated);
          console.log('✅ regression-contract.yaml → $NEW_VERSION');
        "
    else
        echo "⚠️  node 不可用，请手动更新 regression-contract.yaml"
    fi
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ 6 个文件已同步到 $NEW_VERSION"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "⚠️  还需手动在 feature-registry.yml 添加 changelog 条目："
echo "  changelog:"
echo "    - version: \"$NEW_VERSION\""
echo "      date: \"$(TZ=Asia/Shanghai date +%Y-%m-%d)\""
echo "      changes: \"<描述变更>\""
