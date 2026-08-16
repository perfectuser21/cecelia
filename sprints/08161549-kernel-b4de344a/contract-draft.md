# Sprint Contract Draft (Round 1)

**journey_type**: autonomous
**target_environment**: local_api
**BASE_REPO**: perfectuser21/cecelia
**implementation_baseline base_sha**: 40ecf6e6a031c2eb9a23825aabfc2ed215a69da6

> contract-gate: cecelia worktree（packages/brain/src/lib/contract-gate.js 存在）→ 代码层 Contract Gate 生效，本合同断言按速查表写 gate-clean。
> gp-anchor: skipped (product-map.json not found)
> map: [MAP_NOT_CONFIGURED]（task.payload 无 map_scope/map_repo，Unified Map radius 未启用，不回退领域硬编码；影响面以 PRD「预期受影响文件」为准）

## 锚定父路声明

独立小路（无父路）——journey e6f803f2 现有 ability 均为 planned，本 line 暂无已验收 golden_path，本 sprint 为 Fleet Runner 容器隔离基础设施改造，不推进既有业务父路。

## Response Schema（推导来源: N/A）

N/A — 任务无 HTTP 响应。本 sprint 只改 `packages/brain/scripts/fleet-worker/*` 容器编排与 `src/orchestrator/fleet-node/node-profile.js` 容量算法，对外无新增 HTTP 端点。容器/DB 副作用由 [BEHAVIOR] 的 psql/单测断言覆盖（Reviewer 第 6 维按 [BEHAVIOR] 覆盖度判，不适用 jq schema 链）。

## 已知约束（来自回归测试）

- [attempt-runner.test.cjs] → 现有 46+ 条 it()，覆盖 prepare/verify/start/reconcile/凭据 FIFO/信任（`starts only evaluator containers as root for the trusted evidence stage` / `rejects a Codex launch without an envelope before workspace or Docker side effects` / `streams a bounded GitHub token to its dedicated FIFO without argv exposure`）——本 sprint 改容器命名/生命周期不得回退这些断言。
- [workspace-manager.test.cjs] → clone/verifyExpectedHead/quarantine/node_deps 预装（`运行时依赖预装（node_deps）`）——候选 bundle 复用现有 quarantine 卷约定，不得破坏既有 clone/预装路径。
- [node-profile.test.js] → NodeProfile 注册表冻结校验（`contains exactly the three canonical machines and their frozen capacities`，us-mac-m4=7/xian-mac-m4=8/xian-mac-m1=8）+ `getRoleCapacity` 角色权重（generator/evaluator/judge=4, proposer=2）——per-run 容量新增函数不得改动上述冻结常量与既有 role-weight 语义。
- [累积FR] context-manifest: 本 line（journey e6f803f2）暂无已验收行为，累积 FR 为空（PRD 已声明）。

## Golden Path

[initiative_run 首个 attempt 到达 fleet worker] → [工作容器 `cecelia-fleet-run-<run8>` 常驻 + 同 run attempt 共享工作区 + Generator 候选 git bundle 落 quarantine] → [Evaluator 从 bundle 干净 clone 起 `cecelia-fleet-eval-<attempt8>`] → [run 终态销毁工作容器 / reconcile 按 run_id 找回] → [一条 run 稳定 ≤2 容器、候选不丢、≥2 run 并行]

---

### Step 1: initiative_run 首个 attempt 到达 → 创建/复用 run 级工作容器

**来源**: `[FROM_PRD]` — Golden Path 第 1 步 + 「预期受影响文件」attempt-runner.cjs/fleet-worker.cjs

**可观测行为**: fleet-worker 为一条 run 创建（或复用已有）工作容器，命名 `cecelia-fleet-run-<run8>`（run_id 前 8 位），打 label `cecelia.run_id=<run_id>`；container_id 持久化到 initiative_runs（新列 `work_container_id`，见假设决策）。同 run 后续 attempt（Planner/Proposer/Reviewer/Generator）在同一工作容器内 docker exec 启新 provider 进程，每 attempt 仍是 fresh session（独立 TaskBundle/callback token/scoped route token/lease），共享同一工作区（clone at base_sha）。首个 attempt 竞态并发 → 幂等按 run_id 复用，只创建一个容器。

**验证命令**（单测，docker CLI 为注入桩=外层边界，真实 attempt-runner 生命周期逻辑）:
```bash
cd packages/brain && npx vitest run scripts/fleet-worker/attempt-runner.test.cjs -t 'B-01'
# 期望：同 run 两 attempt → 同一 container_id（cecelia-fleet-run-<run8>）；不同 run → 不同容器
```

**硬阈值**: 同 run 连续两 attempt 的 docker create `--name` 仅出现一次且相同；第二次走 docker exec 而非 create；不同 run 名字不同。
**验证命令**: 见上（vitest -t 'B-01' 退出码驱动）。

---

### Step 2: run 终态销毁 + kernel 崩溃后 reconcile 按 run_id 找回

**来源**: `[FROM_PRD]` — Golden Path 第 5 步（run 终态销毁 / reconcile 找回）+ 边界情况「kernel 崩溃/lease 过期后重入」

**可观测行为**: run 进入终态（done/failed/cancelled，含 orphan-guard 判死）→ 销毁工作容器（docker rm -f `cecelia-fleet-run-<run8>`）；lease 过期/kernel 崩溃后重入，reconcile 按 `run_id` + label `cecelia.run_id` 找回既有容器继续，禁止新建（否则候选蒸发）。

**验证命令**:
```bash
cd packages/brain && npx vitest run scripts/fleet-worker/attempt-runner.test.cjs -t 'B-02'
# 期望：终态触发 docker rm；reconcile 用 run_id 命中既有容器（docker ps -f label=cecelia.run_id）不新建
```

**硬阈值**: 终态时对 run 容器执行且仅执行一次 `rm -f`；reconcile 分支命中既有容器时 create 调用数=0。
**验证命令**: 见上（vitest -t 'B-02'）。

---

### Step 3: Generator 候选落 quarantine + Evaluator 从 bundle 干净 clone（防污染）

**来源**: `[FROM_PRD]` — Golden Path 第 3-4 步 + Invariant [eval-clean]

**可观测行为**: Generator 完成后，候选 SHA 经 `git bundle` 落 host quarantine 卷（Brain 可读、只写一次、按 run 清理；二次写入幂等跳过/拒绝）。Evaluator attempt（含 evidence repair）起全新评估容器 `cecelia-fleet-eval-<attempt8>`，从 quarantine bundle 干净 clone 到候选 SHA（**不 fetch 远端**），依赖按锁文件重装，**不继承工作容器的 node_modules/缓存/hooks/tmp**。评估容器读不到 bundle → fail-closed 报错，禁止回退 fetch 远端伪造候选。

**验证命令**:
```bash
cd packages/brain && npx vitest run scripts/fleet-worker/workspace-manager.test.cjs -t 'B-03'
# 期望：bundleCandidate 落 quarantine（幂等）；cloneFromBundle 后 HEAD==候选SHA；且 clone 树内不存在工作容器写入的标记文件（防污染断言）；bundle 缺失 fail-closed
```

**硬阈值**: clone 后 `git rev-parse HEAD` == 候选 SHA；评估工作区不含工作容器写入的任意标记文件（防污染探针）；bundle 缺失时抛错不回退远端。
**验证命令**: 见上（vitest -t 'B-03'）。

---

### Step 4: 信任边界不变（非 root / 零 cap / push 拒绝 / token 独立）

**来源**: `[FROM_PRD]` — NFR 信任边界 + Invariant [non-root-zero-cap]

**可观测行为**: 容器非 root UID（evaluator 除外的既有语义不变）、零 capabilities、Generator push 拒绝（`remote.origin.pushurl=blocked-by-harness://`）、每 attempt 独立 scoped route token + callback token（容器级凭据 broker 保持）、attempt 间不复用 provider session、进程退出即回收临时 env。改造后现有 runner trust smoke 全绿。

**验证命令**:
```bash
cd packages/brain && npx vitest run scripts/fleet-worker/attempt-runner.test.cjs -t 'B-04'
# 期望：既有信任 smoke（root 语义/push 拒绝/token 独立不复用 session）在 run 级双容器下全绿
```

**硬阈值**: 现有信任相关 it() 全部 passed，0 failed；push gate 断言仍命中 `blocked-by-harness://`。
**验证命令**: 见上（vitest -t 'B-04'）。

---

### Step 5: 容量按并发 run 容器计（per-run），5GB VM 得 ≥2

**来源**: `[FROM_PRD]` — Golden Path 第 6 步（≥2 run 并行）+ NFR 容量约束

**可观测行为**: Brain 侧 machine capacity 改按并发 run 容器数计（每 run 容器上限 mem 2GB/cpu 2），autonomous_singleton 语义改 per-run，xian 路由 per-run 选机。5GB VM 下 per-run 容量计算 ≥2。

**验证命令**:
```bash
cd packages/brain && npx vitest run src/orchestrator/fleet-node/node-profile.test.js -t 'B-05'
# 期望：per-run 容量函数对 5GB(≈5120MiB)/2GB-per-container 得出 ≥2；既有冻结常量与 role-weight 不变
```

**硬阈值**: per-run 容量函数(5120MiB VM, 2048MiB/容器) 返回 ≥2；node-profile 三机冻结 capacity(7/8/8) 与 getRoleCapacity role-weight 语义不回退。
**验证命令**: 见上（vitest -t 'B-05'）。

---

### Step 6: FLEET_RUN_SCOPED_CONTAINER=off 回退单 attempt 容器

**来源**: `[AI_ADDED]` — 理由：PRD「范围限定」列出 feature flag 默认 on/off 回退，但 Golden Path 未单列可观测步骤；补一条防「默认开启后旧路径静默腐烂」的回退回归。

**可观测行为**: 环境变量 `FLEET_RUN_SCOPED_CONTAINER=off` 时，attempt-runner 回退到改造前单 attempt 容器命名 `cecelia-fleet-<attemptId>`，行为与改造前一致（每 attempt 一容器跑完销毁）。

**验证命令**:
```bash
cd packages/brain && npx vitest run scripts/fleet-worker/attempt-runner.test.cjs -t 'B-06'
# 期望：flag=off → 容器名回退 cecelia-fleet-<attemptId>，不复用、不 bundle
```

**硬阈值**: flag=off 时容器名匹配旧 `cecelia-fleet-<attemptId>` 形态；不触发 run 级复用/exec 分支。
**验证命令**: 见上（vitest -t 'B-06'）。

---

## 禁 mock 边清单

本单改动涉及【生命周期钩子】（run 级容器 create/exec/rm/reconcile）、【跨模块数据传递】（attempt-runner ↔ workspace-manager 的候选 bundle 接力、container_id 从 runner 落 initiative_runs）、【DB 写路径】（initiative_runs.work_container_id / harness_attempts.container_id）。以下边禁 mock：

- **attempt-runner ↔ workspace-manager**（本单改了两者间「候选 bundle 落 quarantine → 评估容器从 bundle clone」的接力数据）：生命周期单测必须真调真实 `workspace-manager.cjs` 模块（`bundleCandidate`/`cloneFromBundle`/`quarantine`/`reconcile`），不得用假 workspaceManager 顶替被改的这条边。
- **attempt-runner ↔ 容器生命周期状态（stateStore/reconcile 判定）**：run 复用/终态销毁/reconcile 找回的分支必须走真实 attempt-runner 生命周期逻辑，只允许把 `docker` CLI 适配器作为注入桩（外层边界——docker daemon 不参与单测）。
- **代码 ↔ DB 表 initiative_runs（work_container_id 写/读）**：container_id 持久化与「reconcile 按 run_id 找回」的落库读写属真 Postgres 边——需真 PG 的断言按 `*.pg.integration.test.js` 命名放 `src/__tests__/integration/`，由 CI `brain-integration` job 起真 Postgres 跑；纯生命周期分支（docker 桩）留 `scripts/fleet-worker/*.test.cjs` 走 brain-unit。**不得**在纯单测里用 mock DB 顶替 work_container_id 落库校验后就宣称覆盖了持久化——落库校验归 integration。

> 说明：本 attempt 的 proposer 环境 postgres:false，故 DB 落库校验由合同指派到 `brain-integration`（真 PG）执行，evaluator 的 local_api 阶段跑单测（docker 桩，真实模块）+ DevGate；生产 docker-ps/psql 共享 container_id 的接缝由最终生产真 run 验证（见接缝清单）。

## 接缝清单（接缝 vs 逻辑）

| # | 接缝点 | 碰真实世界在哪 | 真目标验证方式 | 当前状态 |
|---|---|---|---|---|
| 1 | run 级容器实际创建/复用/销毁 | 真实 Docker daemon（OrbStack VM） | 生产真 run：`docker ps` Planner→Generator 只见 1 个 `cecelia-fleet-run-<run8>`，Evaluator 阶段仅多出 1 个 `cecelia-fleet-eval-*` | logic-done-pending（单测以 docker 桩验分支逻辑；真容器数由生产 run 验） |
| 2 | container_id 同 run 共享 + 持久化 | 真 Postgres（harness_attempts / initiative_runs） | 生产真 run：`psql` 查 harness_attempts 同 run 的 attempt 共享 container_id；`brain-integration` 起真 PG 验 work_container_id 落库/找回 | logic-done-pending（单测 docker 桩不落库；持久化归 integration + 生产 run） |
| 3 | ≥2 run 并行占用 | 真 VM 内存/OrbStack 调度 | 生产真 run：同一时刻 ≥2 条 run 各自容器并行，候选在 Evaluator 卡住时仍在工作容器内可取 | logic-done-pending（容量算法单测验 ≥2；真并行由生产 run 验） |

逻辑断言（容器命名/复用/终态/reconcile 分支、候选 bundle/clone、容量计算、信任 smoke）在 CI 单测验绿=真 done；接缝断言（真 Docker 容器计数、真 PG 共享 container_id、真 VM 并行）必须在生产真 run 验，未真验标 logic-done-pending，不得标 done。

## 未覆盖真实链路清单

| 真实链路点 | 为什么被降级 | 真验证补位计划（谁/何时/什么环境） |
|---|---|---|
| 真实 Docker 容器 create/exec/rm/reconcile | 单测环境无 Docker daemon（docker CLI 注入桩），evaluator local_api 沙箱亦不保证 DinD | controller 调度的最终生产真 run（fleet us-mac-m4）跑 F1 任务，`docker ps` 断言容器数（接缝清单 #1/#3） |
| work_container_id / 共享 container_id 落库 | 本 proposer/evaluator attempt postgres 未提供业务库；纯单测用 docker 桩不落库 | CI `brain-integration` job（真 PG）跑 `*.pg.integration.test.js`；生产真 run `psql` 复核（接缝清单 #2） |

> 说明：本合同 [BEHAVIOR] 均为真实模块 + docker CLI 注入桩（外层边界），非 force_*/假数据；无 LLM/支付/短信等第三方真调（本 sprint 不涉第三方 API，规则 B N/A）。上表两项为「真机/真库接缝降级到 integration + 生产 run」的显式登记，非静默假绿。

## 真实调用方请求 shape

N/A — 本 sprint 无「设备/agent 调服务端」新链路（无 Android/Windows agent、无外部 webhook 新增）。attempt-runner 由 fleet-worker 进程内直接调用，非跨网络真实调用方。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | run 级双容器：一条 initiative_run 一个常驻工作容器（Planner/Proposer/Reviewer/Generator 共享工作区、候选不丢）+ 每次评估一个从候选 SHA 干净 clone 的评估容器；container_id 持久化 + reconcile 按 run_id 找回；容量改 per-run；feature flag 可回退。 |
| **NFR（做得多好）** | 性能/可靠/并发 | 每 run 工作容器 mem 2GB/cpu 2；5GB VM 得 ≥2 并发 run 容器；一条 run 稳定 ≤2 容器；reconcile 幂等不新建。 |
| **Invariant（永不违反）** | 不变量 | [eval-clean] 评估容器不继承工作容器任何文件；[non-root-zero-cap] 非 root/零 cap/push 拒绝/每 attempt 独立 token 不复用 session；[no-self-merge]/[ci-guard]/[generator-retry]/[brain-url]/[validation-clock]/[session-path]（见 DoD INV 条目逐条映射）。 |
| **判定点（怎么知道）** | 对模糊现实的判断 | 见下方判定点登记表（run 是否终态、reconcile 是否命中既有容器、评估容器是否被污染）。 |
| **保质期（何时过期）** | 何时失效 | 工作容器随 run 终态销毁；quarantine bundle 按 run 清理；scoped route/callback token 按 attempt lease 有效期过期。 |
| **死亡告警（停了谁知道）** | 谁多久知道 | fleet-worker 心跳 + orphan-guard 判死；容器泄漏由 reconcile 扫 `label=cecelia.fleet.worker_id` 回收（既有 removedOrphanContainers 路径）；容量耗尽经 machine capacity 上报 Brain。 |
| **失败语义（挂了怎么办）** | 放行/拦截/重试 | 见下方失败语义声明。核心：评估容器读不到 bundle → fail-closed（禁回退 fetch 远端）；容器创建竞态 → 幂等复用不重复创建。 |
| **效果确认（已发≠已生效）** | 回执方式 | 容器创建回执 = `docker inspect`/label 可查 + container_id 落 initiative_runs；候选落盘回执 = quarantine bundle 文件存在且 `git bundle verify` 通过；clone 回执 = HEAD==候选 SHA。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 聊天记录 API 不稳定 | 静默丢消息 |
| ⚠️ run 是否进入终态（可销毁工作容器） | A. Brain 侧 run.status ∈ {done,failed,cancelled}; B. lease 过期即判死; C. orphan-guard 无活 attempt 判死 | A 为主 + C 兜底（orphan-guard） | 提前销毁会蒸发未取候选（本 sprint 的核心痛点） | ⚠️ 候选丢失、run 只能从合同重做（不可逆返工） |
| ⚠️ reconcile 是否应复用既有容器（vs 新建） | A. 按 run_id + label `cecelia.run_id` 查在世容器; B. 按 initiative_runs.work_container_id 反查 | A 为主 + B 交叉 | 新建=蒸发候选（PRD 明令禁止） | ⚠️ 误判为「无容器」→ 新建 → 候选蒸发 |
| 评估容器是否被工作容器污染 | A. 干净 clone 树内探针标记文件不存在; B. 校验 node_modules 由锁文件重装非继承 | A（防污染探针）+ B | [eval-clean] 铁律要求防篡改不因共享容器失效 | 依赖/hook/替换对象污染逃过评估（#4890 类防篡改失效） |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 首个 attempt 竞态并发创建同 run 容器 | 只创建一个，后到者复用 | 是（幂等键=run_id） | 幂等复用，无降级 |
| kernel 崩溃/lease 过期重入 | reconcile 按 run_id 找回既有容器 | 是（幂等键=run_id + label） | 禁止新建（否则候选蒸发） |
| 评估容器读不到 quarantine bundle | fail-closed 报错，评估失败 | 是（bundle 只写一次） | **禁止**回退 fetch 远端伪造候选 |
| Generator 候选 bundle 二次写入（重跑） | 幂等跳过或拒绝二次写 | 是（只写一次） | 沿用既有候选 |
| run 级容器功能异常 | `FLEET_RUN_SCOPED_CONTAINER=off` 回退单 attempt 容器 | 是 | 回退改造前行为 |

### 输入对抗面

N/A — 本 sprint 无对外暴露 agent（fleet-worker/attempt-runner 是 Brain 内部编排组件，输入来自服务端权威 TaskBundle + lease，非外部用户可写入接口）。

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `deriveRunContainerName` 传入非法/空 run_id（非 UUID）→ 应抛错，禁生成非法容器名污染 docker namespace。
- 重复提交: 同 run 第三个、第四个 attempt 连续到达 → 仍复用同一容器，create 调用恒为 1。
- 中途中断: reconcile 时既有容器已被外部 `docker rm`（label 查不到）→ 应 fail-closed 或按 run 状态决定重建 vs 报错，不得静默蒸发候选。
- 边界值: run8 前缀碰撞（两条不同 run_id 前 8 位相同）→ 容器名是否用足够长前缀避免碰撞；FLEET_RUN_SCOPED_CONTAINER 未设/空串/"0"/"false" 各值的回退判定。
发现分级: P0/P1（候选丢失/评估容器被污染/信任边界破损）→ 阻塞 merge；P2/P3（命名碰撞概率/日志噪声）→ 记 findings 不阻塞。

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

> autonomous / local_api：evaluator 在本地执行。本 sprint 的真实容器 create/rm 与 DB 共享 container_id 是接缝（见接缝清单），由生产真 run + brain-integration 验；local_api 阶段可确定性执行的 oracle = run 级双容器**生命周期逻辑单测全绿**（真实 attempt-runner/workspace-manager/node-profile 模块，docker CLI 注入桩=外层边界）+ DevGate（facts / 版本四处同步 / DoD→Test 映射）。node_deps 已预装，vitest 可用。

```bash
#!/bin/bash
set -euo pipefail

# 0. 定位仓库根（evaluator 从 /workspace 执行）
ROOT="${WORKSPACE_PATH:-/workspace}"
cd "$ROOT"

# 1. run 级双容器生命周期 + 防污染 + 容量 + 信任回归 单测全绿
#    真实模块，docker CLI 为注入桩（外层无关边界，非被改的接缝边）
cd "$ROOT/packages/brain"
OUT=$(npx vitest run \
  scripts/fleet-worker/attempt-runner.test.cjs \
  scripts/fleet-worker/workspace-manager.test.cjs \
  src/orchestrator/fleet-node/node-profile.test.js 2>&1)
echo "$OUT" | tail -30
echo "$OUT" | grep -qE "Tests +[1-9][0-9]* passed" || { echo "FAIL: 无 passed 计数"; exit 1; }
echo "$OUT" | grep -qE "Tests +[0-9]+ failed"       && { echo "FAIL: 存在 failed 单测"; exit 1; }

# 2. DevGate（改 Brain 强制门禁）—— facts + 版本四处同步
#    注：check-dod-mapping.cjs 期望 Test: 紧跟 checkbox 下一行，与本合同五行剧本格式
#    （Test 为第 6 行）不兼容；DevGate 的 DoD→Test 映射由 generator 在代码侧 .dod.md
#    机制满足，不在此 E2E 对五行 contract-dod.md 强跑（否则必假失败）。
cd "$ROOT"
node scripts/facts-check.mjs || { echo "FAIL: facts-check"; exit 1; }
bash scripts/check-version-sync.sh || { echo "FAIL: version-sync（package.json/package-lock/.brain-versions/DEFINITION.md 四处未同步）"; exit 1; }

echo "✅ Golden Path（run 级双容器生命周期逻辑 + DevGate）验证通过"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| run 级工作容器复用/隔离 | `packages/brain/scripts/fleet-worker/attempt-runner.test.cjs` | `B-01`, `B-02`, `B-04`, `B-06` | attempt-runner 无 `deriveRunContainerName`、容器名仍 `cecelia-fleet-<attemptId>` → 相关 it() FAIL |
| 候选 quarantine bundle + 干净 clone | `packages/brain/scripts/fleet-worker/workspace-manager.test.cjs` | `B-03` | workspace-manager 无 `bundleCandidate`/`cloneFromBundle` → FAIL |
| per-run 容量 | `packages/brain/src/orchestrator/fleet-node/node-profile.test.js` | `B-05` | 无 per-run 容量函数 → FAIL |
| container_id 持久化/共享（真 PG） | `packages/brain/src/__tests__/integration/*run-container*.pg.integration.test.js` | 接缝清单 #2 | work_container_id 列/落库不存在 → integration FAIL |

> 命名死规则：上表「BEHAVIOR 覆盖」的 `B-0N` 是对应 it() 名的字面子串（generator 写 `it('B-01: ...')`），evaluator `vitest -t 'B-0N'` 精确命中。
