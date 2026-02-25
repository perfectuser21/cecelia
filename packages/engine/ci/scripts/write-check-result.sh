#!/usr/bin/env bash
# =============================================================================
# write-check-result.sh - 写入单个 check 结果 JSON
# =============================================================================
#
# 用法：
#   bash ci/scripts/write-check-result.sh <name> <ok> <exit_code> [command] [summary]
#
# 示例：
#   bash ci/scripts/write-check-result.sh typecheck true 0 "npm run typecheck"
#   bash ci/scripts/write-check-result.sh test false 1 "npm run test" "3 tests failed"
#
# 输出：
#   ci/out/checks/<name>.json
#
# =============================================================================

set -euo pipefail

NAME="${1:-}"
OK="${2:-false}"
EXIT_CODE="${3:-1}"
COMMAND="${4:-}"
SUMMARY="${5:-}"

if [[ -z "$NAME" ]]; then
  echo "Usage: write-check-result.sh <name> <ok> <exit_code> [command] [summary]"
  exit 1
fi

# 确保目录存在
CHECKS_DIR="ci/out/checks"
mkdir -p "$CHECKS_DIR"

OUTPUT_FILE="$CHECKS_DIR/${NAME}.json"

# 生成 JSON
jq -n \
  --arg name "$NAME" \
  --argjson ok "$OK" \
  --argjson exit_code "$EXIT_CODE" \
  --arg timestamp "$(date -Iseconds)" \
  --arg command "$COMMAND" \
  --arg summary "$SUMMARY" \
  '{
    name: $name,
    ok: $ok,
    exit_code: $exit_code,
    timestamp: $timestamp,
    details: {
      command: $command,
      summary: $summary
    }
  }' > "$OUTPUT_FILE"

echo "✅ Check result written: $OUTPUT_FILE"
