#!/bin/bash
# final-e2e — ledger-hygiene m2 口径修正端到端验收（真 cecelia 库 + 只读复现脚本差分）
# 对应 PRD:81-94 验收点 1-5；测试数据带唯一 tag，trap 清理（验收点 6 的数据清理部分）
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
DB="${DATABASE_URL:-postgresql://localhost/cecelia}"
[ -d packages/brain/node_modules ] || npm --prefix packages/brain ci --prefer-offline >/dev/null 2>&1

m2_debt() {
  node packages/brain/scripts/smoke-ledger-hygiene.mjs | awk -F'|' '/归属完整率/{gsub(/ /,"",$4); print $4; exit}'
}

E2E_TAG=""
cleanup() {
  if [ -n "$E2E_TAG" ]; then
    psql "$DB" -c "DELETE FROM tasks WHERE payload->>'e2e_tag' = '$E2E_TAG'" >/dev/null 2>&1 || true
    psql "$DB" -c "DELETE FROM issues WHERE body = 'e2e-tag:$E2E_TAG'" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

attempt() {
  E2E_TAG="m2-e2e-$$-$RANDOM"
  local D0 D1 D2 D3

  # 1. 基线（PRD 验收点 1）
  D0=$(m2_debt)
  [[ "$D0" =~ ^[0-9]+$ ]] || { echo "FAIL: 基线 m2 debt 非数字: $D0"; return 2; }

  # 2. 注入三类噪声（PRD 验收点 2；均无 journey 归属；status=completed 防被 tick 调度）
  psql "$DB" -v ON_ERROR_STOP=1 -q \
    -c "INSERT INTO tasks (title, task_type, status, payload) VALUES ('headed-smoke-test', 'harness_initiative', 'completed', jsonb_build_object('smoke_tag', '$E2E_TAG', 'e2e_tag', '$E2E_TAG'))" \
    -c "INSERT INTO tasks (title, task_type, status, payload) VALUES ('[紧急] issue: [ledger-hygiene] 归属完整率 欠账上升 e2e 注入', 'dev', 'completed', jsonb_build_object('e2e_tag', '$E2E_TAG'))" \
    -c "INSERT INTO issues (title, priority, status, sub_area, body, journey_id) VALUES ('[ledger-hygiene] 归属完整率 e2e 注入噪声', 'P2', 'In progress', 'brain', 'e2e-tag:$E2E_TAG', NULL)"

  # 3. 重算：三类噪声全部被排除 → debt 不变（PRD 验收点 3；smoke task 同时覆盖验收点 5 —
  #    旧口径它会在 attribution_harness 子查询再 +1，D1 == D0 即证明该子项已停计且不双重计数）
  D1=$(m2_debt)
  [ "$D1" -eq "$D0" ] || { echo "DRIFT: 噪声注入后 debt $D0 -> $D1 (应不变)"; return 1; }

  # 4. 注入真实归属缺失 task → 恰 +1（PRD 验收点 4：排除不误伤）
  psql "$DB" -v ON_ERROR_STOP=1 -q \
    -c "INSERT INTO tasks (title, task_type, status, payload) VALUES ('e2e 真实业务任务-归属缺失', 'dev', 'completed', jsonb_build_object('e2e_tag', '$E2E_TAG'))"
  D2=$(m2_debt)
  [ "$D2" -eq $((D0 + 1)) ] || { echo "DRIFT: 真实缺失注入后 debt $D0 -> $D2 (应恰 +1)"; return 1; }

  # 5. attribution_harness 停计 + 双重计数消除（PRD 验收点 5）：
  #    无 smoke_tag、无 ability_id、无 journey_id 的 harness 任务只计 1 次（旧口径 +2）
  psql "$DB" -v ON_ERROR_STOP=1 -q \
    -c "INSERT INTO tasks (title, task_type, status, payload) VALUES ('e2e harness 真实归属缺失', 'harness_initiative', 'completed', jsonb_build_object('e2e_tag', '$E2E_TAG'))"
  D3=$(m2_debt)
  [ "$D3" -eq $((D0 + 2)) ] || { echo "DRIFT: harness 缺失注入后 debt $D0 -> $D3 (应累计恰 +2，+3 即双重计数未消除)"; return 1; }

  echo "PASS D0=$D0 D1=$D1 D2=$D2 D3=$D3"
  return 0
}

# 生产库存在并发写入（brain_auto 建 task 等）可能恰落在测量间隙造成差分漂移：
# 允许整场景重试一次（每次新 tag + 先清理）；重试仍失败 = FAIL，不兜底放行
for run in 1 2; do
  RC=0
  attempt || RC=$?
  if [ "$RC" -eq 0 ]; then
    echo "✅ Golden Path m2 口径验证通过"
    exit 0
  fi
  [ "$RC" -eq 2 ] && exit 1
  cleanup
  echo "attempt $run 差分漂移，重试一次排除并发干扰"
done
echo "FAIL: 两次尝试均未通过 m2 口径差分验收"
exit 1
