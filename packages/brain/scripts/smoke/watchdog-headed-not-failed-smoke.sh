#!/usr/bin/env bash
# Smoke: harness-watchdog 不得把有头会话判成 failed（终端态不可恢复）
#
# 2026-09-16 实证：有头 /dev 任务被 work-router 改写成 task_type=harness_initiative，
# 而有头执行不建 initiative_runs 行；watchdog 的 never-started 豁免只看 claimed_at
# （开工那一刻），认不出"还在干活"——一个会话认真干 44/118 分钟就被判死。
# 判 failed 是终端态（状态机 allowed:[]），API 无法回正，只能直写 DB。本次会话 4 个
# 有头任务全中，全部人工直写库才救回来。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$ROOT_DIR"

WD="packages/brain/src/harness-watchdog.js"

echo "[watchdog-headed-not-failed-smoke] 1. never-started 分支能识别有头会话"
if ! grep -q "isHeaded" "$WD"; then
  echo "FAIL: never-started 分支未做有头识别，有头任务会被一刀切判 failed"
  exit 1
fi
if ! grep -q "executor_kind === 'headed-session'" "$WD"; then
  echo "FAIL: 未按 executor_kind 识别有头会话"
  exit 1
fi
echo "OK: 有头识别存在"

echo "[watchdog-headed-not-failed-smoke] 2. lock 查询必须取到判定所需字段"
if ! grep -q "SELECT id, status, claimed_at, claimed_by, executor_kind" "$WD"; then
  echo "FAIL: lock 查询未取 claimed_by/executor_kind，isHeaded 永远判不出来"
  exit 1
fi
echo "OK: 判定字段齐全"

echo "[watchdog-headed-not-failed-smoke] 3. 有头分支落 blocked 且带 blocked_at"
if ! grep -A6 "isHeaded" "$WD" | grep -q "status = 'blocked'"; then
  echo "FAIL: 有头分支未降级为 blocked"
  exit 1
fi
if ! grep -A8 "status = 'blocked'" "$WD" | grep -q "blocked_at = NOW()"; then
  echo "FAIL: blocked 未带 blocked_at —— 会撞 chk_blocked_at_not_null 约束"
  exit 1
fi
echo "OK: 有头降级 blocked 且带 blocked_at"

echo "[watchdog-headed-not-failed-smoke] 4. 自动流水线路径仍保留 failed（那条是对的）"
if ! grep -q "harness_initiative never started graph" "$WD"; then
  echo "FAIL: 非有头的 failed 路径被误删"
  exit 1
fi
echo "OK: 自动流水线判死路径保留"

echo "[watchdog-headed-not-failed-smoke] 5. 回归测试跑通"
cd packages/brain && npx vitest run src/__tests__/harness-watchdog-never-started.test.js --reporter=basic 2>&1 | tail -5

echo "[watchdog-headed-not-failed-smoke] ALL PASS"
