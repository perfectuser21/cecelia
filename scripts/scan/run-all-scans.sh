#!/usr/bin/env bash
# 照相层全量重扫统一入口(刀0,2026-07-18)。
# host cron 安装说明(SSOT,系统时区 America/Los_Angeles,LA 05:00 = 北京 20:00):
#   0 5 * * * cd /Users/administrator/perfect21/cecelia && bash scripts/scan/run-all-scans.sh >> /tmp/registry-scan.log 2>&1
# 哨兵:本脚本停摆 >24h 后,GET /api/brain/registry?type=api|db_schema|test 自动 stale:true。
#
# 刀0修复(2026-08-11): cron PATH 不含 node，需用 nvm/asdf 或 which node 确定路径。
set -uo pipefail
cd "$(dirname "$0")/../.."

# 解析 node 全路径，优先走 nvm/asdf，兜底 PATH 查找
NODE_BIN=""
for candidate in \
  "$HOME/.nvm/versions/node/$(cat "$HOME/.nvmrc" 2>/dev/null || echo 'v20')/bin/node" \
  "$HOME/.asdf/shims/node" \
  "$(command -v node 2>/dev/null || true)"; do
  if [ -x "$candidate" ]; then
    NODE_BIN="$candidate"
    break
  fi
done

if [ -z "$NODE_BIN" ]; then
  # 最后尝试常见安装路径
  for d in /usr/local/bin /usr/bin /opt/homebrew/bin; do
    if [ -x "$d/node" ]; then NODE_BIN="$d/node"; break; fi
  done
fi

if [ -z "$NODE_BIN" ]; then
  echo "FATAL: 找不到 node 可执行文件，扫描中止"
  exit 1
fi

echo "=== registry photo-layer scan $(date '+%F %T %Z') ==="
echo "node: $NODE_BIN ($("$NODE_BIN" --version 2>/dev/null || echo '?'))"

if [ "$(git branch --show-current)" = "main" ] && [ -z "$(git status --porcelain)" ]; then
  git pull --ff-only 2>&1 || echo "WARN: git pull 失败,用当前工作区继续"
else
  echo "WARN: 非 main 分支或工作区不干净,跳过 git pull"
fi

FAIL=0
for s in scan-api-registry.js scan-db-schema.js scan-test-registry.js scan-graph.mjs; do
  if "$NODE_BIN" "scripts/scan/${s}"; then
    echo "OK: ${s}"
  else
    echo "FAIL: ${s}"
    FAIL=1
  fi
done
exit $FAIL
