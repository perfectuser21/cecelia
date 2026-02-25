#!/usr/bin/env bash
set -euo pipefail

# L2A Check: PRD/DoD 结构验证
# P1-1 修复：增强结构检查，防止空内容或低质量产物通过

PRD_FILE="${1:-.prd.md}"
DOD_FILE="${2:-.dod.md}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  L2A 结构验证"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ============================================================================
# PRD 结构检查
# ============================================================================

if [[ ! -f "$PRD_FILE" ]]; then
  echo "❌ PRD 文件不存在: $PRD_FILE"
  exit 1
fi

echo ""
echo "检查 PRD 结构..."

# 检查 1: 最少 3 个 section
SECTION_COUNT=$(grep -c "^## " "$PRD_FILE" || echo "0")
if [[ $SECTION_COUNT -lt 3 ]]; then
  echo "  ❌ PRD 必须有至少 3 个 section (##)"
  echo "     当前: $SECTION_COUNT 个 section"
  echo "     需要: 至少 3 个 section（如：背景、问题、方案）"
  exit 1
fi
echo "  ✅ PRD 包含 $SECTION_COUNT 个 section"

# 检查 2: 每个 section 至少 2 行非空内容
EMPTY_SECTIONS=0
SECTION_LINES=$(grep -n "^## " "$PRD_FILE" | cut -d: -f1)
TOTAL_LINES=$(wc -l < "$PRD_FILE")

for LINE_NUM in $SECTION_LINES; do
  # 找到下一个 section 的行号（如果没有就用文件末尾）
  NEXT_LINE=$(echo "$SECTION_LINES" | grep -A 1 "^${LINE_NUM}$" | tail -1)
  if [[ "$NEXT_LINE" == "$LINE_NUM" ]]; then
    NEXT_LINE=$((TOTAL_LINES + 1))
  fi

  # 计算 section 内容行数（排除空行和 section 标题）
  CONTENT_LINES=$(sed -n "${LINE_NUM},$((NEXT_LINE - 1))p" "$PRD_FILE" | \
                  tail -n +2 | \
                  grep -cv "^$" || echo "0")

  if [[ $CONTENT_LINES -lt 2 ]]; then
    SECTION_TITLE=$(sed -n "${LINE_NUM}p" "$PRD_FILE")
    echo "  ⚠️  Section 内容不足: $SECTION_TITLE"
    echo "     当前: $CONTENT_LINES 行，需要至少 2 行非空内容"
    EMPTY_SECTIONS=$((EMPTY_SECTIONS + 1))
  fi
done

if [[ $EMPTY_SECTIONS -gt 0 ]]; then
  echo "  ❌ 发现 $EMPTY_SECTIONS 个内容不足的 section"
  exit 1
fi
echo "  ✅ 所有 section 都有充分内容"

# 检查 3: 必须包含关键字段
REQUIRED_KEYWORDS=("背景\|Background" "问题\|Problem" "方案\|Solution")
MISSING_KEYWORDS=()

for KEYWORD in "${REQUIRED_KEYWORDS[@]}"; do
  if ! grep -qi "$KEYWORD" "$PRD_FILE"; then
    MISSING_KEYWORDS+=("$KEYWORD")
  fi
done

if [[ ${#MISSING_KEYWORDS[@]} -gt 0 ]]; then
  echo "  ⚠️  建议包含关键字段: ${MISSING_KEYWORDS[*]}"
  echo "     （非强制，但建议完整描述背景、问题、方案）"
fi

echo "  ✅ PRD 结构检查通过"

# ============================================================================
# DoD 结构检查
# ============================================================================

if [[ ! -f "$DOD_FILE" ]]; then
  echo "❌ DoD 文件不存在: $DOD_FILE"
  exit 1
fi

echo ""
echo "检查 DoD 结构..."

# 检查 1: 最少 3 个验收项
CHECKBOX_COUNT=$(grep -c "^- \[[ x]\] " "$DOD_FILE" || echo "0")
if [[ $CHECKBOX_COUNT -lt 3 ]]; then
  echo "  ❌ DoD 必须有至少 3 个验收项"
  echo "     当前: $CHECKBOX_COUNT 个验收项"
  echo "     需要: 至少 3 个验收项（确保需求可验收）"
  exit 1
fi
echo "  ✅ DoD 包含 $CHECKBOX_COUNT 个验收项"

# 检查 2: 每个验收项必须有 Test 映射
ITEMS_WITHOUT_TEST=0
TEMP_MISSING=$(mktemp)
grep -n "^- \[[ x]\] " "$DOD_FILE" | while IFS=: read -r LINE_NUM LINE_CONTENT; do
  # 检查后续 5 行内是否有 "Test:" 映射
  HAS_TEST=$(sed -n "${LINE_NUM},$((LINE_NUM + 5))p" "$DOD_FILE" | grep -c "Test:" || echo "0")

  if [[ $HAS_TEST -eq 0 ]]; then
    echo "  ⚠️  验收项缺少 Test 映射: ${LINE_CONTENT:0:60}..."
    echo "1" >> "$TEMP_MISSING"
  fi
done

ITEMS_WITHOUT_TEST=$(wc -l < "$TEMP_MISSING" 2>/dev/null || echo "0")
rm -f "$TEMP_MISSING"

if [[ $ITEMS_WITHOUT_TEST -gt 0 ]]; then
  echo "  ❌ 发现 $ITEMS_WITHOUT_TEST 个验收项缺少 Test 映射"
  echo "     每个验收项必须有 'Test: auto:...' 或 'Test: manual:...'"
  exit 1
fi
echo "  ✅ 所有验收项都有 Test 映射"

# 检查 3: Test 映射格式验证
INVALID_TEST_MAPPINGS=0
while IFS= read -r LINE; do
  # 提取 Test: 后的内容
  TEST_REF=$(echo "$LINE" | sed 's/.*Test: *//' | awk '{print $1}')

  # 验证格式：auto:path 或 manual:description
  if [[ ! "$TEST_REF" =~ ^(auto|manual): ]]; then
    echo "  ⚠️  Test 映射格式无效: $TEST_REF"
    echo "     必须是 'auto:tests/...' 或 'manual:描述'"
    INVALID_TEST_MAPPINGS=$((INVALID_TEST_MAPPINGS + 1))
  fi
done < <(grep "Test:" "$DOD_FILE")

if [[ $INVALID_TEST_MAPPINGS -gt 0 ]]; then
  echo "  ❌ 发现 $INVALID_TEST_MAPPINGS 个无效的 Test 映射"
  exit 1
fi
echo "  ✅ 所有 Test 映射格式正确"

echo "  ✅ DoD 结构检查通过"

# ============================================================================
# 总结
# ============================================================================

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ L2A 结构验证全部通过"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "PRD: $SECTION_COUNT sections, 结构完整"
echo "DoD: $CHECKBOX_COUNT 验收项, Test 映射完整"
echo ""

exit 0
