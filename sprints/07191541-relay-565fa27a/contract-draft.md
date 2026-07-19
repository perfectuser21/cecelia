# Contract Draft — smoke-verify-headless-dispatch 565fa27a

> 生成日期：2026-07-19
> Task ID：565fa27a-4b5b-4eb7-905e-b6fb61eb8413
> Sprint Dir：sprints/07191541-relay-565fa27a
> Brain URL：http://host.docker.internal:5221

---

## Test Contract

| ID | [BEHAVIOR] | 验收命令（manual:bash） | 通过条件 |
|----|------------|------------------------|---------|
| B-01 | GET /api/brain/tasks/565fa27a 返回 200，且 payload.mode=headless | `curl -sf http://host.docker.internal:5221/api/brain/tasks/565fa27a-4b5b-4eb7-905e-b6fb61eb8413 \| jq -e '.payload.mode=="headless"'` | exit 0 |
| B-02 | 同一 API 返回 payload.executor=claude | `curl -sf http://host.docker.internal:5221/api/brain/tasks/565fa27a-4b5b-4eb7-905e-b6fb61eb8413 \| jq -e '.payload.executor=="claude"'` | exit 0 |
| B-03 | 同一 API 返回 payload.orchestrator=skill-relay | `curl -sf http://host.docker.internal:5221/api/brain/tasks/565fa27a-4b5b-4eb7-905e-b6fb61eb8413 \| jq -e '.payload.orchestrator=="skill-relay"'` | exit 0 |
| B-04 | 同一 API 返回 status=in_progress（任务已被认领） | `curl -sf http://host.docker.internal:5221/api/brain/tasks/565fa27a-4b5b-4eb7-905e-b6fb61eb8413 \| jq -e '.status=="in_progress"'` | exit 0 |
| B-05 | 同一 API 返回 dispatched_by_orchestrator=true | `curl -sf http://host.docker.internal:5221/api/brain/tasks/565fa27a-4b5b-4eb7-905e-b6fb61eb8413 \| jq -e '.dispatched_by_orchestrator==true'` | exit 0 |
| B-06 | /api/brain/harness/phase-events 返回 initiative_id=565fa27a 的事件记录 ≥ 1 | `curl -sf "http://host.docker.internal:5221/api/brain/harness/phase-events?initiative_id=565fa27a-4b5b-4eb7-905e-b6fb61eb8413" \| jq -e 'length >= 1'` | exit 0（可选，concern 记录）|

---

## E2E 验收

以下脚本在 CI / 本地均可直接执行（manual:bash）：

```bash
#!/usr/bin/env bash
# E2E 验收脚本 — smoke-verify-headless-dispatch 565fa27a
# 用法：bash sprints/07191541-relay-565fa27a/tests/contract-red.test.sh
# 目标环境：host.docker.internal:5221（us Brain 节点）

set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://host.docker.internal:5221}"
TASK_ID="565fa27a-4b5b-4eb7-905e-b6fb61eb8413"
TASK_URL="${BRAIN_URL}/api/brain/tasks/${TASK_ID}"

echo "=== E2E 验收：headless dispatch smoke 565fa27a ==="

# B-01: payload.mode=headless
echo "[B-01] 验证 payload.mode=headless ..."
curl -sf "${TASK_URL}" | jq -e '.payload.mode=="headless"' > /dev/null \
  && echo "  PASS B-01" || { echo "  FAIL B-01: payload.mode 不为 headless"; exit 1; }

# B-02: payload.executor=claude
echo "[B-02] 验证 payload.executor=claude ..."
curl -sf "${TASK_URL}" | jq -e '.payload.executor=="claude"' > /dev/null \
  && echo "  PASS B-02" || { echo "  FAIL B-02: payload.executor 不为 claude"; exit 1; }

# B-03: payload.orchestrator=skill-relay
echo "[B-03] 验证 payload.orchestrator=skill-relay ..."
curl -sf "${TASK_URL}" | jq -e '.payload.orchestrator=="skill-relay"' > /dev/null \
  && echo "  PASS B-03" || { echo "  FAIL B-03: payload.orchestrator 不为 skill-relay"; exit 1; }

# B-04: status=in_progress
echo "[B-04] 验证 status=in_progress ..."
curl -sf "${TASK_URL}" | jq -e '.status=="in_progress"' > /dev/null \
  && echo "  PASS B-04" || { echo "  FAIL B-04: status 不为 in_progress"; exit 1; }

# B-05: dispatched_by_orchestrator=true
echo "[B-05] 验证 dispatched_by_orchestrator=true ..."
curl -sf "${TASK_URL}" | jq -e '.dispatched_by_orchestrator==true' > /dev/null \
  && echo "  PASS B-05" || { echo "  FAIL B-05: dispatched_by_orchestrator 不为 true"; exit 1; }

# B-06: phase-events 记录（可选，不阻断）
echo "[B-06] 检查 phase-events 记录（concern 级，不阻断主链路）..."
EVENTS_URL="${BRAIN_URL}/api/brain/harness/phase-events?initiative_id=${TASK_ID}"
EVENTS_COUNT=$(curl -sf "${EVENTS_URL}" 2>/dev/null | jq 'length' 2>/dev/null || echo "0")
if [ "${EVENTS_COUNT}" -ge 1 ]; then
  echo "  PASS B-06: phase-events 记录数=${EVENTS_COUNT}"
else
  echo "  CONCERN B-06: phase-events 暂无 initiative_id=565fa27a 记录（可能尚未触发，不算失败）"
fi

echo ""
echo "=== E2E 验收完成：B-01~B-05 全部通过 ==="
```

**执行入口**：

```bash
bash sprints/07191541-relay-565fa27a/tests/contract-red.test.sh
```

全部 PASS = 合同通过。B-06 CONCERN 不阻断，但需记录。

---

## 未覆盖真实链路清单

| 链路 | 状态 | 说明 |
|------|------|------|
| headless relay 真实执行 run | CONCERN（非 mock 豁免） | `/api/brain/harness/runs` 目前未返回当前 task 的 run 记录；B-06 仅检查 phase-events，无法证明 relay 真实运行完毕。FR-003 要求此为 concern，不计为失败，但不可声明 headless smoke 完成。 |
| initiative_runs 端到端回写 | N/A（本 sprint 范围外） | harness run 回写属后续 sprint 范围，本次仅 smoke dispatch 链路。 |
| 租户隔离验证 | N/A | PRD invariant 明确：本 smoke 不查询租户数据。 |
| UI/Dashboard 验证 | N/A | 本 sprint 范围明确不包含 UI/Dashboard 改动。 |
| Brain runtime 变更 | N/A | 本 sprint 不改 Brain runtime，仅验证现有 API 状态。 |
