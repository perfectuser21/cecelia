#!/usr/bin/env bash
# =============================================================================
# add-manual-verification.sh - 添加手动验证记录
# =============================================================================
#
# 用法：
#   bash ci/scripts/add-manual-verification.sh <id> <actor> <evidence>
#
# 示例：
#   bash ci/scripts/add-manual-verification.sh template-review "John Doe" "已审核模板结构"
#   bash ci/scripts/add-manual-verification.sh rci-review "Jane Smith" "RCI 覆盖率已确认"
#
# 输出：
#   ci/out/manual-verifications.json（累积追加）
#
# =============================================================================

set -euo pipefail

ID="${1:-}"
ACTOR="${2:-}"
EVIDENCE="${3:-}"

if [[ -z "$ID" || -z "$ACTOR" || -z "$EVIDENCE" ]]; then
  echo "Usage: add-manual-verification.sh <id> <actor> <evidence>"
  echo ""
  echo "Example:"
  echo "  bash ci/scripts/add-manual-verification.sh template-review \"John Doe\" \"已审核模板结构\""
  exit 1
fi

# 确保目录存在
OUT_DIR="ci/out"
mkdir -p "$OUT_DIR"

OUT_FILE="$OUT_DIR/manual-verifications.json"

# 如果文件不存在，创建空数组
if [[ ! -f "$OUT_FILE" ]]; then
  echo "[]" > "$OUT_FILE"
fi

# 添加新记录
TIMESTAMP=$(date -Iseconds)
jq \
  --arg id "$ID" \
  --arg actor "$ACTOR" \
  --arg evidence "$EVIDENCE" \
  --arg timestamp "$TIMESTAMP" \
  '. + [{id: $id, actor: $actor, evidence: $evidence, timestamp: $timestamp}]' \
  "$OUT_FILE" > "$OUT_FILE.tmp" && mv "$OUT_FILE.tmp" "$OUT_FILE"

echo "✅ Manual verification added: $ID"
echo "   Actor: $ACTOR"
echo "   Evidence: $EVIDENCE"
echo "   File: $OUT_FILE"
