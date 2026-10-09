#!/usr/bin/env bash
# 每日库体积守卫: 超阈值报红 + 顺手跑 migrations/041 的既有清理函数(生产从未被调度, 表曾涨到 218 万行)
# 用法: bash db-size-check.sh [max_gb]；SKIP_CLEANUP=1 时只查体积不清理(供首刀归档完成前验证用)
set -euo pipefail
MAX_GB="${1:-4}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ "${SKIP_CLEANUP:-0}" != "1" ]]; then
  psql "${DATABASE_URL:-postgres:///cecelia}" -c "SELECT run_periodic_cleanup();" >/dev/null 2>&1 || true
fi
node "$SCRIPT_DIR/../db-slim.mjs" --check --max-db-gb "$MAX_GB"
