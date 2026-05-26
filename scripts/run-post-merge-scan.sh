#!/bin/bash
# PR 合并后自动刷新 4 张 registry 表
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SCRIPT_DIR/scan/scan-api-registry.js"   || echo "[scan] api-registry 失败，跳过"
node "$SCRIPT_DIR/scan/scan-db-schema.js"       || echo "[scan] db-schema 失败，跳过"
node "$SCRIPT_DIR/scan/scan-test-registry.js"   || echo "[scan] test-registry 失败，跳过"
node "$SCRIPT_DIR/scan/scan-skills.js"          || echo "[scan] skills 失败，跳过"
echo "[scan] registry 刷新完成"
