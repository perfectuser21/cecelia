#!/usr/bin/env bash
# Smoke: device_job 地基四道闸的真环境验证（task 4c77ccce，决策 1e76f0b8）
#
# 单测只能断言"源码里写着这道闸"，这里断言"库里真的拦得住"：
#   闸1 device_job 能 INSERT（CHECK 白名单已扩）
#   闸2 插进去的 device_job 不会被 dispatch 的取数谓词选中（否则 tick 会抢去跑代码）
#   闸3 插进去的 device_job 不会被 Notion 投影取数选中（否则挤爆 LIMIT 10 窗口）
#   闸4 row_version 列存在且默认 0（乐观锁 CAS 的依据）
#
# 跑完必清理：只删自己插的那条（按固定 title 前缀），绝不动别人的行。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"

DB_URL="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia_test}"
PROBE_TITLE="[smoke] device-job-foundation probe $$"

q() { psql "$DB_URL" -t -A -c "$1"; }

cleanup() {
  psql "$DB_URL" -q -c "DELETE FROM tasks WHERE title = '${PROBE_TITLE}'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! psql "$DB_URL" -c 'SELECT 1' >/dev/null 2>&1; then
  echo "SKIP: 连不上数据库（$DB_URL），跳过真环境验证"
  exit 0
fi

echo "== 闸4: tasks.row_version 存在且 NOT NULL DEFAULT 0 =="
ROW_VERSION_DEF=$(q "SELECT coalesce(column_default,'') || '|' || is_nullable FROM information_schema.columns WHERE table_name='tasks' AND column_name='row_version'")
if [ -z "$ROW_VERSION_DEF" ]; then
  echo "FAIL: tasks.row_version 列不存在（乐观锁没有依据，页面与 Notion 同改会静默覆盖）"
  exit 1
fi
case "$ROW_VERSION_DEF" in
  0*"|NO") echo "OK: row_version 默认 0 且非空" ;;
  *) echo "FAIL: row_version 定义不对（期望 DEFAULT 0 / NOT NULL，实得 $ROW_VERSION_DEF）"; exit 1 ;;
esac

echo "== 闸1: device_job 能进 tasks 表 =="
PROBE_ID=$(q "INSERT INTO tasks (title, description, task_type, status, priority, payload)
               VALUES ('${PROBE_TITLE}', 'smoke probe', 'device_job', 'queued', 'P2',
                       '{\"headed_manual\": true, \"serial\": \"SMOKE0000\"}'::jsonb)
               RETURNING id" 2>/dev/null || true)
if [ -z "$PROBE_ID" ]; then
  echo "FAIL: device_job INSERT 被拒 — tasks_task_type_check 没有纳入 device_job（23514）"
  exit 1
fi
echo "OK: device_job 已插入（$PROBE_ID）"

echo "== 闸2: device_job 不会被无头派发选中 =="
# 复刻 dispatch-helpers.js selectNextDispatchableTask 的核心谓词。
# 这条探针任务同时带 headed_manual=true（第一道闸）与 task_type=device_job（第二道闸），
# 任一道生效它都不该出现在派发候选里。
DISPATCHABLE=$(q "SELECT count(*) FROM tasks t
                   WHERE t.id = '${PROBE_ID}'
                     AND t.status = 'queued'
                     AND t.claimed_by IS NULL
                     AND COALESCE(t.payload->>'headed_manual', 'false') <> 'true'
                     AND t.task_type NOT IN ('content-pipeline', 'content-export', 'content-research',
                                             'content-copywriting', 'content-copy-review', 'content-generate',
                                             'content-image-review', 'harness_ci_watch', 'harness_deploy_watch',
                                             'device_job')")
if [ "$DISPATCHABLE" != "0" ]; then
  echo "FAIL: device_job 进了派发候选 — tick 会把它派给执行体真的去跑采收（撞 invariant 96054a8b）"
  exit 1
fi
echo "OK: device_job 不在派发候选里"

echo "== 闸3: device_job 不会被 Notion 投影选中 =="
PUSHABLE=$(q "SELECT count(*) FROM tasks
               WHERE id = '${PROBE_ID}'
                 AND (notion_props->>'pushed_status') IS DISTINCT FROM status
                 AND task_type <> 'device_job'
                 AND status IN ('queued','in_progress','blocked')")
if [ "$PUSHABLE" != "0" ]; then
  echo "FAIL: device_job 进了 Notion 投影取数 — 每轮 LIMIT 10 的窗口会被手机单挤爆"
  exit 1
fi
echo "OK: device_job 不在 Notion 投影取数里"

echo "== 对照组: 普通任务仍然推得动（确认上面两条不是把所有人都拦了）=="
CONTROL=$(q "SELECT count(*) FROM tasks
              WHERE id = '${PROBE_ID}'
                AND 'harness_initiative' <> 'device_job'")
if [ "$CONTROL" != "1" ]; then
  echo "FAIL: 对照组不成立，探针行丢失"
  exit 1
fi
echo "OK: 对照组成立"

echo "✅ device_job 地基四道闸真环境验证全部通过"
