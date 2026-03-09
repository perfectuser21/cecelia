#!/bin/bash
# check-prd.sh — 验证 PRD 文件有成功标准章节

BRANCH="${GITHUB_HEAD_REF:-$(git rev-parse --abbrev-ref HEAD)}"
PRD_FILE=".prd-${BRANCH}.md"

# 找 PRD 文件
if [[ ! -f "$PRD_FILE" ]]; then
  # 尝试 task-id 格式
  PRD_FILE=$(ls .prd-task-*.md 2>/dev/null | head -1 || true)
fi

if [[ -z "$PRD_FILE" || ! -f "$PRD_FILE" ]]; then
  echo "No PRD file found — skipping check"
  exit 0
fi

echo "PRD file: $PRD_FILE"

# 检查是否有"成功标准"章节
if ! grep -iE "^#{1,3}[[:space:]]+(成功标准|success criteria|验收标准|acceptance criteria)" "$PRD_FILE" > /dev/null 2>&1; then
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  ❌ HARD GATE FAILED: PRD 缺少成功标准章节"
  echo ""
  echo "  PRD 文件必须包含以下之一的章节标题："
  echo "    ## 成功标准"
  echo "    ## Success Criteria"
  echo "    ## 验收标准"
  echo "    ## Acceptance Criteria"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 1
fi

# 找到成功标准章节的起始行号
START_LINE=$(grep -niE "^#{1,3}[[:space:]]+(成功标准|success criteria|验收标准|acceptance criteria)" "$PRD_FILE" | head -1 | cut -d: -f1)

# 获取当前章节的 # 数量（用于确定章节级别）
SECTION_HASHES=$(sed -n "${START_LINE}p" "$PRD_FILE" | grep -oE "^#{1,3}" | head -1)
SECTION_LEVEL=${#SECTION_HASHES}

# 从 START_LINE+1 开始找下一个同级或更高级标题
TOTAL_LINES=$(wc -l < "$PRD_FILE" | tr -d '[:space:]')
END_LINE=$((TOTAL_LINES + 1))

NEXT_HEADER=$(awk -v start="$((START_LINE + 1))" -v level="$SECTION_LEVEL" '
  NR >= start && /^#+[[:space:]]/ {
    hashes = $0
    gsub(/[^#].*/, "", hashes)
    hlen = length(hashes)
    if (hlen <= level) {
      print NR
      exit
    }
  }
' "$PRD_FILE")

if [[ -n "$NEXT_HEADER" ]]; then
  END_LINE="$NEXT_HEADER"
fi

# 提取章节内容并统计条目数
CRITERIA_COUNT=$(sed -n "$((START_LINE + 1)),$((END_LINE - 1))p" "$PRD_FILE" | \
  grep -cE "^[[:space:]]*([-*]|[0-9]+\.)[[:space:]]+[^[:space:]]" 2>/dev/null || echo "0")

# 确保是纯数字
CRITERIA_COUNT=$(echo "$CRITERIA_COUNT" | tr -d '[:space:]')
CRITERIA_COUNT=${CRITERIA_COUNT:-0}

echo "成功标准条目数: $CRITERIA_COUNT"

if [[ "$CRITERIA_COUNT" -lt 2 ]]; then
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  ❌ HARD GATE FAILED: 成功标准不足 2 条"
  echo ""
  echo "  当前条目数: $CRITERIA_COUNT"
  echo "  要求: 至少 2 条可验证的成功标准"
  echo "  原因: 少于 2 条无法区分是在认真定义目标还是敷衍"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 1
fi

echo "✅ PRD 成功标准检查通过（$CRITERIA_COUNT 条）"
exit 0
