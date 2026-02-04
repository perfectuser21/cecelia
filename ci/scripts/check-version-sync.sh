#!/usr/bin/env bash
# 检查所有版本文件是否同步
# CI 中运行，任何不同步都会导致失败

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Version Sync Check"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 获取 package.json 版本作为基准
if [[ ! -f "package.json" ]]; then
    echo "⚠️  package.json 不存在，跳过检查"
    exit 0
fi

BASE_VERSION=$(jq -r '.version' package.json)
echo "基准版本 (package.json): $BASE_VERSION"
echo ""

ERRORS=0

# 检查 package-lock.json
if [[ -f "package-lock.json" ]]; then
    LOCK_VERSION=$(jq -r '.version' package-lock.json)
    if [[ "$LOCK_VERSION" != "$BASE_VERSION" ]]; then
        echo "❌ package-lock.json: $LOCK_VERSION (期望: $BASE_VERSION)"
        ERRORS=$((ERRORS + 1))
    else
        echo "✅ package-lock.json: $LOCK_VERSION"
    fi
fi

# 检查 VERSION 文件
if [[ -f "VERSION" ]]; then
    FILE_VERSION=$(cat VERSION | tr -d '\n')
    if [[ "$FILE_VERSION" != "$BASE_VERSION" ]]; then
        echo "❌ VERSION: $FILE_VERSION (期望: $BASE_VERSION)"
        ERRORS=$((ERRORS + 1))
    else
        echo "✅ VERSION: $FILE_VERSION"
    fi
fi

# 检查 hook-core/VERSION
if [[ -f "hook-core/VERSION" ]]; then
    HC_VERSION=$(cat hook-core/VERSION | tr -d '\n')
    if [[ "$HC_VERSION" != "$BASE_VERSION" ]]; then
        echo "❌ hook-core/VERSION: $HC_VERSION (期望: $BASE_VERSION)"
        ERRORS=$((ERRORS + 1))
    else
        echo "✅ hook-core/VERSION: $HC_VERSION"
    fi
fi

# 检查 .hook-core-version
if [[ -f ".hook-core-version" ]]; then
    HCV_VERSION=$(cat .hook-core-version | tr -d '\n')
    if [[ "$HCV_VERSION" != "$BASE_VERSION" ]]; then
        echo "❌ .hook-core-version: $HCV_VERSION (期望: $BASE_VERSION)"
        ERRORS=$((ERRORS + 1))
    else
        echo "✅ .hook-core-version: $HCV_VERSION"
    fi
fi

# 检查 regression-contract.yaml
if [[ -f "regression-contract.yaml" ]]; then
    RC_VERSION=$(grep '^version:' regression-contract.yaml | sed 's/version: *"\?\([^"]*\)"\?/\1/')
    if [[ "$RC_VERSION" != "$BASE_VERSION" ]]; then
        echo "❌ regression-contract.yaml: $RC_VERSION (期望: $BASE_VERSION)"
        ERRORS=$((ERRORS + 1))
    else
        echo "✅ regression-contract.yaml: $RC_VERSION"
    fi
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [[ $ERRORS -gt 0 ]]; then
    echo "  ❌ 版本不同步 ($ERRORS 个文件)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "修复方法："
    echo "  npm version patch --no-git-tag-version"
    echo "  cat package.json | jq -r .version > VERSION"
    echo "  npm install --package-lock-only"
    echo "  # 同步其他版本文件..."
    echo ""
    exit 1
else
    echo "  ✅ 所有版本文件同步"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
fi
