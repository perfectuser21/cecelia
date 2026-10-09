#!/bin/bash
# run-all-initial-scans.sh — 初始化填充 dev management tables
# journeys / journey_features 由 Brain 写、Notion 只读（notion_projection_map），不再从 Notion 反向同步；
# journey_steps 已于 2026-06-09 废弃。
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Dev Registry 初始填充 ==="

echo "[1/5] sync issues from Notion..."
node "$SCRIPT_DIR/notion-to-brain/sync-issues.js"

echo "[2/5] scan api registry..."
node "$SCRIPT_DIR/scan/scan-api-registry.js"

echo "[3/5] scan db schema registry..."
node "$SCRIPT_DIR/scan/scan-db-schema.js"

echo "[4/5] scan test registry..."
node "$SCRIPT_DIR/scan/scan-test-registry.js"

echo "[5/5] scan skills..."
node "$SCRIPT_DIR/scan/scan-skills.js"

echo "=== 全部完成 ==="
