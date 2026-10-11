#!/usr/bin/env bash
# Smoke: daily-backup-scheduler — 每日 02:00 自动 DB 备份调度
# 验证：调度器接线在；trigger_backup 无可用执行者（location=us 落已退役 Claude 桥接），
# 自派发总闸 F（任务 0a70684f）起 /api/brain/backup/trigger-now 建单被明确拒绝，不再进队无人领
set -euo pipefail

# 真 Brain 写入必须显式授权，并核对本机测试容器。
if ! node "$(dirname "${BASH_SOURCE[0]}")/../lib/smoke-production-guard.mjs" "${BRAIN_URL:-http://localhost:5221}"; then
  exit 0
fi

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "[daily-backup-smoke] 1. 检查 Brain 健康"
STATUS=$(curl -q -sf "${BRAIN_URL}/api/brain/health" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','unknown'))")
if [[ "$STATUS" != "ok" && "$STATUS" != "healthy" && "$STATUS" != "degraded" ]]; then
  echo "[daily-backup-smoke] FAIL: Brain 不健康，status=${STATUS}"
  exit 1
fi
echo "[daily-backup-smoke] Brain 健康 ✓"

echo "[daily-backup-smoke] 2. 验证 daily-backup-scheduler.js 文件存在且导出正确"
node -e "
const fs = require('fs');
const path = require('path');
const file = path.join(process.cwd(), 'packages/brain/src/daily-backup-scheduler.js');
if (!fs.existsSync(file)) {
  console.error('FAIL: daily-backup-scheduler.js 不存在');
  process.exit(1);
}
const content = fs.readFileSync(file, 'utf8');
if (!content.includes('isInDailyBackupWindow')) {
  console.error('FAIL: 缺少 isInDailyBackupWindow 导出');
  process.exit(1);
}
if (!content.includes('scheduleDailyBackup')) {
  console.error('FAIL: 缺少 scheduleDailyBackup 导出');
  process.exit(1);
}
if (!content.includes('DAILY_BACKUP_HOUR_UTC = 18')) {
  console.error('FAIL: 触发时间不是 UTC 18（北京时间 02:00）');
  process.exit(1);
}
console.log('daily-backup-scheduler.js 导出验证通过 ✓');
"

echo "[daily-backup-smoke] 3. 验证 tick-runner.js 已接入备份调度"
node -e "
const fs = require('fs');
const path = require('path');
const file = path.join(process.cwd(), 'packages/brain/src/tick-runner.js');
const content = fs.readFileSync(file, 'utf8');
if (!content.includes('daily-backup-scheduler')) {
  console.error('FAIL: tick-runner.js 未 import daily-backup-scheduler');
  process.exit(1);
}
if (!content.includes('scheduleDailyBackup')) {
  console.error('FAIL: tick-runner.js 未调用 scheduleDailyBackup');
  process.exit(1);
}
console.log('tick-runner.js 接入验证通过 ✓');
"

echo "[daily-backup-smoke] 4. 触发强制备份（force=true）：trigger_backup 无可用执行者，建单闸必须明确拒绝（派发总闸 F，任务 0a70684f）"
RESULT=$(curl -q -sf -X POST "${BRAIN_URL}/api/brain/backup/trigger-now" \
  -H "Content-Type: application/json" \
  -d '{"force":true}' 2>/dev/null || echo '{"error":"curl_failed"}')
echo "[daily-backup-smoke] trigger-now result: ${RESULT}"

ERROR=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error') or d.get('result',{}).get('error') or '')" 2>/dev/null || echo "parse_error")
TRIGGERED=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); r=d.get('result',d); print(r.get('triggered',''))" 2>/dev/null || echo "")
if [[ "$ERROR" != *no_executor_for_task_type* ]]; then
  echo "[daily-backup-smoke] FAIL: 期望 no_executor_for_task_type 明确拒绝，实际 error=${ERROR} triggered=${TRIGGERED}"
  exit 1
fi
echo "[daily-backup-smoke] trigger_backup 建单被明确拒绝（no_executor_for_task_type），不再进队无人领 ✓"

echo "[daily-backup-smoke] 5. 验证没有 queued trigger_backup 卡在队里"
QUEUED=$(curl -q -sf "${BRAIN_URL}/api/brain/tasks?status=queued&task_type=trigger_backup&limit=5" 2>/dev/null \
  | python3 -c "import sys,json; d=json.load(sys.stdin); r=d if isinstance(d,list) else d.get('tasks',[]); print(len(r))" 2>/dev/null || echo "err")
if [[ "$QUEUED" != "0" ]]; then
  echo "[daily-backup-smoke] FAIL: 仍有 queued trigger_backup（${QUEUED}）"
  exit 1
fi
echo "[daily-backup-smoke] 无 queued trigger_backup ✓"

echo "[daily-backup-smoke] PASS ✓"
