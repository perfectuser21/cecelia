#!/usr/bin/env bash
# 照相层全量重扫统一入口(刀0,2026-07-18)。
# host cron 安装说明(SSOT,系统时区 America/Los_Angeles,LA 05:00 = 北京 20:00):
#   0 5 * * * cd /Users/administrator/perfect21/cecelia && bash scripts/scan/run-all-scans.sh >> /tmp/registry-scan.log 2>&1
# 哨兵:本脚本停摆 >24h 后,GET /api/brain/registry?type=api|db_schema|test 自动 stale:true。
set -uo pipefail
cd "$(dirname "$0")/../.."

echo "=== registry photo-layer scan $(date '+%F %T %Z') ==="

if [ "$(git branch --show-current)" = "main" ] && [ -z "$(git status --porcelain)" ]; then
  git pull --ff-only 2>&1 || echo "WARN: git pull 失败,用当前工作区继续"
else
  echo "WARN: 非 main 分支或工作区不干净,跳过 git pull"
fi

FAIL=0
for s in scan-api-registry.js scan-db-schema.js scan-test-registry.js scan-graph.mjs; do
  if node "scripts/scan/${s}"; then
    echo "OK: ${s}"
  else
    echo "FAIL: ${s}"
    FAIL=1
  fi
done
exit $FAIL
