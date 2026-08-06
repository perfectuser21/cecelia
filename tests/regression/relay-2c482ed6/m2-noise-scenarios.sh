#!/bin/bash
# m2-noise-scenarios.sh — ledger-hygiene m2 口径修正真库差分场景（合同 DoD B1-B4 的可执行 oracle）
# 用法: bash sprints/08070516-relay-2c482ed6/tests/m2-noise-scenarios.sh <noise|real-miss|issue-real-miss|harness-once>
# 每场景：读基线 D0 → 注入带唯一 tag 的测试数据 → 重算差分断言 → trap 清理。
# 并发防抖：生产库 brain_auto 写入可能落在测量间隙，整场景允许重试 1 次；二次失败 = FAIL（非兜底放行）。
set -euo pipefail
cd "$(dirname "$0")/../../.."

SCENARIO="${1:?用法: m2-noise-scenarios.sh <noise|real-miss|issue-real-miss|harness-once>}"
DB="${DATABASE_URL:-postgresql://localhost/cecelia}"
[ -d packages/brain/node_modules ] || npm --prefix packages/brain ci --prefer-offline >/dev/null 2>&1

m2_debt() {
  node packages/brain/scripts/smoke-ledger-hygiene.mjs | awk -F'|' '/归属完整率/{gsub(/ /,"",$4); print $4; exit}'
}

TAG=""
cleanup() {
  if [ -n "$TAG" ]; then
    psql "$DB" -c "DELETE FROM tasks WHERE payload->>'e2e_tag' = '$TAG'" >/dev/null 2>&1 || true
    psql "$DB" -c "DELETE FROM issues WHERE body = 'e2e-tag:$TAG'" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

inject_task() { # $1=title $2=task_type $3=extra_payload_kv（可空，形如 'smoke_tag', '<tag>'）
  local extra="${3:-}"
  local payload="jsonb_build_object('e2e_tag', '$TAG'${extra:+, $extra})"
  psql "$DB" -v ON_ERROR_STOP=1 -q \
    -c "INSERT INTO tasks (title, task_type, status, payload) VALUES ('$1', '$2', 'completed', $payload)"
}

attempt() {
  TAG="m2sc-$$-$RANDOM"
  local D0 D1 EXPECT
  D0=$(m2_debt)
  [[ "$D0" =~ ^[0-9]+$ ]] || { echo "FAIL: 基线 m2 debt 非数字: $D0"; return 2; }

  case "$SCENARIO" in
    noise)
      # 三类噪声全排除：自产 issue + 自产 [紧急] task + smoke_tag 冒烟 task → debt 不变
      inject_task 'headed-smoke-test' 'harness_initiative' "'smoke_tag', '$TAG'"
      inject_task '[紧急] issue: [ledger-hygiene] 归属完整率 欠账上升 scenario 注入' 'dev'
      psql "$DB" -v ON_ERROR_STOP=1 -q \
        -c "INSERT INTO issues (title, priority, status, sub_area, body, journey_id) VALUES ('[ledger-hygiene] 归属完整率 scenario 注入噪声', 'P2', 'In progress', 'brain', 'e2e-tag:$TAG', NULL)"
      EXPECT=$D0
      ;;
    real-miss)
      # 真实归属缺失 task 仍被捕捉：无标记、无 journey_id → 恰 +1
      inject_task 'scenario 真实业务任务-归属缺失' 'dev'
      EXPECT=$((D0 + 1))
      ;;
    issue-real-miss)
      # 真实 issue（title 非自产前缀开头）journey_id NULL 仍被捕捉 → 恰 +1
      psql "$DB" -v ON_ERROR_STOP=1 -q \
        -c "INSERT INTO issues (title, priority, status, sub_area, body, journey_id) VALUES ('讨论 [ledger-hygiene] 相关的真实业务问题 scenario', 'P2', 'In progress', 'brain', 'e2e-tag:$TAG', NULL)"
      EXPECT=$((D0 + 1))
      ;;
    harness-once)
      # attribution_harness 停计 + 双重计数消除：无 smoke_tag、无 ability_id、无 journey_id 的
      # harness_initiative 只在 tasks 子查询计 1 次（旧口径 +2）
      inject_task 'scenario harness 真实归属缺失' 'harness_initiative'
      EXPECT=$((D0 + 1))
      ;;
    *)
      echo "FAIL: 未知场景 $SCENARIO"; return 2 ;;
  esac

  D1=$(m2_debt)
  if [ "$D1" -eq "$EXPECT" ]; then
    echo "PASS scenario=$SCENARIO D0=$D0 D1=$D1 expect=$EXPECT"
    return 0
  fi
  echo "DRIFT scenario=$SCENARIO debt $D0 -> $D1 (期望 $EXPECT)"
  return 1
}

for run in 1 2; do
  RC=0
  attempt || RC=$?
  if [ "$RC" -eq 0 ]; then
    echo "✅ m2 场景 $SCENARIO 通过"
    exit 0
  fi
  [ "$RC" -eq 2 ] && exit 1
  cleanup
  echo "attempt $run 差分漂移，重试一次排除并发干扰"
done
echo "FAIL: 场景 $SCENARIO 两次尝试均未通过"
exit 1
