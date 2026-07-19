# Contract Draft — headless-smoke dedbca0c

## 背景与范围

本合同验证 Brain 无头 dispatch 机制（headless skill-relay run）的完整链路：

1. **Dispatch**：Brain orchestrator 以 `mode=headless, orchestrator=skill-relay, dispatched_by_orchestrator=true` 派发 task `dedbca0c-0864-4b0d-be69-d37f70a25827`
2. **Claim**：Harness session 正确接管任务（`status` → `in_progress`，`claimed_by` 非空，`claimed_at` 有时间戳）
3. **Phase 推进**：Harness 推进各阶段（planner → proposer → dev → evaluator），在 Brain DB（`harness_initiative_run` 表）产生可观测记录
4. **Completion**：最终任务 `status=completed`，`pr_url` 非空，`quality_gate` 更新

本合同是 PR #4103（codex-headed-smoke d355821f）配对验证任务，填补其「未覆盖真实链路清单」中 Brain 无头 spawn → skill-relay container run 盲区。

### 观测约束

- 证据基准：Brain API（`localhost:5221` / `host.docker.internal:5221`）和 Brain DB，不认 session 内部状态
- 绑定 task_id：所有断言必须基于当前 task `dedbca0c`，历史任务（d355821f 等）成功不得冒充
- 端点确认：harness run 记录通过 `GET /api/brain/harness/runs`（全局列表）过滤 `initiative_id` 字段验证

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| headless dispatch 验证 | `../../tests/regression/relay-dedbca0c/contract-red.test.sh` | B-1/B-2: task 状态与 payload 三元组验证（dispatched_by_orchestrator=true） | task 未被 dispatch 或 payload 字段缺失时 FAIL |
| claim oracle 验证 | `../../tests/regression/relay-dedbca0c/contract-red.test.sh` | B-3/B-4: status_history 转换记录与 claimed_by/claimed_at 字段验证 | claim 流程未正确写入 DB 时 FAIL |
| sprint 产物完整性 | `../../tests/regression/relay-dedbca0c/contract-red.test.sh` | B-5: sprint-prd.md + contract-draft.md + contract-dod.md 三文件存在 | sprint 产物文件缺失时 FAIL |
| harness run 记录（完成态） | `../../tests/regression/relay-dedbca0c/contract-red.test.sh` | B-6/B-7/B-8: harness run DB 记录、started_at、status=completed（optional，Green 完成后才通过） | harness run 未创建或任务未 completed 时 WARN（optional） |

## E2E 验收

```bash
# 以下命令可独立验证本 sprint 的核心链路
TASK_ID=dedbca0c-0864-4b0d-be69-d37f70a25827
BRAIN=http://localhost:5221

# 验证任务被正确 dispatch 和认领
curl -sf "$BRAIN/api/brain/tasks/$TASK_ID" | jq -e '.status == "in_progress" or .status == "completed"' && echo "PASS B-1: task claimed" || { echo "FAIL B-1"; exit 1; }

# 验证 payload 包含 headless dispatch 三元组
curl -sf "$BRAIN/api/brain/tasks/$TASK_ID" | jq -e '.payload.mode == "headless" and .payload.orchestrator == "skill-relay" and .payload.dispatched_by_orchestrator == true' && echo "PASS B-2: headless dispatch payload correct" || { echo "FAIL B-2"; exit 1; }

# 验证 status_history 存在 queued → in_progress 转换
curl -sf "$BRAIN/api/brain/tasks/$TASK_ID" | jq -e '[.status_history[] | select(.from == "queued" and .to == "in_progress")] | length > 0' && echo "PASS B-3: status transition recorded" || { echo "FAIL B-3"; exit 1; }

# 验证 claimed_by 非空、claimed_at 非空
curl -sf "$BRAIN/api/brain/tasks/$TASK_ID" | jq -e '.claimed_by != null and .claimed_at != null' && echo "PASS B-4: claim fields present" || { echo "FAIL B-4"; exit 1; }

# 验证 sprint 目录产物存在
test -f sprints/07191539-relay-dedbca0c/sprint-prd.md && \
test -f sprints/07191539-relay-dedbca0c/contract-draft.md && \
test -f sprints/07191539-relay-dedbca0c/contract-dod.md && \
echo "PASS B-5: sprint artifacts present" || { echo "FAIL B-5"; exit 1; }

# 验证 harness run 记录存在于 Brain DB（initiative_id 匹配）
curl -sf "$BRAIN/api/brain/harness/runs" | jq -e --arg tid "$TASK_ID" '[.[] | select(.initiative_id == $tid)] | length > 0' && echo "PASS B-6: harness run recorded" || { echo "FAIL B-6 (harness run not yet recorded - expected before completion)"; }

# 验证 started_at 不为 null
curl -sf "$BRAIN/api/brain/tasks/$TASK_ID" | jq -e '.started_at != null' && echo "PASS B-7: started_at present" || { echo "FAIL B-7 (started_at null - may be set later)"; }

# 验证完成态（Green 阶段才应通过）
curl -sf "$BRAIN/api/brain/tasks/$TASK_ID" | jq -e '.status == "completed" and .pr_url != null' && echo "PASS B-8: task completed with pr_url" || { echo "FAIL B-8 (not yet completed - expected at end of sprint)"; }
```

## 未覆盖真实链路清单

本合同诚实标注以下链路未直接验证：

1. **skill-relay container 内部执行日志**：无法观测 container 内 executor 的具体步骤，只能通过 Brain DB 状态间接推断。
2. **`executor=claude` 的实际调用记录**：payload 中 `executor=claude` 字段的实际执行路径（Claude API 调用、token 消耗等）不在 Brain DB 可观测范围内。
3. **phase 细粒度推进顺序**：`harness/runs` 端点返回全局列表，当前任务 `dedbca0c` 在 Red 阶段尚无记录；phase 从 `planning → gan → generate → evaluate → done` 的逐步推进验证依赖 Green 阶段完成后才可完整断言。
4. **`executor_kind` 字段是否更新为 `headless-session`**：PRD 标注此字段目前为 `headed-session`（初始值），headless 模式下是否更新存在不确定性（已作为 ASSUMPTION）。
5. **`started_at` 填充时机**：当前 `started_at=null`（Brain API 已确认），该字段在 harness 推进某 phase 时才填充，Red 阶段断言会失败（B-7 预期 Red FAIL）。
