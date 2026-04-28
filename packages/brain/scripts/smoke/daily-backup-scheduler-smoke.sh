#!/usr/bin/env bash
# Smoke: daily-backup-scheduler — 每日 02:00 自动 DB 备份调度
# 验证：Brain 运行中时调用 /api/brain/backup/trigger-now 能创建 trigger_backup 任务
# CI 新 DB 无历史任务，故 force 模式一定可以触发（幂等：再次调用返回 alreadyDone=true）
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "[daily-backup-smoke] 1. 检查 Brain 健康"
STATUS=$(curl -sf "${BRAIN_URL}/api/brain/health" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','unknown'))")
if [[ "$STATUS" != "ok" && "$STATUS" != "healthy" ]]; then
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

echo "[daily-backup-smoke] 4. 触发强制备份（force=true），验证能创建 trigger_backup 任务"
RESULT=$(curl -sf -X POST "${BRAIN_URL}/api/brain/backup/trigger-now" \
  -H "Content-Type: application/json" \
  -d '{"force":true}' 2>/dev/null || echo '{"error":"curl_failed"}')
echo "[daily-backup-smoke] trigger-now result: ${RESULT}"

ERROR=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',''))" 2>/dev/null || echo "parse_error")
if [[ -n "$ERROR" && "$ERROR" != "None" && "$ERROR" != "" ]]; then
  echo "[daily-backup-smoke] FAIL: trigger-now error=${ERROR}"
  exit 1
fi

echo "[daily-backup-smoke] 5. 验证 DB 中有 trigger_backup 任务（最近 5 分钟内）"
COUNT=$(psql -U cecelia -d cecelia -t -c "
  SELECT COUNT(*) FROM tasks
  WHERE task_type = 'trigger_backup'
    AND created_at >= NOW() - INTERVAL '5 minutes';
" 2>/dev/null | tr -d ' \n' || echo "0")
if [[ -z "$COUNT" || "$COUNT" -eq 0 ]]; then
  echo "[daily-backup-smoke] FAIL: 未在 DB 中找到 trigger_backup 任务"
  exit 1
fi
echo "[daily-backup-smoke] DB 中 trigger_backup 任务 count=${COUNT} ✓"

echo "[daily-backup-smoke] PASS ✓"
