# Kernel Harness 控制面收敛修复 PRD

**日期**：2026-07-30

**状态**：待 Owner 书面确认

**Owner**：Cecelia Owner

**适用仓库**：`zenithjoy/cecelia`；涉及 Controller skill SSOT 时联动 `zenithjoy-skills`

**基线**：`origin/main@e583f4aab8092f23fbefdbfd9ce29558f475ff51`

**性质**：P0 数据正确性与自主收敛修复，不是新 Harness 架构，不重写 Commander/Fleet

**根因核证**：`kernel-harness-convergence-four-roots-verified.md`（生产库实弹、代码和容器日志）

---

## 0. 一句话裁决

Worker 能执行，当前失败发生在控制面：Run 身份不唯一、失败不关闭父任务、异步
callback 不进入决策账本、孤儿守卫又把失败任务重新点火。修复必须把
`task_id → run_id → attempt_id → lease_generation` 变成不可绕过的身份链，并让
每个异步终态进入同一个 append-only 收敛状态机。

---

## 1. 事故结论与证据

### 1.1 根因一：按 Initiative 批量改写 Run 历史

`PATCH /api/brain/orchestrator/relay-runs/:initiative_id` 当前执行：

```sql
UPDATE initiative_runs
SET ...
WHERE initiative_id = $1
  AND orchestrator_version = 'v2'
```

一个 initiative 已经可以拥有多条 run，但 mutation 仍假设“一条 initiative
只有一条 v2 run”。生产库事务内复现：一条 PATCH 同时命中 #4457 的 25 条 run；
16 条 failed run 的 `completed_at` 精确到微秒相同。Controller 的阶段进度 PATCH、
watchdog 更新和无排序的详情 GET 都继承了同一错误假设。

### 1.2 根因二：新 Run 生下来就没有 Task 身份

不是后续逻辑把 `current_task_id` 清成 NULL。生产证据和代码共同证明：

- 仓库没有 `SET current_task_id = NULL` 的写路径；
- migration 238 的该列没有外键或非空约束；
- `POST /relay-runs/:initiative_id` 的 INSERT 列清单根本不含
  `current_task_id`；
- 05:09 后新建的 NULL run 初始 phase 为 `gan/generate`，与前台点火端点指纹吻合。

该端点也没有记录创建来源，无法从账本证明哪个前台或恢复链路重复 POST。

### 1.3 根因三：异步 Callback 对 Loop 不可见

Dispatcher 启动容器后立即同步返回 `DONE`。Loop 只消费这个同步返回值，把“成功
启动”误当成“工作完成”。真实 callback 的 `blocked/needs_context` 只写
`harness_attempts`；`blockedStreak` 却只从 decision log 的 `deny:*` 行推导。

结果是：

1. 异步失败没有进入收敛状态机；
2. 下一轮只看到 generator 跑过但没有 PR；
3. derive 进入 `generator-fix(no_pr)`；
4. `fixRound` 只是观测，不负责停止；
5. 同一无进展状态可持续烧额度。

### 1.4 根因四：Run 失败后父 Task 悬空并被重复点火

`markRunFailed()` 只更新 `initiative_runs.phase/failure_reason`，既不写
`completed_at`，也不更新父 `tasks`。成功路径却会事务性更新 run 和 task。

生产现场有 3 个 `in_progress` task，分别挂 24、4、15 条 failed run。验证期间
其中一项又新生第 25 条。日志证实重复引擎为：

```text
orphan-guard → no_kernel_run → requeue → tick 再派
```

判活查询用 `current_task_id OR initiative_id` 兜底，spawn 去重只用
`current_task_id`。NULL run 因而“判活看得见，去重看不见”。

### 1.5 指标裁决

历史 `81 run / 0 done` 是批量污染与重复点火的复合产物，不能代表 Kernel Harness
真实成功率。现有 Worker attempt 完成率可以证明执行介质并非主要故障，但也不能
替代端到端成功率。修复前不得对外引用被污染 run 的成功率。

---

## 2. 目标、非目标和阶段边界

### 2.1 目标

1. 一个 task 在任一时刻最多有一个非终态 Kernel run。
2. 所有 Run mutation 精确命中 `run_id`，不再按 `initiative_id` 更新。
3. Run 与父 Task 的完成、失败保持事务一致。
4. “已启动”和“已完成”在协议上分离。
5. 所有异步 callback 以身份栅栏写入 append-only decision log。
6. 同一无进展签名不会无限重试；真实进展不受固定代码量或固定轮数限制。
7. 历史数据只在可证明时重建，否则明确标记不可信并排除出指标。
8. 用一个真实业务任务证明完整 Kernel Harness 链路收敛。

### 2.2 非目标

- 不重写 Commander、Planner、GAN、Generator、Evaluator、Judge、Reporter
  或 Fleet 架构。
- 不改变 Provider-neutral 模型选择策略。
- 不把 Phase 4B/4C/4D 或 Phase 5 混入本修复。
- 不以 LOC、固定 fix round 或自然语言“看起来有进展”作为收敛依据。
- 不用 synthetic canary 代替真实业务验收。
- 不删除或伪造历史记录。
- 不处理与本事故无关的 dashboard、Golden Path 合同或断言盖章功能。

### 2.3 完成边界

本 PRD 在第 12 节四个语义阶段全部完成、真实业务验收通过后结束。它只宣称
“Kernel Harness 控制面收敛修复完成”，不宣称 Provider-neutral Harness 总 PRD
或 Fleet 全阶段完成。

---

## 3. 权威身份模型

| 身份 | 含义 | 基数与职责 |
|---|---|---|
| `initiative_id` | 业务目标聚合 | 一个 initiative 可以有多个 task 和多个历史 run；只用于查询聚合 |
| `task_id` | 一次可终结的调度任务 | 一个 task 同时最多一个 active Kernel run |
| `run_id` | 一次 Kernel 状态机执行 | Run 的唯一 mutation key |
| `attempt_id` | 某个角色的一次 Provider 执行 | 属于唯一 run/hop/role |
| `lease_generation` | Attempt 租约代次 | 阻止旧 Worker callback 覆盖新租约 |

### 3.1 不变量

1. `initiative_id` 永远不是 Run mutation key。
2. 新建 v2 Kernel run 必须同时有 `current_task_id` 和 `created_source`。
3. `current_task_id` 必须引用真实 task；业务层不得接受 NULL。
4. 同一 `current_task_id` 最多存在一个 phase 不为 `done/failed` 的 v2 run。
5. Run 进入终态时必须写 `completed_at`。
6. Run 失败与父 Task 失败必须在同一数据库事务提交。
7. 终态 task 不允许被 orphan guard、watchdog 或 tick 原地复活。
8. 自动恢复必须创建有 lineage 的后继 task/run；不得把已终态 task 改回 queued。
9. Callback 必须匹配 `run_id + attempt_id + lease_generation + lease_owner`。
10. 迟到、重复或旧租约 callback 只能幂等确认或返回 409，不能改写当前状态。
11. 所有影响路由的异步结果必须先写 append-only decision event，再由 loop 投影。
12. 指标默认只统计 `trusted` 与满足指定口径的 `reconstructed` 记录。

这些不变量由数据库约束、事务边界和集成测试共同执行，不能只写在注释里。

---

## 4. 数据模型与数据库约束

### 4.1 `initiative_runs` 增量字段

新增：

```sql
created_source TEXT
  CHECK (created_source IN (
    'kernel_dispatch',
    'foreground_handoff',
    'explicit_recovery',
    'historical_reconstruction'
  ));

record_trust_status TEXT NOT NULL DEFAULT 'untrusted'
  CHECK (record_trust_status IN ('trusted','reconstructed','untrusted'));

record_trust_reason TEXT;
predecessor_run_id UUID REFERENCES initiative_runs(id);
```

含义：

- 新 canonical 创建路径写 `trusted`。
- cutover 前的历史行先统一视为 `untrusted`。
- 只有确定性对账成功的行才升级为 `reconstructed`，并填写原因和来源。
- `predecessor_run_id` 只描述显式恢复谱系，不等于允许复活旧 task。
- successor task 的 payload 必须同时写 `recovery_of_task_id` 和结构化
  `recovery_reason`；新 run 的 `predecessor_run_id` 指向旧 terminal run。

### 4.2 Task 外键

在清点历史非法值后为 `current_task_id` 增加到 `tasks(id)` 的外键。历史 NULL
不强行猜测回填；NULL 历史行保留并标记 `untrusted`。新 canonical API 和所有内部
spawn 路径应用层强制非空。

若 PostgreSQL 无法在不污染历史的前提下一次加入全表 `NOT NULL`，采用：

1. 外键 `NOT VALID`；
2. 新写路径的 trigger/check 约束只覆盖 cutover 后记录；
3. 重建完成后再评估是否将全表升级为 `NOT NULL`。

不得为了过迁移而把 initiative ID 猜成 task ID。

### 4.3 单 active run 唯一索引

```sql
CREATE UNIQUE INDEX ... ON initiative_runs(current_task_id)
WHERE orchestrator_version = 'v2'
  AND current_task_id IS NOT NULL
  AND phase NOT IN ('done', 'failed');
```

Migration 前必须先生成冲突报告。对同 task 多条 active run：

- 有且仅有一条能由活跃 PID、最新有效 lease 或 callback 证明仍在执行时，保留它；
- 其余以 `duplicate_active_run_reconciled` 终结并标记历史可信度；
- 无法证明哪条活跃时，全部 drain，交人工选择，禁止按时间戳猜。

### 4.4 Attempt 身份

`harness_attempts` 已有 `run_id` 与 `lease_generation`。本修复补齐数据库/Store 层
条件更新，使 terminal write 同时匹配：

```text
attempt.id
+ attempt.run_id
+ lease_owner
+ lease_generation
+ 当前非终态
```

Callback result 和 decision event 都保存这四项。

---

## 5. Canonical Run API

### 5.1 创建

```http
POST /api/brain/orchestrator/relay-runs
```

请求：

```json
{
  "initiative_id": "uuid",
  "current_task_id": "uuid",
  "phase": "planning",
  "journey_id": "uuid-or-null",
  "created_source": "foreground_handoff"
}
```

语义：

- 在事务内锁定 task；
- 校验 task 类型、initiative 归属和非终态状态；
- 查找 active run；存在则幂等返回同一个 `run_id`；
- 不存在则创建；
- 并发 POST 由 unique index 收敛为同一 active run；
- 响应总是携带 `run_id`。

不得再从 URL 参数暗推 `current_task_id`。

### 5.2 精确读取和更新

```http
GET   /api/brain/orchestrator/relay-runs/by-id/:run_id
PATCH /api/brain/orchestrator/relay-runs/by-id/:run_id
```

PATCH 的 SQL 必须包含 `WHERE id = $1 AND orchestrator_version='v2'`。响应校验
`rowCount === 1`；零行为 404，多行在主键约束下不可能发生。

中间进度、PR URL、Evaluator/Judge verdict、cost 和终态全部走 exact-run API，
或走内部同等严格的 `run_id` Store 方法。

### 5.3 Initiative 历史读取

```http
GET /api/brain/orchestrator/relay-initiatives/:initiative_id/runs
```

它返回有确定排序的历史列表：

```text
ORDER BY started_at DESC, id DESC
```

只读聚合端点永远不能被复用为 mutation。

### 5.4 Legacy 迁移

现有 `GET/PATCH/POST /relay-runs/:initiative_id` 分两步退役：

1. 兼容窗：旧 PATCH 先查询候选；零条 404，多条 409 fail closed，恰一条时内部
   转为 exact `run_id` 更新并发出 deprecation 日志。禁止直接
   `UPDATE ... WHERE initiative_id`。
   旧 POST 必须补交 `current_task_id/created_source` 后委托第 5.1 节的同一事务；
   缺任一字段即拒绝，不能继续产生 NULL 身份。
2. Controller skill SSOT 和所有调用方部署完成后：旧 mutation 返回 410；
   旧 GET 改为显式历史列表或迁移到第 5.3 节。

兼容窗必须有截止版本和调用计数。PR2 结束时，生产日志中 legacy mutation 调用数
必须归零。

---

## 6. Run 与 Task 统一终态

新增单一内部能力：

```text
finalizeKernelRun({
  runId,
  outcome: done | failed,
  reason,
  expectedTaskId,
  evidence
})
```

事务内：

1. `BEGIN`；
2. `SELECT initiative_runs ... FOR UPDATE`；
3. 校验 `current_task_id === expectedTaskId`；
4. 若已终态，返回幂等结果，不覆盖先前终态；
5. 更新 run 的 phase、reason、`completed_at`、`updated_at`；
6. 对 done 更新 task 为 `completed`；
7. 对 failed 更新 task 为 `failed`，写 `error_message/completed_at`；
8. 写 append-only terminal decision event；
9. `COMMIT`。

任一步失败全部回滚，不允许出现 failed run + in_progress task。

### 6.1 启动失败

Kernel 进程或 Worker job 启动失败也调用同一终态能力。现有
“run failed、task 改回 queued”的两段非事务写必须删除。需要自动恢复时，由
Commander 根据结构化失败类创建一个新的 successor task，并记录
`recovery_of_task_id/predecessor_run_id`。

### 6.2 Orphan Guard

对 `harness_runtime='kernel-v1'`：

- task 已终态：永不 requeue；
- 存在 active run：按该 run 的 heartbeat/PID/attempt lease 判活；
- 只存在 terminal run：把 task/run 不一致交给 reconcile，禁止点火；
- 完全没有 run：只对 cutover 前可信的 legacy 情形保留恢复；cutover 后视为数据
  不变量破坏，fail closed + 告警；
- `no_kernel_run` 不再直接等价于“可 requeue”。

旧 relay 的容器守卫语义不在本 PRD 中扩大修改。

---

## 7. 异步执行协议

### 7.1 Dispatcher 返回值

成功持久化 launch receipt 后，Dispatcher 返回：

```json
{
  "status": "LAUNCHED",
  "run_id": "uuid",
  "attempt_id": "uuid",
  "lease_generation": 3,
  "provider": "codex"
}
```

`LAUNCHED` 只表示“外部执行已接管”，不表示角色完成。不得再返回语义 `DONE`。
Loop 对 `LAUNCHED` 写 `effect:attempt_launched` 后等待 callback/reconcile，不派下一棒。

### 7.2 Callback 身份栅栏

Callback 必须包含或由路径、认证上下文唯一证明：

```text
run_id
attempt_id
lease_owner
lease_generation
role
hop
```

服务器校验：

- body/path attempt ID 一致；
- attempt 所属 run 与 body/context run 一致；
- owner 与当前 lease 一致；
- generation 与当前 generation 一致；
- role/hop 与 attempt 建档一致；
- 当前 attempt 尚未被更晚租约取代。

不一致返回 409，并写安全遥测；不得落业务 decision event。

### 7.3 Callback 到决策账本

Attempt terminal write 与 `orchestrator_decision_log` append 必须在同一 PostgreSQL
事务完成。不能只写 attempt 后 best-effort 追加，也不在本阶段引入第二套 outbox。

标准事件：

```text
verdict:attempt_callback
```

detail 至少含：

```json
{
  "run_id": "uuid",
  "attempt_id": "uuid",
  "lease_generation": 3,
  "role": "generator",
  "status": "blocked",
  "failure_class": "infrastructure_blocked",
  "failure_signature": {},
  "artifacts": []
}
```

Loop 只从 append-only 事件和外部真相投影收敛状态，不轮询可变自然语言摘要。

### 7.4 Callback 路由表

| Callback 状态 | Attempt 终态 | Decision 语义 | 下一步 |
|---|---|---|---|
| `completed` | completed | allow | 重新 collect 外部真相，再 derive |
| `completed_with_concerns` | completed_with_concerns | allow+concerns | 记录 concerns，按合同路由 |
| `needs_context` | needs_context | deny:NEEDS_CONTEXT | pause，进入人答例外 |
| `blocked` + infrastructure | blocked | deny:BLOCKED | 仅允许预算内 infra failover |
| `failed` + `semantic_refusal` | failed | deny:SEMANTIC_REFUSAL | 不换机器盲重试；人审或终败 |
| `failed` | failed | deny:FAILED | 依结构化签名判断恢复或终败 |
| `cancelled` | cancelled | deny:CANCELLED | 终结 attempt；按取消来源决定 run |

`blocked/needs_context` 不再属于“成功终态集合”；它们是“已可靠收到的控制终态”。

---

## 8. 收敛与恢复策略

本 PRD 保留既有“有可验证进展就允许继续，不设固定 fix 轮数上限”的裁决，但补上
异步结果缺口。收敛依据只能是结构化证据：

- 新 Git SHA；
- 服务端确认的 PR head；
- 更小或从未见过的失败集合；
- 新 artifact；
- 机器/Provider/transport 的可证明基础设施变化；
- 明确的人类上下文或合同变更。

代码行数、Agent summary、等待时长和“换个模型再试试”都不构成进展。

### 8.1 无 PR

Generator completed 但没有 PR：

1. 首次出现某结构化失败签名，可创建一次带该签名的 recovery attempt；
2. 相同签名再次出现，run 终态 failed；
3. 如果恢复产生新的 Git SHA、artifact 或更小/新失败面，视为新状态，可继续；
4. 无结构化签名视为 `unknown_no_pr`，第二次即停止。

### 8.2 Infrastructure blocked

- 只有 `failure_class='infrastructure_blocked'` 能走自动 infra failover；
- failover 必须改变 machine/provider/transport 中至少一项，并受现有预算护栏限制；
- 同一基础设施签名在没有环境变化时不得重试；
- 三机均不可用时显式 failed/paused，不得静默回本机假装成功。

### 8.3 Needs context

进入 `paused` 并生成一次人类例外请求。回答必须绑定 run、hop 和上下文版本；
旧回答不能解锁新上下文。

### 8.4 Semantic refusal

语义拒绝不是基础设施故障。不得通过换机器无限重放相同提示。若合同允许重写任务，
由 Commander 生成新指令和新签名；否则终败或上浮人审。

### 8.5 终态不可逆

Run/task 终态后任何晚 callback、watchdog 或 orphan sweep 都不能复活它。需要继续
业务目标时创建 successor task/run，并保留 lineage。

---

## 9. 历史修复与可信度

Owner 已裁决：**可证明则重建，否则标记不可信。**

### 9.1 可证明重建

只有以下证据能参与重建：

- 唯一 task ↔ run 直接引用；
- 唯一 attempt.run_id；
- 已验证的 decision log hop；
- GitHub PR head/merge receipt；
- 有 lease generation 的 callback；
- 可验证的 orchestrator heartbeat/PID 时间窗；
- Controller 产生且能与唯一 run 对齐的 receipt。

重建脚本必须是：

- dry-run 默认；
- 输出逐行 reason 和 before/after；
- 可重复执行且幂等；
- 单事务分批提交；
- 不删除原始记录；
- 生成不可变审计报告。

### 9.2 不可信

无法唯一归属的 NULL `current_task_id`、被批量 PATCH 覆盖的终态字段、来源不明的
重复 run，保留原样并标记：

```text
record_trust_status = untrusted
record_trust_reason = <枚举原因>
```

不得用 started_at 最近、UUID 前缀相似或 initiative_id 相等来猜归属。

### 9.3 生产止血

上线迁移前进入 Kernel admission drain：

1. 暂停创建新的 Kernel run；
2. 不停止已确认仍活跃的 Worker attempt；
3. 快照冲突清单和相关表；
4. 部署 exact-run API、事务终态和约束；
5. 执行 reconciliation dry-run；
6. 审核后 apply；
7. 复验无 active 冲突；
8. 恢复 admission。

历史行不得物理删除。当前 3 个重复点火 task 按同一政策处置：能证明则重建，
否则终结悬空 task、保留 run 并标记不可信。

---

## 10. 指标与可观测性

### 10.1 新口径

至少输出：

- trusted task 端到端完成率；
- trusted run 终态分布；
- attempt 完成率，按 role/provider/machine/transport 分组；
- retry amplification：每个 task 的 run 数、每个 run 的 attempt 数；
- duplicate-active-run 拦截次数；
- stale callback 409 次数；
- legacy initiative mutation 调用次数；
- untrusted/reconstructed 历史数量；
- task/run terminal mismatch 数量；
- no-progress signature 终止次数。

### 10.2 分母

- `trusted`：进入正式 SLO 分母；
- `reconstructed`：单独报告，可进入趋势但不得与原生 trusted 混称；
- `untrusted`：只报污染规模，不进入成功率分母。

修复前的 `81/0` 在知识页和运营报告中标记“已污染、不可引用”。

### 10.3 告警

下列任一立即 P0/P1 告警：

- 同 task active run 唯一约束冲突；
- terminal run + nonterminal task；
- terminal task + active run；
- callback 身份栅栏连续失败；
- legacy PATCH 在退役版本后仍被调用；
- admission 恢复后出现 NULL `current_task_id/created_source`；
- 同一 no-progress signature 被派发超过政策允许次数。

---

## 11. TDD：Red → Green 验证矩阵

所有实现先提交能在旧代码上失败的 Red 测试。禁止把测试改成读取源码字符串来绕过
真实路由/事务；关键场景使用真实 Router、Store 和 PostgreSQL 并发测试。

| ID | Red 场景 | Green 验收 |
|---|---|---|
| R1 | 同 initiative 预置 25 条 run，PATCH 一条 | 只改指定 run_id，其余 24 条字节级不变 |
| R2 | 两个并发 POST 同一 task | 恰一条 active run，两响应同 run_id |
| R3 | 创建 v2 run 缺 task/source | 4xx fail closed，数据库无新增 |
| R4 | run 失败时 task 仍 in_progress | 同事务得到 failed run + failed task + completed_at |
| R5 | 事务中 task 更新失败 | run 更新回滚，不能半终态 |
| R6 | terminal run 对应 in_progress task 被 orphan sweep | 不 requeue、不新建 run，产生 mismatch 告警 |
| R7 | launch receipt 成功 | Dispatcher 返回 LAUNCHED，Loop 不把它当 DONE |
| R8 | 异步 BLOCKED callback | 同事务写 attempt 终态和 deny:BLOCKED decision event |
| R9 | 异步 NEEDS_CONTEXT callback | run paused/等待人答，不进入 no_pr fix |
| R10 | 相同 no-PR 签名第二次出现 | run/task failed，不产生第三个 attempt |
| R11 | 旧 generation callback 晚到 | 409，attempt/run/decision log 均不被污染 |
| R12 | callback 重试同一 payload | 幂等 ack，只存在一个 terminal event |
| R13 | 批量污染历史无法唯一重建 | 标记 untrusted，指标分母排除 |
| R14 | 可由唯一 attempt/run 证明的历史 | 标记 reconstructed，审计原因完整 |
| R15 | 三机均不可用 | 显式 infra blocked/failed，不静默本机执行 |
| R16 | 真实业务任务跑完整链 | 一个 task、一个 terminal run、角色事件齐全、无隐式重排 |

### 11.1 回归池

除新增测试外至少覆盖：

- relay-runs create/read/patch；
- harness-skill-relay；
- kernel-liveness 与 harness-orphan-guard；
- orchestrator dispatcher/loop/derive/counters；
- attempt callback、lease、launch receipt；
- Commander/Fleet production wiring；
- migrations 真 PostgreSQL；
- Brain 全量测试、DevGate 和 GitHub required checks。

---

## 12. 实施拆分与依赖图

```text
PR1 身份与终态止血
  ├─> PR2 Exact Run API + 历史可信度
  │      └─> zenithjoy-skills Controller SSOT 切 run_id
  │             └─> 关闭 legacy mutation
  └─> PR3 Callback 收敛状态机
             └─> PR4 生产 reconcile + 真实业务验收
```

### PR1：身份与终态止血

范围：

- migration：created source、Task 外键准备、active-run 唯一约束；
- canonical create transaction；
- spawn/dedupe/liveness 统一按 task_id；
- `finalizeKernelRun` 事务双写；
- launch failure 走统一终态；
- orphan guard 不复活 terminal Kernel；
- 冲突扫描和 admission drain。

不包含：Controller skill 迁移、callback 路由重构、历史 apply。

### PR2：Exact Run API 与历史可信度

范围：

- exact GET/PATCH by run_id；
- initiative 历史只读端点；
- legacy mutation 兼容窗与 410 退役；
- watchdog/controller 调用改为 run_id；
- `zenithjoy-skills` Controller SSOT 单独 PR；
- migration：record trust 与 recovery lineage 字段；
- 历史分类器和 dry-run 报告；
- 指标过滤 trust status。

跨仓顺序：

1. Cecelia 先部署兼容 exact-run API；
2. skills SSOT 发布并让 Controller 保存/传递 run_id；
3. 生产观测 legacy 调用归零；
4. Cecelia 关闭 legacy mutation。

不允许直接编辑部署副本冒充 SSOT 变更。

### PR3：Callback 收敛

范围：

- Dispatcher `LAUNCHED`；
- callback 四元身份栅栏；
- attempt terminal + decision event 原子落库；
- Loop 消费异步终态；
- no-PR/blocked/needs-context/semantic-refusal 路由；
- late callback 与幂等；
- structured progress 收敛。

不包含：模型策略调整、固定轮数或 LOC cap。

### PR4：生产修复与真实验收

范围：

- drain；
- 历史 dry-run、审核后的 apply 和审计报告；
- 当前重复点火 task 对账；
- trusted 指标重算；
- 真实业务任务端到端执行；
- 生产 receipt、三机可达性和 CI 证据；
- 运营知识页更新“旧 81/0 不可信”和新口径。

不得用 synthetic canary 替代 R16。

### 12.1 文件边界预估

具体计划可在代码勘察后缩小，但不得跨越语义阶段：

| PR | 主要文件域 |
|---|---|
| PR1 | `migrations/`、`orchestrator/run-store/finalize`、`harness-skill-relay.js`、`kernel-liveness.js`、`harness-orphan-guard.js` |
| PR2 | `routes/initiatives.js`、`harness-relay-watchdog.js`、trust/reconcile/metrics 模块、Controller skill SSOT |
| PR3 | `orchestrator/dispatcher.js`、`routes/harness-callback.js`、`attempt-store.js`、`loop.js`、`counters.js`、`derive.js` |
| PR4 | reconcile CLI/运营脚本、生产验证文档与 receipts；只修验收发现的同阶段缺陷 |

每个修改 `packages/brain/src/` 的 PR 都必须同步 Brain 版本和
`packages/brain/DEFINITION.md`。所有代码通过 `/dev`、DevGate、独立复审和 required
checks；不得直接 push main。

---

## 13. 上线、回滚与安全

### 13.1 上线顺序

1. 先上只读诊断和 admission drain；
2. PR1 数据约束与事务终态；
3. PR2 exact API；
4. Controller skill 切换；
5. legacy mutation 关闭；
6. PR3 async callback 收敛；
7. PR4 历史修复与真实业务任务；
8. 指标稳定观察后关闭 repair drain。

### 13.2 回滚

- Schema 采用 additive migration；回滚应用版本时不删除新列或审计数据。
- Unique index 上线前保留冲突清单；若误阻塞，只能进入 drain 后修复数据，不得直接
  删除索引恢复重复点火。
- Callback 新旧协议在兼容窗内双读，但只允许一份 canonical event 生效。
- Legacy mutation 不因回滚重新开放批量 UPDATE；必要时只开放 exact-run 兼容适配器。

### 13.3 凭据和机器边界

- Xian 节点不得保存或复制长期 Codex 凭据；
- OrbStack/Docker 仍是统一执行介质；
- callback 网络、机器 attestation、Runner digest 和 lease generation 继续
  fail closed；
- 本修复不降低 Phase 4A admission 约束。

---

## 14. 验收标准

只有同时满足以下条件才可宣称完成：

1. 生产 schema 阻止同 task 多 active run。
2. 所有 Run mutation 生产调用按 run_id，legacy mutation 计数为 0。
3. 新建 Kernel run 的 `current_task_id/created_source` 为 100% 非空。
4. 任一 run 终态后，对应 task 同事务终态；mismatch 查询为 0。
5. async `blocked/needs_context/failed/cancelled` 全部在 decision log 可回放。
6. 相同 no-progress signature 不产生超政策重试。
7. 迟到旧 callback 无法改变当前 run。
8. 历史记录全部被分类为 trusted/reconstructed/untrusted，且无猜测回填。
9. 新成功率只使用合规分母，旧 `81/0` 明确下线。
10. R16 真实业务任务完成 Commander → Planner → GAN → Generator →
    Evaluator → Judge → Merge/Report，且只有一条 terminal run。
11. 最新 Brain/Fleet/三机生产检查和 required CI 全绿。
12. Brain 版本、DEFINITION、知识页、运行手册和回滚说明同步。

---

## 15. 待 Owner 签字的裁决

本 PRD 没有遗留技术方案选择；Owner 只需确认以下整体边界：

> 同意以“task 终态不可复活、恢复创建 successor task/run、历史可证明则重建否则
> untrusted、无固定 LOC/fix-round 上限、真实业务任务终验”为最终实施合同。

签字后进入实施计划和 Red 测试，不再重新讨论已核证的四条根因。
