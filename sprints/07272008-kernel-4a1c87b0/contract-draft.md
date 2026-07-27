# Sprint Contract Draft (Round 5)

## 合同边界

- 本合同只覆盖 `packages/brain/src/orchestrator/*`、`packages/brain/src/routes/tasks.js`、`packages/brain/src/slot-allocator.js` 以及与 Kernel v2 run/task 失败终结相关的回归测试、版本账本与回归合同；不改 `allocator` SSOT，不改 `executor-contracts`。
- 历史生产 `task/run=51836fb2/13d41c64` 与 `05f41282/e2dad31b` 仅作为 ghost fixture/回归证据来源，不允许直接回写这些生产行掩盖缺陷。
- retry 分类只接受结构化 `failureClass === "infrastructure_blocked"`；`all_execution_targets_exhausted` 只是 fallback reason/target exhaustion 语义，不得按 `failure_reason` 子串猜测。
- `contract-gate`: enabled（`packages/brain/src/lib/contract-gate.js` 存在）。
- 根 `RCI` 文件在当前仓库中未发现；本次合同以根 `DEFINITION.md`、`packages/brain/package.json`、`packages/brain/package-lock.json`、`.brain-versions`、`regression-contract.yaml` 为版本/回归 SSOT，并在实现阶段显式说明 `RCI` 缺失。
- `context-manifest` 于 2026-07-27 实测 `GET /api/brain/line/bb8cc561-b3ee-4fec-b74d-2255694bd963/context-manifest` 返回 `Cannot GET ...`，因此累积 FR 来源显式登记为 unavailable，而不是静默留空。

## Response Schema（推导来源: PRD字面）

N/A — 任务无新增 HTTP 响应。对外可观测契约是 `initiative_runs`、`tasks`、`task_status_history`、slot 计数与既有路由 `POST /api/brain/tasks/:task_id/feedback` / 正式 failed 路径的 completed_at 行为。

## 已知约束（来自回归测试）

- `[tests/regression/relay-50170af2/kernel-wiring-persistent-blocked.integration.test.js]` → `BLOCKED result is authoritative in decision log for the next loop instance`
- `[tests/regression/relay-50170af2/kernel-wiring-deadline.integration.test.js]` → `the instant before the activity deadline may dispatch; the boundary terminates before collect`
- `[tests/regression/relay-50170af2/kernel-wiring-deadline.integration.test.js]` → `derive completion cannot enter a wait branch after the deadline`
- `[tests/regression/relay-50170af2/kernel-wiring-deadline.integration.test.js]` → `deadline reached after intent persistence still blocks the actual dispatch`
- `[packages/brain/src/orchestrator/__tests__/loop.test.js]` → `BLOCKED×2（连续同态）→ run 置 failed + exitReason=blocked_same_state`
- `[packages/brain/src/orchestrator/__tests__/loop.test.js]` → `连续 wait:poll_ci 累积 pollCount → 超限时 derive 判 ci_timeout（mark_failed）`
- `[packages/brain/src/__tests__/integration/kernel-wiring.pg.integration.test.js]` → `public watchdog success resumes a new lineage child, never the expired parent`
- `[packages/brain/src/__tests__/harness-slot-check-kernel.test.js]` → `slot 计数以 in_progress task / kernel_active 为真相，不靠 run join 绕过`
- `[累积FR] 2026-07-27 实测 `GET /api/brain/line/bb8cc561-b3ee-4fec-b74d-2255694bd963/context-manifest` 返回 `Cannot GET ...`，因此本轮无可加载累积 FR 清单`

## 真实调用方请求 shape

本任务不是新增外部 API，而是收口现有真实调用方与既有数据库写路径。所有 DoD 验证请求 shape 必须与生产调用方逐字段一致：

| 调用方 | 入口 | 关键字段/形状 |
|---|---|---|
| Kernel loop | `runLoop(deps, { taskId, runId })` | `taskId`、`runId`、`decision.action===ACTION.MARK_FAILED`、`decision.reason`、`failure_class` |
| Kernel fatal catch / launch failure / watchdog dead/deadline | `failureTerminalizer(runId, taskId, reason, failureClass)` | `runId`、`taskId`、`reason`、`failureClass`（仅结构化枚举） |
| infrastructure retry | `failureClass==="infrastructure_blocked"` + `fallback_reason==="all_execution_targets_exhausted"` | `retry_count`、`retry_after`、`current_task_id`、`task.status==='in_progress'` |
| reconciler | latest `initiative_runs` row | `orchestrator_version='v2'`、`phase in ('done','failed')`、`current_task_id` 精确匹配、task 仍 `in_progress` |
| 正式 API failed 路径 | `routes/tasks.js` 既有 failed 更新 | 原有 status/error/result 字段不变，仅补 `completed_at`，不得另造第二条更新路径 |

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求：系统对外承诺做什么 | 建立唯一 failure terminalizer，统一收口 Kernel 失败出口；hard failure 原子终结 run+task；`infrastructure_blocked` 且 target exhaustion 时在总 run 上限 4 内自动 requeue；窄 reconciler 清理 terminal run + in_progress task 幽灵态；正式 failed API 路径补 `completed_at`。 |
| **NFR（做得多好）** | 非功能需求：性能/可靠性/并发阈值等 | 单数据库事务、幂等、条件更新；重复调用不重复 history；第 4 次基础设施失败 hard fail；slot 计数继续以 task.status 为唯一 SSOT；评测/判官证据绑定 current SHA。 |
| **Invariant（永不违反）** | 任何情况下不得打破的不变量 | 不修改历史生产行；不批量触碰 paused/blocked/queued/completed 历史 task；不按 `failure_reason` 猜 infra；不通过 JOIN run 修 slot；不改 allocator / executor-contracts 硬边界。 |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表。 |
| **保质期（何时过期）** | 该能力/数据/token 何时失效，谁负责退役 | `retry_after` 只对当前 queued 重试窗口有效；超过第 4 次 infra run 即失效并 hard fail；reconciler 只对 latest Kernel v2 terminal run 有效，旧 run 不追溯。 |
| **死亡告警（停了谁知道）** | 该功能停止工作后，谁在多久内会知道，用什么告警手段 | DevGate、Brain unit/integration、smoke 与 evaluator/judge current SHA 证据会暴露 failure terminalizer 缺口；生产侧若再出现 terminal run + in_progress task，watchdog/reconciler 回归测试应先红。 |
| **失败语义（挂了怎么办）** | 故障时放行还是拦截？重试幂等？降级策略？ | 数据库事务任一步失败则整体回滚；infra 仅在 `failureClass==="infrastructure_blocked"` 且 `retry_count<3` 并带 `all_execution_targets_exhausted` 时回 queued；合同/评测/用户拒绝、历史 stranded run 一律 hard fail；重复调用幂等返回已终态。 |
| **效果确认（已发≠已生效）** | 每个对外动作如何确认真实生效？回执方式/时限/拿不到算什么 | 用真 PG 查询 run/task/status_history/slot 状态确认：run `completed_at` 非空、task 终态正确、history 仅 1 条、claim 清空、retry 窗口正确；再以 DevGate/unit/integration/smoke/current SHA 证据确认没有旁路。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| ⚠️ `all_execution_targets_exhausted` 是否允许自动重试 | A. 看 `failure_reason` 文本包含 exhausted; B. 只认结构化 `failureClass==="infrastructure_blocked"` 且 fallback reason 为 target exhaustion | B. 只认结构化 failureClass + exhaustion fallback | Operator Correction 明确禁止按子串猜测 | 错把合同/评测/用户拒绝回队，造成面客错误或无限重试 |
| ⚠️ 当前 task 是否可被终结 | A. 只看 task_id; B. run.current_task_id 精确匹配且 task.status 仍为 `in_progress` | B. current_task_id + in_progress 双条件 | PRD/Operator Correction 明确限定 | 误终结其他 task，直接破坏串行 slot 不变量 |
| ⚠️ 历史 stranded failed run 是否允许自动 infra retry | A. 猜历史 failure_reason; B. reconciler 一律 hard-fail 当前精确 in_progress task | B. 一律 hard-fail | Operator Correction 第 4 条 | 把历史脏状态误判成可重试 infra，制造新 run 风暴 |
| ⚠️ slot 回收以什么为准 | A. JOIN run 看 phase; B. 仅看 task.status | B. 仅看 task.status | PRD 第 6 条与硬边界 | 用 run 绕过脏状态，导致 slot 假释放或假占用 |

上述 ⚠️ 判定点已由 PRD 与 Operator Correction 拍板，无 `judgment-pending-user`。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| hop cap / MARK_FAILED / approved-but-no-contract / blocked_same_state / ci_timeout / fatal catch / launch failure / watchdog deadline/dead | 当前 run `failed+completed_at`；当前 task `failed+completed_at`；history 单条；claim 清空 | 是 | 无降级；直接 hard fail |
| `failureClass==="infrastructure_blocked"` 且 target exhaustion、`retry_count<3` | 当前 run `failed+completed_at`；task `queued`；`retry_count+1`；写 `retry_after`；claim 清空 | 是 | 自动退避重试 |
| 第 4 次 infrastructure_blocked | hard fail，不再 requeue | 是 | 无降级 |
| terminalizer 事务中途报错 | run/task/history 全部回滚，保持调用前状态 | 是 | 调用方感知异常，后续重试同一 terminalizer |
| reconciler 命中历史/非 latest/非 in_progress | 不做任何写入 | N/A | 跳过 |
| 正式 API `in_progress -> failed` | 现有 failed 语义不变，但必须补 `completed_at` | 是 | 无 |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本任务不新增对外暴露 agent；输入仅来自 Kernel 内部状态机、watchdog、reconciler 与正式 Brain task 路由。

## Golden Path

覆盖父路 `0cdadc1a-e3a0-46a1-8333-ebbc102883f7` 第 1-3 步

[统一失败出口触发] → [唯一 terminalizer 原子收账或重排] → [窄 reconciler 清理幽灵态并回收 slot]

### Step 1: 统一失败出口只走一个 terminalizer 入口

**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步、范围限定第 2 条、Operator Correction 第 3 条。

**可观测行为**: hop cap、`ACTION.MARK_FAILED`、三类 approved-but-no-contract、`blocked_same_state`、`ci_timeout`/deadline、run fatal catch、kernel launch failure、Kernel watchdog dead/deadline 最终都调用同一个 `failureTerminalizer(runId, taskId, reason, failureClass)`，而不是各自散写 SQL。

**验证命令**:
```bash
npx vitest run sprints/07272008-kernel-4a1c87b0/tests/kernel-failure-terminalizer.contract.test.js -t "统一失败出口接入 failure terminalizer"
```

**硬阈值**: exit code = 0；断言命中的出口至少覆盖 `hop_cap`、`mark_failed`、`blocked_same_state`、`ci_timeout`、`automation_deadline_exceeded`、`approved_but_no_contract_branch`、`approved_but_no_contract_sha`、`approved_but_contract_artifacts_missing`、`fatal_catch`、`launch_failure`、`watchdog_dead`、`watchdog_deadline`。

---

### Step 2: hard failure 原子写 run/task failed 并保持幂等

**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步、边界情况第 1-2 条、验收点 1-2。

**可观测行为**: hard failure 在单数据库事务内把 run 写成 `failed + failure_reason + completed_at`，把 `current_task_id` 且仍 `in_progress` 的 task 写成 `failed + completed_at + error/result`，只追加一条 `status_history`，并清理 claim。重复调用不重复 history、不覆盖已终态。

**验证命令**:
```bash
npx vitest run sprints/07272008-kernel-4a1c87b0/tests/kernel-failure-terminalizer.pg.contract.test.js -t "hard failure 原子终结 run task history claim 并保持幂等"
```

**硬阈值**: exit code = 0；同一事务内 run/task/history 要么全写成目标状态，要么全回滚；重复调用后 `task_status_history` 新增数 = 1。

---

### Step 3: target exhaustion 只在结构化 infra 类前 3 次自动回 queued

**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步第二分支、边界情况第 3-4 条、Operator Correction 第 2 条。

**可观测行为**: 仅当 `failureClass==="infrastructure_blocked"` 且 `fallback_reason==="all_execution_targets_exhausted"`、当前 task 仍匹配 `current_task_id` 时，前 1/2/3 次失败会让当前 run `failed+completed_at`，task 清 claim、写 `retry_count/retry_after` 并回 `queued`；第 4 次基础设施失败 hard fail。合同/评测/用户拒绝类失败不得自动重试。

**验证命令**:
```bash
npx vitest run sprints/07272008-kernel-4a1c87b0/tests/kernel-failure-terminalizer.contract.test.js -t "all_execution_targets_exhausted 仅前 3 次回 queued 第 4 次 hard fail"
```

**硬阈值**: exit code = 0；总 run 上限 = 4；`retry_count` 序列为 `1,2,3` 后第 4 次不再回 queued；非 infra 类失败从不触发 queued。

---

### Step 4: 窄 reconciler 只修 latest Kernel v2 terminal run 的幽灵态

**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步、边界情况第 5 条、Operator Correction 第 4 条。

**可观测行为**: reconciler 只处理 latest Kernel v2 terminal run 且 `current_task_id` 精确匹配、task 仍 `in_progress` 的幽灵态；done 复用既有成功语义，failed 复用 `failureTerminalizer`；历史 run、paused/blocked/queued/completed task 全跳过，历史 stranded failed run 不猜 infra 分类。

**验证命令**:
```bash
npx vitest run sprints/07272008-kernel-4a1c87b0/tests/kernel-failure-terminalizer.contract.test.js -t "reconciler 仅处理 latest kernel v2 terminal run 的精确幽灵态"
```

**硬阈值**: exit code = 0；只命中 latest v2 terminal run；对历史/非 in_progress task 写入数 = 0；failed 分支必须复用 terminalizer。

---

### Step 5: slot 仅按 task.status 回收且正式 failed API 补 completed_at

**来源**: `[FROM_PRD]` — PRD 第 6-7 条、验收点 5-6、范围限定第 5 条。

**可观测行为**: slot allocator 继续只按 `task.status` 计数，失败终结或 infra 回队后 used slot 从 1 回到 0；`routes/tasks.js` 正式 `in_progress -> failed` 路径与 terminalizer 一样补 `completed_at`，不能留下半终态。

**验证命令**:
```bash
npx vitest run sprints/07272008-kernel-4a1c87b0/tests/kernel-failure-terminalizer.contract.test.js -t "slot allocator 继续以 task status 为 SSOT 且 failed API 补 completed_at"
```

**硬阈值**: exit code = 0；slot 查询不新增 `JOIN initiative_runs` 绕过逻辑；正式 failed API 更新后 `completed_at IS NOT NULL`。

---

### Step 6: ghost fixture、版本账本与 current SHA 证据保持可审计

**来源**: `[AI_ADDED]` — 理由：PRD 明确要求生产 ghost fixture、版本/回归合同同步、DevGate/unit/integration/smoke 与 evaluator/judge 绑定 current SHA；这些属于防造假与回归守门，必须显式写进合同。

**可观测行为**: 两组 ghost fixture 仅作为只读回归样本；根版本账本同步更新；回归合同和 current SHA 校验存在，避免“代码修了但证据仍指旧 SHA / 旧版本”的假绿。

**验证命令**:
```bash
npx vitest run sprints/07272008-kernel-4a1c87b0/tests/kernel-failure-terminalizer.contract.test.js -t "ghost fixture 只读回归且 current SHA 证据已接线" && bash scripts/check-version-sync.sh
```

**硬阈值**: exit code = 0；ghost fixture 不写生产行；版本同步脚本通过；current SHA 校验路径被测试命中。

## 接缝清单

1. `loop.js` / fatal catch / watchdog / launch failure ↔ `failureTerminalizer`：所有失败出口必须收敛到同一真实代码路径。
2. `failureTerminalizer` ↔ `initiative_runs/tasks/task_status_history`：本单改 DB 写路径，必须真 PG 验证原子性、回滚、幂等与 claim 清理。
3. `reconciler` ↔ latest Kernel v2 terminal run 查询：只能命中 latest/current_task_id 精确接缝，不能猜历史 run。
4. `slot-allocator.js` ↔ `tasks.status`：slot 使用量必须继续以 task.status 为唯一 SSOT。
5. `routes/tasks.js` failed 更新 ↔ 正式 API 写路径：需要和 terminalizer 语义对齐补 `completed_at`。
6. evaluator/judge ↔ current SHA / 版本账本：证据必须锚定当前提交，不得复用历史结果。

## 禁 mock 边清单

- `packages/brain/src/orchestrator/loop.js` ↔ `packages/brain/src/orchestrator/failure-terminalizer.js`（本单改失败出口收口，测试必须真调用 terminalizer，不得 stub 终结函数返回值）
- `packages/brain/src/orchestrator/run.js` ↔ fatal catch / launch failure 路径（本单改 run 级失败出口，测试必须真命中对应入口）
- `packages/brain/src/harness-relay-watchdog.js` ↔ `packages/brain/src/orchestrator/failure-terminalizer.js`（本单改 watchdog dead/deadline 失败出口，测试必须真接线）
- `packages/brain/src/orchestrator/failure-terminalizer.js` ↔ `initiative_runs / tasks / task_status_history`（本单改 DB 写路径，PG 集成测必须真 Postgres）
- `packages/brain/src/orchestrator/reconciler.js` ↔ latest Kernel v2 run 查询（本单改 latest/current_task_id 接缝，测试必须真跑查询条件）
- `packages/brain/src/slot-allocator.js` ↔ `tasks.status` 计数逻辑（本单不得改成 join run 绕过）
- `packages/brain/src/routes/tasks.js` ↔ 正式 failed 路径更新 SQL（本单改写 `completed_at`，测试必须命中真实路由更新分支）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail

cd /workspace

SPRINT_DIR="sprints/07272008-kernel-4a1c87b0"
DB_URL="${DB_URL:-postgresql://localhost/cecelia}"

TASK_JSON=$(curl -fsS --max-time 10 "http://localhost:5221/api/brain/tasks/4a1c87b0-8bfc-4770-9a60-6423b024329a")
echo "$TASK_JSON" | jq -e '
  (.id // .task.id) == "4a1c87b0-8bfc-4770-9a60-6423b024329a"
  and ((.payload.sprint_dir // .task.payload.sprint_dir) == "sprints/07272008-kernel-4a1c87b0")
' >/dev/null

npx vitest run \
  "$SPRINT_DIR/tests/kernel-failure-terminalizer.contract.test.js" \
  "$SPRINT_DIR/tests/kernel-failure-terminalizer.pg.contract.test.js" \
  tests/regression/relay-50170af2/kernel-wiring-persistent-blocked.integration.test.js \
  tests/regression/relay-50170af2/kernel-wiring-deadline.integration.test.js \
  packages/brain/src/orchestrator/__tests__/loop.test.js \
  packages/brain/src/__tests__/integration/kernel-wiring.pg.integration.test.js \
  packages/brain/src/__tests__/harness-slot-check-kernel.test.js

DEADLINE=$((SECONDS + 60))
until psql "$DB_URL" -Atqc "SELECT count(*) FROM initiative_runs WHERE phase='failed' AND completed_at > NOW() - interval '5 minutes';" | grep -Eq '^[1-9][0-9]*$'; do
  [ $SECONDS -lt $DEADLINE ] || { echo "FAIL: timeout after 60s"; exit 1; }
  sleep 2
done
psql "$DB_URL" -Atqc "SELECT count(*) FROM task_status_history WHERE created_at > NOW() - interval '5 minutes';" | grep -Eq '^[1-9][0-9]*$'

bash scripts/check-version-sync.sh
node -e "const fs=require('fs');const y=fs.readFileSync('regression-contract.yaml','utf8');if(!/current sha|current_sha|head sha/i.test(y))process.exit(1)"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| failure terminalizer 出口收口 / target exhaustion retry / reconciler / slot / API completed_at / current SHA 守门 | `tests/kernel-failure-terminalizer.contract.test.js` | `统一失败出口接入 failure terminalizer` / `all_execution_targets_exhausted 仅前 3 次回 queued 第 4 次 hard fail` / `reconciler 仅处理 latest kernel v2 terminal run 的精确幽灵态` / `slot allocator 继续以 task status 为 SSOT 且 failed API 补 completed_at` / `ghost fixture 只读回归且 current SHA 证据已接线` | 目标模块/导出尚不存在或未接线时 import/行为断言直接失败；即便存在空壳实现，也会在 failureClass/retry/latest/current_task_id/slot/current SHA 断言处失败 |
| 真 PG 原子性 / 回滚 / 幂等 / claim / history | `tests/kernel-failure-terminalizer.pg.contract.test.js` | `hard failure 原子终结 run task history claim 并保持幂等` | 未实现事务与真实表写路径前，PG 集成测在 completed_at/history/claim/rollback 断言处失败 |
