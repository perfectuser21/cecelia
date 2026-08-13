# Sprint Contract Draft (Round 1)

**journey_type**: autonomous
**target_environment**: local_api（仅 packages/brain 后端进程 + Brain DB；E2E 用 $DB_URL 真 migrate + node 驱动真实模块 + 真子进程 + psql 断言）

## 锚定父路声明

独立小路（无父路）——本 line（journey e6f803f2）累积 FR 为空，本 sprint 是 kernel run 生命周期从「记账户籍」升级为「真身监护」的独立路径。

## Response Schema（推导来源: PRD 字面）

N/A — 任务无 HTTP 响应。本 sprint 是 Brain 进程内 orchestrator 改动（Controller 真身进程 / lease 续租 / 监护循环 / 终局回写），无新增 HTTP 端点。Golden Path 的「可观测输出」是 **initiative_runs / tasks 表列** 与 **真实进程存活/退出**，验证靠 psql + 进程信号，不靠 curl HTTP schema。

已存在的 DB 事实来源（本 sprint 读写，非新造）：
- `initiative_runs.controller_session_id`（text）— Controller 真身标识（PR #4860 已建列，本 sprint 从「randomUUID 记账」改为「真进程身份」）
- `initiative_runs.controller_lease_expires_at`（timestamptz）— lease 到期（本 sprint 新增周期续租续期）
- `initiative_runs.orchestrator_pid` / `orchestrator_host` / `orchestrator_heartbeat_at`（Kernel 进程存活佐证）
- `initiative_runs.phase`（enum: planning/gan/generate/evaluate/judge/paused/done/failed）
- `tasks.payload`（jsonb）— human_review 冻结标记 `pr_push_frozen` / `pr_head_sha`（本 sprint 用 payload，避免加列迁移）
- `tasks.result`（jsonb）— 终局回写 `pr_url` / `merged` / `summary`

被 pin 的新代码事实来源（本合同 ground truth，failing test 引用）：
- 新模块 `packages/brain/src/orchestrator/kernel-controller-runtime.js` 导出：
  `deriveControllerSessionId` / `renewControllerLease` / `classifyKernelFatal` /
  `superviseKernelFatal` / `guardPushDuringHumanReview` / `finalizeControllerExit` /
  常量 `CONTROLLER_RENEW_INTERVAL_MS` / `RECOVERABLE_KERNEL_FATAL` / `UNRECOVERABLE_KERNEL_FATAL`
- 新 daemon 入口 `packages/brain/src/orchestrator/kernel-controller.js`（可 `node kernel-controller.js --task-id .. --run-id ..` spawn 的常驻监护进程）
- 修改 `packages/brain/src/harness-skill-relay.js` `_spawnKernelRuntime`：先 spawn Controller 真身（`spawnKernelController`），Controller 取得 ownership 后再由其拉起 Kernel；`controllerSessionId` 由真进程身份派生，不再 `randomUUID()`。

**禁用字段名**: 无（无 HTTP schema）。
**Error 语义**: 见「失败语义声明」段。

---

## Golden Path

覆盖父路：独立小路（无父路）。

[createKernelRun 派发] → [Controller 真身 spawn + ownership 认领] → [lease 周期续租 + 监护循环] → [Kernel fatal 按 failure_class 分流恢复/终止] → [human_review 冻结 PR push] → [PR merged + task.result 回写 + Controller 退出]

### Step 1: Controller 真身 spawn + ownership 认领

**来源**: `[FROM_PRD]` — PRD Golden Path 第 1-2 步 / 交付范围 1（`_spawnKernelRuntime` 先 spawn 常驻 Controller 进程，Controller 写 `controller_session_id`=自身真实身份后再拉起 Kernel）。

**可观测行为**: `createKernelRun` 后存在一个**活的 Controller 进程**；`initiative_runs.controller_session_id` 指向该进程的真实身份（由 `deriveControllerSessionId({pid,host})` 派生，形如 `ctrl:<host>:<pid>`，**非** randomUUID）；Kernel 由 Controller 拉起（`orchestrator_pid` 落库），Controller 先启动、Kernel 后启动。

**验证命令**:
```bash
# 真 spawn Controller daemon（真子进程），断言 controller_session_id 指向活进程身份
node sprints/08131657-kernel-9bd45a03/e2e/behavior.mjs B-01
# 期望：exit 0，stdout 含 OK: controller alive sid=ctrl:<host>:<pid>
```

**硬阈值**: `controller_session_id ~ '^ctrl:'`（真身派生，非 UUID 记账）；Controller 进程 `kill -0` 存活；Kernel `orchestrator_pid` 非空。

---

### Step 2: lease 周期续租（观测两个续租周期）

**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步（周期心跳续租 lease）+ NFR「lease 心跳续租须在既有 lease TTL 过半前完成」。

**可观测行为**: Controller 存活期间周期调 `renewControllerLease` 把 `controller_lease_expires_at` 向前推进；连续观测**两个续租周期**，lease 到期时间单调递增两次（后一次 > 前一次），run 全程不被判无主。续租间隔 `CONTROLLER_RENEW_INTERVAL_MS` 默认 = `CONTROLLER_LEASE_DEFAULT_SECONDS*1000/2`（=900_000ms=TTL 过半前），测试用注入的短间隔快速观测两周期。

**验证命令**:
```bash
node sprints/08131657-kernel-9bd45a03/e2e/behavior.mjs B-02
# 期望：exit 0，stdout 含 OK: lease renewed twice t1<t2<t3
```

**硬阈值**: 观测到 3 个 lease 时间戳且 `t1 < t2 < t3`（两次真续租）；续租只对匹配 `controller_session_id` 生效（错误身份续租被拒）。

---

### Step 3: Kernel fatal 按 failure_class 分流（可恢复 resume / 不可恢复结构化终止）

**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步 / 边界情况「kill -9 Kernel → Controller 检测并按 failure_class 分流，run 不进入无主态」。`[AI_ADDED]` 细化：`classifyKernelFatal` 分类枚举复用现有 `failure_class`（`INFRASTRUCTURE_FAILURE_CLASSES` 归可恢复），理由：不新造分类体系（PRD 假设 3），且 run 全程 `controller_session_id`+lease 存活以证「不进入无主态」。

**可观测行为**:
- 可恢复类（进程崩溃 `process_crash` / 瞬时基础设施 `infrastructure_blocked` 等）：`kill -9` Kernel 后 Controller 检测到 pid 消失，**重启 Kernel（resume）**，run 保持活跃（phase 非 failed），`controller_session_id` 与 lease 仍在（不进入无主态）。
- 不可恢复类（`assembly_fault` / 合同失效 `contract_invalid`）：Controller 执行**结构化终止**——`finalizeKernelRun(outcome=failed)` + `failure_reason` 前缀 `kernel_process_fatal:`（脱敏），`controller_session_id` 存活可回传（复用现有 `handleKernelProcessFatal`，回归不回退）。

**验证命令**:
```bash
# 可恢复：kill -9 Kernel → Controller resume，run 不无主
node sprints/08131657-kernel-9bd45a03/e2e/behavior.mjs B-03
# 期望：exit 0，stdout 含 OK: recoverable resume run-not-ownerless
# 不可恢复：assembly_fault → 结构化终止
node sprints/08131657-kernel-9bd45a03/e2e/behavior.mjs B-04
# 期望：exit 0，stdout 含 OK: unrecoverable terminate failure_reason=kernel_process_fatal:assembly_fault
```

**硬阈值**: 可恢复分支后 `isOwnerlessRun(run)==false` 且 phase ∉ (failed)；不可恢复分支后 `phase='failed'` 且 `failure_reason ~ '^kernel_process_fatal:'` 且不含凭据明文。

---

### Step 4: kill -9 Controller → lease 过期 → orphan-guard 兜底接管（回归不回退）

**来源**: `[FROM_PRD]` — PRD 边界情况「kill -9 Controller → lease 过期 → orphan-guard 兜底接管收尸（现有机制降级为后备，回归不回退）」。

**可观测行为**: Controller 进程被 `kill -9` 后不再续租，`controller_lease_expires_at` 自然过期；既有 `reconcileOwnerlessKernelRuns`（orphan-guard 后备）扫描到该无主 run（`controller_lease_expired`），fail-closed 收敛为 `phase='failed'` + `failure_reason ~ '^ownerless_kernel_run_recovered:'`。健康 owned run 不被误伤。

**验证命令**:
```bash
node sprints/08131657-kernel-9bd45a03/e2e/behavior.mjs B-05
# 期望：exit 0，stdout 含 OK: controller-dead lease-expired orphan-guard-reclaimed
```

**硬阈值**: 无主 run `phase='failed'` 且 `failure_reason ~ '^ownerless_kernel_run_recovered:'`；健康 run phase 不变、`controller_session_id` 不变（现有回归不回退）。

---

### Step 5: human_review 期间冻结 PR 分支 push（防 head 漂移饿死人审）

**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 步 / 边界情况（run 8783807c 死因：head 漂移饿死人审）。

**可观测行为**: run 进入 human_review（decision-log 最新 action=`wait:human_review` 且 PR 未 merge）期间，Controller 冻结该 PR 分支 push——`guardPushDuringHumanReview` 拒止 push 尝试（返回 `{allowed:false, rejected:true}`），`tasks.payload.pr_push_frozen=true`，记录的 `pr_head_sha` 不变（head 不漂移）；人审裁决（approve/reject）后解冻（`pr_push_frozen=false`），push 恢复放行。

**验证命令**:
```bash
node sprints/08131657-kernel-9bd45a03/e2e/behavior.mjs B-06
# 期望：exit 0，stdout 含 OK: push-frozen-in-review head-unchanged unfrozen-after-verdict
```

**硬阈值**: 冻结期间 push 尝试 `rejected==true` 且 `payload->>'pr_head_sha'` 前后一致；裁决后 `payload->>'pr_push_frozen'='false'` 且 push 放行。

---

### Step 6: PR merged → task.result 回写（pr_url + merged）→ Controller 退出

**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 步 / 交付范围 4（守到 merged + report 完成，回写 task result 后 Controller 才退出；失败终局也结构化回传，禁无声消失）。

**可观测行为**: PR merged 后 Controller 调 `finalizeControllerExit` 把 `tasks.result` 写成含 `pr_url` + `merged=true` + `summary` 的 jsonb，回写完成后 Controller 进程才退出（exit 0）；失败终局同样结构化回写（`merged=false` + 失败摘要），Controller 不无声消失。

**验证命令**:
```bash
node sprints/08131657-kernel-9bd45a03/e2e/behavior.mjs B-07
# 期望：exit 0，stdout 含 OK: task-result-written pr_url+merged controller-exited
```

**硬阈值**: `tasks.result->>'pr_url'` 非空且 `tasks.result->'merged'=true`（成功终局）；回写发生在 Controller 进程退出之前（driver 观测 result 落库后进程才 `ESRCH`）。

---

## 真实调用方请求 shape

N/A — 本 sprint 无「设备/agent 调服务端」的真实外部调用方。所有调用均为 Brain 进程内路径：`harness-initiative-patrol` → `spawnSkillRelaySession` → `_spawnKernelRuntime` → `spawnKernelController`（本机 detach 进程）→ `createKernelRun` / `launchKernelProcess`。无 header/body 认证分叉风险。

## 未覆盖真实链路清单（规则 C）

| 被 mock/替身顶替的真实链路点 | 为什么 | 真验证补位计划（谁/何时/什么环境） |
|---|---|---|
| GitHub PR merge / CI 状态观测（`gh pr view` 第三方）| 本 sprint 测试焦点是「Controller↔进程↔DB」生命周期；真 PR/CI 需要真实开 PR + 真跑 CI，超出 local_api 单 run 隔离能力 | merged/CI 观测在真实 kernel run 上由 evaluator 现有 kernel-wiring 链路覆盖；本 sprint 用 driver 注入 `pr.merged=true`/`pr.head_sha` 事实位驱动 Step 5/6，被改边（冻结判定 + task.result 回写 + head_sha 不变）真 PG 真验 |
| GitHub PR 分支真实 `git push`（Step 5 冻结的对象）| 真 push 到远端需真凭据真远端分支 | 被改边是「Controller 是否放行 push + head_sha 是否漂移」——用真 PG 记录 `pr_push_frozen` + 真 `pr_head_sha` 比较真验；真实远端 push 属更外层第三方，允许 stub |

（说明：本 sprint 无 LLM/支付/短信等第三方 API 依赖，无需规则 B 真 key 调用；上表两项均为 GitHub 侧，被改的边全部真 PG 真验，仅最外层 GitHub 远端 stub。）

## 禁 mock 边清单

本单同时命中【调度】（Controller spawn→Kernel launch 派发）、【状态机】（phase/无主判定/lease 到期收敛）、【跨模块数据传递】（controller_session_id/lease 在 relay↔run-store↔lifecycle 接力）、【生命周期钩子】（spawn/fatal/resume/exit）、【DB 写路径】（initiative_runs / tasks 写读）——failing test 必须真 PG + 真子进程，逐条禁 mock：

- 代码 ↔ `initiative_runs` 表（`controller_session_id` / `controller_lease_expires_at` 写读、lease 续租、phase 收敛）：真 pg.Pool 连真 PG，禁 mock pool。
- Controller 进程 ↔ Kernel 进程（spawn / `kill -9` / resume 真实子进程）：真 `child_process` spawn，**禁** `fakeChild = new EventEmitter()` / stub 子进程。
- 代码 ↔ `tasks` 表（终局 `tasks.result` 回写、`payload.pr_push_frozen` 冻结标记）：真 PG 验行落库。
- orphan-guard（`reconcileOwnerlessKernelRuns`）↔ `initiative_runs`（lease 过期兜底接管）：真 PG（现有回归不回退）。
- 仅允许 mock 更外层无关依赖：GitHub 远端（`gh`/`git push`）、Bark 通知——这些不是被改的边（见未覆盖清单）。

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 每条 kernel run 起一个常驻 Controller 真身进程：认领 ownership→lease 续租→监护 Kernel 存活/phase/PR-CI→fatal 按 failure_class 分流→human_review 冻结 push→merged 后回写 task.result 再退出 | 见 Golden Path Step 1-6 |
| **NFR（做得多好）** | lease 续租须在 TTL（1800s）过半（900s）前完成；终局必须结构化回写（禁无声消失）；频控：待定（PrepPRD 未指定，本 sprint 不引入额外频控） | `CONTROLLER_RENEW_INTERVAL_MS`=TTL/2；`finalizeControllerExit` 强制回写 |
| **Invariant（永不违反）** | ① 无主 run 绝不静默放行（fail-closed）② watchdog 对『从未启动』走 never_started 兜底且不覆盖已有 error_message/failure_reason ③ Controller 台账不入 git ④ Controller 只监护不执行任何阶段工作 | 见 Invariant 覆盖条目 INV-1..INV-4 |
| **判定点（怎么知道）** | 见判定点登记表 | 见下方登记表 |
| **保质期（何时过期）** | Controller lease TTL 1800s，过期即由 orphan-guard 后备接管；Controller 进程随 run 终局退出 | lease 过期→Step 4 兜底 |
| **死亡告警（停了谁知道）** | Controller 死 → lease 过期 → orphan-guard 巡检（既有 5min 节奏）扫到无主 run fail-closed 收敛并落 failure_reason，可观测 | 复用既有 orphan-guard 告警链路 |
| **失败语义（挂了怎么办）** | 见失败语义声明 | 见下方 |
| **效果确认（已发≠已生效）** | 终局 `tasks.result` 落库（pr_url+merged）为回执；lease 续租以 `controller_lease_expires_at` 前移为回执；resume 以 run 不无主+新 kernel pid 为回执 | psql 断言回执 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息 |
| ⚠️ Kernel 进程是否已死（该 resume/终止） | A. `orchestrator_heartbeat_at` 陈旧; B. `kill(pid,0)` host 一致探活 | B（复用现有 `assessKernelLiveness`：先心跳后 pid，host 不一致判 unknown 不猜） | 跨主机裸 pid 无意义；心跳+pid 双证已是既有权威判定 | 误判活为死→无谓 resume 双 Kernel；误判死为活→run 卡死不救 |
| ⚠️ Kernel fatal 是否可恢复（resume vs 终止） | A. 按 `failure_class` 枚举分类; B. 一律终止不 resume | A（`classifyKernelFatal`：`INFRASTRUCTURE_FAILURE_CLASSES`∪process_crash→可恢复；assembly_fault/contract_invalid→不可恢复） | 复用既有 failure_class 枚举，不新造（PRD 假设 3）；瞬时基础设施类 resume 可自愈 | 误判不可恢复为可恢复→无限 resume 烧算力；误判可恢复为不可恢复→本可自愈的 run 被过早 fail |
| ⚠️ Controller 是否存活（run 是否无主） | A. lease 未过期即视为存活; B. lease + 进程 kill(pid,0) 双证 | A（`controller_lease_expires_at ≥ now` 且 `controller_session_id` 非空，复用现有 `isOwnerlessRun` 谓词） | 与 PR #4860 既有无主判定一致，避免双套判定漂移；lease 续租本身即进程存活佐证 | 误判无主→误杀健康 run；误判有主→死 Controller 的 run 无人收尸 |
| run 是否进入 human_review（该冻结 push） | A. decision-log 最新 action=`wait:human_review` 且 PR 未 merge; B. 加独立 phase 列 | A（读既有 decision-log action，不加 phase 迁移） | initiative_runs.phase 枚举无 human_review；`wait:human_review` 是既有 action | 误判进入→过早冻结阻塞正常 push；误判退出→head 漂移饿死人审（run 8783807c 死因） |

> ⚠️ 行属「升拍板点」级别。PrepPRD 未逐条拍板这些判定方法，均采用「复用既有权威判定」保守策略（不新造判定体系），notes 标注待确认：
> `judgment-pending-user: Kernel fatal 可恢复分类边界（哪些 failure_class 归可恢复）`

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| Controller spawn 失败（进程未起来） | createKernelRun 前失败 → 无半态 run，向上抛 spawn 失败（fail-closed，同现有 kernel_launch_failed 语义） | 是（无 run 落库，重派幂等） | 上层 dispatcher 重派 |
| lease 续租写库失败（DB 抖动） | 单次续租失败不崩 Controller，下一周期重试；连续失败至 lease 过期 → orphan-guard 兜底 | 是（续租是幂等 UPDATE，按 controller_session_id 匹配） | 降级到 orphan-guard 后备接管 |
| Kernel fatal 分类命中不可恢复 | 结构化终止（finalize failed + 脱敏 failure_reason），Controller 存活回传 | 是（finalize 幂等，终态 run 不重复收敛） | 无（终局） |
| Controller 自身死亡（kill -9） | lease 自然过期 → orphan-guard `reconcileOwnerlessKernelRuns` fail-closed 收敛 | 是（无主判定纯谓词，重扫幂等） | orphan-guard 后备（现有机制） |
| 从未成功启动的 Controller/Kernel | 走 never_started 兜底，**不覆盖**已有 error_message/failure_reason（INV-2 铁律） | 是 | never_started 分类 |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本 sprint 无对外暴露 agent / 无外部用户可写入接口。全部为 Brain 进程内 orchestrator 调度，输入来源为 Brain 自身派发的 task/run，信任等级=内部可信。

## Invariant 覆盖（铁律逐条映射）

- INV-1 [无主 fail-closed]：无主 run 绝不静默放行 → B-05 断言无主 run `phase='failed'`+`ownerless_kernel_run_recovered:` 前缀，且不存在无主活跃残留。
- INV-2 [never_started 兜底]：watchdog 对『从未启动』走 never_started 且不覆盖已有 error_message/failure_reason → 由「失败语义声明」保证，`handleKernelProcessFatal`/`finalizeControllerExit` 均不覆盖既有非空 failure_reason；本 sprint 不改 orphan-guard never_started 分支（回归不回退，B-05 覆盖）。
- INV-3 [controller 台账不入 git]：`.harness/progress.md` 保持 git 追踪之外 → 本 sprint Controller 台账/日志落 `CECELIA_KERNEL_LOG_DIR` 或 repo `logs/kernel/`（已 gitignore），**不**写 sprint PR；DoD [ARTIFACT] 断言无 `.harness/` 进 git diff。
- INV-4 [relay 心跳]：relay 单 session 各 phase 完成调 `POST /api/brain/harness/phase-event` → N/A：本 sprint 是 kernel-v1（非 relay 单 session 模式），不触及 relay phase-event 心跳；Controller 用 lease 续租（`controller_lease_expires_at`）作为存活心跳，不改 relay 路径。
- INV-5 [PR 验证时钟]：Kernel 对既有 PR 采用 evaluator validation clock adoption → N/A：本 sprint 不改 evaluator validation clock，Controller 只监护不执行 evaluator（PRD 范围外）。

## 已知约束（回归测试 + 累积 FR）

- [kernel-controller-lifecycle.pg.integration.test.js] → Kernel fatal 只结束 Kernel Controller 存活；failure_reason 结构化脱敏；无主历史/lease 过期 fail-closed 进恢复；健康 owned run 不被误伤（**本 sprint 回归不回退，全部保留**）。
- [kernel-controller-ownership.pg.integration.test.js] → controller_session_id ownership 在 createKernelRun 事务内落库（本 sprint 从 randomUUID 改真身，ownership 落库时序不变）。
- [orphan-run-revival.integration.test.js] → 无主 run 复活/收尸（orphan-guard 后备，回归不回退）。
- [累积FR] （本 line 暂无历史）
- [context-manifest] unavailable（runtime postgres=false，Brain API 5221 不可达；累积 FR 由 PRD「本 line 暂无历史」佐证）

## gp-anchor: skipped (product-map.json not found)

## contract-gate: active (packages/brain/src/lib/contract-gate.js 存在，本仓 cecelia，代码层 Contract Gate 复核生效)

> 本合同 [BEHAVIOR] `Test:` 均为 `node <driver> <scenario>` 自包含真实断言（driver 内 psql/进程/PG 断言，FAIL 传播非 0 exit），非裸 curl 无 jq / `|| true` 吞错型弱 oracle；DB 计数断言（INV-1 无主残留、B-05 收敛）均带 phase 过滤而非裸 count。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: 用错误 `controller_session_id` 调 `renewControllerLease`（应被拒，不得续到别人的 lease）
- 重复提交: 同一 run 并发两个 Controller spawn（应只一个取得 ownership，另一个 createKernelRun 返回 created:false 不串台账）
- 中途中断: lease 续租进行中 `kill -9` Controller（应 lease 过期后由 orphan-guard 兜底，不留无主活跃残留）
- 边界值: Kernel fatal `failure_class` 为未知/空值（应保守归不可恢复结构化终止，不误 resume 烧算力）
- 双重终局: PR merged 后 `finalizeControllerExit` 被调两次（应幂等，不重复覆盖已写 result / 不覆盖已有 failure_reason）
发现分级: P0/P1（无主残留/双 Kernel/覆盖既有 failure_reason）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

> evaluator 模式 B：由 Fleet 注入 attempt 级 `$DB_URL`（全新空库）。脚本先对空库跑仓库真实 migration，机检目标表存在，再用 node 驱动**真实 orchestrator 模块 + 真子进程**跑完 Golden Path Step 1-6，psql 断言真实副作用（带时间窗防造假）。无业务身份/cookie 需求（Brain 内部 orchestrator，无 signup/login）。

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
export DATABASE_URL="$DB_URL"

# 0. 解析 DB_URL → migrate.js 所需 DB_* 环境变量（migrate.js 读 DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME）
eval "$(node -e '
const u = new URL(process.env.DB_URL);
process.stdout.write(
  `export DB_HOST=${u.hostname}\n` +
  `export DB_PORT=${u.port||5432}\n` +
  `export DB_USER=${decodeURIComponent(u.username)}\n` +
  `export DB_PASSWORD=${decodeURIComponent(u.password)}\n` +
  `export DB_NAME=${u.pathname.replace(/^\//,"")}\n`
);
')"
export NODE_ENV=test

# 1. 对空库跑仓库真实 migration，机检目标表存在（Kernel local_api 硬规则）
node packages/brain/src/migrate.js
psql "$DB_URL" -tAc "SELECT to_regclass('public.initiative_runs') IS NOT NULL" | grep -qx t
psql "$DB_URL" -tAc "SELECT to_regclass('public.tasks') IS NOT NULL" | grep -qx t
# 确认 controller ownership 列已由既有 migration 建出（本 sprint 依赖，非本 sprint 建）
psql "$DB_URL" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='initiative_runs' AND column_name IN ('controller_session_id','controller_lease_expires_at')" | grep -qx 2

# 2. 驱动全部 Golden Path 场景（真实模块 + 真子进程 + 真 PG），任一 FAIL 传播非 0 exit
node sprints/08131657-kernel-9bd45a03/e2e/behavior.mjs all

echo "✅ Golden Path Step 1-6 验证通过（真 PG + 真子进程）"
```
