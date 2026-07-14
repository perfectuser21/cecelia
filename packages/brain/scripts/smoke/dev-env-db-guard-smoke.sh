#!/usr/bin/env bash
# Smoke: cecelia_dev容器 + dev误连生产库guard（刀2，Initiative 0935f962 Task4）
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$ROOT_DIR"

DB_CONFIG="packages/brain/src/db-config.js"

echo "[dev-env-db-guard-smoke] 1. db-config.js 含 dev guard"
if ! grep -q "isDev" "$DB_CONFIG"; then
  echo "FAIL: 缺少 isDev 判断"
  exit 1
fi
if ! grep -q "isDev && dbName === 'cecelia'" "$DB_CONFIG"; then
  echo "FAIL: 缺少 isDev+cecelia 生产库拒绝逻辑"
  exit 1
fi
echo "OK: dev guard 逻辑存在"

echo "[dev-env-db-guard-smoke] 2. docker-compose.dev.yml node-brain-dev 含 NODE_ENV=development"
if ! grep -A10 "container_name: cecelia-node-brain-dev" docker-compose.dev.yml | grep -q "NODE_ENV=development"; then
  echo "FAIL: node-brain-dev 服务缺少 NODE_ENV=development"
  exit 1
fi
echo "OK: NODE_ENV=development 已配置"

echo "[dev-env-db-guard-smoke] 3. 单元测试跑通"
cd packages/brain && npx vitest run src/__tests__/db-config-dev-guard.test.js src/__tests__/db-config-guard.test.js --reporter=verbose 2>&1 | tail -15

echo "[dev-env-db-guard-smoke] ALL PASS"
