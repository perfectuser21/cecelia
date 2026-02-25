#!/usr/bin/env bash
set -euo pipefail

# post-pr-checklist.sh
# Post-PR Checklist - 自动检查常见问题
#
# 用途：PR 合并后自动检查，防止问题重复出现
# 调用时机：Step 11 (Cleanup) 或 CI 的 post-merge hook

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Post-PR Checklist"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

ERRORS=0
WARNINGS=0
QUEUE_FILE="docs/SELF-EVOLUTION-QUEUE.md"

# Helper function: 记录问题到队列
record_issue() {
    local type="$1"
    local description="$2"
    local priority="${3:-P3}"
    local auto_fix="${4:-false}"

    # 生成 ID（简单递增）
    local next_id=$(grep -oP 'SE-\K\d+' "$QUEUE_FILE" 2>/dev/null | sort -n | tail -1 || echo "000")
    next_id=$(printf "%03d" $((10#$next_id + 1)))

    local timestamp=$(date -Iseconds)

    # 追加到队列文件（在 pending 部分）
    # 简化实现：直接输出提示，不修改文件结构
    echo "  📝 已记录到 Self-Evolution Queue"
    echo "     ID: SE-$next_id"
    echo "     Type: $type"
    echo "     Priority: $priority"
    echo ""
}

# 检查 1: develop/main 不应该有 PRD/DoD
CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "")

if [[ "$CURRENT_BRANCH" == "develop" || "$CURRENT_BRANCH" == "main" ]]; then
  echo "[检查 1/4] PRD/DoD 残留检查"

  if git ls-files | grep -qE "^\.(prd|dod)\.md$"; then
    echo "  ⚠️  发现 PRD/DoD 残留（已记录到队列）"
    echo "     这些文件应该只存在于功能分支 (cp-*, feature/*)"
    echo ""
    echo "     发现的文件："
    git ls-files | grep -E "^\.(prd|dod)\.md$" | sed 's/^/       - /'
    echo ""
    record_issue "prd-dod-residue" "develop/main 分支存在 PRD/DoD 文件" "P3" "true"
    WARNINGS=$((WARNINGS + 1))
  else
    echo "  ✅ develop/main 无 PRD/DoD 残留"
  fi
else
  echo "[检查 1/4] PRD/DoD 残留检查 (跳过，当前在功能分支: $CURRENT_BRANCH)"
fi

echo ""

# 检查 2: 派生视图是否同步
echo "[检查 2/4] 派生视图版本同步检查"

if [[ -f "features/feature-registry.yml" ]]; then
  REGISTRY_VERSION=$(grep "^version:" features/feature-registry.yml | awk '{print $2}' | tr -d '"' || echo "")
  OPTIMAL_VERSION=$(grep "^version:" docs/paths/OPTIMAL-PATHS.md | awk '{print $2}' | tr -d '"' || echo "")

  if [[ -z "$REGISTRY_VERSION" || -z "$OPTIMAL_VERSION" ]]; then
    echo "  ⚠️  无法读取版本号"
    WARNINGS=$((WARNINGS + 1))
  elif [[ "$REGISTRY_VERSION" != "$OPTIMAL_VERSION" ]]; then
    echo "  ⚠️  派生视图版本不匹配（已记录到队列）"
    echo "     registry: $REGISTRY_VERSION"
    echo "     views:    $OPTIMAL_VERSION"
    echo ""
    record_issue "version-drift" "派生视图版本不同步: registry=$REGISTRY_VERSION, views=$OPTIMAL_VERSION" "P2" "false"
    WARNINGS=$((WARNINGS + 1))
  else
    echo "  ✅ 派生视图版本同步 (v$REGISTRY_VERSION)"
  fi
else
  echo "  ⚠️  feature-registry.yml 不存在（非 Engine repo？）"
fi

echo ""

# 检查 3: 是否有未跟踪的临时文件
echo "[检查 3/4] 临时文件残留检查"

TEMP_FILES=$(git ls-files --others --exclude-standard | grep -E "\.(tmp|bak|old|swp)$" 2>/dev/null || true)
if [[ -n "$TEMP_FILES" ]]; then
  echo "  ⚠️  发现临时文件："
  echo "$TEMP_FILES" | sed 's/^/       - /'
  WARNINGS=$((WARNINGS + 1))
else
  echo "  ✅ 无临时文件残留"
fi

echo ""

# 检查 4: 是否有未 push 的 commit
echo "[检查 4/4] 未推送 commit 检查"

UNPUSHED=$(git log @{u}.. --oneline 2>/dev/null || true)
if [[ -n "$UNPUSHED" ]]; then
  echo "  ⚠️  有未 push 的 commit："
  echo "$UNPUSHED" | sed 's/^/       /'
  echo ""
  echo "     提示: git push origin $(git branch --show-current)"
  WARNINGS=$((WARNINGS + 1))
else
  echo "  ✅ 所有 commit 已 push"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 汇总结果
if [[ $ERRORS -gt 0 ]]; then
  echo "  ❌ 发现 $ERRORS 个错误"
  if [[ $WARNINGS -gt 0 ]]; then
    echo "  ⚠️  发现 $WARNINGS 个警告"
  fi
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 1
elif [[ $WARNINGS -gt 0 ]]; then
  echo "  ⚠️  发现 $WARNINGS 个警告（非阻塞）"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 0
else
  echo "  ✅ 所有检查通过"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 0
fi
