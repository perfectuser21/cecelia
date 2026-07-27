# Sprint Contract Draft (Round 1)

## 合同边界

- 本合同只覆盖 Harness 派发前 `harnessSlotCheck` 的 provider/account-aware Kernel capacity gate、active attempt account occupancy、candidate-aware admission 与 P0 版本/RCI/review_required 声明。
- 不新增 provider 类型，不改 Controller 编排流程，不降低 interactive reserve、内存、磁盘、quota 或 `HARNESS_HARD_CAP`，不允许绕过 Brain tick / dispatcher / `harnessSlotCheck`。
- legacy relay 容器计数、Kernel v1 run 计数、inflight 宽限期和 quota-guard 既有语义必须保持。
- `contract-gate`: enabled（`packages/brain/src/lib/contract-gate.js` 存在）。

## Response Schema（推导来源: PRD字面）

N/A - 本任务无新增 HTTP 响应。对外可观测契约是 `harnessSlotCheck()` 返回的 `cap.acct_cap/effective/account_capacity/candidate_account`、真实 `harness_attempts` 占用查询、dispatcher/tick 派发行为、版本/RCI 文件和测试退出码。

Registry 非空但照相层已标记 stale；本任务无 PRD HTTP schema，字段命名沿现有 Brain/Harness 约定：`provider`、`account_id`、`role_assignments`、`harness_runtime`、`acct_cap`、`kernel_active`、`inflight`、`allow`、`reason`。

## 已知约束（来自回归测试与累积 FR）

- `[回归测试] packages/brain/src/__tests__/harness-slot-check.test.js` -> `harnessSlotCheck` 仍需叠加内存、磁盘、quota、inflight、hard cap，且旧 relay cap 语义保持。
- `[回归测试] packages/brain/src/__tests__/harness-slot-check-kernel.test.js` -> Kernel v1 活跃 run 必须计入产能账本，且不得与 inflight 双计。
- `[回归测试] packages/brain/src/__tests__/dispatcher-harness-concurrency-cap.test.js` -> dispatcher 的 Harness admission 权威入口仍是 `harnessSlotCheck`，task cap backstop 仅作兜底。
- `[回归测试] packages/brain/src/__tests__/llm-capacity.test.js` -> llm-capacity snapshot 已有 `vendors.claude/codex/grok` 摘要形状。
- `[回归测试] packages/brain/src/__tests__/llm-capacity-pool.test.js` -> Codex 账本必须覆盖 `team1` 到 `team5`。
- `[回归测试] packages/brain/src/orchestrator/preflight/production-wiring.test.js` -> `role_assignments.<role> = {provider, account}` 是生产 task payload 的固定账号来源。
- `[累积FR]` 本 line 暂无历史。
- `context-manifest: unavailable`（`GET /api/brain/line/bb8cc561-b3ee-4fec-b74d-2255694bd963/context-manifest` 返回不可用）。

## 真实调用方请求 shape

本任务入口不是新 HTTP API，而是 Brain tick/dispatcher 对 `harnessSlotCheck({ candidate })` 的内部调用。生产调用方 shape 必须逐字保持如下，禁止另造 body/header 双路径：

| 调用方 | 入口 | 关键字段 |
|---|---|---|
| Brain tick loop | `tick-runner.js` -> `dispatchNextTask()` | 只通过正常 tick 节奏触发，不新增直接派发旁路 |
| Dispatcher | `dispatcher.js` -> `harnessSlotCheck({ candidate })` | `candidate.id`、`candidate.priority`、`candidate.task_type`、`candidate.payload.harness_runtime`、`candidate.payload.role_assignments` |
| Kernel task payload | `tasks.payload.role_assignments.<role>` | 固定账号 shape 为 `{provider, account}`，字段名不得改成 `vendor/accountId` |
| Attempt 账本 | `harness_attempts` | `provider`、`account_id`、`role`、`status`、`task_bundle`、`run_id` |
| Capacity snapshot | `getLlmCapacitySnapshot()` | `vendors.<provider>.accounts[]`，账号必须含 provider/vendor、account/name、available、safe_concurrency；缺 `safe_concurrency` fail-closed |

固定 `role_assignments` 优先级：`harness_attempts.provider/account_id` 明确时优先；否则按 attempt `role` 从 `task_bundle.observed.task.payload.role_assignments` 或 `task_bundle.task.payload.role_assignments` 解析；解析不到则该 attempt 作为 unknown 占用处理并 fail-closed，不可静默忽略。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | 用 provider-neutral llm capacity snapshot 计算 Harness `acct_cap`；按 provider/account 安全并发去重；扣除非终态 attempt 占用；candidate 固定账号耗尽时拒绝；缺快照/未知 provider/熔断/不可用 fail-closed；保留旧 relay 与 tick/harnessSlotCheck 路径。 |
| **NFR（做得多好）** | 性能/可靠性 | capacity snapshot TTL 必须受控；DB active occupancy 查询失败保守拒绝；不得增加慢外呼到 hot path；不降低 reserve、quota、内存、磁盘和 hard cap。 |
| **Invariant（永不违反）** | 不变量 | 同一 provider/account 只计一次；同账号 active attempts 不得超发；终态 attempt 不占用；unknown provider/account/concurrency 不计入可用容量；dispatcher 不绕过 `harnessSlotCheck`。 |
| **判定点（怎么知道）** | 判断假设 | 见下方登记表。 |
| **保质期（何时过期）** | 数据/能力寿命 | llm capacity snapshot 的 `sampled_at/cache_ttl_ms` 到期即不可用于 admission；active attempt occupancy 每次 `harnessSlotCheck` 从 DB 现查。 |
| **死亡告警（停了谁知道）** | 停止工作后的发现 | `harnessSlotCheck` 返回 `reason=capacity_snapshot_missing|unknown_provider|account_unavailable|account_exhausted|active_attempt_query_error`，dispatcher dispatch result 暴露 reason；P0 review_required 阻止未批准 merge/deploy。 |
| **失败语义（挂了怎么办）** | 放行/拦截/重试 | 缺 snapshot、DB 查询失败、未知 provider/account、账号熔断、账号不可用、未知并发上限均 fail-closed；candidate 固定账号满时拒绝该 candidate，不借其他账号偷偷放行。 |
| **效果确认（已发不等于已生效）** | 回执方式/时限 | 以 `harnessSlotCheck` 实际返回、真实 PostgreSQL `harness_attempts` 占用、dispatcher/tick 路径测试和版本/RCI 检查确认；额外 Codex/Grok 容量必须 proven-to-fire 到统一 Controller。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| acct_cap 是否可信 | A. 继续读 Claude `getAvailableAccountCount()*2`; B. 读 provider-neutral snapshot 每账号安全并发 | B. provider-neutral snapshot | PRD 指出 Claude-only 是生产病灶 | Codex/Grok 服务器和 token 永远进不了 Controller |
| ⚠️ 固定 role_assignment 是否可借其他账号放行 | A. 全局还有空账号就放行; B. 固定账号无剩余即拒绝 | B. 固定账号耗尽即拒绝 | PRD 明确 candidate-aware 与固定 role_assignment 占用 | 同账号超发、失败被误判为容量可用 |
| ⚠️ stale attempt 是否占用 | A. 心跳旧就忽略; B. 非终态在恢复/终态前继续占用 | B. 非终态继续占用 | PRD 边界情况明确 stale 未终态继续占用 | 超发导致同账号多 attempt 互相挤掉 |
| unknown provider/account 如何处理 | A. 忽略未知并继续; B. fail-closed | B. fail-closed | PRD 明确缺快照/未知 provider fail-closed | 不可信账号进入派发，容量账本失真 |

上述两个 ⚠️ 判定点已由冻结 PRD 明确拍板，无 `judgment-pending-user`。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| llm capacity snapshot 缺失或过期 | `allow=false`，`reason=capacity_snapshot_missing|capacity_snapshot_stale` | 是；下一 tick 重取 snapshot | 不用 Claude-only fallback 冒充真容量 |
| provider/account 未知或缺 `safe_concurrency` | 该账号不计入容量；candidate 命中则拒绝 | 是 | 人工补 provider/account 元数据 |
| 账号熔断或 available=false | 该账号剩余容量为 0 | 是 | candidate 可在上游重新选择健康账号；固定账号不偷换 |
| active attempt DB 查询失败 | `allow=false`，`reason=active_attempt_query_error` | 是 | 下次 tick 重试 |
| fixed role_assignment 账号已满 | `allow=false`，`reason=candidate_account_exhausted` | 是 | 等 attempt 终态或上游生成新 candidate |
| 额外 Codex/Grok 可用但 mem/quota/hard cap 到顶 | 继续按旧资源闸拒绝 | 是 | 不降低 reserve/quota/hard cap |
| P0 capacity 状态机变更未获批准 | review_required 阻止 merge/deploy | N/A | 主理人批准后才继续 |

### 输入对抗面（对外暴露 agent 必填）

N/A - 本任务不新增对外 agent/API。输入来自 Brain 内部 task payload、llm capacity snapshot 与 PostgreSQL attempt 账本。

## Golden Path

独立小路（无父路）

[Brain tick 待派发 Harness 任务] -> [provider-neutral snapshot] -> [active attempt occupancy] -> [harnessSlotCheck 叠加资源闸] -> [统一 Controller 放行或 fail-closed]

### Step 1: 读取 provider-neutral 能力快照并计算候选容量

**来源**: `[FROM_PRD]` - PRD Golden Path 第 1 步与背景段。

**可观测行为**: `2 Claude + 5 Codex + 1 Grok` 全 available 时，账号容量按八个 provider/account 分别乘安全并发计算，`acct_cap` 不再固定为 4；同一 provider/account 多候选只计一次。

**验证命令**:
```bash
npx vitest run sprints/07272205-kernel-9315c992/tests/kernel-provider-capacity.contract.test.ts -t "provider-neutral acct_cap 覆盖 Claude Codex Grok 且不固定为 4"
```

**硬阈值**: exit code = 0；`accounts.length=8`；`acct_cap=16`（每账号安全并发 2）；`effective=16` 当 `mem_cap=20/hard_cap=20`；重复候选不得增加 `acct_cap`。

### Step 2: 扣除非终态 attempt 与固定 role_assignment 占用

**来源**: `[FROM_PRD]` - PRD Golden Path 第 2 步与边界情况。

**可观测行为**: 真实 PostgreSQL `harness_attempts` 中 `queued/starting/running` 占用对应 provider/account；`completed/completed_with_concerns/needs_context/blocked/failed/cancelled` 不占用；`role_assignments` 固定账号在 `provider/account_id` 缺失时仍被正确扣减；stale 但未终态继续占用。

**验证命令**:
```bash
DB_URL="${DB_URL:-postgresql://localhost/cecelia}" npx vitest run sprints/07272205-kernel-9315c992/tests/kernel-attempt-occupancy.pg.contract.test.ts -t "真实 harness_attempts 非终态占用按 provider account 计数且终态不占用"
```

**硬阈值**: exit code = 0；真 PG 插入的 `starting/running/queued` 三行分别计入；终态 fixture 为 0；`codex:team2` active=2；`claude:account1` active=1。

### Step 3: 缺快照、未知 provider、账号熔断或不可用 fail-closed

**来源**: `[FROM_PRD]` - PRD Golden Path 第 3 步与边界情况。

**可观测行为**: 缺 snapshot、snapshot stale、未知 provider、未知账号并发上限、`available=false` 或熔断账号都不计入 `acct_cap`；candidate 命中这些账号时 admission 拒绝并给出机器可读 reason。

**验证命令**:
```bash
npx vitest run sprints/07272205-kernel-9315c992/tests/kernel-provider-capacity.contract.test.ts -t "缺快照 未知 provider 未知并发上限全部 fail-closed"
```

**硬阈值**: exit code = 0；缺 snapshot 时 `allow=false/acct_cap=0`；未知 provider candidate reason=`unknown_provider`；缺 `safe_concurrency` 账号 reason=`unknown_account_concurrency`；熔断账号剩余 0。

### Step 4: 继续叠加 reserve、内存、磁盘、quota、hard cap 且不绕过 harnessSlotCheck

**来源**: `[FROM_PRD]` - PRD Golden Path 第 4 步与范围限定。

**可观测行为**: `harnessSlotCheck` 使用 provider-neutral `acct_cap` 后，仍按 `min(mem_cap, acct_cap, HARNESS_HARD_CAP)` 计算 effective；磁盘、quota、memory_pressure、inflight、kernel_active 与 task_cap_backstop 语义不回退；dispatcher/tick 仍通过 `harnessSlotCheck`。

**验证命令**:
```bash
npx vitest run sprints/07272205-kernel-9315c992/tests/kernel-provider-capacity.contract.test.ts -t "harnessSlotCheck 叠加 provider-neutral acct_cap active attempts reserve 和 hard cap"
npx vitest run packages/brain/src/__tests__/harness-slot-check.test.js packages/brain/src/__tests__/harness-slot-check-kernel.test.js packages/brain/src/__tests__/dispatcher-harness-concurrency-cap.test.js
```

**硬阈值**: exit code = 0；`cap.acct_cap` 可大于 4；`cap.effective` 仍不超过 `HARNESS_HARD_CAP`；旧 relay、Kernel v1、inflight、quota、disk 回归全绿。

### Step 5: 额外 Codex/Grok 容量 proven-to-fire 到统一 Controller

**来源**: `[FROM_PRD]` - PRD Golden Path 第 5 步、NFR 可观测与 P0 review_required 要求。

**可观测行为**: 当四个旧 Claude 容量已被占用但 Codex/Grok 有真实空闲账号时，`harnessSlotCheck` 不以 `acct_cap=4` 拦截，candidate 进入统一 Controller；DEFINITION/version/RCI 记录 P0 capacity 状态机变更且 `review_required=true`。

**验证命令**:
```bash
npx vitest run sprints/07272205-kernel-9315c992/tests/kernel-provider-capacity.contract.test.ts -t "provider-neutral acct_cap 覆盖 Claude Codex Grok 且不固定为 4"
bash scripts/check-version-sync.sh
node -e "const fs=require('fs');const root=fs.readFileSync('DEFINITION.md','utf8');const brain=fs.readFileSync('packages/brain/DEFINITION.md','utf8');for(const s of ['provider-neutral Harness capacity','review_required=true','acct_cap']){if(!root.includes(s)&&!brain.includes(s))throw new Error('missing '+s)}"
```

**硬阈值**: 三条命令 exit code = 0；旧 4 容量占用后仍可放行 Codex/Grok candidate；版本同步脚本通过；RCI/DEFINITION 显式记录 `review_required=true`。

## 接缝清单

1. `llm-capacity` snapshot -> `harnessSlotCheck` capacity accounting：真返回 shape 必须用于 admission，不能回退到 Claude-only `getAvailableAccountCount()*2`。
2. `harness_attempts` / `role_assignments` -> active occupancy：必须真 PostgreSQL 查询，非终态扣减、终态释放，stale 未终态仍占用。
3. dispatcher/tick -> `harnessSlotCheck` -> unified Controller：不得新增绕过 `harnessSlotCheck` 的直接派发路径。
4. P0 version/RCI/review gate -> merge/deploy：主理人批准前不得 merge/deploy。

## 禁 mock 边清单

- `packages/brain/src/slot-allocator.js` (`harnessSlotCheck`) <-> `packages/brain/src/llm-capacity.js` provider-neutral snapshot（本单改容量来源，测试不得 mock 成 Claude-only）。
- `harnessSlotCheck` <-> `harness_attempts` / `initiative_runs` / `tasks.payload.role_assignments`（本单改 active attempt occupancy，合同测试必须真 PostgreSQL 插入和查询）。
- dispatcher/tick <-> `harnessSlotCheck`（本单要求不绕过 admission，测试必须保留真实接线或运行既有调度回归）。
- `account-usage.js` Claude legacy ledger <-> provider-neutral capacity accounting（legacy 可作为 Claude ledger 输入，但不得继续是唯一 `acct_cap` 来源）。

## 未覆盖真实链路清单

（本合同无 `force_*`/stub/mock 豁免，N/A。contract tests 构造能力快照是系统输入 fixture，用于确定性覆盖 provider/account 组合，不替代被改的 `harnessSlotCheck`、DB occupancy 或 dispatcher 接缝。）

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail

cd /workspace

HARNESS_TASK_ID="${HARNESS_TASK_ID:-9315c992-7061-4d17-8c88-628ed0eb0be2}"
TASK_JSON=$(curl -fsS --max-time 10 "http://localhost:5221/api/brain/tasks/$HARNESS_TASK_ID")
echo "$TASK_JSON" | jq -e --arg id "$HARNESS_TASK_ID" '
  .id == $id
  and (.task_type == "harness_initiative" or .task_type == "harness_contract_propose" or (.payload.sprint_dir == "sprints/07272205-kernel-9315c992"))
  and ((.payload.sprint_dir // "") == "sprints/07272205-kernel-9315c992")
' >/dev/null

CAP_JSON=$(curl -fsS --max-time 20 "http://localhost:5221/api/brain/dispatch/llm-capacity")
echo "$CAP_JSON" | jq -e '
  .vendors.claude.total_count >= 2
  and .vendors.codex.total_count >= 5
  and .vendors.grok.total_count >= 1
' >/dev/null

DB_URL="${DB_URL:-postgresql://localhost/cecelia}" npx vitest run \
  sprints/07272205-kernel-9315c992/tests/kernel-provider-capacity.contract.test.ts \
  sprints/07272205-kernel-9315c992/tests/kernel-attempt-occupancy.pg.contract.test.ts \
  packages/brain/src/__tests__/harness-slot-check.test.js \
  packages/brain/src/__tests__/harness-slot-check-kernel.test.js \
  packages/brain/src/__tests__/dispatcher-harness-concurrency-cap.test.js \
  packages/brain/src/__tests__/llm-capacity.test.js \
  packages/brain/src/__tests__/llm-capacity-pool.test.js

bash scripts/check-version-sync.sh

node -e "const fs=require('fs');const text=fs.readFileSync('DEFINITION.md','utf8')+'\n'+fs.readFileSync('packages/brain/DEFINITION.md','utf8');for(const s of ['provider-neutral Harness capacity','review_required=true','acct_cap']){if(!text.includes(s))throw new Error('missing '+s)}"

echo "OK: provider-neutral Harness capacity final-e2e passed"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| provider-neutral capacity / candidate-aware admission / fail-closed / harnessSlotCheck overlay | `sprints/07272205-kernel-9315c992/tests/kernel-provider-capacity.contract.test.ts` | `provider-neutral acct_cap 覆盖 Claude Codex Grok 且不固定为 4` / `同账号多候选只计一次且固定 role_assignment 耗尽时拒绝该账号` / `缺快照 未知 provider 未知并发上限全部 fail-closed` / `harnessSlotCheck 叠加 provider-neutral acct_cap active attempts reserve 和 hard cap` | 当前代码仍用 Claude-only `getAvailableAccountCount()*2`，且缺 provider-neutral capacity helper / harnessSlotCheck 注入点，import 或断言失败 |
| active attempt account occupancy | `sprints/07272205-kernel-9315c992/tests/kernel-attempt-occupancy.pg.contract.test.ts` | `真实 harness_attempts 非终态占用按 provider account 计数且终态不占用` | 当前代码没有从 `harness_attempts` 按 provider/account/role_assignment 汇总 active occupancy 的导出函数，测试失败 |
