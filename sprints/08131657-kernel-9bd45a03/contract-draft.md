# Sprint Contract Draft (Round 1)

**Sprint**: 真身 Session Controller——每条 kernel run 一个常驻监护进程
**journey_type**: autonomous
**target_environment**: local_api
**base_sha（实现基线）**: 813dc7037c15e4946d51f921a9a9bff00c575c16

## 锚定父路声明

独立小路（无父路）—— PrepPRD 未锚定 ability_id / golden-path step（PRD `step_id: none`），本 sprint 是 harness 内部编排能力，无产品 Golden Path 父路。

gp-anchor: skipped (product-map.json not found)  <!-- cecelia 仓无 product-map/generated/product-map.json，Step 1.7 整体跳过 -->

contract-gate: active（本仓 cecelia，`packages/brain/src/lib/contract-gate.js` 存在，由代码层 Contract Gate 复核；已按 Contract Gate 速查表惯用法起草 [BEHAVIOR]/E2E 断言）。

## Unified Map 半径

[MAP_NOT_CONFIGURED] —— task.payload.map_scope / map_repo 均为 null（Brain `/api/brain/tasks/<id>` 实测），无 Unified Map 影响半径可读；`must_run_assertions` 为空。已知回归约束改由「## 已知约束」+「## Invariant 覆盖」承接，禁回退领域硬编码。

---

## Response Schema（推导来源: PRD 明确 + api_registry 现有约定；本 sprint 无新 HTTP 端点）

### HTTP 端点：N/A —— 本 sprint 无新增/修改 HTTP 响应

本 sprint 是纯 Brain 后端进程编排（Controller 守护进程 + 生命周期库 + relay 拉起链），对外**无新 HTTP 端点**。既有 `POST /api/brain/harness/phase-event`（harness.js:1888）不改签名，仅保证 Controller 不拦截其调用链。Reviewer 第 6 维 HTTP schema 项按 `N/A — 任务无 HTTP 响应` 处理。

### 可观测状态契约（本 sprint 的「响应」= DB 行 + 进程态 + task.result）

**1. `initiative_runs` ownership/lease 列（migration 415 已存在，字面复用，禁改名）**
```
controller_session_id       TEXT         -- Controller 真身身份（非空 = 有主）
controller_lease_expires_at TIMESTAMPTZ  -- 租约到期；周期续租单调后推
orchestrator_pid            INT          -- 被监护 Kernel 子进程 pid（heartbeat.js 既有列）
orchestrator_host           TEXT         -- Kernel 子进程主机（heartbeat.js 既有列）
```
- `controller_session_id`（string, 必填非空）: 来源——PRD step1「Controller 写 controller_session_id=自身真实身份」；须绑定真实进程身份（含 pid/host），**禁止**沿用 `_spawnKernelRuntime` 现状的裸 `randomUUID()` 记账（无进程）。
- `controller_lease_expires_at`（timestamptz, 必填）: 来源——PRD step2「周期心跳续租 lease」，续租后该值必须严格 > 续租前值。

**2. 终局 `tasks.result`（jsonb，migration 220 已存在列）字面 key（PRD step5 明确）**
```json
{"pr_url": "<string>", "merged": true, "summary": "<string>"}
```
- `pr_url` (string, 必填): 来源——PRD step5「回写 task result（pr_url/merged/终局摘要）」。
- `merged` (boolean, 必填): 来源——PRD step5，同上；merged=true 表示守到 PR merged 才回写。
- `summary` (string, 必填): 来源——PRD step5「终局摘要」；失败终局同样结构化回传（禁无声消失）。
- **禁用字段名**（不得作为终局回写正向 key）: `pr`、`url`、`is_merged`、`merged_at`、`status`（api_registry 同义替换词，字面用 PRD 的 `pr_url`/`merged`/`summary`）。

**3. Controller daemon 结构化 failure_reason 前缀（沿用 lifecycle.js 既有约定 + 新增）**
- `kernel_process_fatal:<code>`（既有 `KERNEL_FATAL_REASON_PREFIX`，Kernel 进程 fatal）
- `ownerless_kernel_run_recovered:<cause>`（既有 `OWNERLESS_RECOVERED_REASON_PREFIX`，orphan-guard 兜底）
- `controller_never_started:<code>`（**新增** `CONTROLLER_NEVER_STARTED_REASON_PREFIX`，INV：从未启动兜底，不覆盖已有 error_message/failure_reason）

**4. 分流判定纯函数（新增，pure，可无 PG 单测）**
- `classifyControllerRecovery(failureClass) -> 'resume' | 'terminate'`：可恢复类（`transient`/`infrastructure_blocked`/未知 fail-open）→ `resume`；不可恢复类（`assembly_fault`/`contract_fault`/`contract_invalid`）→ `terminate`。字面沿用现有 failure_class 枚举（harness-utils.js / quarantine 已用），不新增分类体系（PRD 假设3）。
- `isPushFrozenForRun(runRow) -> boolean`：`reviewClassForReason(runRow.failure_reason)===merge_gate`（human-review-class.js 既有）且 phase 非 done/failed → true。

---

## Golden Path

[createKernelRun 派发] → [relay spawn 真身 Controller 守护进程 → Controller 取 ownership → 拉起 Kernel] → [Controller 周期续租 lease + 监护 Kernel 存活/phase/PR/CI] → [Kernel fatal 按 failure_class 分流 resume/结构化终止] → [human_review 期冻结 PR push] → [守到 PR merged + report → 回写 task.result → Controller 退出]

### Step 1: relay 先 spawn 真身 Controller 守护进程，Controller 取 ownership 后才拉起 Kernel
**来源**: `[FROM_PRD]` — PRD Golden Path 具体第 1 条（第 18 行）「createKernelRun 时先 spawn 一个本机 detach 守护进程（Controller，非 LLM session）；Controller 写 controller_session_id=自身真实身份 取得 ownership 后，才拉起 Kernel」。

**可观测行为**: `createKernelRun` 派发后，本机存在一个存活的 Controller 守护进程（`child_process` detach，非 LLM session）；`initiative_runs.controller_session_id` 非空且绑定该真实进程身份（含 pid/host 可核对），且该 ownership 早于 Kernel 可执行态落库。

**验证命令**:
```bash
# driver 内先 migrate 空 DB_URL 建表，再 spawn Controller，回读 ownership 与进程存活
node packages/brain/scripts/controller-e2e-driver.mjs scenario-ownership-lease | tee /dev/stderr | grep -q '"ownership_ok":true'
```

**硬阈值**: within 20s，`controller_session_id IS NOT NULL` 且 Controller pid `kill -0` 可达。

---

### Step 2: Controller 周期心跳续租 lease（可观测跨 ≥2 续租周期）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 条（第 19 行）+ NFR「验收须可观测≥2 个续租周期」（第 59 行）。

**可观测行为**: `controller_lease_expires_at` 在 Controller 存活期间被周期性向后推进；连续采样出现 ≥2 次严格递增（续租周期为可注入 `CONTROLLER_LEASE_RENEW_INTERVAL_MS`，默认由 lease 常量派生，测试用小值以在秒级观测；lease TTL 沿用 `CONTROLLER_LEASE_DEFAULT_SECONDS=1800`，不新定义 SLA）。

**验证命令**:
```bash
# driver 采样 controller_lease_expires_at 三次，断言 >=2 次严格后推
node packages/brain/scripts/controller-e2e-driver.mjs scenario-ownership-lease | tee /dev/stderr | grep -q '"lease_renewals":[2-9]'
```

**硬阈值**: within 15s 观测到 ≥2 次 `controller_lease_expires_at` 严格递增。

---

### Step 3: kill -9 Kernel → run 不进无主态，Controller 按 failure_class 分流
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 条（第 20 行）+ 边界情况「kill -9 Kernel」（第 30 行）。

**可观测行为**: `kill -9` 掉被监护 Kernel 子进程（`orchestrator_pid`）后，Controller 检测到并分流：可恢复类（进程崩溃/瞬时基础设施）重启 Kernel `resume`（出现新的 `orchestrator_pid`、run 仍活跃且有主）；不可恢复类（`assembly_fault`/合同失效）结构化终止（run.phase=failed + `kernel_process_fatal:` 前缀 failure_reason）。两分支下 run 都**不得进入无主态**（`controller_session_id` 仍非空）。

**验证命令**:
```bash
# 可恢复分支：kill Kernel 后 Controller resume，出现新 orchestrator_pid，run 仍有主
node packages/brain/scripts/controller-e2e-driver.mjs scenario-kill-kernel-recoverable | tee /dev/stderr | grep -q '"resumed":true'
# 不可恢复分支：kill Kernel 后结构化 failed，且不无主
node packages/brain/scripts/controller-e2e-driver.mjs scenario-kill-kernel-terminate | tee /dev/stderr | grep -q '"structured_terminate":true'
```

**硬阈值**: within 30s；`resumed` 分支 `orchestrator_pid` 变化且 run 活跃有主；`terminate` 分支 `failure_reason` 以 `kernel_process_fatal:` 开头且 `controller_session_id` 非空。

---

### Step 4: human_review 期 Controller 冻结 PR 分支 push，裁决后解冻
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 条（第 21 行）「run 进入 human_review 等待期间，Controller 冻结该 PR 分支 push（防 head 漂移饿死人审）；人审裁决后解冻」（run 8783807c 死因）。

**可观测行为**: run 进入 human_review 等待（`failure_reason='awaiting_human_review'`，reviewClassForReason=merge_gate）时，`isPushFrozenForRun(run)` 为 true，向 PR 分支的 push 被 Controller 拒止/回滚（真 git：整合层用真 bare repo 验拒止）；人审裁决使 run 离开人审等待后 `isPushFrozenForRun` 转 false，push 恢复。

**验证命令**:
```bash
# driver 置真 run 为 human_review 等待态,断言冻结判据 true,裁决后 false,并真 git push 验拒止/恢复
node packages/brain/scripts/controller-e2e-driver.mjs scenario-human-review-freeze | tee /dev/stderr | grep -q '"freeze_ok":true'
```

**硬阈值**: 冻结期 `isPushFrozenForRun`=true 且真 push 被拒（非零退出/回滚）；解冻后 =false 且 push 成功。

---

### Step 5: 守到 PR merged + report → 回写 task.result → Controller 退出
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 条（第 22 行）「Controller 守到 PR merged + report 完成，回写 task result（pr_url/merged/终局摘要）后才退出；失败终局也结构化回传，禁无声消失」。

**可观测行为**: run 达终局（merged）后，Controller 回写 `tasks.result = {pr_url, merged:true, summary}` 后进程才退出；失败终局同样写结构化 result（禁无声消失 = 进程消失但 result 缺失）。

**验证命令**:
```bash
# driver 驱动 run 至 merged 终局,等待 Controller 回写 task.result 后退出,断言 result 含 pr_url+merged
node packages/brain/scripts/controller-e2e-driver.mjs scenario-finalize | tee /dev/stderr | grep -q '"result_written":true'
```

**硬阈值**: within 30s，`tasks.result ? 'pr_url'` 为真且 `(result->>'merged')::boolean` 为 true，且 Controller pid 已退出。

---

### Step 6（边界/回归）: kill -9 Controller → lease 过期 → orphan-guard 兜底接管收尸
**来源**: `[FROM_PRD]` — PRD 边界情况「kill -9 Controller」（第 31 行）+ 范围「现有 orphan-guard 降级为后备，保持不动」（第 39 行）。

**可观测行为**: `kill -9` 掉 Controller 进程后，lease 自然过期，既有 `reconcileOwnerlessKernelRuns`（lifecycle.js:97）真扫真收敛：run 被判无主 → fail-closed（phase=failed + `ownerless_kernel_run_recovered:` 前缀），现有回归不回退。

**验证命令**:
```bash
# driver kill Controller 进程后触发既有 reconciler,断言无主 fail-closed 收敛
node packages/brain/scripts/controller-e2e-driver.mjs scenario-kill-controller | tee /dev/stderr | grep -q '"orphan_recovered":true'
```

**硬阈值**: run.phase=failed 且 `failure_reason` 以 `ownerless_kernel_run_recovered:` 开头；既有 lifecycle 集成回归全绿。

---

## 禁 mock 边清单

本单改动涉及**生命周期钩子（Controller spawn/monitor/finalize）+ 状态机（run phase 迁移）+ 跨模块数据传递（relay↔Controller↔Kernel）+ DB 写路径（initiative_runs / tasks）**，failing test 必须不 mock 下列被改的边：

- Controller 守护进程 ↔ `initiative_runs`（写 `controller_session_id` ownership + 周期续租 `controller_lease_expires_at`）—— 测试用真 `pg.Pool` 连真 PG，禁 mock pool。
- Controller 进程 ↔ Kernel 子进程（真 `child_process` spawn + `kill -9` + `kill(pid,0)` 探活分流）—— 测试真起子进程、真发信号，禁 mock EventEmitter/fakeChild（作弊反例 #4）。
- Controller 死亡 ↔ `reconcileOwnerlessKernelRuns` 兜底（lease 过期真扫真收敛）—— 真 PG + 真进程死亡，禁 mock reconciler / pool。
- human_review 冻结判据 ↔ 真 git push 到 PR 分支（整合层用真 bare git repo 验 push 拒止/恢复）—— 禁 mock git 层。
- 终局回写 ↔ `tasks.result`（真 PG UPDATE）—— 禁 mock tasks 写路径。

允许 mock 的更外层无关依赖：真实 LLM Kernel 的阶段工作本身（测试用 `CONTROLLER_KERNEL_LAUNCH_CMD` 注入良性长驻子进程如 `sleep` 代替 LLM Kernel——这不是 mock「被改的边」，被改的边是 Controller↔子进程的 spawn/监护/kill 探活，测试对该边全真）；GitHub 网络 API（gh CLI）在纯谓词单测中可 mock 更外层，但整合层 push 拒止用真 git。

---

## 已知约束

### 来自回归测试（Step 1.2）
- [kernel-controller-lifecycle.pg.integration.test.js] Kernel fatal 只结束 Kernel、Controller ownership 存活（`controller_session_id` 未被清）→ 本 sprint 的 resume/terminate 分流不得破坏该隔离。
- [kernel-controller-lifecycle.pg.integration.test.js] 无主判定 A OR B（`controller_session_id` 空 OR lease 过期）+ 健康 owned run 不被误伤 → Controller 真身续租不得让健康 run 被 reconciler 误收。
- [kernel-controller-lifecycle.pg.integration.test.js] failure_reason 结构化脱敏（不落 token/credential 明文）→ 新增 `controller_never_started:` / 终局 summary 同样必须过 `redactSecrets`。
- [kernel-controller-ownership.pg.integration.test.js] Controller ownership 先于 Kernel 可执行态落库（issue 962d399c 不回退）。

### 来自累积 FR（Step 1.3，context-manifest）
- `[累积FR]` 本 line（journey e6f803f2）现存 ability 均为 planned 态，无 done/working 历史（PRD 第 78 行）——无累积行为约束需保持。
- context-manifest: 本 sprint 无 line journey_id 级 T3 端点数据（journey 无历史 ability），按「无累积 FR」处理。

---

## Invariant 覆盖（铁律逐条映射，Step 1.3）

| 铁律 | 映射 | 覆盖方式 |
|------|------|----------|
| [台账不入库] controller 台账 `.harness/progress.md` git 追踪之外 | INV-1 | `.gitignore` 新增 `.harness/`；`git check-ignore` 断言 |
| [never_started 兜底] 从未启动进程走 never_started，不覆盖已有 error_message/failure_reason | INV-2 | 新增 `CONTROLLER_NEVER_STARTED_REASON_PREFIX` + 兜底逻辑；单测断言不覆盖既有字段 |
| [会话独享路径] 临时脚本落会话独享路径（含 session/run id），禁共享 /tmp 固定名 | INV-3 | Controller 台账/句柄文件路径含 runId；断言路径含 runId 且非共享固定名 |
| [PR CONFLICTING] CONFLICTING 时 GitHub 静默不触发 CI，不得按 CI 卡死空等 | INV-4 | 监护循环遇 CONFLICTING 短路（不空等 CI）；单测断言短路 |
| [phase-event] relay 各 phase 完成调 `POST /harness/phase-event` 记账 | INV-5 | Controller **只监护不执行**，phase-event 仍由 Kernel 派发链调用；断言 Controller 不拦截/不改该调用（保留既有链路） |
| [validation clock] evaluator validation clock 采纳规则不得回退 | INV-6 | N/A：本 sprint 不触及 evaluator validation clock 代码路径 |

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 每条 kernel run 一个常驻只监护 Controller 进程：认领→续租→监护 fatal 分流→human_review 冻结→终局回写退出 | 见 Golden Path Step 1-6 |
| **NFR（做得多好）** | 续租周期可观测 ≥2；失败终局结构化回传；各 phase 记账 | lease 续租秒级可观测（注入小周期）；task.result 必写；phase-event 不拦截 |
| **Invariant（永不违反）** | 台账不入库/never_started 兜底/会话独享路径/CONFLICTING 不空等/phase-event/validation clock | 见「## Invariant 覆盖」INV-1..6 |
| **判定点（怎么知道）** | Kernel 死活、failure_class 可否恢复、run 是否在人审等待 | 见「判定点登记表」 |
| **保质期（何时过期）** | lease TTL=1800s；Controller 进程随 run 终局退出 | 沿用 `CONTROLLER_LEASE_DEFAULT_SECONDS`，不新定义 |
| **死亡告警（停了谁知道）** | Controller 死 → lease 过期 → orphan-guard 兜底接管（后备） | `reconcileOwnerlessKernelRuns` 兜底收尸，现有机制 |
| **失败语义（挂了怎么办）** | 见「失败语义声明」 | 结构化 fail-closed；从不静默停在活跃/done |
| **效果确认（已发≠已生效）** | ownership 落库回读、lease 单调后推回读、task.result 回读 | 每个对外动作都 psql 回读真实副作用（带时间窗/单调断言） |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ Kernel 子进程是否已死 | A. `kill(pid,0)` 探 ESRCH; B. 仅看心跳过期 | A. `kill(pid,0)`（host 一致才判，fail-open 见 kernel-liveness.js） | 裸心跳过期会误杀活 Controller（事故 51836fb2 实证） | 误判死→无谓 resume/终止；误判活→崩溃 run 无人救 |
| ⚠️ failure_class 可否恢复 | A. 按枚举白名单分类; B. 一律重试 | A. `classifyControllerRecovery` 枚举分流，未知 fail-open resume | 沿用既有 failure_class 枚举，未知偏可恢复不误杀 | 不可恢复误判可恢复→无限重启烧配额；反之→本可救的 run 被终止 |
| run 是否在人审等待 | A. `reviewClassForReason==merge_gate`; B. 看 phase | A. `reviewClassForReason(failure_reason)==merge_gate`（human-review-class.js 既有） | 复用既有人审分类，不自造 | 误判→该冻结时没冻结，head 漂移饿死人审（run 8783807c 死因） |

> ⚠️ 行属「升拍板点」级别：lease 续租周期与 failure_class 分流边界若 PrepPRD 未拍，见下 notes。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| Controller 从未成功启动 | 走 never_started 兜底，写 `controller_never_started:`，不覆盖已有 error_message/failure_reason | 是（幂等键=runId） | orphan-guard 后备接管 |
| Kernel 子进程 fatal | 可恢复→resume；不可恢复→结构化 failed（`kernel_process_fatal:`）；run 不进无主态 | 是（同 runId 收敛） | reconciler 后备 |
| Controller 进程死亡 | lease 过期 → `reconcileOwnerlessKernelRuns` fail-closed 收敛 | 是（无主判定 A OR B） | 现有 orphan-guard 后备 |
| PR CONFLICTING（CI 静默） | 监护循环短路，不按 CI 卡死空等 | 是 | 走人审/收敛，不空转 |
| 终局回写失败 | 结构化回传失败终局（禁无声消失） | 是 | 下一轮巡检重试 |

### 输入对抗面

N/A —— 本 sprint 是 Brain 内部进程编排，不对外暴露 agent 输入接口（无外部用户可写入面）。

---

## 真实调用方请求 shape

N/A —— 本 sprint 无「设备/agent 调服务端」路径（Controller 是本机守护进程，relay 本机 spawn，无跨设备真实调用方）。

## 未覆盖真实链路清单

- **真实 LLM Kernel 阶段工作** ｜ 测试用 `CONTROLLER_KERNEL_LAUNCH_CMD` 注入良性子进程（`sleep`）代替真 LLM Kernel ｜ 原因：E2E 内跑完整 LLM pipeline 成本/时长不可控，且被改的边是 Controller↔子进程监护（该边全真：真 spawn/真 kill/真探活），非 Kernel 的 LLM 产出 ｜ 真验证补位：生产 relay 路径用真 `launchKernelProcess`；Kernel LLM 产出正确性由既有 harness GAN/evaluator 链路覆盖，不属本 sprint scope。
- **真实 GitHub PR merge**（Step 5）｜ E2E 用 driver 注入「已 merged 终局信号」驱动 Controller 回写，不真去 GitHub merge PR ｜ 原因：attempt 沙箱无真实可 merge 的 PR ｜ 真验证补位：Controller 终局回写逻辑（task.result 结构 + merged 判据）真 PG 验；真实「守到 PR merged」的 PR 状态轮询由既有 pr-head-resolver / harness 巡检覆盖。

## 接缝清单（接缝 vs 逻辑）

1. **Controller ↔ Kernel 子进程存活探测**（真机=本机 `child_process`）——接缝，真进程 spawn/kill/探活验（scenario-kill-kernel-*），CI 绿 ≠ done。
2. **Controller ↔ 真 PG（ownership/lease 续租）**——接缝，真 PG 回读单调后推验（scenario-ownership-lease）。
3. **human_review 冻结 ↔ 真 git push**——接缝，整合层真 bare git repo 验 push 拒止/恢复（scenario-human-review-freeze）。

上述接缝均在真目标（真进程 + 真 PG + 真 git）验，非 mock/CI 绿即 done。

---

## E2E 验收（final-e2e — target_environment=local_api，evaluator 本地跑）

> 单 bash 块。`${DB_URL:?}` 由 Fleet 注入的 attempt 级全新空库；先跑仓库真实 migration 建表，再用 driver 驱动真身 Controller 守护进程与真 PG/真子进程/真 git 完成 Golden Path 全程。Controller 的 Kernel 用 `CONTROLLER_KERNEL_LAUNCH_CMD` 注入良性子进程（被改的边——Controller↔子进程监护——全真）。业务身份自举：本 sprint 无用户 auth/tenant，业务主体 = migration 建表后 driver 用真 `createKernelRun` 建 run（非预注入凭据）。

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
export DATABASE_URL="$DB_URL"
# 从 DB_URL 派生 DB_* 供 migrate.js / db-config.js（避免 Chinese 标点贴变量，纯 ASCII 段）
eval "$(node -e 'const u=new URL(process.env.DB_URL);const d=s=>s?decodeURIComponent(s):"";process.stdout.write(["export DB_HOST="+u.hostname,"export DB_PORT="+(u.port||"5432"),"export DB_USER="+d(u.username),"export DB_PASSWORD="+d(u.password),"export DB_NAME="+u.pathname.replace(/^\//,"")].join(String.fromCharCode(10)))')"

# 1. 空库跑仓库真实 migration，机检 ownership/lease 列存在
( cd packages/brain && NODE_ENV=test node src/migrate.js )
psql "$DB_URL" -tAc "SELECT to_regclass('public.initiative_runs') IS NOT NULL" | grep -qx t
psql "$DB_URL" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='initiative_runs' AND column_name IN ('controller_session_id','controller_lease_expires_at')" | grep -qx 2

DRIVER="packages/brain/scripts/controller-e2e-driver.mjs"

# 2. GP Step1+2: spawn 真身 Controller 取 ownership + 续租 lease 跨 >=2 周期
OUT1=$(node "$DRIVER" scenario-ownership-lease)
echo "$OUT1"
echo "$OUT1" | grep -q '"ownership_ok":true'
echo "$OUT1" | grep -q '"lease_renewals":[2-9]'

# 3. GP Step3: kill -9 Kernel 两分支——可恢复 resume / 不可恢复结构化终止，均不无主
node "$DRIVER" scenario-kill-kernel-recoverable | tee /dev/stderr | grep -q '"resumed":true'
node "$DRIVER" scenario-kill-kernel-terminate | tee /dev/stderr | grep -q '"structured_terminate":true'

# 4. GP Step4: human_review 期 push 冻结判据 true->裁决后 false（真 git push 验拒止/恢复）
node "$DRIVER" scenario-human-review-freeze | tee /dev/stderr | grep -q '"freeze_ok":true'

# 5. GP Step5: 终局 task.result 回写 pr_url+merged 后 Controller 退出
OUT5=$(node "$DRIVER" scenario-finalize)
echo "$OUT5"
echo "$OUT5" | grep -q '"result_written":true'
FIN_TASK=$(echo "$OUT5" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s.trim().split(String.fromCharCode(10)).pop()).task_id||""))}catch(e){process.stdout.write("")}})')
if [ -n "$FIN_TASK" ]; then
  psql "$DB_URL" -tAc "SELECT (result->>'merged')::boolean AND (result ? 'pr_url') FROM tasks WHERE id='$FIN_TASK'" | grep -qx t
fi

# 6. GP Step6(边界): kill -9 Controller -> lease 过期 -> 既有 orphan-guard 兜底 fail-closed
node "$DRIVER" scenario-kill-controller | tee /dev/stderr | grep -q '"orphan_recovered":true'

echo "OK: 真身 Session Controller Golden Path 全程验证通过"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 12 分钟 / 18 动作（进程编排 + 并发接缝面较宽，略调大，理由：kill/续租/兜底存在竞态窗口）
高风险面:
- 错输入: driver 传不存在的 runId / 非法 failure_class（如 `CONTROLLER_FORCE_FAILURE_CLASS=garbage`），断言 Controller 不崩、走兜底
- 重复提交: 同一 task 连续两次 spawn Controller（并发 run），断言不双主、不共享 /tmp 固定文件互踩（INV-3）
- 中途中断: 续租途中 kill -9 Controller 与 orphan-guard 巡检并发，断言不双写/不误伤健康 run（lifecycle.js 二次纯谓词确认）
- 边界值: lease 恰好在续租与过期临界（`CONTROLLER_LEASE_RENEW_INTERVAL_MS` 接近 TTL），断言不出现瞬时无主假阳
发现分级: P0/P1（run 无主/静默丢/双主/误杀健康 run）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

## notes

- `judgment-pending-user: lease 续租周期（CONTROLLER_LEASE_RENEW_INTERVAL_MS 默认值）` —— PRD 假设2 明确「不新定义 SLA 数值，除非 GAN 阶段用户指定」；本合同取「默认由 lease TTL 派生（如 TTL/3），测试用小值注入」，续租默认周期数值待 PrepPRD/用户拍板，未拍前按派生值实现。
- `judgment-pending-user: failure_class 可恢复/不可恢复边界名单` —— 沿用现有枚举（可恢复=transient/infrastructure_blocked，不可恢复=assembly_fault/contract_fault/contract_invalid，未知 fail-open resume）；若用户对某枚举归类有异议需在 GAN 拍板。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 分流/冻结/兜底纯谓词 | `sprints/08131657-kernel-9bd45a03/tests/controller-lifecycle-contract.test.ts` | `assembly_fault 归不可恢复类 terminate` / `transient / infrastructure_blocked 归可恢复类 resume` / `等待人审` / `renewControllerLease 导出` | 10 failed（导出未实现）已实测 |
| 真 PG + 真子进程生命周期 | `packages/brain/src/__tests__/integration/kernel-controller-daemon.pg.integration.test.js`（新增，登记进 vitest.config.js POSTGRES_INTEGRATION_TESTS） | Controller 真身 spawn 取 ownership / lease 周期续租跨 2 周期 / kill Kernel 分流不无主 / kill Controller orphan-guard 兜底 / human_review push 冻结（真 git） / 终局 task.result 回写 | brain-integration job 起真 PG，实现前红 |
