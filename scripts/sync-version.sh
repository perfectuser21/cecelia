#!/usr/bin/env bash
#
# sync-version.sh - 从 package.json 同步版本号到其他文件
#
# 用法:
#   bash scripts/sync-version.sh [--check]
#
# 选项:
#   --check  只检查是否同步，不修改（用于 CI）
#
# 同步目标:
#   - VERSION
#   - ci-tools/VERSION
#   - regression-contract.yaml
#

set -euo pipefail

CHECK_ONLY=false
if [[ "${1:-}" == "--check" ]]; then
  CHECK_ONLY=true
fi

# 获取 package.json 版本
if [[ ! -f "package.json" ]]; then
  echo "❌ package.json 不存在"
  exit 1
fi

VERSION=$(jq -r '.version' package.json)
if [[ -z "$VERSION" || "$VERSION" == "null" ]]; then
  echo "❌ 无法从 package.json 读取版本号"
  exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Version Sync"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Source: package.json = $VERSION"
echo ""

NEED_SYNC=false
SYNCED=()

# 检查/同步 VERSION
sync_file() {
  local file="$1"
  local current=""

  if [[ -f "$file" ]]; then
    current=$(cat "$file" | tr -d '\n')
  fi

  if [[ "$current" != "$VERSION" ]]; then
    if $CHECK_ONLY; then
      echo "  ❌ $file: $current (需要 $VERSION)"
      NEED_SYNC=true
    else
      echo "$VERSION" > "$file"
      echo "  ✅ $file: $current → $VERSION"
      SYNCED+=("$file")
    fi
  else
    echo "  ✅ $file: $VERSION (已同步)"
  fi
}

# 检查/同步 regression-contract.yaml
sync_yaml() {
  local file="regression-contract.yaml"

  if [[ ! -f "$file" ]]; then
    echo "  ⚠️ $file 不存在，跳过"
    return
  fi

  # 使用 grep 获取当前版本（兼容无 yq 环境）
  local current
  current=$(grep -E '^version:' "$file" | head -1 | awk '{print $2}' | tr -d '"' || echo "")

  if [[ "$current" != "$VERSION" ]]; then
    if $CHECK_ONLY; then
      echo "  ❌ $file: $current (需要 $VERSION)"
      NEED_SYNC=true
    else
      # 使用 sed 替换（兼容 macOS 和 Linux）
      if [[ "$(uname)" == "Darwin" ]]; then
        sed -i '' "s/^version:.*/version: \"$VERSION\"/" "$file"
      else
        sed -i "s/^version:.*/version: \"$VERSION\"/" "$file"
      fi
      echo "  ✅ $file: $current → $VERSION"
      SYNCED+=("$file")
    fi
  else
    echo "  ✅ $file: $VERSION (已同步)"
  fi
}

# 执行同步
echo "[Targets]"
sync_file "VERSION"
sync_file "ci-tools/VERSION"
sync_file ".hook-core-version"
sync_yaml

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if $CHECK_ONLY; then
  if $NEED_SYNC; then
    echo "  ❌ 版本不同步"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "运行以下命令同步版本："
    echo "  bash scripts/sync-version.sh"
    exit 1
  else
    echo "  ✅ 版本已同步"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  fi
else
  if [[ ${#SYNCED[@]} -gt 0 ]]; then
    echo "  ✅ 已同步 ${#SYNCED[@]} 个文件"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "已更新的文件："
    for f in "${SYNCED[@]}"; do
      echo "  - $f"
    done
  else
    echo "  ✅ 无需同步"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  fi

  echo ""
  echo "[package-lock.json]"
  # 检查 package-lock.json 是否需要同步
  if [[ -f "package-lock.json" ]]; then
    LOCK_VERSION=$(jq -r '.version // ""' package-lock.json 2>/dev/null || echo "")
    if [[ "$LOCK_VERSION" != "$VERSION" ]]; then
      echo "  ⚠️  package-lock.json 版本不匹配 ($LOCK_VERSION != $VERSION)"
      echo ""
      echo "运行以下命令同步 package-lock.json："
      echo "  npm install --package-lock-only"
      echo ""
    else
      echo "  ✅ package-lock.json 已同步"
    fi
  else
    echo "  ⏭️  package-lock.json 不存在"
  fi
fi
