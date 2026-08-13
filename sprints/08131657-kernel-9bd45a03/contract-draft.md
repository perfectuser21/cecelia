# Sprint Contract Draft (Round 1) — 真身 Session Controller：每条 kernel run 一个常驻监护进程

> journey_type: autonomous ｜ target_environment: local_api
> 锚定父路声明：独立小路（无父路）——本 line（journey e6f803f2）下 ability 均为 planned，无 done/working 的已验收 golden_path 可锚定（PRD「累积 FR」段已注明）。
> gp-anchor: skipped (product-map.json not found)  — 本仓库（cecelia）无 `product-map/generated/product-map.json`，GP-Anchor 段整体跳过（Step 1.7 file-existence gate）。
> contract-gate: cecelia worktree，`packages/brain/src/lib/contract-gate.js` 存在，代码层 Contract Gate 生效；本合同断言遵循「Contract Gate 合规惯用法速查表」。
> map-radius: [MAP_NOT_CONFIGURED] — task.payload.map_scope / map_repo 缺失，无 Unified Map affected_business_nodes / must_run_assertions 可注入（不回退领域硬编码）。

---

## Response Schema（推导来源: PRD 无 HTTP 响应）

N/A — 任务无 HTTP 响应。本 sprint 是 `packages/brain/` 纯后端进程编排（Controller/Kernel 生命周期），不新增/改动任何 HTTP 端点，无 request/response body。验证 oracle 全部落在**真 Postgres 行状态 + 真 OS 进程存活/信号 + 真本地 git 仓库 head**，不是 curl jq schema。Reviewer 第 6 维 verification_oracle_completeness 按「进程/DB/git 三类真执行断言覆盖 Golden Path 6 步」核，不按 jq 字段清单核。

---

## 已知约束（来自回归测试 + 累积 FR + 铁律）

- `[回归] kernel-controller-lifecycle.pg.integration.test.js` → Kernel fatal 只结束 Kernel、Controller ownership（controller_session_id）存活；failure_reason 结构化脱敏；无主 run（controller_session_id 空 / lease 过期）fail-closed 进恢复，健康 owned run 不被误伤。**本 sprint 不得回退这些断言。**
- `[回归] kernel-controller-ownership.pg.integration.test.js` → createKernelRun 无 controllerSessionId fail-closed 拒建；ownership + lease 在同一创建事务落库。**不得回退。**
- `[回归] harness-orphan-guard` → `reconcileOwnerlessKernelRuns` 由 orphan-guard 定时器调用，作为无主兜底（`packages/brain/src/lib/harness-orphan-guard.js:422`）。本 sprint **仅将其降级为后备，逻辑不动**。
- `[累积FR]` context-manifest（`/api/brain/line/e6f803f2-.../context-manifest`）返回空 → 本 line 暂无历史累积 FR（与 PRD「累积 FR」段一致）。
- `[铁律映射见下方 DoD INV-1..INV-5]`。

---

## 禁 mock 边清单（v9.12 硬规则 — 本单命中 调度/状态机/跨模块数据传递/生命周期钩子/DB写路径 全部五类）

本单是接缝层改动，failing test 必须**不 mock 被改的那条边**（真 PG、真进程、真 git 仓库），只许 mock 更外层无关依赖（如 GitHub API 网络层、Bark 通知）：

- **代码 ↔ `initiative_runs` 表**（controller ownership / lease / freeze 列的读写）：真 `pg.Pool` 连真 PG；`createKernelRun` / `finalizeKernelRun` / `renewControllerLease` / `enforceHumanReviewPushFreeze` / `writebackControllerFinalResult` 全真代码路径，禁 stub pool。
- **代码 ↔ `tasks` 表**（终局 `result` 回写：pr_url/merged/summary）：真 PG UPDATE，测试真查 `tasks.result`。
- **`_spawnKernelRuntime` ↔ Controller 守护进程 spawn**：真 `child_process.spawn(..., {detached:true})` 起真 Controller 进程，禁 mock spawn 返回假 pid。
- **Controller ↔ 被监护进程（Kernel 位）存活探测/信号**：真 OS 进程 + 真 `kill -9` + 真 `assessKernelLiveness`（真 `process.kill(pid,0)` 探活 + 真 PG heartbeat）。允许通过依赖注入把「Kernel 位」换成一个**真实**的廉价子进程（写心跳后阻塞等待信号）——这是 DI 不是 mock：被改的边（进程存活检测 + PG lease/state 迁移）全程真跑，Kernel **内部的 LLM 阶段工作**才是本监护循环的外层边界（不在本单被改，可不真起）。
- **Controller ↔ orphan-guard 后备**：`reconcileOwnerlessKernelRuns` 真扫真 PG 真收敛（Step 6 后备回归）。
- **Controller ↔ 本地 git 仓库（人审 push 冻结）**：真建 bare remote + 真 clone + 真 push 尝试，断言真 head 未越过冻结 SHA（拒止/回滚生效）。禁 mock git 命令返回值。

> 无「纯 UI / 纯文档」豁免——本单是核心接缝改动，清单非空。generator 测试中任一 `vi.mock`/`stub` 命中以上边 = CONTRACT-IS-LAW FAIL（evaluator 机械 grep 核查）。需要真 PG 的测试放 `packages/brain/src/__tests__/integration/*.pg.integration.test.js` 并登记进 `vitest.config.js` 的 `POSTGRES_INTEGRATION_TESTS`，由 brain-integration job 起真 PG 跑。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 系统对外承诺 | 每条 kernel run 启动一个常驻真身 Controller 守护进程：先取 ownership 再拉 Kernel；周期续租 lease；监护 Kernel 存活并按 failure_class 决策 resume/结构化终止；人审期冻结 PR 分支 push；守到 merged 回写 task result 才退出。 |
| **NFR（做得多好）** | 性能/可靠性 | Kernel fatal 检测延迟上限 = `KERNEL_HEARTBEAT_STALE_MS`(3min) + 一个监护循环周期；lease 续租周期 < lease TTL（`CONTROLLER_LEASE_DEFAULT_SECONDS`=1800s），续租间隔取 lease TTL 的 1/3（≤600s），保证 Controller 存活时 lease 永不过期。**judgment-pending-user: lease 续租间隔具体值（PrepPRD 未给显式数值，PRD 假设③沿用现有 heartbeat 节拍；建议 600s，待主理人/对齐会确认）。** |
| **Invariant（永不违反）** | 不变量 | ①任何活跃 Kernel run 前必先有有效 Controller ownership（已有不变量，不回退）；②Controller 存活 ⇒ lease 不过期；③失败终局必结构化回传，禁无声消失；④Controller 只监护不执行（不派发 planner/proposer/generator/evaluator/judge，不绕 Gate，不改 Kernel 状态机权威）；⑤merge 权归 Controller，其它角色禁自 merge（铁律 e8230eb5）。 |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方「判定点登记表」（Kernel 是否死 / 是否可恢复 / 是否人审期 / 是否 merged）。 |
| **保质期（何时过期）** | 失效与退役 | Controller 生命周期 = 单条 run 生命周期（run 达 done/failed 即退役）；lease TTL 1800s，过期即由 orphan-guard 接管退役该 Controller 的 ownership。 |
| **死亡告警（停了谁知道）** | 告警手段 | Controller 死 → lease 过期 → orphan-guard 定时巡检（与孤儿巡检同节奏）检测并 fail-closed 恢复 + 日志 `[orphan-guard] ownerless kernel runs recovered=N`；不新增告警渠道（后备机制既有）。 |
| **失败语义（挂了怎么办）** | 放行/拦截/重试 | 见「失败语义声明」。核心：不可恢复类 fail-closed 结构化终止（拦截，不静默 done）；可恢复类幂等 resume；Controller 自身崩溃由 lease 过期 + orphan-guard 兜底（后备）。 |
| **效果确认（已发≠已生效）** | 回执验证 | 终局回写后真查 `tasks.result` 含 `pr_url`+`merged`+`summary`；resume 后真查被监护进程重新存活 + run 未进无主态；冻结后真查 git head 未越过冻结 SHA。 |

### 判定点登记表（对模糊现实的判断假设 — decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息 |
| ⚠️ Kernel 进程是否已死 | A. 仅看 heartbeat 过期; B. heartbeat + host 一致时 pid 探活(kill(pid,0)) | B（复用 `assessKernelLiveness`，fail-open：拿不到确定答案返回 'unknown'） | 既有铁律：把「我不知道」判成「它死了」正是 51836fb2 事故根因 | 误判存活 Kernel 为死 → 重复 resume 双 spawn / 误终止在跑的 run |
| ⚠️ Kernel fatal 是否可恢复 | A. 一律 resume; B. 按 failure_class 分类(进程崩溃/瞬时基础设施=可恢复, assembly_fault/合同失效=不可恢复) | B（`decideKernelFatalAction`） | 不可恢复类 resume 只会无限撞死；可恢复类终止会丢可救的 run | 可恢复类误终止=丢 run；不可恢复类误 resume=死循环烧 requeue |
| Kernel liveness 返回 'unknown' 时的动作 | A. 当死→resume; B. 不动作(wait) | B（unknown 绝不触发 resume/terminate，只 wait 下一循环） | fail-open 铁律；避免误重启存活 Kernel | 误 resume 存活 Kernel → 双 spawn |
| run 是否处于人审等待期 | A. phase='review' 且 derive action=wait:human_review; B. 显式 flag | A（DB 观察 phase='review' 为人审等待态；merged/rejected 短路先于此） | 复用既有状态机 phase，不新增权威态 | 误判非人审期冻结→饿死正常 push；误判人审期不冻结→head 漂移饿死人审(8783807c 死因) |
| PR 是否 merged（终局） | A. 信本地标记; B. 外部真相 pr.merged（GitHub） | B（`pr.merged` 外部终态真相，derive.js:686 短路到 done/report） | 铁律 636296d4：不得盲信标记，须外部真相核查 | 未真 merged 就回写 merged=true → 假终局 |

> 本 sprint 判定点均登记；⚠️ 标记项（Kernel 死否 / 可恢复否）误判后果严重（丢 run / 死循环），属「升拍板点主动请教用户」级别，见 notes。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| （示例：Brain API 超时） | 返回 503，不写 DB | 是（幂等键=task_id） | 客户端重试 |
| Kernel 进程崩溃（可恢复类） | Controller resume 重拉 Kernel，run 保持活跃不进无主态 | 是（幂等键=run_id；已有 inflight 观测防双 spawn） | resume 超次数上限后降级为不可恢复终止 |
| Kernel fatal（assembly_fault/合同失效，不可恢复类） | `structuredFailureReason` 结构化脱敏终止，run finalize failed，Controller 存活回传 | 是（finalize 幂等，expectedTaskId 校验） | fail-closed，绝不静默 done |
| Controller 自身进程崩溃 | lease 自然过期 → orphan-guard 兜底 fail-closed 恢复（后备，不动） | 是（reconcile 二次纯谓词确认防竞态） | 降级为既有 orphan-guard 收尸 |
| 人审期收到 push | 拒止/回滚（head 不越过冻结 SHA） | 是（幂等：重复 push 一律拒到解冻） | 无（拦截为正确行为） |
| merge 后回写前 Controller 异常 | 终局回写必须在退出前完成；未完成即视为失败终局需结构化回传（铁律 e83b2f0d） | 是（writeback 幂等 upsert） | fail-closed 结构化回传，禁无声消失 |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本 sprint 无对外暴露 agent / 无外部用户可写入接口。Controller 是本机内部守护进程，输入源为 Brain 自身 DB 行 + 本机进程信号，无 prompt injection / 越权指令面。

---

## Golden Path

[createKernelRun 入口] → [Step1 Controller 认领→拉起 Kernel] → [Step2 lease 周期续租] → [Step3 监护循环 fatal 分类决策] → [Step4 人审窗口 push 冻结/解冻] → [Step5 守到 merged 回写 task result 才退出] → [Step6 后备不变：Controller 死→lease 过期→orphan-guard 接管]

---

### Step 1: Controller 真身 spawn + 取得 ownership 后再拉 Kernel
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 条（`_spawnKernelRuntime` 先 spawn 本机 detach 守护进程作为真身 Controller，取得 ownership 后**再**拉 Kernel）。

**可观测行为**: `_spawnKernelRuntime` 被调用后，先 spawn 一个真实的本机 detached Controller 守护进程；Controller 把 `initiative_runs.controller_session_id`（+ `controller_pid`/`controller_host`）写为自身进程身份，**在此之后**才 launch Kernel。ownership 写入时刻严格早于 Kernel launch。

**验证命令**（真 PG + 真进程，见 `## E2E 验收`）:
```bash
# 通过真实 launchController / launchKernel 记录时间戳标记，断言 controller 标记 < kernel 标记，
# 且 run.controller_session_id 与 controller_pid 非空且指向存活进程
bash packages/brain/scripts/run-controller-daemon-test.sh 'B-01'
```
**硬阈值**: 存在活 Controller 进程（`kill -0 controller_pid` 成功）；`controller_session_id` 非空；Controller 就绪标记时间戳 < Kernel launch 标记时间戳。

---

### Step 2: Controller 周期心跳续租 lease（观测两个续租周期）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 条（周期心跳续租，观测连续两个续租周期 lease 持续有效）。

**可观测行为**: Controller 存活期间周期调用 `renewControllerLease` 推进 `controller_lease_expires_at`；连续观测两个续租周期，lease 到期时刻单调后移且始终晚于 NOW()。

**验证命令**:
```bash
bash packages/brain/scripts/run-controller-daemon-test.sh 'B-02'
```
**硬阈值**: 两次续租后 `controller_lease_expires_at` 严格递增（第 2 次 > 第 1 次 > 初始），且两周期内任意时刻 `controller_lease_expires_at > NOW()`。

---

### Step 3: 监护循环 — Kernel fatal 按 failure_class 分类决策
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 条 + 边界情况「Kernel fatal 但 failure_class unknown」。

**可观测行为**: Controller 用 `assessKernelLiveness` 探 Kernel 存活。真 `kill -9` Kernel 位进程后：
- 可恢复类（进程崩溃/瞬时基础设施）→ `decideKernelFatalAction` 返回 `resume` → Controller 重拉 Kernel，run **不进入无主态**。
- 不可恢复类（`assembly_fault`/合同失效）→ 返回 `terminate` → `handleKernelProcessFatal` 结构化脱敏终止，run finalize failed（`kernel_process_fatal:<code>`），Controller 存活，run **不进入无主态**（controller_session_id 仍在）。
- liveness = `unknown` → 返回 `wait`，**绝不 resume/terminate**（不误判存活 Kernel）。

**验证命令**:
```bash
bash packages/brain/scripts/run-controller-daemon-test.sh 'B-03'
```
**硬阈值**: 可恢复类：kill 后 run 仍活跃且被监护进程重新存活；不可恢复类：`failure_reason` = `kernel_process_fatal:<code>` 且 `controller_session_id` 未清空；unknown：run 状态与 lease 均不变、无 resume 派生。

---

### Step 4: 人审窗口冻结 PR 分支 push（拒止/回滚），裁决后解冻
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 条 + 边界「人审期并发 push」（防 head 漂移饿死人审，run 8783807c 死因）。

**可观测行为**: run 进入 `phase='review'`（人审等待态，derive action=`wait:human_review`）时，Controller 冻结该 PR 分支：记录冻结 head SHA（`controller_frozen_head_sha` + `controller_push_frozen_at`）。冻结窗口内任何使 head 越过冻结 SHA 的 push 尝试都被拒止/回滚（真本地 git 仓库：head 保持 = 冻结 SHA）；并发多次 push 尝试全部被拒。人审裁决后（phase 离开 review：done/failed 或批准继续）解冻，push 恢复正常。

**验证命令**:
```bash
bash packages/brain/scripts/run-controller-daemon-test.sh 'B-04'
```
**硬阈值**: 冻结期真 git remote head == 冻结 SHA（未漂移）；`enforceHumanReviewPushFreeze` 对越界 push 返回 reject/rollback；解冻后同一 push 被允许、head 前进。

---

### Step 5: 终局 — 守到 merged 回写 task result 才退出；失败终局结构化回传
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 条 + 边界「merge 后异常退出跳过 report」+ 铁律 e83b2f0d（收尾不跳过）。

**可观测行为**: Controller 守到 PR `merged`（外部真相 `pr.merged`）+ report 完成后，`writebackControllerFinalResult` 把 `tasks.result` 写为 `{pr_url, merged:true, summary}`，**然后**才退出（Controller 是最后一个退出者）。失败终局同样必须结构化回传（`tasks.result.failure_reason` 结构化脱敏 + run failed），**禁无声消失**——退出前 result 必已落库。

**验证命令**:
```bash
bash packages/brain/scripts/run-controller-daemon-test.sh 'B-05'
```
**硬阈值**: `tasks.result` 含 `pr_url`（非空 string）+ `merged=true` + `summary`；成功终局回写发生在 Controller 进程退出**之前**；失败终局 `tasks.result` 含结构化 `failure_reason`（脱敏，无凭据明文）。

---

### Step 6: 后备不变 — Controller 死→lease 过期→orphan-guard 接管收尸（回归不回退）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 6 条 + 边界「Controller 与 Kernel 同时死」+ 铁律 636296d4（无主核查）。

**可观测行为**: 真 `kill -9` Controller 进程后，无人续租 → `controller_lease_expires_at` 自然过期 → 既有 orphan-guard（`reconcileOwnerlessKernelRuns`）巡检检测为无主 → fail-closed 恢复（phase=failed + `ownerless_kernel_run_recovered:<cause>`）；健康 owned run 不被误伤；不双重接管。**既有 orphan-guard 逻辑一字不动，仅降级为后备。**

**验证命令**:
```bash
bash packages/brain/scripts/run-controller-daemon-test.sh 'B-06'
```
**硬阈值**: kill Controller 后 lease 过期，`reconcileOwnerlessKernelRuns` 把该 run 判无主并 finalize failed（`ownerless_kernel_run_recovered:controller_lease_expired`）；健康 run phase 不变；既有回归 `kernel-controller-lifecycle.pg.integration.test.js` 全绿不回退。

---

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 本 sprint 是纯后端进程编排，真实验收 = 真 Postgres 集成 + 真 OS 进程 spawn/kill + 真本地 git 仓库（PRD「target_environment_reason」明示：本机 PG 集成测试 + 进程 spawn/kill + psql 查 run 行）。
> local_api 空库自举（Kernel 硬规则）：每个集成测试用例通过 admin pool 连接 `$DB_URL`（Fleet 注入的 attempt 级资源，仅取 host/port/user/password 用于 `CREATE DATABASE`）建**全新隔离空库**，再用仓库真实 `src/migrate.js` bootstrap（含 migration 415/416），然后跑真代码路径；afterAll `DROP DATABASE` 清理，兜底由 attempt 级销毁。禁预注入业务 cookie/tenant（本 sprint 无业务身份）。
> 下方脚本由 evaluator 模式 B 执行；`packages/brain/scripts/run-controller-daemon-test.sh` 是 generator 交付的 ARTIFACT（解析 `$DB_URL`→DB_* env + 跑指定 `-t` 用例）。

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"

# 1. 从 Fleet 注入的 DB_URL 派生 DB_* 环境（DB_DEFAULTS 读 DB_HOST/PORT/USER/PASSWORD；
#    NODE_ENV=test + DB_NAME=cecelia_test 满足 db-config.js 的「测试环境禁连生产 cecelia 库」守卫；
#    集成测试内部 admin pool 连 database=postgres 建隔离空库，各用例自跑 migrate.js）。
proto_removed="${DB_URL#*://}"
creds="${proto_removed%%@*}"
hostportdb="${proto_removed#*@}"
export DB_USER="${creds%%:*}"
export DB_PASSWORD="${creds#*:}"
hostport="${hostportdb%%/*}"
export DB_HOST="${hostport%%:*}"
export DB_PORT="${hostport##*:}"
export DB_NAME="cecelia_test"
export NODE_ENV="test"

cd packages/brain

# 2. 跑本 sprint 新增守护进程集成套件（真 PG + 真进程 spawn/kill + 真 git）+ 既有回归套件，
#    禁 mock 被改的边。任一失败 pipefail 传播非 0 exit → E2E FAIL（无 exit 0 兜底）。
npx vitest run --config vitest.integration.config.js \
  src/__tests__/integration/kernel-controller-daemon.pg.integration.test.js \
  src/__tests__/integration/kernel-controller-lifecycle.pg.integration.test.js \
  src/__tests__/integration/kernel-controller-ownership.pg.integration.test.js \
  2>&1 | tee /tmp/controller-e2e.log

# 3. 显式核对全套 6 步 BEHAVIOR 用例名均通过（防「0 用例被跳过也算绿」假绿）。
for name in B-01 B-02 B-03 B-04 B-05 B-06; do
  grep -qE "(\bok\b|✓|passed).*${name}|${name}.*(\bok\b|✓|passed)" /tmp/controller-e2e.log \
    || { echo "FAIL: BEHAVIOR ${name} 未在测试输出中通过"; exit 1; }
done

echo "OK: Controller daemon Golden Path E2E 全绿（真 PG + 真进程 + 真 git）"
```

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 12 分钟 / 18 动作（略高于默认——进程生命周期竞态面广，写明理由：spawn/kill/续租/接管四者存在时序竞态）
高风险面:
- 错输入: 向 `renewControllerLease` 传已 terminal（done/failed）的 run_id / 不匹配的 controllerSessionId，断言不误续（不复活终态 run）。
- 重复提交: Controller 与 orphan-guard 同一 tick 并发处理同一无主 run（Controller 刚死 lease 刚过期）——断言不双重接管/双重 finalize（边界「Controller 与 Kernel 同时死」）。
- 中途中断: resume 重拉 Kernel 的瞬间再 kill -9（连环崩溃），断言 inflight 观测防双 spawn、requeue 有上限不无限烧。
- 边界值: liveness 恰在 `KERNEL_HEARTBEAT_STALE_MS` 边界（age == staleMs）；lease 恰在过期临界（expires_at == NOW()）；freeze SHA 与新 push SHA 相同（合法 no-op push 不应被误拒）。
发现分级: P0/P1（run 进无主态 / 丢 run / 误终止存活 Kernel / head 漂移饿死人审 / 假终局 merged）→ 阻塞 merge；P2/P3（日志噪声/非关键竞态窗口）→ 记 findings 不阻塞。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Controller spawn 先于 Kernel + ownership | `kernel-controller-daemon.pg.integration.test.js` | `B-01 spawn Controller before Kernel` | import `runControllerDaemon`（模块不存在）→ 模块加载失败 |
| lease 两周期续租 | 同上 | `B-02 lease renewed across two cycles` | import `renewControllerLease`=undefined → ReferenceError |
| Kernel fatal 分类决策(resume/terminate/unknown-wait) | 同上 | `B-03 kill Kernel classified fatal action` | import `decideKernelFatalAction`=undefined |
| 人审 push 冻结/解冻 | 同上 | `B-04 human review push freeze` | import `enforceHumanReviewPushFreeze`=undefined |
| 终局回写 pr_url+merged 才退出 | 同上 | `B-05 final writeback pr_url merged before exit` | import `writebackControllerFinalResult`=undefined |
| Controller 死→lease 过期→orphan-guard 接管 | 同上 | `B-06 kill Controller orphan-guard reclaims` | 新列 controller_pid/frozen_head 缺失（migration 416 未建）→ SQL 报错 |

> BEHAVIOR 覆盖名均为对应 `it()` 名的字面子串（下游按字符串映射），generator 写 `it()` 名时必须包含这些子串。

---

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）——所有被改边均真跑（真 PG / 真进程 / 真 git）。唯一 DI 替换是「Kernel 位」换成真实廉价子进程（见「禁 mock 边清单」，属 DI 非 mock，被改边全真）；GitHub merge/CI 网络层为监护循环外层边界，测试用真 PG 中的 `pr` 观测行喂入（`pr.merged` 由既有 github-pr-discovery 提供，本单不改），不属被改边。
