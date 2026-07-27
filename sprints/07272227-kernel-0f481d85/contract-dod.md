---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Sprint: Kernel provider-neutral capacity accounting recovery 2

**范围**: provider/account/candidate/active-attempt-aware Kernel admission、attempt 状态 SSOT、legacy usage 归一去重、真实 dispatcher/tick 链与 review gate 收口。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] Sprint 红测文件存在并锚定 provider/account/attempt/review gate 四个接缝
  Test: node -e "const fs=require('fs');for(const p of ['sprints/07272227-kernel-0f481d85/tests/kernel-attempt-status-ssot.contract.test.ts','sprints/07272227-kernel-0f481d85/tests/kernel-capacity-accounting.contract.test.ts','sprints/07272227-kernel-0f481d85/tests/kernel-dispatcher-chain.contract.test.ts']){if(!fs.existsSync(p))throw new Error('missing '+p)}"

- [ ] [ARTIFACT] contract-draft.md 含真实调用方请求 shape、Legacy Usage 边界定案、禁 mock 边清单、未覆盖真实链路清单与 E2E 验收
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/07272227-kernel-0f481d85/contract-draft.md','utf8');for(const s of ['## 真实调用方请求 shape','## Legacy Usage 边界定案','## 禁 mock 边清单','## 未覆盖真实链路清单','## E2E 验收']){if(!c.includes(s))throw new Error('missing '+s)}"

- [ ] [ARTIFACT] Brain 版本账本同步
  Test: bash scripts/check-version-sync.sh

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] [L2] attempt 状态 SSOT：active 仅 queued starting running，terminal 仅 completed completed_with_concerns needs_context blocked failed cancelled
  动作: 运行状态契约红测，读取真实 `execution-contract`/attempt-store 状态接缝。
  预期观察: active 与 terminal 状态集合逐字匹配 PRD；缺任何状态或多任何状态都失败。
  Test: manual:bash -c 'npx vitest run sprints/07272227-kernel-0f481d85/tests/kernel-attempt-status-ssot.contract.test.ts -t "attempt 状态 SSOT：active 仅 queued starting running，terminal 仅 completed completed_with_concerns needs_context blocked failed cancelled"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] same attempt 非终态转 recovered terminal 只释放一次容量且重复 terminal 不二次释放
  动作: 运行 recovered terminal 红测，模拟同一 attempt 从 active 进入 terminal 并重复写回。
  预期观察: 首次 recovered terminal 释放一次 capacity；重复 terminal 不二次释放、不出现负数 free。
  Test: manual:bash -c 'npx vitest run sprints/07272227-kernel-0f481d85/tests/kernel-attempt-status-ssot.contract.test.ts -t "same attempt 非终态转 recovered terminal 只释放一次容量且重复 terminal 不二次释放"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] selected account free=max(0,safe_limit-active(provider account)) 且 total=4 active=2 free=2 仍放行
  动作: 运行 provider/account accounting 红测，使用真实 provider-neutral 账本接口验证单账户 free。
  预期观察: 只扣一次 active(provider,account)；`total=4 active=2 free=2` 且其他硬闸允许时 admission 放行。
  Test: manual:bash -c 'npx vitest run sprints/07272227-kernel-0f481d85/tests/kernel-capacity-accounting.contract.test.ts -t "selected account free=max(0,safe_limit-active(provider account)) 且 total=4 active=2 free=2 仍放行"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] legacy relay kernel attempt usage 统一归一并按 attempt_id provider account 去重
  动作: 运行 legacy usage 红测，构造同一 attempt 同时出现在 relay/kernel/attempt 多源的场景。
  预期观察: 相同 `attempt_id + provider + account` 只计一次 active；不允许先算 acct_cap 再二次减 occupied。
  Test: manual:bash -c 'npx vitest run sprints/07272227-kernel-0f481d85/tests/kernel-capacity-accounting.contract.test.ts -t "legacy relay kernel attempt usage 统一归一并按 attempt_id provider account 去重"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] snapshot sampled_at cache_ttl 缺失陈旧 usage API 错误或 candidate unknown 都 fail closed 且 reason 稳定
  动作: 运行 fail-closed snapshot 红测，依次构造缺字段、stale、usage error、candidate unknown、partial provider/account 场景。
  预期观察: 每个场景都返回稳定 `reason` 且只拒当前 candidate；无关 pool 仍可继续评估。
  Test: manual:bash -c 'npx vitest run sprints/07272227-kernel-0f481d85/tests/kernel-capacity-accounting.contract.test.ts -t "snapshot sampled_at cache_ttl 缺失陈旧 usage API 错误或 candidate unknown 都 fail closed 且 reason 稳定"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] dispatcher tick 真实 role target 交集：只允许 server owned role_assignments 命中的 provider account，未知候选只拒自身
  动作: 用真实 task-row/dispatcher shape 运行红测，role target 从服务端 `role_assignments` 解析。
  预期观察: 只交集 pinned provider/account；unknown 只作用于当前 candidate，不得让无关空闲账号顶替放行。
  Test: manual:bash -c 'npx vitest run sprints/07272227-kernel-0f481d85/tests/kernel-dispatcher-chain.contract.test.ts -t "dispatcher tick 真实 role target 交集：只允许 server owned role_assignments 命中的 provider account，未知候选只拒自身"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] dispatcher tick -> harnessSlotCheck -> unified Controller 真实链路：Claude 满载拒 Claude，Codex 或 Grok 仅在 pinned account 可用时派发
  动作: 运行真实 dispatch 链红测，覆盖 dispatcher/tick 经过 harnessSlotCheck 再到 unified Controller 的接缝。
  预期观察: Claude 满载时稳定拒绝 Claude candidate；角色允许且 pinned account free>0 的 Codex/Grok 可在同链路放行；无关空闲账号不得越权接棒。
  Test: manual:bash -c 'npx vitest run sprints/07272227-kernel-0f481d85/tests/kernel-dispatcher-chain.contract.test.ts -t "dispatcher tick -> harnessSlotCheck -> unified Controller 真实链路：Claude 满载拒 Claude，Codex 或 Grok 仅在 pinned account 可用时派发"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] review_required=true 的首个 P0 controller 改动未获批前保持 review gate 拒绝 completed
  动作: 运行真实 `PATCH /api/brain/tasks/:task_id` review gate 既有回归。
  预期观察: `review_required=true` 且 `review_status=pending` 返回 422 `REVIEW_NOT_APPROVED`，不允许借 capacity recovery 绕过审批。
  Test: manual:bash -c 'npx vitest run packages/brain/src/routes/__tests__/tasks-completed-gate.test.js -t "Rule1: review_required=true + review_status=pending → 422 REVIEW_NOT_APPROVED"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-1 语义一致：unknown/stale/missing/usage error 在判定端与终验端返回同一稳定拒发语义
  动作: 运行 fail-closed 红测与真实 dispatch 链红测。
  预期观察: 相同失败类型不会在不同断言里出现一处 candidate_unknown、一处 fallback open 的分叉。
  Test: manual:bash -c 'npx vitest run sprints/07272227-kernel-0f481d85/tests/kernel-capacity-accounting.contract.test.ts -t "snapshot sampled_at cache_ttl 缺失陈旧 usage API 错误或 candidate unknown 都 fail closed 且 reason 稳定" && npx vitest run sprints/07272227-kernel-0f481d85/tests/kernel-dispatcher-chain.contract.test.ts -t "dispatcher tick 真实 role target 交集：只允许 server owned role_assignments 命中的 provider account，未知候选只拒自身"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-2 真链验证：dispatcher/tick 真实 task-row 经过 harnessSlotCheck 后再决定放行
  动作: 运行真实 dispatch 链红测。
  预期观察: 断言不依赖 synthetic `candidate.role` 或纯 mock helper；必须能看见真实 task-row 的 `role_assignments`。
  Test: manual:bash -c 'npx vitest run sprints/07272227-kernel-0f481d85/tests/kernel-dispatcher-chain.contract.test.ts -t "dispatcher tick -> harnessSlotCheck -> unified Controller 真实链路：Claude 满载拒 Claude，Codex 或 Grok 仅在 pinned account 可用时派发"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-3 Fail Closed：缺失快照、usage 真相或关键时间字段时必须拒发
  动作: 运行 fail-closed snapshot 红测。
  预期观察: missing/partial/stale/usage error 全部返回拒发，不得 warning 降级或 fail-open。
  Test: manual:bash -c 'npx vitest run sprints/07272227-kernel-0f481d85/tests/kernel-capacity-accounting.contract.test.ts -t "snapshot sampled_at cache_ttl 缺失陈旧 usage API 错误或 candidate unknown 都 fail closed 且 reason 稳定"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-4 Smoke 随 PR：本 sprint 红测与既有 kernel/dispatcher 回归需同分支可执行
  动作: 运行 sprint 红测与既有 kernel/dispatcher/review gate 回归。
  预期观察: PR 分支上可机械执行，不依赖口头说明。
  Test: manual:bash -c 'npx vitest run sprints/07272227-kernel-0f481d85/tests/kernel-attempt-status-ssot.contract.test.ts sprints/07272227-kernel-0f481d85/tests/kernel-capacity-accounting.contract.test.ts sprints/07272227-kernel-0f481d85/tests/kernel-dispatcher-chain.contract.test.ts packages/brain/src/__tests__/harness-slot-check-kernel.test.js packages/brain/src/__tests__/dispatcher-allocation-guide.test.js packages/brain/src/routes/__tests__/tasks-completed-gate.test.js'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-5 真环境验证：依赖真实 dispatcher/provider-account 组合的断言未跑通前只算 logic-done-pending
  动作: 运行 E2E 契约脚本。
  预期观察: 若真实调度链测试未通过，则 sprint 不得标 done。
  Test: manual:bash -c 'RESP=$(curl -fsS "http://localhost:5221/api/brain/tasks/b6d166c5-d694-43e7-8890-c6eddf2be24c"); echo "$RESP" | jq -e '"'"'\'"'"''"'"'(.id // .task.id) == "b6d166c5-d694-43e7-8890-c6eddf2be24c" and ((.payload.sprint_dir // .task.payload.sprint_dir) == "sprints/07272227-kernel-0f481d85")'"'"'\'"'"''"'"' >/dev/null && npx vitest run sprints/07272227-kernel-0f481d85/tests/kernel-attempt-status-ssot.contract.test.ts sprints/07272227-kernel-0f481d85/tests/kernel-capacity-accounting.contract.test.ts sprints/07272227-kernel-0f481d85/tests/kernel-dispatcher-chain.contract.test.ts packages/brain/src/__tests__/harness-slot-check-kernel.test.js packages/brain/src/__tests__/dispatcher-allocation-guide.test.js packages/brain/src/routes/__tests__/tasks-completed-gate.test.js && bash scripts/check-version-sync.sh'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-6 单 slot 串行：同一 account 下重复 terminal 不会制造额外 free 并发位
  动作: 运行 recovered terminal 红测。
  预期观察: 相同 attempt 的重复 terminal 不会二次释放，避免虚增 slot。
  Test: manual:bash -c 'npx vitest run sprints/07272227-kernel-0f481d85/tests/kernel-attempt-status-ssot.contract.test.ts -t "same attempt 非终态转 recovered terminal 只释放一次容量且重复 terminal 不二次释放"'
  期望: exit 0

## E2E 验收

```bash
#!/bin/bash
set -euo pipefail

cd /workspace

TASK_ID="b6d166c5-d694-43e7-8890-c6eddf2be24c"
SPRINT_DIR="sprints/07272227-kernel-0f481d85"

cat > /tmp/h07272227-e2e-contract.sh <<'"'"'EOS'"'"'
#!/bin/bash
set -euo pipefail
cd /workspace

RESP=$(curl -fsS "http://localhost:5221/api/brain/tasks/b6d166c5-d694-43e7-8890-c6eddf2be24c")
echo "$RESP" | jq -e '
  (.id // .task.id) == "b6d166c5-d694-43e7-8890-c6eddf2be24c"
  and ((.payload.sprint_dir // .task.payload.sprint_dir) == "sprints/07272227-kernel-0f481d85")
' >/dev/null

npx vitest run \
  "sprints/07272227-kernel-0f481d85/tests/kernel-attempt-status-ssot.contract.test.ts" \
  "sprints/07272227-kernel-0f481d85/tests/kernel-capacity-accounting.contract.test.ts" \
  "sprints/07272227-kernel-0f481d85/tests/kernel-dispatcher-chain.contract.test.ts" \
  packages/brain/src/__tests__/harness-slot-check-kernel.test.js \
  packages/brain/src/__tests__/dispatcher-allocation-guide.test.js \
  packages/brain/src/routes/__tests__/tasks-completed-gate.test.js

bash scripts/check-version-sync.sh
EOS

chmod +x /tmp/h07272227-e2e-contract.sh
/tmp/h07272227-e2e-contract.sh
```
