# Sprint Contract Draft (Round 1)

contract-gate: active
覆盖父路 Kernel provider-neutral capacity recovery 第 1-5 步

## Notes

- context-manifest: unavailable
- registry freshness: api/db/test registry 最新扫描于 2026-07-18；本任务无 HTTP schema，字段冻结以 PRD 字面和现有运行时字面值为准
- contract-branch-evidence: preserve contract `c7ffa99de` only as evidence，不回收其语义
- initiative_id: unavailable in proposer inputs，本轮 `task-plan.json` 以 `pending` 占位
- red-evidence: Sprint 测试必须在依赖已加载后因业务断言失败而红；不接受缺 vitest/config/import 的伪红
- database-safety: 本合同与后续生成测试只允许 `DB_NAME=cecelia_test|*_scratch` 或显式测试 URL，禁止生产 DB 变更

## Response Schema（推导来源: PRD字面）

N/A — 本任务无新增 HTTP 响应。可观测契约是 `tasks` / `initiative_runs` / `harness_attempts` 的真实状态迁移、`dispatchNextTask -> harnessSlotCheck -> launchKernelProcess|unified Controller` 真链路，以及稳定 reason 字面值。

## 已知约束（来自回归测试）

- [packages/brain/src/__tests__/harness-slot-check-kernel.test.js] → `kernel-v1 在跑的 run 计入产能账本`
- [packages/brain/src/__tests__/harness-slot-check-kernel.test.js] → `inflight 查排除 kernel-v1，防同一条 run 被数两遍`
- [packages/brain/src/__tests__/dispatcher-harness-concurrency-cap.test.js] → `harness admission 3b'' 块 — deny/兜底路径行为`
- [packages/brain/src/orchestrator/__tests__/dispatcher.test.js] → `按 role_assignments 为同一 run 的 generator/evaluator 选择不同 provider 与账户 home`
- [packages/brain/src/orchestrator/__tests__/ground-truth.test.js] → `读取最新完成 evaluator attempt 的完整 result`
- [累积FR] context-manifest: unavailable

## 真实调用方请求 shape

本任务无外部 HTTP 调用方；真实调用方是服务端持有的任务行与 run 状态，shape 固定如下：

| 调用方 | 真 shape | 合同要求 |
|---|---|---|
| Brain tick 选中的 Kernel 任务 | `tasks.id/status='queued'`, `payload.harness_runtime='kernel-v1'`, `payload.role_assignments.<role>.provider/account/machine`, `payload.review_required=true`, `payload.anchor.step_id` | dispatcher 只能从任务行与 run 状态解析 role/action/target，不得接受 synthetic `candidate.role` 或 helper 伪 target |
| Kernel run 状态 | `initiative_runs.current_task_id`, `initiative_runs.phase`, `initiative_runs.orchestrator_version='v2'`, `initiative_runs.orchestrator_heartbeat_at` | 当前 role/action 必须锚定服务端 run 状态，不得从调用方 body 自报 |
| 真容量账本 | `harness_attempts.status/provider/account_id/requested_machine_id`, provider snapshot `sampled_at/cache_ttl/accounts[].available/source` | active 只认 `queued|starting|running`；terminal 只认 `completed|completed_with_concerns|needs_context|blocked|failed|cancelled` |

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求：系统对外承诺做什么 | 让 Kernel provider-neutral 容量判定回到真实 tick/dispatcher/harnessSlotCheck/launch 链路；同一真实 attempt 终态自然释放容量；legacy 非 Kernel/relay 继续走隔离旧适配器。 |
| **NFR（做得多好）** | 非功能需求：性能/可靠性/并发阈值等 | fail-closed；exact stable reasons；双任务双 cycle 真链路可重复复现；不新增生产 DB migration；首次 merge/deploy 等待用户批准。 |
| **Invariant（永不违反）** | 任何情况下不得打破的不变量 | active/terminal 状态 SSOT 单一；不引入 `recovered_at` 或命令式 release helper；不让无关空闲账号放行 pinned 满额账号；不让 unknown target 污染健康任务。 |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表。 |
| **保质期（何时过期）** | 该能力/数据/token 何时失效，谁负责退役 | provider snapshot 只在 `sampled_at + cache_ttl` 内有效；过期后必须 fail-closed 并等待下一次真实刷新。 |
| **死亡告警（停了谁知道）** | 该功能停止工作后，谁在多久内会知道，用什么告警手段 | harness contract PG/API 集成测试、dispatcher/slot allocator 回归和 evaluator 终验会在本轮发现；稳定 reason 必须进入日志/返回体。 |
| **失败语义（挂了怎么办）** | 故障时放行还是拦截？重试幂等？降级策略？ | snapshot 缺失/过期/usage API 失败/unknown target 一律 fail-closed；legacy 只走 legacy adapter，绝不混入 provider-neutral fallback。 |
| **效果确认（已发≠已生效）** | 每个对外动作如何确认真实生效？回执方式/时限/拿不到算什么 | 用真实任务行、`harness_attempts`、dispatcher 决策与 `launchKernelProcess`/unified Controller 触发证据确认；helper 返回布尔/path array 不算回执。 |

### 判定点登记表（对模糊现实的判断假设 — decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| ⚠️当前 run 的角色/action 从哪里取 | A. 调用方参数 `candidate.role`; B. 服务端 `initiative_runs.phase` + 任务行 | B. 服务端 run 状态 + 任务行 | PRD要求 server-owned state 为真相 | 错 role 导致错误 provider/account 被计费或放行 |
| ⚠️selected provider/account 是否可用 | A. 任意健康 fallback 账号; B. 任务 `role_assignments` 冻结 target + 真 snapshot | B. 冻结 target + 真 snapshot | PRD明确 pinned account 不能被别的空闲账号顶替 | 满额 Claude 被误放行，资源双扣或错投 |
| occupancy 哪些 attempt 算 active | A. 只看 tasks/in_progress 或 helper 记账; B. 真 `harness_attempts.status IN ('queued','starting','running')` | B. 真 `harness_attempts` active 状态 | PRD要求 execution-contract / attempt-store / occupancy / harnessSlotCheck SSOT 一致 | 容量不释放或重复扣账 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| selected provider/account 未知 | 返回 `selected_target_unknown`，只拒绝当前 pinned 任务 | 是 | 无；等待正确 role_assignment |
| snapshot 缺失 | 返回 `provider_snapshot_missing` | 是 | 无；等待真实 snapshot 写入 |
| snapshot 过期 | 返回 `provider_snapshot_stale` | 是 | 无；等待真实刷新 |
| usage API 失败 | 返回 `provider_usage_unavailable` | 是 | 无；legacy 路径不受影响 |
| memory/disk/quota/global hard seats 任一失败 | 返回各自独立 stable reason | 是 | 不吞并成通用 `cap_reached` |
| attempt 进入 terminal | 真实 occupancy 重查后自然释放容量 | 是 | 禁止 release helper |

### 输入对抗面（对外暴露 agent 必填 — decisions 27b57469 第9要素）

N/A — 本任务是 Brain 内部 dispatcher/capacity 热修复，不新增对外可写 agent 输入面。

## 接缝清单

1. `dispatchNextTask` / Kernel dispatcher ↔ `harnessSlotCheck`：真任务行与 run 状态解析出 selected target 后进入准入，不得使用 synthetic role/boolean helper。
2. `harnessSlotCheck` ↔ `harness_attempts` / provider snapshot：active/terminal SSOT、per-account free、dedup key、stable reasons 都必须由真实账本和真快照决定。
3. `harnessSlotCheck` ↔ `launchKernelProcess` / unified Controller：allow 的任务必须继续触发真实 launch 证据，deny 的任务必须留下 exact reason。
4. legacy admission adapter ↔ 非 Kernel/relay 任务：legacy 行为必须在 provider-neutral snapshot 逻辑前完全分流，不受 snapshot 缺失/过期影响。

## 禁 mock 边清单

- `packages/brain/src/orchestrator/execution-contract.js` ↔ `packages/brain/src/orchestrator/attempt-store.js`（本单统一 active/terminal SSOT，测试必须真比对两侧状态字面）
- `packages/brain/src/orchestrator/attempt-store.js` ↔ `public.harness_attempts`（本单改真实 attempt 终态释放语义，测试必须真 PostgreSQL 验状态迁移）
- `packages/brain/src/slot-allocator.js` ↔ provider snapshot / `harness_attempts` occupancy query（本单改 per-account free 与去重账本，测试不得把被改 SQL/相邻模块 stub 掉）
- `packages/brain/src/orchestrator/dispatcher.js` ↔ `tasks.payload.role_assignments` / `initiative_runs`（本单改真实 target 解析，测试不得用 synthetic candidate.role 旁路）
- `packages/brain/src/dispatcher.js` ↔ `packages/brain/src/harness-skill-relay.js`（本单验真实 tick -> allow -> launch 链路，测试不得用 helper-returned path array/boolean 代替）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## Golden Path

覆盖父路 Kernel provider-neutral capacity recovery 第 1-5 步

[Brain tick 选中两条 server-owned Kernel 任务] → [dispatcher 从 run 状态与 role_assignments 解析冻结 target，并把 legacy 非 Kernel/relay 先分流] → [harnessSlotCheck 仅用 canonical active attempts、真快照与独立硬闸计算 per-account free，消除双扣] → [Claude 满额任务稳定拒绝，Codex/Grok 空闲任务继续进入真实 launchKernelProcess/unified Controller] → [attempt 进入 terminal 后真实 occupancy 重查自然释放容量，snapshot/usage/unknown 各返回 exact stable reason]

### Step 1: canonical attempt 状态在四处共享一个 SSOT

**来源**: `[FROM_PRD]` — PRD 第 21、36、49-50 行。

**可观测行为**: `execution-contract`、`attempt-store` SQL、occupancy query 与 `harnessSlotCheck` 对 active/terminal 字面值完全一致；真实 `harness_attempts` 从 active 转 terminal 后下一次 occupancy 自然释放容量。

**验证命令**:
```bash
cd packages/brain
DB_NAME="${DB_NAME:-cecelia_test}" npx vitest run ../../sprints/07272240-kernel-2212a691/tests/kernel-capacity-recovery.pg.contract.test.ts -t "active attempt 进入 terminal 后 occupancy 自然释放容量|active terminal SSOT 与 execution-contract 完全一致"
```

**硬阈值**: active 仅 `queued|starting|running`；terminal 仅 `completed|completed_with_concerns|needs_context|blocked|failed|cancelled`；禁止 `recovered_at`、禁止命令式 release helper。

---

### Step 2: dispatcher 只能从服务端 run 状态与冻结 target 解析当前 admission target

**来源**: `[FROM_PRD]` — PRD 第 19、36、48、81-82 行。

**可观测行为**: dispatcher 读取真实 `initiative_runs` 与 `tasks.payload.role_assignments`，把解析出的 immutable `{provider,account,machine}` 传给容量准入；unknown target 只拒绝当前任务，不污染其它健康任务。

**验证命令**:
```bash
cd packages/brain
npx vitest run ../../sprints/07272240-kernel-2212a691/tests/kernel-capacity-recovery.contract.test.ts -t "unknown selected provider/account 只拒绝当前 pinned 任务|dispatcher 只能使用 role_assignments 冻结 target"
```

**硬阈值**: 不接受 synthetic `candidate.role` / `candidate.account`；返回 stable reason `selected_target_unknown`；无关健康任务仍可通过。

---

### Step 3: harnessSlotCheck 按 selected provider/account 计算 free=max(0,safe_limit-active) 且不双扣

**来源**: `[FROM_PRD]` — PRD 第 20、30、36、85 行。

**可观测行为**: relay/inflight/kernel 三本账只按一个 dedup key 记一次；`total=4, active=2, free=2` 且其它独立硬闸通过时允许；任何保留旧 `occupied>=min(acct_cap...)` 逻辑的实现都会被红测抓住。

**验证命令**:
```bash
cd packages/brain
npx vitest run ../../sprints/07272240-kernel-2212a691/tests/kernel-capacity-recovery.contract.test.ts -t "total=4 active=2 free=2 的 selected target 必须 allow|harnessSlotCheck 不得 double debit 同一 dedup key"
```

**硬阈值**: 返回中可区分 `provider_account_free=2`；同一 dedup key 不能在 relay/inflight/kernel 三本账重复扣减。

---

### Step 4: legacy 非 Kernel/relay 完全隔离在 provider-neutral snapshot 逻辑之前

**来源**: `[FROM_PRD]` — PRD 第 19、29、36 行。

**可观测行为**: non-Kernel/relay 任务仍走 legacy admission adapter；Kernel snapshot 缺失/过期不会改变 legacy 行为；不存在 hybrid fallback。

**验证命令**:
```bash
cd packages/brain
DB_NAME="${DB_NAME:-cecelia_test}" npx vitest run ../../sprints/07272240-kernel-2212a691/tests/kernel-capacity-recovery.pg.contract.test.ts -t "legacy admission adapter 在 provider-neutral snapshot 之前独立生效"
```

**硬阈值**: 必须能证明 legacy path 仍被触发且有自己 fail 行为；snapshot missing/stale 不得改写 legacy verdict。

---

### Step 5: 双任务双 cycle 真链路一拒一放并保留 review_required gate

**来源**: `[FROM_PRD]` — PRD 第 18-22、31-32、51-52、81-85 行。

**可观测行为**: Claude-pinned 满额任务在真实 tick/dispatch 链路被拒；独立 Codex/Grok-pinned 空闲任务穿过真实 `dispatchNextTask -> harnessSlotCheck -> launchKernelProcess|unified Controller`；真实任务行保持 `payload.review_required=true` 并继续受 current-SHA evaluator/judge/human gate 约束。

**验证命令**:
```bash
cd packages/brain
DB_NAME="${DB_NAME:-cecelia_test}" npx vitest run ../../sprints/07272240-kernel-2212a691/tests/kernel-capacity-recovery.pg.contract.test.ts -t "双任务双 cycle 真链路中 Claude 满额被拒而 Codex 或 Grok 空闲被真实 launch|review_required=true gate 继续生效"
```

**硬阈值**: 不接受 helper-returned path array/boolean 作为通过证据；必须看到真实 launch 触发与稳定拒绝 reason。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/usr/bin/env bash
set -euo pipefail

export DB_NAME="${DB_NAME:-cecelia_test}"
case "$DB_NAME" in
  *_test|*_scratch) ;;
  *) echo "FAIL: 只允许测试库，当前 DB_NAME=$DB_NAME"; exit 1 ;;
esac

curl -sf localhost:5221/api/brain/health | jq -e '.status=="ok" or .status=="degraded"' >/dev/null

cd /workspace/packages/brain
npx vitest run ../../sprints/07272240-kernel-2212a691/tests/kernel-capacity-recovery.contract.test.ts
npx vitest run ../../sprints/07272240-kernel-2212a691/tests/kernel-capacity-recovery.pg.contract.test.ts

echo "OK: Kernel provider-neutral capacity recovery contract E2E passed"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| selected target / stable reasons / counterexample allow | `sprints/07272240-kernel-2212a691/tests/kernel-capacity-recovery.contract.test.ts` | `unknown selected provider/account 只拒绝当前 pinned 任务`, `dispatcher 只能使用 role_assignments 冻结 target`, `total=4 active=2 free=2 的 selected target 必须 allow`, `harnessSlotCheck 不得 double debit 同一 dedup key` | 现状会返回 `ok` 或缺字段，不能给出 provider-neutral exact reason / free / dedup 证据 |
| SSOT / legacy boundary / true launch chain / review gate | `sprints/07272240-kernel-2212a691/tests/kernel-capacity-recovery.pg.contract.test.ts` | `active terminal SSOT 与 execution-contract 完全一致`, `active attempt 进入 terminal 后 occupancy 自然释放容量`, `legacy admission adapter 在 provider-neutral snapshot 之前独立生效`, `双任务双 cycle 真链路中 Claude 满额被拒而 Codex 或 Grok 空闲被真实 launch`, `review_required=true gate 继续生效` | 现状 occupancy 仍依赖旧账本/全局 account 数，缺 legacy adapter 切口与双任务真链路证明 |
