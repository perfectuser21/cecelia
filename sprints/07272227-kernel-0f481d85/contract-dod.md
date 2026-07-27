---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Sprint: Kernel provider-neutral capacity accounting recovery 2

**范围**: provider/account/candidate/active-attempt-aware Kernel admission、attempt 状态 SSOT、legacy usage 边界、真实 dispatcher/tick 链与 review gate 收口。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] Sprint 红测文件存在并锚定 provider/account/attempt/review gate 四个接缝
  Test: node -e "const fs=require('fs');for(const p of ['sprints/07272227-kernel-0f481d85/tests/kernel-attempt-status-ssot.contract.test.ts','sprints/07272227-kernel-0f481d85/tests/kernel-capacity-accounting.contract.test.ts','sprints/07272227-kernel-0f481d85/tests/kernel-dispatcher-chain.contract.test.ts']){if(!fs.existsSync(p))throw new Error('missing '+p)}"

- [ ] [ARTIFACT] contract-draft.md 含真实调用方请求 shape、禁 mock 边清单、未覆盖真实链路清单与 E2E 验收
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/07272227-kernel-0f481d85/contract-draft.md','utf8');for(const s of ['## 真实调用方请求 shape','## 禁 mock 边清单','## 未覆盖真实链路清单','## E2E 验收']){if(!c.includes(s))throw new Error('missing '+s)}"

- [ ] [ARTIFACT] Brain 版本账本同步
  Test: bash scripts/check-version-sync.sh

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] [L2] attempt 状态 SSOT：active 仅 queued starting running，terminal 仅 completed completed_with_concerns needs_context blocked failed cancelled
  动作: 运行状态契约红测，读取真实 `execution-contract`/Kernel 状态接缝。
  预期观察: active 与 terminal 状态集合逐字匹配 PRD；缺任何状态或多任何状态都失败。
  Test: manual:bash -c 'npx vitest run sprints/07272227-kernel-0f481d85/tests/kernel-attempt-status-ssot.contract.test.ts -t "attempt 状态 SSOT：active 仅 queued starting running，terminal 仅 completed completed_with_concerns needs_context blocked failed cancelled"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] same attempt 非终态转 recovered terminal 只释放一次容量
  动作: 运行同 attempt recovered terminal 红测，模拟同一 attempt 从 active 进入 terminal 并重复写回。
  预期观察: 首次 recovered terminal 释放一次 capacity；重复 terminal 不二次释放、不出现负数 free。
  Test: manual:bash -c 'npx vitest run sprints/07272227-kernel-0f481d85/tests/kernel-attempt-status-ssot.contract.test.ts -t "same attempt 非终态转 recovered terminal 只释放一次容量"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] selected account free=max(0,safe_limit-active(provider account)) 且 total=4 active=2 free=2 仍放行
  动作: 运行 provider/account accounting 红测，使用真实 provider-neutral 账本接口验证单账户 free。
  预期观察: 只扣一次 active(provider,account)；`total=4 active=2 free=2` 且其他硬闸允许时 admission 放行。
  Test: manual:bash -c 'npx vitest run sprints/07272227-kernel-0f481d85/tests/kernel-capacity-accounting.contract.test.ts -t "selected account free=max(0,safe_limit-active(provider account)) 且 total=4 active=2 free=2 仍放行"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] snapshot sampled_at cache_ttl 缺失陈旧 usage API 错误或 candidate unknown 都 fail closed 且只拒当前 candidate
  动作: 运行 fail-closed snapshot 红测，依次构造缺字段、stale、usage error、candidate unknown、partial provider/account 场景。
  预期观察: 每个场景都返回稳定 `reason` 且只拒当前 candidate；无关 pool 仍可继续评估。
  Test: manual:bash -c 'npx vitest run sprints/07272227-kernel-0f481d85/tests/kernel-capacity-accounting.contract.test.ts -t "snapshot sampled_at cache_ttl 缺失陈旧 usage API 错误或 candidate unknown 都 fail closed 且只拒当前 candidate"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] dispatcher tick 真实 role target 交集：Claude 满载但 pinned Codex account 有位时仍派发 Codex，未知 Grok 不得顶替
  动作: 用真实 task-row/dispatcher shape 运行红测，role target 从服务端 `role_assignments` 解析。
  预期观察: 只交集 pinned provider/account；Claude 满载时若 pinned Codex 有位则派发 Codex；未知 Grok 不得作为 unrelated fallback 顶替。
  Test: manual:bash -c 'npx vitest run sprints/07272227-kernel-0f481d85/tests/kernel-dispatcher-chain.contract.test.ts -t "dispatcher tick 真实 role target 交集：Claude 满载但 pinned Codex account 有位时仍派发 Codex，未知 Grok 不得顶替"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] dispatcher tick -> harnessSlotCheck -> unified Controller 真实链路证明 Claude 满载拒 Claude 而 Codex Grok 可派发
  动作: 运行真实 dispatch 链红测，覆盖 dispatcher/tick 经过 harnessSlotCheck 再到 unified Controller 的接缝。
  预期观察: Claude 满载时稳定拒绝 Claude candidate；角色允许且 free>0 的 Codex/Grok account 可在同链路放行。
  Test: manual:bash -c 'npx vitest run sprints/07272227-kernel-0f481d85/tests/kernel-dispatcher-chain.contract.test.ts -t "dispatcher tick -> harnessSlotCheck -> unified Controller 真实链路证明 Claude 满载拒 Claude 而 Codex Grok 可派发"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] review_required=true 的首个 P0 controller 改动未获批前保持 review gate 拒绝 completed
  动作: 运行真实 `PATCH /api/brain/tasks/:task_id` review gate 既有回归。
  预期观察: `review_required=true` 且 `review_status=pending` 返回 422 `REVIEW_NOT_APPROVED`，不允许借 capacity recovery 绕过审批。
  Test: manual:bash -c 'npx vitest run packages/brain/src/routes/__tests__/tasks-completed-gate.test.js -t "Rule1: review_required=true + review_status=pending → 422 REVIEW_NOT_APPROVED"'
  期望: exit 0

## E2E 验收

```bash
#!/bin/bash
set -euo pipefail

cd /workspace

TASK_ID="b6d166c5-d694-43e7-8890-c6eddf2be24c"
SPRINT_DIR="sprints/07272227-kernel-0f481d85"

RESP=$(curl -fsS "http://localhost:5221/api/brain/tasks/$TASK_ID")
echo "$RESP" | jq -e '
  (.id // .task.id) == "b6d166c5-d694-43e7-8890-c6eddf2be24c"
  and ((.payload.sprint_dir // .task.payload.sprint_dir) == "sprints/07272227-kernel-0f481d85")
' >/dev/null

npx vitest run \
  "$SPRINT_DIR/tests/kernel-attempt-status-ssot.contract.test.ts" \
  "$SPRINT_DIR/tests/kernel-capacity-accounting.contract.test.ts" \
  "$SPRINT_DIR/tests/kernel-dispatcher-chain.contract.test.ts" \
  packages/brain/src/__tests__/harness-slot-check-kernel.test.js \
  packages/brain/src/__tests__/dispatcher-allocation-guide.test.js \
  packages/brain/src/routes/__tests__/tasks-completed-gate.test.js

bash scripts/check-version-sync.sh
```
