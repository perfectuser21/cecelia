#!/bin/bash
# run-all-initial-scans.sh — 初始化填充所有 dev management tables
# 顺序重要：journey_steps 依赖 journeys，journey_features 依赖两者
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Dev Registry 初始填充 ==="

echo "[1/8] sync journeys from Notion..."
node "$SCRIPT_DIR/notion-to-brain/sync-journeys.js"

echo "[2/8] sync journey steps from Notion..."
node "$SCRIPT_DIR/notion-to-brain/sync-journey-steps.js"

echo "[3/8] sync journey features from Notion..."
node "$SCRIPT_DIR/notion-to-brain/sync-journey-features.js"

echo "[4/8] sync issues from Notion..."
node "$SCRIPT_DIR/notion-to-brain/sync-issues.js"

echo "[5/8] scan api registry..."
node "$SCRIPT_DIR/scan/scan-api-registry.js"

echo "[6/8] scan db schema registry..."
node "$SCRIPT_DIR/scan/scan-db-schema.js"

echo "[7/8] scan test registry..."
node "$SCRIPT_DIR/scan/scan-test-registry.js"

echo "[8/8] scan skills..."
node "$SCRIPT_DIR/scan/scan-skills.js"

echo "=== 全部完成 ==="
