#!/usr/bin/env bash
# Smoke: never_started 假杀修复（task 94ee0ec4）——
# headed_manual 派发排除 + liveness kill 授权 spawn 证据校验 + 处置留痕 结构校验
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$ROOT_DIR"

# 1. 留痕 helper 存在且导出
[ -f "packages/brain/src/lib/task-event-log.js" ] \
  || { echo "FAIL: lib/task-event-log.js 不存在"; exit 1; }
grep -q "export async function recordTaskEventSafe" packages/brain/src/lib/task-event-log.js \
  || { echo "FAIL: recordTaskEventSafe 未导出"; exit 1; }
echo "OK: task-event-log.js recordTaskEventSafe 已导出"

# 2. 派发谓词排除 headed_manual（无头派发消费语义）
grep -q "headed_manual" packages/brain/src/dispatch-helpers.js \
  || { echo "FAIL: selectNextDispatchableTask 缺 headed_manual 排除"; exit 1; }
echo "OK: dispatch-helpers.js headed_manual 派发排除存在"

# 3. probeTaskLiveness 零 spawn 证据安全回队分支
grep -q "hasSpawnEvidence" packages/brain/src/executor.js \
  || { echo "FAIL: executor.js 缺 spawn 证据校验"; exit 1; }
grep -q "watchdog_safe_requeue" packages/brain/src/executor.js \
  || { echo "FAIL: executor.js 缺 watchdog_safe_requeue 留痕"; exit 1; }
grep -q "watchdog_headed_requeue" packages/brain/src/executor.js \
  || { echo "FAIL: executor.js 缺 watchdog_headed_requeue 留痕"; exit 1; }
echo "OK: executor.js 零证据安全回队 + 留痕分支存在"

# 4. requeueTask 处置留痕
grep -q "watchdog_requeue" packages/brain/src/executor.js \
  || { echo "FAIL: requeueTask 缺 watchdog_requeue 留痕"; exit 1; }
grep -q "watchdog_quarantine" packages/brain/src/executor.js \
  || { echo "FAIL: requeueTask 缺 watchdog_quarantine 留痕"; exit 1; }
echo "OK: requeueTask 处置留痕存在"

# 5. dispatcher spawn 失败 fail-closed 回执
grep -q "recordTaskEventSafe" packages/brain/src/dispatcher.js \
  || { echo "FAIL: dispatcher.js 缺 spawn 失败 task_events 留痕"; exit 1; }
echo "OK: dispatcher.js spawn 失败 fail-closed 留痕存在"

# 6. 回归测试永久入 CI（毕业目录 + vitest.config.js 登记）
[ -f "packages/brain/src/__tests__/integration/liveness-queued-never-spawned.integration.test.js" ] \
  || { echo "FAIL: 回归测试未入 CI 测试族目录"; exit 1; }
grep -q "liveness-queued-never-spawned.integration.test.js" packages/brain/vitest.config.js \
  || { echo "FAIL: 未登记 POSTGRES_INTEGRATION_TESTS"; exit 1; }
echo "OK: 回归测试已毕业入 CI"

echo "PASS: liveness-queued-never-spawned smoke 全过"
