# Sprint Contract Draft (Round 2)

## 合同边界

- 本合同只覆盖 `packages/brain/` 内 Kernel provider-neutral capacity accounting recovery：`dispatcher/tick -> harnessSlotCheck -> unified Controller`、attempt 状态 SSOT、provider/account/candidate admission、legacy usage 边界与 fail-closed 快照规则。
- 不放宽 memory、disk、quota、global hard seat、review gate；这些闸门继续独立生效，只修 account free、candidate 交集、账本去重与 recovered terminal 释放。
- reviewed_contract_sha `b1aeccddb` 仅作历史证据，不继承任何 approval；本轮仍按首个 P0 controller 变更对待，`review_required=true` 不得回退。
- `contract-gate`: enabled（`packages/brain/src/lib/contract-gate.js` 存在）。

## Response Schema（推导来源: PRD字面）

N/A — 本任务无新增 HTTP 响应。对外可观测契约是 `dispatcher/harnessSlotCheck` 的结构化拒发 reason、attempt/account 占用账本、真实调度链返回值以及测试退出码。

Registry 未提供比 PRD 更高优先级的新 schema 约束；沿用现有 Brain/Kernel 字段字面值：`provider`、`account`、`sampled_at`、`cache_ttl_ms`、`status`、`reason`、`review_required`、`role_assignments`。

## 已知约束（来自回归测试）

- `[packages/brain/src/__tests__/harness-slot-check-kernel.test.js]` → `零容器 + 零 inflight + 4 条 kernel run（cap=4）→ 拒 cap_reached`
- `[packages/brain/src/__tests__/harness-slot-check-kernel.test.js]` → `kernel 占用查 SQL：只数 v2 非终态 + kernel-v1 + 心跳新鲜/刚落行（不依赖 docker）`
- `[packages/brain/src/__tests__/harness-slot-check-kernel.test.js]` → `inflight 查排除 kernel-v1，防同一条 run 被数两遍`
- `[packages/brain/src/__tests__/dispatcher-allocation-guide.test.js]` → `tight 预算下的 dev 任务 → triggerCeceliaRun 收到 payload.executor=codex`
- `[packages/brain/src/__tests__/dispatcher-allocation-guide.test.js]` → `harness_initiative 在 claude 无可用容量时续接到 codex`
- `[packages/brain/src/orchestrator/__tests__/execution-contract.test.js]` → `maps completed_with_concerns to DONE_WITH_CONCERNS`
- `[packages/brain/src/routes/__tests__/tasks-completed-gate.test.js]` → `Rule1: review_required=true + review_status=pending → 422 REVIEW_NOT_APPROVED`
- `[累积FR] context-manifest: unavailable`（`GET /api/brain/line/bb8cc561-b3ee-4fec-b74d-2255694bd963/context-manifest` 不存在）

## 真实调用方请求 shape

本任务入口不是新 API，而是 Brain 服务端拥有的任务行、run 行、capability snapshot 与 usage 账本。真实调用方 shape 必须逐字保持如下，禁止测试伪造 `candidate.role` 快捷路径：

| 调用方 | 入口 | 关键字段 |
|---|---|---|
| dispatcher/tick | `dispatchNextTask()` 选出的真实 task 行 | `task.id`、`task.task_type`、`task.priority`、`task.payload.role_assignments.<role>.provider`、`task.payload.role_assignments.<role>.account`、`task.payload.review_required` |
| unified Controller / slot check | server-owned candidate / snapshot | `provider`、`account`、`sampled_at`、`cache_ttl_ms`、`vendors.<provider>.accounts[]`、`reason`、`state` |
| attempt 账本 | attempt/run 真实状态行 | `attempt_id`、`run_id`、`status`、`provider`、`account`、`recovered_at` |
| legacy usage 账本 | relay/kernel/attempt 历史来源 | `attempt_id`、`provider`、`account`、`status`；相同 `attempt_id` 必须先归一再计算 active |
| 完成闸门 | `PATCH /api/brain/tasks/:task_id` | `review_required=true` 时必须由服务端 review gate 拒绝未审批 completed |

## Legacy Usage 边界定案

本 sprint 选择：**将 legacy relay/account/attempt usage 统一归一进同一份 provider-neutral snapshot，再按 `attempt_id + provider + account` 去重后参与 account active 计算**。

- 不采用双路径并行扣减。
- 若 snapshot 缺 provider/account、usage API 报错、`sampled_at` 或 `cache_ttl_ms` 缺失/非法/陈旧，则只拒当前 pinned candidate，返回稳定 reason。
- 若某 legacy 数据源缺字段导致无法安全归一，则该 candidate fail-closed，不允许回退成 pool 级 fail-open。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求：系统对外承诺做什么 | 服务端只用真实 role target 与 provider/account 快照交集做 admission；active/terminal attempt 口径统一；同 attempt recovered terminal 释放 capacity；Claude 满载时允许角色约束下的 Codex/Grok 账户接棒。 |
| **NFR（做得多好）** | 非功能需求：性能/可靠性/并发阈值等 | `sampled_at + cache_ttl_ms` 过期立即 stale 拒发；missing/partial/usage error/unknown reason 稳定 fail-closed；重复 terminal 不得把 free 减成负数或反复释放。 |
| **Invariant（永不违反）** | 任何情况下不得打破的不变量 | 不双扣 account 占用；不让无关空闲账户替 pinned 不可用账户放行；不放宽 memory/disk/quota/hard-seat/review gate；review_required=true 的首个 P0 controller 改动在 evaluator、judge、人审绑定最终 SHA 前不得 merge/deploy。 |
| **判定点（怎么知道）** | 对模糊现实的判断假设（详见下方登记表） | 见下方登记表 |
| **保质期（何时过期）** | 该能力/数据/token 何时失效，谁负责退役 | capability snapshot 在 `sampled_at + cache_ttl_ms` 后立即失效；attempt active 集合只对当前非终态有效；legacy usage 一旦统一进 snapshot，旧路径不得再单独扣减。 |
| **死亡告警（停了谁知道）** | 该功能停止工作后，谁在多久内会知道，用什么告警手段 | dispatcher/harnessSlotCheck 必须返回稳定 `reason`；usage API 错误、snapshot stale、candidate unknown 由真实 dispatcher 链路回归测试和 evaluator 执行失败立即暴露。 |
| **失败语义（挂了怎么办）** | 故障时放行还是拦截？重试幂等？降级策略？ | 缺快照/局部缺 provider/account/usage API 错误/unknown/stale 全部 fail-closed；只拒对应 candidate，不扩大到整个 pool；同 attempt 重复 terminal 写回幂等，不重复释放。 |
| **效果确认（已发≠已生效）** | 每个对外动作如何确认真实生效？回执方式/时限/拿不到算什么 | 以真实 `dispatcher/tick -> harnessSlotCheck -> unified Controller` 测试链回执、账户 free 断言、稳定 reason、review gate 422/拒发作为生效确认；拿不到稳定 reason 视为失败。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| ⚠️ 本次 dispatch 的 role target 从哪里来 | A. synthetic `candidate.role`; B. server-owned `task.payload.role_assignments` | B. server-owned `role_assignments` | PRD 明示“tests must use the real task-row/dispatcher shape” | 无关空闲账号顶替 pinned 不可用账号，错误放行 |
| ⚠️ attempt 是否仍算 active | A. 任何非 completed；B. 仅 `queued|starting|running` | B. 仅三种字面值 | PRD 给出 canonical SSOT | recovered terminal 不释放 capacity，或 blocked/failed 仍占座 |
| ⚠️ snapshot stale 判定 | A. sentinel!=ok 就 stale；B. `sampled_at + cache_ttl_ms` 过期或字段缺失即 stale | B. 时间窗与字段完整性 | PRD 明示 sampled_at/cache_ttl 缺失或陈旧必须拒发 | 用过期样本误派发，形成 fail-open |
| ⚠️ legacy usage 与 kernel usage 如何并存 | A. 双路径都扣；B. 统一归一到同一 provider-neutral snapshot 并按 attempt 去重 | B. 单一路径归一 + attempt 级去重 | PRD 第 2、4 条要求显式定案 | 同一 attempt/account 被双扣，`free` 错误变负 |

上述四个 ⚠️ 判定点都已在本 PRD 明确，无 `judgment-pending-user`。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| snapshot 缺失/局部缺 provider/account | 只拒当前 candidate，返回稳定 `reason` | 是 | 不放大为整个 pool unknown |
| sampled_at/cache_ttl_ms 缺失、非法或过期 | stale 拒发，不创建新 active 占用 | 是 | 无降级，必须刷新快照 |
| usage API 错误或 candidate unknown | fail-closed 返回稳定 `reason` | 是 | 无关 provider/account 继续按各自证据判定 |
| 同 attempt 非终态转 recovered terminal | 释放一次 capacity | 是 | 重复 terminal 写回不得二次释放 |
| review_required=true 的首个 P0 controller 改动 | evaluator/judge/人审未完成前拒绝 completed/merge/deploy | 是 | 无降级 |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本任务只改 Brain 内部调度与账本，不新增外部可写 agent 接口。

## Golden Path

独立小路（无父路）

[dispatcher/tick 选中真实 harness task] → [服务端角色锚定唯一 provider/account 候选] → [用 active attempt SSOT 与 provider/account free 计算 admission] → [legacy usage 归一并按 attempt 去重] → [快照 stale/missing/unknown 按 candidate fail-closed] → [Claude 满载但角色允许的 Codex/Grok 可派发] → [recovered terminal 释放 capacity 且 review gate 继续收口]

### Step 1: dispatcher/tick 从服务端真实 task/run shape 锚定 role target，只把对应 provider/account 候选送入 admission

**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步、边界情况第 2 条。

**可观测行为**: candidate 交集只来自 server-owned `role_assignments` 与 capability snapshot 的匹配项；无关空闲 Grok/Codex 账户不会替 pinned 不可用账户放行；unknown 只作用于当前 candidate。

**验证命令**:
```bash
bash -c 'npx vitest run sprints/07272227-kernel-0f481d85/tests/kernel-dispatcher-chain.contract.test.ts -t "dispatcher tick 真实 role target 交集：只允许 server owned role_assignments 命中的 provider account，未知候选只拒自身"'
```

**硬阈值**: test exit code = 0；fixture 内不得使用 synthetic `candidate.role`；拒发/放行都带稳定 `reason`。

### Step 2: attempt 状态 SSOT 统一为 active=`queued|starting|running`、terminal=`completed|completed_with_concerns|needs_context|blocked|failed|cancelled`，recovered terminal 立即释放且幂等

**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步、边界情况第 4 条。

**可观测行为**: active 集合只含三种字面值；terminal 集合只含六种字面值；同 attempt 从非终态进入 recovered terminal 立即释放占用，重复 terminal 回写不再释放第二次。

**验证命令**:
```bash
bash -c 'npx vitest run sprints/07272227-kernel-0f481d85/tests/kernel-attempt-status-ssot.contract.test.ts'
```

**硬阈值**: test exit code = 0；释放后 free 回升且不超过 safe_limit；重复 terminal 不产生负数或二次释放。

### Step 3: account free 只按 `free=max(0,safe_limit-active(provider,account))` 计算一次，memory/disk/quota/hard-seat 独立叠加，不得双扣

**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步、边界情况第 3 条。

**可观测行为**: 选中 account 的 free 只扣 active attempts 一次；relay/kernel/attempt 账本对同 attempt 去重；`total=4, active=2, free=2` 且其他硬闸允许时 admission 放行。

**验证命令**:
```bash
bash -c 'npx vitest run sprints/07272227-kernel-0f481d85/tests/kernel-capacity-accounting.contract.test.ts -t "selected account free=max(0,safe_limit-active(provider account)) 且 total=4 active=2 free=2 仍放行"'
```

**硬阈值**: test exit code = 0；`free` 最小为 0；不允许先减 active 再按 occupied 二次扣减。

### Step 4: legacy relay/account usage 统一归一到 provider-neutral snapshot 并按 `attempt_id + provider + account` 去重

**来源**: `[FROM_PRD]` — PRD 边界情况第 1、3 条。

**可观测行为**: legacy usage 明确走单一路径归一；同 attempt 若同时出现在 relay/kernel/attempt 多源，只计一次 active；缺字段无法安全归一时，只拒当前 candidate。

**验证命令**:
```bash
bash -c 'npx vitest run sprints/07272227-kernel-0f481d85/tests/kernel-capacity-accounting.contract.test.ts -t "legacy relay kernel attempt usage 统一归一并按 attempt_id provider account 去重"'
```

**硬阈值**: test exit code = 0；去重后 active 与 free 可机械断言；不允许 pool 级 fail-open。

### Step 5: missing/partial/stale snapshot、usage API 错误、candidate unknown 全部 fail-closed，但只拒当前 pinned candidate

**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 步、边界情况第 2、5 条。

**可观测行为**: 缺失 snapshot、局部缺 provider/account、`sampled_at` 超过 `cache_ttl_ms`、usage API 错误、candidate unknown 时返回稳定 `reason` 并拒发；无关 provider/account 不会被扩大误杀。

**验证命令**:
```bash
bash -c 'npx vitest run sprints/07272227-kernel-0f481d85/tests/kernel-capacity-accounting.contract.test.ts -t "snapshot sampled_at cache_ttl 缺失陈旧 usage API 错误或 candidate unknown 都 fail closed 且 reason 稳定"'
```

**硬阈值**: test exit code = 0；`reason` 稳定可断言；unknown 不得扩大到整个 pool。

### Step 6: 真实 dispatcher/tick -> harnessSlotCheck -> unified Controller 证明 Claude 满载拒 Claude，但角色允许且有空位的 Codex/Grok 可派发；review gate 继续收口

**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 步、假设第 1 条。

**可观测行为**: 真实调度链上 Claude 账户满载时拒绝该 Claude candidate；若 pinned Codex/Grok account free>0 且其他独立硬闸允许，则同链路可派发；`review_required=true` 的首个 P0 controller 改动未获批前不得 completed/merge/deploy。

**验证命令**:
```bash
bash -c 'npx vitest run sprints/07272227-kernel-0f481d85/tests/kernel-dispatcher-chain.contract.test.ts -t "dispatcher tick -> harnessSlotCheck -> unified Controller 真实链路：Claude 满载拒 Claude，Codex 或 Grok 仅在 pinned account 可用时派发" && npx vitest run packages/brain/src/routes/__tests__/tasks-completed-gate.test.js -t "Rule1: review_required=true + review_status=pending → 422 REVIEW_NOT_APPROVED"'
```

**硬阈值**: 两个测试 exit code = 0；Claude 满载场景 reason 稳定；Codex/Grok 放行不借助 unrelated account；review gate 422 收口不回退。

## 接缝清单

1. `dispatcher/tick` ↔ `task.payload.role_assignments` ↔ candidate 交集：必须用真实 task-row shape，不能 mock 成 synthetic `candidate.role`。
2. `harnessSlotCheck/unified Controller` ↔ provider/account usage snapshot：必须真走 provider/account 维度 free 计算、legacy 归一与 stale 判定，不得只测聚合总数。
3. attempt/run 状态行 ↔ recovered terminal 释放：必须真按同 attempt 状态迁移断言幂等释放。

## 禁 mock 边清单

- `dispatcher.js` ↔ `slot-allocator.js`（本单改 dispatch 链与 admission 接缝，测试必须真调 `harnessSlotCheck`）
- `slot-allocator.js` ↔ provider/account usage snapshot（本单改 provider/account free 计算与 legacy 去重，不得把 snapshot/account ledger mock 成 synthetic 聚合结果）
- `orchestrator/execution-contract.js` ↔ `orchestrator/attempt-store.js`（本单改 active/terminal SSOT 与 recovered release 语义，测试必须真走状态字面值与迁移语义）
- `routes/tasks.js` ↔ review gate（本单假设首个 P0 controller 改动必须 `review_required=true`，完成闸门不得被 mock 掉）

## 未覆盖真实链路清单

| 未覆盖点 | 原因 | 真验证补位计划 |
|---|---|---|
| 生产数据库上的真实 dispatcher/tick 定时调度 | proposer 阶段只产合同与红测，不执行生产 tick | evaluator 在本地 Brain 真链路执行 `## E2E 验收`，人审再绑定最终 SHA |
| 真实 provider usage API 外呼 | proposer 阶段冻结红测，不消耗真实账号 | generator/evaluator 在实现后增加至少一条真 key 真请求校验；若凭据缺失则在 PR 描述保留未覆盖登记 |
| merge/deploy 阶段的人审绑定 | 本合同阶段不执行 merge/deploy | 人工审批完成后再允许最终 SHA 合并部署 |

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt 状态 SSOT 与 recovered release | `sprints/07272227-kernel-0f481d85/tests/kernel-attempt-status-ssot.contract.test.ts` | `attempt 状态 SSOT：active 仅 queued starting running，terminal 仅 completed completed_with_concerns needs_context blocked failed cancelled` / `same attempt 非终态转 recovered terminal 只释放一次容量且重复 terminal 不二次释放` | 缺少 SSOT 常量或 recovered release helper 时 fail |
| provider/account free、legacy 去重与 fail-closed snapshot | `sprints/07272227-kernel-0f481d85/tests/kernel-capacity-accounting.contract.test.ts` | `selected account free=max(0,safe_limit-active(provider account)) 且 total=4 active=2 free=2 仍放行` / `legacy relay kernel attempt usage 统一归一并按 attempt_id provider account 去重` / `snapshot sampled_at cache_ttl 缺失陈旧 usage API 错误或 candidate unknown 都 fail closed 且 reason 稳定` | 缺少 provider-neutral accounting helper、legacy 去重或 stale/unknown rule 时 fail |
| 真实 dispatch 链交集与 review gate | `sprints/07272227-kernel-0f481d85/tests/kernel-dispatcher-chain.contract.test.ts` | `dispatcher tick 真实 role target 交集：只允许 server owned role_assignments 命中的 provider account，未知候选只拒自身` / `dispatcher tick -> harnessSlotCheck -> unified Controller 真实链路：Claude 满载拒 Claude，Codex 或 Grok 仅在 pinned account 可用时派发` | 缺少真实 task-row 交集或真实链路回归时 fail |

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

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
