#!/usr/bin/env bash
# drift-sentinel-smoke.sh — G2 部署漂移哨兵 smoke 验证
# 验证 drift-sentinel.js 文件存在，核心导出符号正确，tick-runner.js 已注册
set -euo pipefail

SENTINEL_FILE="packages/brain/src/cron/drift-sentinel.js"
TICK_RUNNER="packages/brain/src/tick-runner.js"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"

cd "$REPO_ROOT"

echo "[drift-sentinel-smoke] 检查文件存在..."
[ -f "$SENTINEL_FILE" ] || { echo "FAIL: $SENTINEL_FILE 不存在"; exit 1; }
echo "  OK: $SENTINEL_FILE"

echo "[drift-sentinel-smoke] 检查核心导出（runDriftCheck / DRIFT_SENTINEL_INTERVAL_MS / DRIFT_WINDOW_MS）..."
grep -q "export.*runDriftCheck" "$SENTINEL_FILE" || { echo "FAIL: runDriftCheck 未导出"; exit 1; }
grep -q "export.*DRIFT_SENTINEL_INTERVAL_MS" "$SENTINEL_FILE" || { echo "FAIL: DRIFT_SENTINEL_INTERVAL_MS 未导出"; exit 1; }
grep -q "export.*DRIFT_WINDOW_MS" "$SENTINEL_FILE" || { echo "FAIL: DRIFT_WINDOW_MS 未导出"; exit 1; }
echo "  OK: 导出符号齐全"

echo "[drift-sentinel-smoke] 检查审计日志格式..."
grep -q "\[drift_check\]" "$SENTINEL_FILE" || { echo "FAIL: 审计日志 [drift_check] 格式缺失"; exit 1; }
grep -q "verdict=ok" "$SENTINEL_FILE" || { echo "FAIL: verdict=ok 分支缺失"; exit 1; }
grep -q "verdict=drifting" "$SENTINEL_FILE" || { echo "FAIL: verdict=drifting 分支缺失"; exit 1; }
grep -q "verdict=redeploying" "$SENTINEL_FILE" || { echo "FAIL: verdict=redeploying 分支缺失"; exit 1; }
grep -q "verdict=escalated" "$SENTINEL_FILE" || { echo "FAIL: verdict=escalated 分支缺失"; exit 1; }
echo "  OK: 审计日志 verdict 枚举齐全"

echo "[drift-sentinel-smoke] 检查 INV-02（brain-deploy.sh 调用）..."
grep -q "brain-deploy.sh" "$SENTINEL_FILE" || { echo "FAIL: brain-deploy.sh 未在 sentinel 中调用（INV-02）"; exit 1; }
echo "  OK: brain-deploy.sh 调用存在"

echo "[drift-sentinel-smoke] 检查 INV-01（无路径判据，排除注释行）..."
# 排除以 * 或 # 开头的注释行，只检查实际代码中是否有路径判据
PATH_FILTER_COUNT=$(grep -E "changed_paths|file.*filter|path.*filter" "$SENTINEL_FILE" \
  | grep -vcE "^\s*[*/]" || true)
[ "$PATH_FILTER_COUNT" -eq 0 ] || { echo "FAIL: 检测到路径判据（代码中，非注释，$PATH_FILTER_COUNT 处）（INV-01）"; exit 1; }
echo "  OK: 无路径判据"

echo "[drift-sentinel-smoke] 检查 tick-runner.js 注册..."
grep -q "drift-sentinel" "$TICK_RUNNER" || { echo "FAIL: drift-sentinel 未在 tick-runner.js 中注册"; exit 1; }
grep -q "runDriftSentinel\|DRIFT_SENTINEL_INTERVAL_MS" "$TICK_RUNNER" || { echo "FAIL: runDriftSentinel 调用缺失"; exit 1; }
echo "  OK: tick-runner.js 注册确认"

echo "[drift-sentinel-smoke] 检查防抖窗口 30min（1800000ms）..."
grep -q "1800000\|30 \* 60 \* 1000\|DRIFT_WINDOW_MS" "$SENTINEL_FILE" || { echo "FAIL: 30min 防抖窗口常量缺失"; exit 1; }
echo "  OK: 防抖窗口配置正确"

echo "[drift-sentinel-smoke] 检查 dedupeKey drift-escalated..."
grep -q "drift-escalated" "$SENTINEL_FILE" || { echo "FAIL: dedupeKey=drift-escalated 缺失（B4）"; exit 1; }
echo "  OK: dedupeKey=drift-escalated"

echo "[drift-sentinel-smoke] ALL PASS"
