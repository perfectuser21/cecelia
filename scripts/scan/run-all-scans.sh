#!/usr/bin/env bash
# 照相层全量重扫统一入口(刀0,2026-07-18)。
# host cron 安装说明(SSOT,系统时区 America/Los_Angeles,LA 05:00 = 北京 20:00):
#   0 5 * * * cd /Users/administrator/perfect21/cecelia && bash scripts/scan/run-all-scans.sh >> /tmp/registry-scan.log 2>&1
# 哨兵:本脚本停摆 >24h 后,GET /api/brain/registry?type=api|db_schema|test 自动 stale:true。
set -uo pipefail
cd "$(dirname "$0")/../.."

absolute_executable() {
  local candidate="$1"
  local candidate_dir
  local candidate_name

  if [[ "$candidate" == /* ]]; then
    printf '%s\n' "$candidate"
    return 0
  fi

  candidate_dir=$(dirname "$candidate")
  candidate_name=$(basename "$candidate")
  candidate_dir=$(cd "$candidate_dir" 2>/dev/null && pwd -P) || return 1
  printf '%s/%s\n' "$candidate_dir" "$candidate_name"
}

resolve_node() {
  local candidate=""

  if [[ -n "${NODE_BIN:-}" ]]; then
    candidate="$NODE_BIN"
    if [[ "$candidate" != */* ]]; then
      candidate=$(command -v "$candidate" 2>/dev/null || true)
    fi
    if [[ -n "$candidate" && -x "$candidate" ]]; then
      absolute_executable "$candidate"
      return 0
    fi
  fi

  candidate=$(command -v node 2>/dev/null || true)
  if [[ -n "$candidate" && -x "$candidate" ]]; then
    absolute_executable "$candidate"
    return 0
  fi

  for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

if ! NODE_EXECUTABLE=$(resolve_node); then
  echo "ERROR: 找不到可执行的 Node.js；请设置 NODE_BIN 或将 node 安装到 PATH、/opt/homebrew/bin/node 或 /usr/local/bin/node" >&2
  exit 127
fi

echo "=== registry photo-layer scan $(date '+%F %T %Z') ==="

if [ "$(git branch --show-current)" = "main" ] && [ -z "$(git status --porcelain)" ]; then
  git pull --ff-only 2>&1 || echo "WARN: git pull 失败,用当前工作区继续"
else
  echo "WARN: 非 main 分支或工作区不干净,跳过 git pull"
fi

DEFAULT_SCAN_SCRIPTS=(
  scan-api-registry.js
  scan-db-schema.js
  scan-test-registry.js
  scan-graph.mjs
)
if [[ ${SCAN_SCRIPTS+x} ]]; then
  SCANNERS=()
  read -r -a SCANNERS <<< "$SCAN_SCRIPTS"
else
  SCANNERS=("${DEFAULT_SCAN_SCRIPTS[@]}")
fi

FAIL=0
for s in "${SCANNERS[@]}"; do
  if "$NODE_EXECUTABLE" "scripts/scan/${s}"; then
    echo "OK: ${s}"
  else
    echo "FAIL: ${s}"
    FAIL=1
  fi
done
exit $FAIL
