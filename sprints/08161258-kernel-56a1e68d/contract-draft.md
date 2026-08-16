# Sprint Contract Draft (Round 1) — Fleet Runner run 级双容器

## 锚定父路声明

独立小路（无父路）—— 本 sprint 定义并完整覆盖 journey `e6f803f2` 的「Fleet run 级双容器」Golden Path 第 1-6 步；该 journey 现有 ability 全为 planned，无既有父路依赖。

## Unified Map 影响半径

`[MAP_NOT_CONFIGURED]` — 任务 payload `map_scope=["F1"]` 但 `map_repo=null`，Unified Map 未完整配置，`must_run_assertions` 为空。不回退领域硬编码；本合同的回归约束以 §已知约束 与铁律 §历史约束三源为准。

## GP-Anchor

gp-anchor: skipped (product-map.json not found)   ← 本仓库（cecelia）根目录无 `product-map/generated/product-map.json`

## Response Schema（推导来源: PRD 字面）

N/A — 任务无 HTTP 响应。本 sprint 交付物为 fleet-worker 脚本（容器生命周期）+ DB 迁移（container_id 列）+ 容量核算重构 + feature flag，均为内部后端调度，无新增 HTTP 端点。api_registry 查询为空（`[NEW_PATTERN]` 不适用，因无对外 schema）。Reviewer 第 6 维 verification_oracle_completeness 就 schema 项自动满分；BEHAVIOR 覆盖以测试套件与 DB 断言为 oracle。

---

## 技术上下文（Step 1.1 registry 推导结果）

- api_registry / db_schema / test_registry 查询：Brain registry 返回空。字段命名规范以现有源码为准（下列均为**现存**符号，非臆造）。
- 关键既有锚点（勘察实证，带文件:行）：
  - `attempt-runner.cjs:18` `CONTAINER_NAME_PATTERN`（严格 per-attempt 正则，改名首要改点）；`:533`/`:748` `cecelia-fleet-${attemptId}` 字面量。
  - `attempt-runner.cjs:1301` `labelsFor` 已写 label `cecelia.fleet.run_id`（run-scoped 恢复的现成锚点）。
  - `attempt-runner.cjs:2456-2476` reconcile 孤儿识别当前按 `attempt_id`/`knownAttemptIds`；`:2462` 已读 `run_id` label 但**未参与匹配决策**。
  - `workspace-manager.cjs:119` `createWorkspaceManager`；**无任何 `git bundle` / 从 bundle clone 逻辑**（全新能力）。现有 `quarantine`（`:478`）是「失败 worktree 隔离归档」，与本 sprint 的「候选导出 quarantine 卷」**同名不同义**，实现时必须区分命名。
  - `workspace-manager.cjs:13-23` `SPEC_FIELDS`（未知字段 → `workspace_spec_unknown_field` 硬拒）；新增 bundle 相关 spec 字段必须登记进此集合。
  - 容量真实所在（PRD 把它写成 node-admission.js 系推断偏差，实处如下）：`src/orchestrator/preflight/production-probes.js:157` `getMachineCapacity`（读 DB）、`src/orchestrator/fleet-node/node-profile.js:157` `getRoleCapacity`（纯函数 `Math.floor(baseCapacity/weight)`）、`src/orchestrator/attempt-machine-capacity.js:17` `prepareAttemptMachineCapacity`（`autonomous_singleton` 判定，纯函数）。当前容量为**纯槽位数**模型，**无** per-container `--memory`/`--cpus`（attempt-runner create 块 `:560-636` 无资源限制），「每 run 2GB/cpu2」为**新引入常量**。
  - `attempt-store.js:502-527` singleton fence SQL 已用 `existing.run_id = run.id` 排他，per-run 语义可复用此结构。
  - migration 现状：最新 `430`；`initiative_runs` 无 `container_id` 列；`harness_attempts.local_container_naming`（migration `364`，枚举 `legacy-unsuffixed`/`generation-v1`）。新 migration 编号 `431`。
- FLEET_RUN_SCOPED_CONTAINER：全 `scripts/fleet-worker/` 无任何出现，从零引入；env 读取点放 `fleet-worker.cjs` 的 `main(env)` 往下透传（与现有 `CECELIA_*` env 读取风格一致），cjs 内部不直接读 `process.env`。

---

## 已知约束（回归测试 + 累积 FR）

来源 [回归测试]（勘察 attempt-runner.test.cjs / workspace-manager.test.cjs / node-profile.test.js / attempt-machine-capacity.test.js）：
- [attempt-runner.test.cjs] 只有 evaluator 角色容器以 `--user root` 启动（`:2812`/`:2897`），其余角色非 root（uid/gid 5999 tmpfs 挂载 `:2786`）。
- [attempt-runner.test.cjs] Generator push 被钉死 `blocked-by-harness://evaluator`（GIT_CONFIG pushurl，`:1213`）。
- [attempt-runner.test.cjs] adapter 层断言硬编码 per-attempt 容器名 `docker start cecelia-fleet-<attemptId>`（`:2813-2817`）——**改名 sprint 必须同步更新此断言**。
- [attempt-runner.test.cjs] 每 attempt 独立 callback token 身份，不持久化（`:756`）。
- [workspace-manager.test.cjs] 「从同机 retained Generator admin clone 物化远端不存在的精确候选」（`:142`）为 (b)(c) 最接近的现有能力，但走同机 admin_path 复用；本 sprint 须新增 bundle 隔离源，不继承工作容器文件。
- [node-admission.test.js] `evaluateBaseAdmission` 为纯函数、真 profile fixture、table-driven，无 mock（不得引入 mock 破坏）。
- [attempt-machine-capacity.test.js] `prepareAttemptMachineCapacity` 纯函数直调断言（`:10`/`:35`），run-scoped 改造须保持纯函数可测。

来源 [累积FR]：`context-manifest` 端点返回空；journey `e6f803f2` 现有 ability 均 planned，本 line 暂无历史已验收行为（PRD 亦声明「本 line 暂无历史」）。context-manifest: available-but-empty。

---

## 历史约束三源加载（铁律 → INV 映射）

PRD 注入的 area 级铁律逐条映射（完整可执行断言见 contract-dod.md 的 INV 条目）：

| 铁律 | 本 sprint 映射 |
|---|---|
| [单slot串行] 单 slot 串行、并行只许跨 slot | INV-1：容量 per-run，`autonomous_singleton` per-run fence 保证同机同 run 仍串行、跨 run 才并行 |
| [禁写死环境] 容量/内存/端口/路径按变量解析 | INV-2：run 容器 mem/cpu 上限走命名常量（`RUN_CONTAINER_MEM_BYTES`/`RUN_CONTAINER_CPUS`），容量从机器 profile 推导，禁写死 |
| [真环境验证] 真环境验证才算 done | 见 §接缝清单：docker ps 真 run 观测为接缝断言，标 logic-done-pending，须真 Fleet 宿主验 |
| [多租户默认] 测试默认多租户 | N/A：本 sprint 为 fleet 基础设施容器生命周期，无业务租户数据面（显式声明） |
| [凭据安全] 凭据不入 git、容器级 broker 保持 | INV-3：每 attempt 独立 scoped route token/callback token，容器级凭据 broker 不变（trust 回归） |
| [日志脱敏] 日志脱敏 | INV-4：bundle/reconcile/容量日志不得打印 token/cookie/authJson（沿用现有 FIFO 凭据不落盘） |
| [端点鉴权] 端点鉴权 | N/A：无新增 HTTP 端点 |
| [租户隔离] 记忆/资源按租户隔离 | N/A：无租户资源改动 |
| [FleetGeneratorBrainURL] Brain URL 服务端签发权威 | INV-5：run 级容器复用不改 Brain URL 注入路径，Generator 容器内不得自改 |
| [generator重试身份] 基础设施重试保持同一 attempt 身份 | INV-6：run 容器复用下，Generator 重试仍复用同 attempt_id 身份，不新起 attempt |
| [planner分支] planner 绑服务端签发 role branch | N/A：不改 planner 分支绑定路径 |
| [evaluator临时脚本隔离] evaluator 临时脚本落会话独享路径 | INV-7：eval 容器全新隔离，天然独享；不共享工作容器 /tmp |
| [generator不自merge] merge 权归 controller | N/A：不改 merge 权 |
| [Kernel校验时钟] existing PR evaluator validation clock adoption | N/A：不改校验时钟 |

---

## Golden Path

[initiative_run 首个 attempt 到达 fleet worker] → [run 级工作容器常驻 + 后续 attempt 复用 + Generator 候选落 quarantine bundle + Evaluator 干净容器从 bundle 评估 + run 终态销毁/reconcile 按 run_id 找回] → [一条 run 稳定 ≤2 个容器、候选不丢、信任边界不变、容量按并发 run 计 ≥2]

### Step 1: run 首个 attempt 到达 → 创建（或复用）工作容器 `cecelia-fleet-run-<run8>`
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步 + 范围限定「run 级容器生命周期（创建/复用）」

**可观测行为**: `resolveContainerNames({runId, attemptId, role, runScoped:true})` 对 work 容器返回 `cecelia-fleet-run-<run8>`（run8 = run_id 前 8 位 hex）；`CONTAINER_NAME_PATTERN` 接受该名；docker create 打 label `cecelia.run_id=<run_id>`（复用已存在的 `cecelia.fleet.run_id`）；container_id 记入 `initiative_runs`（新列 `work_container_id`，migration 431）。

**验证命令**:
```bash
cd packages/brain
npx vitest run scripts/fleet-worker/attempt-runner.test.cjs -t "复用同一工作容器" --reporter=dot 2>&1 | tail -4
```
期望：≥1 passed，0 failed。

**硬阈值**: 同一 run 第 1 个 attempt 触发 `docker.prepare`（create）恰 1 次；第 2 个同 run attempt **不再** create，走 `docker exec` 新起 provider 进程；单测断言 create 调用计数 == 1。

### Step 2: 同 run 后续 attempt（Planner/Proposer/Reviewer/Generator）→ 同容器内新起 fresh session
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步

**可观测行为**: 后续 attempt 在同一工作容器内启动新 provider 进程，仍是 fresh session（独立 TaskBundle、独立 callback token / scoped route token、独立 lease），共享工作区；不同 run → 不同容器名。

**验证命令**:
```bash
cd packages/brain
npx vitest run scripts/fleet-worker/attempt-runner.test.cjs -t "复用同一工作容器" --reporter=dot 2>&1 | tail -4
# 同一测试覆盖「同 run 复用 / 不同 run 隔离」两个断言
```
**硬阈值**: 不同 run_id → work 容器名不同（run8 不同）；同 run 两 attempt 的 container_id 相等；每 attempt 的 callback token 不复用（沿用 `:756` 断言）。

### Step 3: Generator 完成 → 候选 SHA `git bundle` 落 host quarantine 卷
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步（修 #4901 候选蒸发根因）

**可观测行为**: `workspace-manager` 新增能力将 Generator 候选 SHA `git bundle create` 到 quarantine 卷（按 run_id 命名、一次性写入）；bundle 内含候选 commit。

**验证命令**:
```bash
cd packages/brain
npx vitest run scripts/fleet-worker/workspace-manager.test.cjs -t "干净 clone 后 HEAD" --reporter=dot 2>&1 | tail -4
```
**硬阈值**: bundle 文件在 quarantine 卷出现，`git bundle verify` 通过；bundle 含候选 SHA（真 git 验证，非文件存在）。

### Step 4: Evaluator（含 evidence repair）→ 全新容器 `cecelia-fleet-eval-<attempt8>` 从 bundle 干净 clone
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 步 + 边界「防污染断言必须为真」「bundle 缺失/损坏显式失败不 fetch 远端」

**可观测行为**: 每次 Evaluator 起全新 eval 容器，从 quarantine bundle clone 到候选 SHA（`--no-fetch`，不碰远端），依赖按锁文件重装，不继承工作容器任何文件；clone 后 `HEAD == 候选 SHA`；工作容器写入的标记文件在 eval 工作区**不存在**（防污染）；bundle 缺失/损坏 → 显式失败，不回退 fetch。

**验证命令**:
```bash
cd packages/brain
npx vitest run scripts/fleet-worker/workspace-manager.test.cjs -t "防污染" --reporter=dot 2>&1 | tail -4
npx vitest run scripts/fleet-worker/workspace-manager.test.cjs -t "bundle 缺失" --reporter=dot 2>&1 | tail -4
```
**硬阈值**: eval 工作区 `git rev-parse HEAD == 候选 SHA`；工作容器标记文件 `test -e` 为假；bundle 损坏用例抛显式错误、无 fetch 远端调用（真 git fixture 验证）。

### Step 5: run 终态 → 销毁工作容器；kernel 崩溃后 reconcile 按 run_id 找回
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 步 + 边界「reconcile 用 run_id 找回，不误建第二个」

**可观测行为**: run 到达 done/failed/cancelled（含 orphan-guard 判死）→ 销毁工作容器；lease 过期/kernel 崩溃后 reconcile 用 `cecelia.fleet.run_id` label 对照活跃 run 集合：run 仍活 → 保留同容器继续，不新建；run 已终态 → 回收。

**验证命令**:
```bash
cd packages/brain
npx vitest run scripts/fleet-worker/attempt-runner.test.cjs -t "reconcile 按 run_id" --reporter=dot 2>&1 | tail -4
```
**硬阈值**: reconcile 遇到 run 活跃的工作容器 → `docker.remove` **不被调用**；run 终态 → `docker.remove` 被调用恰 1 次；不新建容器（create 调用 0 次）。

### Step 6: 容量按并发 run 容器计 → 5GB VM 得 ≥2；信任边界不变
**来源**: `[FROM_PRD]` — PRD Golden Path 第 6 步 + 目标 4/NFR（每 run mem 2GB/cpu 2）

**可观测行为**: 容量核算改按并发 run 容器数（每 run mem 2GB/cpu 2），`maxConcurrentRunContainers({memoryBytes,cpuCores})` 对 5GB/8core 得 ≥2；`autonomous_singleton` per-run；trust smoke 全绿（非 root、零 cap、push 拒绝、token 独立）。

**验证命令**:
```bash
cd packages/brain
npx vitest run src/orchestrator/fleet-node/node-profile.test.js -t "并发 run 容器" --reporter=dot 2>&1 | tail -4
npx vitest run src/orchestrator/attempt-machine-capacity.test.js -t "per-run" --reporter=dot 2>&1 | tail -4
npx vitest run scripts/fleet-worker/attempt-runner.test.cjs --reporter=dot 2>&1 | tail -4   # trust 回归全文件
```
**硬阈值**: `maxConcurrentRunContainers({memoryBytes: 5*1024^3, cpuCores: 8})` >= 2；attempt-runner.test.cjs 整文件 0 failed（trust 回归）。

---

## 禁 mock 边清单

本单涉及：调度（run 容器创建/复用/reconcile）、状态机（run 终态判死→销毁）、跨模块数据传递（候选 bundle：workspace-manager→quarantine 卷→eval 容器）、生命周期钩子（容器 create/exec/destroy/reconcile）、DB 写路径（container_id → initiative_runs / harness_attempts）。逐条列禁 mock 的边：

- **workspace-manager ↔ 真实 git / 真实 fs（候选 bundle → quarantine → eval clean clone）**：测试必须用真 git（`workspace-manager.test.cjs` 现有 tmp fixture 真 `git init/commit/clone` 风格），禁 mock `git bundle`/`clone`。`HEAD==候选 SHA`、防污染、bundle 损坏失败三条断言均走真 git。
- **attempt-runner / attempt-store ↔ 真实 Postgres（container_id 落库、同 run 共享 container_id）**：走 `.pg.integration.test.js`（migration 431 + 真 PG，`vitest.integration.config.js` 跑），禁 mock DB；per-run singleton fence 复用 `attempt-store.js` 真 SQL。
- **attempt-runner 容器复用/reconcile 决策 ↔ docker CLI**：docker daemon 属 OS 级外部边界，评估环境（local_api）无 docker。单测按 `createDockerAdapter({runCommand})` / 注入 fake `docker` 对象记录 argv 与调用计数，验证「首 attempt create、后续 exec、reconcile 按 run_id 保留/销毁」的**决策逻辑**（沿用现有测试注入模式，非本单新引入的 mock）。**真 docker 端到端复用（docker ps 只见 1 个 run 容器）属接缝断言**（见 §接缝清单），显式登记，非静默 mock。

（无纯 UI/纯文档豁免；本单为接缝密集型，禁 mock 边非空。）

---

## 接缝清单（接缝 vs 逻辑）

| # | 接缝点 | 碰真实世界在哪 | 真目标验证方式 | 本轮状态 |
|---|---|---|---|---|
| 1 | 真 run docker 拓扑观测 | 真 Fleet 宿主 docker daemon：Planner→Generator 全程只 1 个 `cecelia-fleet-run-<run8>`，Evaluator 仅多 1 个 `cecelia-fleet-eval-*` | 真 Fleet 宿主（含 docker + OrbStack 5GB VM）跑一条 F1 真 run，`docker ps` 观测 + `psql harness_attempts` 查同 run 共享 container_id | `logic-done-pending`（评估容器 local_api 无 docker，见 §未覆盖真实链路清单）；逻辑侧由单测（create/exec 计数、命名、reconcile）覆盖 |
| 2 | ≥2 条 run 各自容器并行 | 真宿主并发 run 容器 | 真宿主同时跑 ≥2 run，`docker ps` 见 ≥2 个 `cecelia-fleet-run-*` | `logic-done-pending`；逻辑侧由 `maxConcurrentRunContainers` 纯函数 ≥2 覆盖 |
| 3 | 候选在 Evaluator 卡住时仍可取 | 真宿主 quarantine 卷 | 真宿主中断 Evaluator，`git bundle verify` quarantine 卷候选仍在 | `logic-done-pending`；逻辑侧由 workspace-manager 真 git bundle/clone 覆盖 |

逻辑断言（容器命名、create/exec 计数、reconcile 决策、bundle→clone、容量数、DB 列）CI/单测/pg-integration 验绿即真 done；接缝断言 1-3 须真 Fleet 宿主验，未真验前标 `logic-done-pending`，不得标 done。禁止写死环境假设值（run8/attempt8 从 run_id/attempt_id 推导、mem/cpu 走命名常量、profile 容量从机器读）。

---

## 未覆盖真实链路清单（规则 C 显式登记）

| 被 mock/未覆盖的真实链路点 | 为什么 | 真验证补位计划（谁/何时/什么环境） |
|---|---|---|
| 真 docker 容器 create/exec/destroy 端到端（含 docker ps 拓扑、并发 run、候选在卷可取） | 评估环境 target_environment=local_api，Fleet 评估容器内无 docker daemon（无法起真容器）；docker 是 OS 级外部边界 | controller 调度一条 F1 真 run 到真 Fleet 宿主（us-mac-m4，含 docker + OrbStack 5GB VM），evaluator/主理人 `docker ps` + `psql harness_attempts` 观测；接缝清单 1-3 转 done |
| container_id 落 initiative_runs/harness_attempts 的真 DB 断言 | 本 proposer 会话 runtime_resources.postgres=false，无法在起草期跑；但**评估期 local_api 注入 DB**可跑 | evaluator 阶段：`## E2E 验收` 脚本对注入 DB 跑 migration 431 + pg-integration 断言（本轮已写为可执行，非 mock） |

（本合同其余链路无 force_*/stub/假数据；上述两项为环境不可达的显式登记，controller 须原样呈现进 PR 描述。）

---

## 真实调用方请求 shape

N/A — 本 sprint 无「设备/agent 调服务端」的真实调用方新增或改动（无新增 HTTP 端点，attempt 派发沿用现有 `POST /harness/attempts/prepare` 内部路径，认证方式不变）。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | run 级工作容器常驻（首建/复用/exec/销毁/reconcile）；候选 git bundle→quarantine 卷；Evaluator 干净容器从 bundle clone；容量按并发 run 计；`autonomous_singleton` per-run；feature flag `FLEET_RUN_SCOPED_CONTAINER`（默认 on，off 回退单 attempt 旧路径） |
| **NFR（做得多好）** | | 每 run 工作容器 mem 2GB/cpu 2；一条 run 稳定 ≤2 容器；5GB VM 并发 run ≥2；reconcile 幂等（不误建第二个） |
| **Invariant（永不违反）** | | 非 root（仅 evaluator root）、零 capabilities、Generator push 拒绝、每 attempt 独立 scoped route token/callback token、attempt 间不复用 provider session、Brain URL 服务端签发权威、eval 容器不继承工作容器任何文件（防污染） |
| **判定点（怎么知道）** | | 见下方登记表 |
| **保质期（何时过期）** | | quarantine bundle 按 run 一次性写入、run 终态清理；work 容器随 run 终态销毁；scoped/callback token 随 attempt 进程退出即回收 |
| **死亡告警（停了谁知道）** | | reconcile 找不回工作容器 / bundle 缺失损坏 → 显式失败上报，走现有 harness-watchdog（扫 in-flight initiative_runs deadline）+ orphan-guard 判死 |
| **失败语义（挂了怎么办）** | | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | | 容器 create 后经 docker inspect 确认存活；候选 bundle 经 `git bundle verify`；eval clone 后 `HEAD==候选 SHA`；container_id 落库经 psql 查 harness_attempts |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 聊天记录 API 不稳定 | 静默丢消息 |
| ⚠️ run 是否活跃（reconcile 该保留还是销毁工作容器） | A. `cecelia.fleet.run_id` label 对照 DB 活跃 run 集合; B. 容器运行时长阈值 | A（label 对照活跃 run 集合） | run_id label 已存在且权威（DB 是 run 生命周期 SSOT），时长阈值会误杀长 run | 误销毁活跃 run 工作容器 → 候选/工作区蒸发、run 从合同重做（直接面客倒退） |
| ⚠️ 候选 bundle 是否可用（Evaluator 能否评估） | A. `git bundle verify` 通过且含候选 SHA; B. 仅文件存在 | A（verify + 含 SHA） | 文件存在不代表未损坏/含正确 commit；损坏须显式失败不得回退 fetch 远端 | 用损坏/错 bundle 评估 → 评的不是真候选（假绿或假红） |
| run 首个 attempt 是否已建容器（该 create 还是 exec） | A. state store 查 run→container_id 绑定; B. docker ps grep 容器名 | A（state/DB 绑定） | 绑定是权威，docker ps grep 有竞态 | 重复 create → 一条 run 多容器，容量核算失真 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 工作容器 create 失败 | 回滚 `docker rm -f`，attempt 报错，不绑定 container_id | 是（幂等键=run_id，重试复用绑定或重建） | 由 controller 重派 attempt |
| reconcile 找不回工作容器（run 仍活） | 显式失败上报，**不**误建第二个容器 | 是（按 run_id 匹配） | orphan-guard/watchdog 判死→run 走 failed |
| quarantine bundle 缺失/损坏 | Evaluator **显式失败**，不 fetch 远端、不复用工作容器文件 | 否（候选已丢，须重跑 Generator） | 上报 controller，候选重生成 |
| FLEET_RUN_SCOPED_CONTAINER=off | 回退单 attempt 容器旧路径，行为与今日一致 | 是 | 即降级路径本身 |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本 sprint 为 fleet 内部调度基础设施，无对外暴露 agent / 外部用户可写入接口（attempt 派发是 Brain 服务端内部路径，凭据经容器级 broker）。

---

## E2E 验收（final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 说明：本 sprint 无 HTTP 业务端点、无业务租户身份（local_api 业务登录自举硬规则 N/A：不存在业务用户/session/tenant，仅 fleet 基础设施 + DB schema）。评估期 Fleet 注入 DB（DB_HOST/DB_PORT/DB_USER/... 或 DB_URL）；脚本先对空库跑真实 migration，再跑逻辑套件与 pg-integration。真 docker 拓扑观测为接缝断言（§接缝清单），local_api 评估容器无 docker，不在本脚本内；逻辑侧全部可机检。

```bash
#!/bin/bash
set -euo pipefail
cd "${WORKSPACE_PATH:-/workspace}/packages/brain"

echo "== 1. 逻辑套件（无需 docker/PG）：容器命名/复用/reconcile/容量/bundle/防污染/trust 回归 =="
run_filtered() {  # $1=file $2=名字过滤子串；断言 ≥1 passed 且 0 failed
  local out
  out=$(npx vitest run "$1" -t "$2" --reporter=dot 2>&1)
  echo "$out" | tail -4
  echo "$out" | grep -qE "Tests  +[1-9][0-9]* passed" && ! echo "$out" | grep -qE "[1-9][0-9]* failed"
}
run_filtered scripts/fleet-worker/attempt-runner.test.cjs "复用同一工作容器"
run_filtered scripts/fleet-worker/attempt-runner.test.cjs "reconcile 按 run_id"
run_filtered scripts/fleet-worker/attempt-runner.test.cjs "回退单 attempt 容器"
run_filtered scripts/fleet-worker/workspace-manager.test.cjs "干净 clone 后 HEAD"
run_filtered scripts/fleet-worker/workspace-manager.test.cjs "防污染"
run_filtered scripts/fleet-worker/workspace-manager.test.cjs "bundle 缺失"
run_filtered src/orchestrator/fleet-node/node-profile.test.js "并发 run 容器"
run_filtered src/orchestrator/attempt-machine-capacity.test.js "per-run"

echo "== 2. trust 回归全文件 0 failed（非 root/仅 evaluator root/push 拒绝/token 独立）=="
TRUST=$(npx vitest run scripts/fleet-worker/attempt-runner.test.cjs --reporter=dot 2>&1)
echo "$TRUST" | tail -5
echo "$TRUST" | grep -qE "Test Files  +[1-9][0-9]* passed" && ! echo "$TRUST" | grep -qE "[1-9][0-9]* failed"

echo "== 3. DB：空库跑真实 migration + container_id 持久化 pg-integration（真 PG）=="
if [ -n "${DB_URL:-}" ] || [ -n "${DB_HOST:-}" ]; then
  # 空库先跑仓库真实 migration（migration 431 建 container_id 列），再跑 pg-integration 断言
  node -e "import('./src/migrate.js').then(m=>m.runMigrations()).then(()=>{console.log('migrations OK')}).catch(e=>{console.error(e);process.exit(1)})"
  PG=$(npx vitest run --config vitest.integration.config.js src/__tests__/integration/migration-431-run-container-id.pg.integration.test.js --reporter=dot 2>&1)
  echo "$PG" | tail -5
  echo "$PG" | grep -qE "Test Files  +[1-9][0-9]* passed" && ! echo "$PG" | grep -qE "[1-9][0-9]* failed"
else
  echo "FAIL: 评估环境未注入 DB（local_api 应提供 DB_URL/DB_HOST）——container_id 持久化无法验证"
  exit 1
fi

echo "== 4. Brain semver bump + DevGate 三件套 =="
cd "${WORKSPACE_PATH:-/workspace}"
NEWV=$(node -e "process.stdout.write(require('./packages/brain/package.json').version)")
node -e "const s='$NEWV'.split('.').map(Number),b=[1,273,59];const gt=s[0]>b[0]||(s[0]==b[0]&&(s[1]>b[1]||(s[1]==b[1]&&s[2]>b[2])));process.exit(gt?0:1)" || { echo "FAIL: 版本未 bump（应 > 1.273.59）"; exit 1; }
bash scripts/check-version-sync.sh
node scripts/facts-check.mjs
node packages/quality/scripts/devgate/check-dod-mapping.cjs sprints/08161258-kernel-56a1e68d/contract-dod.md

echo "✅ Fleet run 级双容器 Golden Path 逻辑侧 + DB 侧验证通过（docker 拓扑接缝见 §接缝清单，须真 Fleet 宿主验）"
```

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `resolveContainerNames` 传畸形 run_id（非 UUID / 短于 8 位 / 大写 hex）→ 应显式抛错或落回退，禁产出非法容器名（会被 CONTAINER_NAME_PATTERN 拒）
- 重复提交: 同 run 并发两个「首个 attempt」同时到达 → 只应 create 1 个工作容器（幂等，无竞态双建）
- 中途中断: Generator bundle 写到一半进程被杀 → quarantine 卷不得留半截 bundle 让 Evaluator 误当完好（须 verify 兜底）
- 边界值: 机器 mem 恰 2GB / 恰低于 2GB / 0 core → `maxConcurrentRunContainers` 应得 1 / 0，不得负数或 NaN；reconcile 遇 run_id label 缺失的历史遗留容器（legacy）应安全跳过不误删
发现分级: P0/P1（误删活跃 run 容器 / 候选丢失 / 用错 bundle 评估）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| run/eval 双容器命名 + flag 回退 | `scripts/fleet-worker/attempt-runner.test.cjs`（新增 it） | `复用同一工作容器`、`回退单 attempt 容器` | resolveContainerNames 未实现 → 红 |
| reconcile 按 run_id 找回/销毁 | `scripts/fleet-worker/attempt-runner.test.cjs`（新增 it） | `reconcile 按 run_id` | run_id 未参与匹配 → 红 |
| 候选 bundle → 干净 clone + 防污染 + 损坏失败 | `scripts/fleet-worker/workspace-manager.test.cjs`（新增 it） | `干净 clone 后 HEAD`、`防污染`、`bundle 缺失` | bundle 能力不存在 → 红 |
| 容量按并发 run 容器计 | `src/orchestrator/fleet-node/node-profile.test.js`（新增 it） | `并发 run 容器` | maxConcurrentRunContainers 不存在 → 红 |
| autonomous_singleton per-run | `src/orchestrator/attempt-machine-capacity.test.js`（新增 it） | `per-run` | 当前 per-attempt 语义 → 红 |
| container_id 落库（真 PG） | `src/__tests__/integration/migration-431-run-container-id.pg.integration.test.js`（新建，登记进 vitest.config.js POSTGRES_INTEGRATION_TESTS） | 同 run attempt 共享 container_id | migration 431/列不存在 → 红 |
| sprint TDD red 证明 | `sprints/08161258-kernel-56a1e68d/tests/run-scoped-container.red.test.mjs` | 上述纯函数面缺失 | 已跑：4 failed（Red 证据 /tmp/sprint-red.log） |

> BEHAVIOR 覆盖名均为对应 it() 测试名的字面子串；generator 先写 it() 名再截子串填 DoD，写完 `grep -F '<覆盖名>' <test file>` 必须命中。

---

## Contract Gate

contract-gate: packages/brain/src/lib/contract-gate.js 存在（cecelia worktree），代码层 Contract Gate 生效；本合同断言按速查表写法（curl/psql 无本单适用，vitest 真执行 + `git bundle verify` + psql 时间窗）。

## notes

- 判定点登记表含 2 个 ⚠️ 判定点（误删活跃 run 容器、用损坏 bundle 评估），误判后果严重（候选蒸发/评错候选）；PrepPRD/对齐会未显式拍过判定方法，标 `judgment-pending-user: run 活跃判定（label 对照活跃 run 集合）`、`judgment-pending-user: 候选 bundle 可用判定（git bundle verify + 含 SHA）`——建议主理人确认 label 对照 DB 活跃 run 集合是权威判活方式。
- 容量真实实现位置与 PRD「node-admission.js 及容量相关」的推断不符：实处为 production-probes.js / node-profile.js / attempt-machine-capacity.js（node-admission.js 仅健康准入，不算容量）。合同按真实源码定位，Reviewer 请以 §技术上下文 勘察为准。
- container_id 列落点：按 [ASSUMPTION] 优先 `initiative_runs` 新列（`work_container_id`）+ `harness_attempts.container_id`（同 run 共享），migration 431；若迁移成本高允许退化写 payload（由 generator 按真实表结构定夺）。
