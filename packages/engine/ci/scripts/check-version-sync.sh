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

# jq 优雅降级：jq 不存在时用 node 解析 JSON
_json_version() {
    local _file="$1"
    local _field="${2:-.version}"
    if command -v jq &>/dev/null; then
        jq -r "${_field}" "$_file" 2>/dev/null || echo ""
    else
        _FILE="$_file" _FIELD="$_field" node -e "try{const d=JSON.parse(require('fs').readFileSync(process.env._FILE,'utf8'));const keys=process.env._FIELD.replace(/^\./,'').split('.');let v=d;for(const k of keys)v=v&&v[k];console.log(v||'')}catch(e){}" 2>/dev/null || echo ""
    fi
}

# 检查 jq 和 node 是否都不可用（两者均缺失则优雅跳过）
if ! command -v jq &>/dev/null && ! command -v node &>/dev/null; then
    echo "⚠️  jq 和 node 均未安装，跳过版本同步检查"
    exit 0
fi

BASE_VERSION=$(_json_version "package.json" ".version")
if [[ -z "$BASE_VERSION" || "$BASE_VERSION" == "null" ]]; then
    echo "❌ 无法读取 package.json 版本，版本同步检查失败"
    exit 1
fi
echo "基准版本 (package.json): $BASE_VERSION"
echo ""

ERRORS=0

# 检查 package-lock.json
if [[ -f "package-lock.json" ]]; then
    LOCK_VERSION=$(_json_version "package-lock.json" ".version")
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
