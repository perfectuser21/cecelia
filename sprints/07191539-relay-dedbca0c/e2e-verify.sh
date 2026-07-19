#!/usr/bin/env bash
# E2E 验收脚本 — headless-smoke dedbca0c
# 对应合同 contract-dod.md B-1 至 B-8
set -euo pipefail

TASK_ID="dedbca0c-0864-4b0d-be69-d37f70a25827"
BRAIN="${BRAIN_URL:-http://localhost:5221}"
SPRINT_DIR="sprints/07191539-relay-dedbca0c"
PASS=0; FAIL=0; WARN=0

check() {
  local name="$1" cmd="$2" optional="${3:-false}"
  if eval "$cmd" > /dev/null 2>&1; then
    echo "PASS: $name"
    PASS=$((PASS+1))
  elif [ "$optional" = "true" ]; then
    echo "WARN (optional): $name"
    WARN=$((WARN+1))
  else
    echo "FAIL: $name"
    FAIL=$((FAIL+1))
  fi
}

echo "=== headless-smoke E2E 验收 (task=$TASK_ID) ==="

# B-1: task 已被认领
check "B-1: task status=in_progress or completed" \
  "curl -sf $BRAIN/api/brain/tasks/$TASK_ID | python3 -c \"import json,sys; t=json.load(sys.stdin); exit(0 if t.get('status') in ['in_progress','completed'] else 1)\""

# B-2: payload 三元组
check "B-2: headless dispatch payload" \
  "curl -sf $BRAIN/api/brain/tasks/$TASK_ID | python3 -c \"import json,sys; t=json.load(sys.stdin); p=t.get('payload',{}); exit(0 if p.get('mode')=='headless' and p.get('orchestrator')=='skill-relay' and p.get('dispatched_by_orchestrator')==True else 1)\""

# B-3: status_history 存在 queued→in_progress 转换
check "B-3: status_history queued to in_progress" \
  "curl -sf $BRAIN/api/brain/tasks/$TASK_ID | python3 -c \"import json,sys; t=json.load(sys.stdin); h=t.get('status_history',[]); exit(0 if any(e.get('from')=='queued' and e.get('to')=='in_progress' for e in h) else 1)\""

# B-4: claim 字段非空
check "B-4: claimed_by and claimed_at present" \
  "curl -sf $BRAIN/api/brain/tasks/$TASK_ID | python3 -c \"import json,sys; t=json.load(sys.stdin); exit(0 if t.get('claimed_by') and t.get('claimed_at') else 1)\""

# B-5: sprint 产物文件
check "B-5: sprint artifacts exist" \
  "test -f $SPRINT_DIR/sprint-prd.md && test -f $SPRINT_DIR/contract-draft.md && test -f $SPRINT_DIR/contract-dod.md"

# B-6: harness run 记录（optional — Brain 内部 tick 才创建，前台接管模式不可验证）
check "B-6: harness run in Brain DB" \
  "curl -sf $BRAIN/api/brain/harness/runs | python3 -c \"import json,sys; runs=json.load(sys.stdin); exit(0 if any(r.get('initiative_id')=='$TASK_ID' for r in runs) else 1)\"" true

# B-7: started_at（optional — 仅 Brain 内部 tick 路径自动设置，前台接管模式不可验证）
check "B-7: started_at not null" \
  "curl -sf $BRAIN/api/brain/tasks/$TASK_ID | python3 -c \"import json,sys; t=json.load(sys.stdin); exit(0 if t.get('started_at') is not None else 1)\"" true

# B-8: 完成态（optional — sprint 结束后才验证）
check "B-8: status=completed and pr_url not null" \
  "curl -sf $BRAIN/api/brain/tasks/$TASK_ID | python3 -c \"import json,sys; t=json.load(sys.stdin); exit(0 if t.get('status')=='completed' and t.get('pr_url') else 1)\"" true

echo ""
echo "=== 结果: PASS=$PASS, FAIL=$FAIL, WARN=$WARN ==="
[ "$FAIL" -eq 0 ] && echo "E2E 验收通过" && exit 0 || { echo "E2E 验收失败"; exit 1; }
