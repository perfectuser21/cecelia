# Contract DoD — headless-smoke dedbca0c

## DoD 条目

- [ ] [BEHAVIOR] B-1: task status 在 harness 接管后为 in_progress 或 completed
  - manual:bash: curl -sf http://localhost:5221/api/brain/tasks/dedbca0c-0864-4b0d-be69-d37f70a25827 | jq -e '.status == "in_progress" or .status == "completed"'

- [ ] [BEHAVIOR] B-2: task payload 包含 headless dispatch 三元组（mode=headless, orchestrator=skill-relay, dispatched_by_orchestrator=true）
  - manual:bash: curl -sf http://localhost:5221/api/brain/tasks/dedbca0c-0864-4b0d-be69-d37f70a25827 | jq -e '.payload.mode == "headless" and .payload.orchestrator == "skill-relay" and .payload.dispatched_by_orchestrator == true'

- [ ] [BEHAVIOR] B-3: status_history 存在 queued → in_progress 转换记录（证明 harness 正确接管）
  - manual:bash: curl -sf http://localhost:5221/api/brain/tasks/dedbca0c-0864-4b0d-be69-d37f70a25827 | jq -e '[.status_history[] | select(.from == "queued" and .to == "in_progress")] | length > 0'

- [ ] [BEHAVIOR] B-4: claimed_by 非空且 claimed_at 有时间戳（证明 harness session 已认领任务）
  - manual:bash: curl -sf http://localhost:5221/api/brain/tasks/dedbca0c-0864-4b0d-be69-d37f70a25827 | jq -e '.claimed_by != null and .claimed_at != null'

- [ ] [BEHAVIOR] B-5: sprint 目录产物存在（sprint-prd.md + contract-draft.md + contract-dod.md）
  - manual:bash: test -f sprints/07191539-relay-dedbca0c/sprint-prd.md && test -f sprints/07191539-relay-dedbca0c/contract-draft.md && test -f sprints/07191539-relay-dedbca0c/contract-dod.md && echo "OK"

- [ ] [BEHAVIOR] B-6: harness run 记录在 Brain DB 存在（/api/brain/harness/runs 中有 initiative_id=dedbca0c 的条目）
  - manual:bash: curl -sf http://localhost:5221/api/brain/harness/runs | jq -e '[.[] | select(.initiative_id == "dedbca0c-0864-4b0d-be69-d37f70a25827")] | length > 0'

- [ ] [BEHAVIOR] B-7: started_at 不为 null（证明任务已被 harness 启动）
  - manual:bash: curl -sf http://localhost:5221/api/brain/tasks/dedbca0c-0864-4b0d-be69-d37f70a25827 | jq -e '.started_at != null'

- [ ] [BEHAVIOR] B-8: （完成态）task status=completed 且 pr_url 非 null
  - manual:bash: curl -sf http://localhost:5221/api/brain/tasks/dedbca0c-0864-4b0d-be69-d37f70a25827 | jq -e '.status == "completed" and .pr_url != null'

- [ ] [BEHAVIOR] B-9: verification_level: L3 真目标复核——所有断言基于真实 Brain API（curl localhost:5221 真实实例），无 mock/stub/exit-0 兜底
  - manual:bash: TASK_ID=dedbca0c-0864-4b0d-be69-d37f70a25827 BRAIN=http://localhost:5221; curl -sf "$BRAIN/api/brain/tasks/$TASK_ID" | jq -e '.id != null' && echo "verification_level: L3 真目标复核"

## Invariant 约束（来自 PRD）

- [INVARIANT] 测试证据必须绑定当前 task_id=dedbca0c-0864-4b0d-be69-d37f70a25827，不得使用其他 task 的证据替代（尤其是历史 headed task d355821f 的成功记录）
- [INVARIANT] headless run 证据只认 Brain API/DB 的字段，不认 session 内部状态
- [INVARIANT] 单 slot 串行执行，不得并发 claim 或抢占已有 session（来源: area 级约束）
- [INVARIANT] 端口、host 不得硬编码：优先读 payload/env（fallback: localhost:5221 / host.docker.internal:5221）
- [INVARIANT] secrets 不进 git、不进日志、证据输出脱敏
