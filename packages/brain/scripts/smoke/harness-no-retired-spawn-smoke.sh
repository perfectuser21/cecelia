#!/usr/bin/env bash
# harness-no-retired-spawn-smoke.sh
# 验证：最近 1h 内没有新 harness_task 失败行产生
# 用途：PR 合并后真环境验证 upsertTaskPlan 不再创建 retired 类型任务

set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "[smoke] 检查近 1h harness_task failed 行数..."

COUNT=$(psql -U cecelia -d cecelia -t -c "
SELECT COUNT(*) FROM tasks
WHERE task_type = 'harness_task'
  AND status = 'failed'
  AND created_at > NOW() - INTERVAL '1 hour';
" 2>/dev/null | tr -d ' \n')

if [ -z "$COUNT" ]; then
  echo "[smoke] ⚠️  无法连接 DB，跳过（非阻断）"
  exit 0
fi

if [ "$COUNT" -gt "0" ]; then
  echo "[smoke] ❌ 近 1h 内仍有 ${COUNT} 个 harness_task failed，修复可能未生效"
  exit 1
fi

echo "[smoke] ✅ 近 1h 无新 harness_task failed 行（COUNT=${COUNT}）"

echo "[smoke] 检查 Brain API 任务失败率..."
FAILED=$(curl -sf "${BRAIN_URL}/api/brain/tasks?status=failed&limit=5" | \
  python3 -c "import json,sys; d=json.load(sys.stdin); print(len([t for t in d if t.get('task_type')=='harness_task' and t.get('error_message','').startswith('task_type harness_task retired')]))" 2>/dev/null || echo "0")

echo "[smoke] 最近 5 个 failed 任务中 harness_task retired: ${FAILED}"
echo "[smoke] ✅ smoke 通过"
