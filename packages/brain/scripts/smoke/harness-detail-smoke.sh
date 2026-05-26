#!/usr/bin/env bash
# harness-detail smoke — 验证 GET /initiative/:id/detail 端点静态检查（CI-safe，无需真服务器）
set -euo pipefail

ROUTES_FILE="packages/brain/src/routes/harness.js"
TEST_FILE="packages/brain/src/__tests__/harness-detail.test.js"

echo "[harness-detail-smoke] 检查路由文件存在..."
[ -f "$ROUTES_FILE" ] || { echo "FAIL: $ROUTES_FILE not found"; exit 1; }

echo "[harness-detail-smoke] 检查 /initiative/:id/detail 路由注册..."
grep -q "initiative/:id/detail" "$ROUTES_FILE" || { echo "FAIL: /initiative/:id/detail 路由未注册"; exit 1; }

echo "[harness-detail-smoke] 检查响应 6 字段 schema..."
grep -q "initiative_id" "$ROUTES_FILE" || { echo "FAIL: initiative_id 字段缺失"; exit 1; }
grep -q "step_timing" "$ROUTES_FILE" || { echo "FAIL: step_timing 字段缺失"; exit 1; }
grep -q "screenshot_urls" "$ROUTES_FILE" || { echo "FAIL: screenshot_urls 字段缺失"; exit 1; }
grep -q "prd_content" "$ROUTES_FILE" || { echo "FAIL: prd_content 字段缺失"; exit 1; }
grep -q "contract_content" "$ROUTES_FILE" || { echo "FAIL: contract_content 字段缺失"; exit 1; }
grep -q "gan_rounds" "$ROUTES_FILE" || { echo "FAIL: gan_rounds 字段缺失"; exit 1; }

echo "[harness-detail-smoke] 检查 404 处理..."
grep -q "404" "$ROUTES_FILE" || { echo "FAIL: 404 处理缺失"; exit 1; }

echo "[harness-detail-smoke] 检查单测文件存在..."
[ -f "$TEST_FILE" ] || { echo "FAIL: $TEST_FILE not found"; exit 1; }

echo "[harness-detail-smoke] 检查单测含 describe + mock pool..."
grep -q "describe" "$TEST_FILE" || { echo "FAIL: describe 块缺失"; exit 1; }
grep -q "mockPool" "$TEST_FILE" || { echo "FAIL: mock pool 缺失"; exit 1; }

echo "[harness-detail-smoke] ALL CHECKS PASSED"
exit 0
