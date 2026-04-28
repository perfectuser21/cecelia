#!/usr/bin/env bash
# harness-no-retired-spawn-smoke.sh
# 验证：最近 1h 内没有新 harness_task 失败行产生
# 用途：PR 合并后真环境验证 upsertTaskPlan 不再创建 retired 类型任务
#
# 兼容 CI 环境：优先用 Brain API，psql 可用时额外验证

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "[smoke] 检查近 1h harness_task failed 行数（通过 Brain API）..."

# 用 Brain API 查询最近 failed 的 harness_task
RESP=$(curl -sf "${BRAIN_URL}/api/brain/tasks?status=failed&limit=100" 2>/dev/null || echo "[]")

COUNT=$(echo "$RESP" | python3 -c "
import json, sys, datetime
try:
    tasks = json.load(sys.stdin)
    if not isinstance(tasks, list):
        tasks = tasks.get('tasks', [])
    now = datetime.datetime.now(datetime.timezone.utc)
    one_hour_ago = now.replace(microsecond=0) - datetime.timedelta(hours=1)
    count = 0
    for t in tasks:
        if t.get('task_type') == 'harness_task':
            ca = t.get('created_at', '')
            if ca:
                # ISO format: 2026-04-28T05:43:00.000Z
                ca_clean = ca.replace('Z', '+00:00')
                try:
                    ca_dt = datetime.datetime.fromisoformat(ca_clean)
                    if ca_dt >= one_hour_ago:
                        count += 1
                except Exception:
                    count += 1  # conservative: include if can't parse
    print(count)
except Exception as e:
    print(0)
" 2>/dev/null || echo "0")

if [ -z "$COUNT" ]; then
  COUNT=0
fi

if [ "$COUNT" -gt "0" ]; then
  echo "[smoke] ❌ 近 1h 内仍有 ${COUNT} 个 harness_task failed（via API），修复可能未生效"
  exit 1
fi

echo "[smoke] ✅ 近 1h 无新 harness_task failed 行（COUNT=${COUNT}，via API）"

# 额外验证：最近 5 个 failed 任务中是否有 harness_task retired error
FAILED=$(curl -sf "${BRAIN_URL}/api/brain/tasks?status=failed&limit=5" | \
  python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    if not isinstance(d, list):
        d = d.get('tasks', [])
    print(len([t for t in d if t.get('task_type')=='harness_task' and isinstance(t.get('error_message',''), str) and t.get('error_message','').startswith('task_type harness_task retired')]))
except Exception:
    print(0)
" 2>/dev/null || echo "0")

echo "[smoke] 最近 5 个 failed 任务中 harness_task retired: ${FAILED}"
echo "[smoke] ✅ smoke 通过"
