#!/usr/bin/env bash
# 回归守卫：Brain 告警 task_type="alert" 非法枚举导致静默失败（2026-09-18）
# 根因：Brain tasks 表 CHECK constraint tasks_task_type_check 不含 "alert"，
# curl 直测证实每次 POST 都被 API 拒绝（{"error":"Invalid field value",...}），
# 又被 janitor.sh 里 `2>/dev/null || true` 吞掉——CPU/磁盘/孤儿分支三处告警
# 从写下起就从未真正推送过一条 Brain 任务，长期静默失效。
# 合法枚举值 harness_intervention 已实测（本 session 曾用它成功建任务）。
# 本测试直接扫描 janitor.sh 源码里所有 Brain /api/brain/tasks POST payload
# 的 task_type 字段值——出现 "alert" 必须报红。

set -uo pipefail

PASS=0
FAIL=0

ok() { echo "PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

JANITOR="$(dirname "$0")/../../janitor.sh"
if [ ! -f "$JANITOR" ]; then
  echo "ERROR: janitor.sh not found at $JANITOR"
  exit 1
fi

# 断言 1：源码里不得再出现非法的 task_type":"alert
ALERT_HITS=$(grep -c 'task_type\\":\\"alert\\"' "$JANITOR" 2>/dev/null)
ALERT_HITS=${ALERT_HITS:-0}
if [ "$ALERT_HITS" -eq 0 ]; then
  ok "janitor.sh 中无非法 task_type=\"alert\"（曾有 3 处：CPU/孤儿分支/磁盘告警）"
else
  fail "janitor.sh 中仍有 $ALERT_HITS 处非法 task_type=\"alert\"（Brain CHECK constraint 会拒绝，被吞掉后静默失效）"
fi

# 断言 2：三处存量告警必须都改用合法枚举 harness_intervention
HI_HITS=$(grep -c 'task_type\\":\\"harness_intervention\\"' "$JANITOR" 2>/dev/null)
HI_HITS=${HI_HITS:-0}
if [ "$HI_HITS" -ge 3 ]; then
  ok "janitor.sh 中 harness_intervention 出现 $HI_HITS 次（≥3，覆盖 CPU/孤儿分支/磁盘三处存量告警）"
else
  fail "janitor.sh 中 harness_intervention 只出现 $HI_HITS 次，预期至少 3 次（CPU/孤儿分支/磁盘各一处）"
fi

echo "结果: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
