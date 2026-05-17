# Brain v2 接力 Handoff — C8 / D1.7+ / E（2026-04-25 起草）

> **谁读**：新会话（Claude / Alex）接手 Brain v2 三层架构剩余三大块（C8 / D1.7+ / E）。
>
> **当前状态**：C1-C7 + D1.1-1.6 全部入 main + Brain 容器跑通（v1.222.0）。今晚一晚推 9 个 PR 把 tick.js 砍 34%，但**核心痛点没解**：harness-initiative / content-pipeline 还在走 legacy 单步派发，**没接 L2 runWorkflow**，Brain 重启就清零这两条 1-2h 长任务。**C8 是稳定性的真正关键节点**。

---

## 0. 冷启动三步（新会话必读）

### Step 1 — 读 5 份 source-of-truth（按顺序）

```bash
# 1. 原 spec — Brain 三层架构 v2 完整设计 + 11 决策表
cat docs/design/brain-orchestrator-v2.md

# 2. 整体 roadmap — Phase A-E 总览
cat docs/design/brain-v2-roadmap-next.md

# 3. C6 接力 handoff — 上一棒（已合）
cat docs/design/brain-v2-c6-handoff.md

# 4. 本 handoff — 当前 PRD（你正在读）
cat docs/design/brain-v2-c8-d-e-handoff.md

# 5. C6 smoke 发现的 spawn replay 问题（C8 必须解决）
grep -A5 "LangGraph resume" ~/.claude-account3/projects/-Users-administrator-perfect21-cecelia/memory/changelog.md
```

### Step 2 — 查当前状态（main / 容器 / DB）

```bash
# main HEAD（应在 #2612 hotfix 之后或更新）
git log --oneline main -10

# tick.js / 6 个抽出模块的行数（确认 D1.1-1.6 全在）
wc -l packages/brain/src/tick.js \
       packages/brain/src/dispatcher.js \
       packages/brain/src/dispatch-helpers.js \
       packages/brain/src/tick-helpers.js \
       packages/brain/src/drain.js \
       packages/brain/src/tick-watchdog.js \
       packages/brain/src/report-48h.js

# Brain 容器版本 + L2 模块入 image
docker exec cecelia-node-brain ls /app/src/workflows/
docker exec cecelia-node-brain wc -l /app/src/tick.js
docker logs cecelia-node-brain --since 5m | grep -iE "Workflows initialized|tick-loop Started"

# tick 状态
curl -s localhost:5221/api/brain/tick/status | python3 -c "import json,sys;d=json.load(sys.stdin);print(f'enabled={d[\"enabled\"]}/loop_running={d[\"loop_running\"]}')"

# pg checkpoints 表（L2 持久化层）
psql -U cecelia -d cecelia -h localhost -c "\dt checkpoints"

# 当前 harness-initiative.graph.js 是不是真图（是真图就不用做 C8a；当前还是单 function，需要做）
grep -c "StateGraph\|Annotation.Root" packages/brain/src/workflows/harness-initiative.graph.js
# 期望：0（还没接真图，C8a 要做）
```

### Step 3 — 若 Brain 不健康，先 redeploy

```bash
cd /Users/administrator/perfect21/cecelia
node --check packages/brain/server.js  # SyntaxError 预检（feedback memory brain_deploy_syntax_smoke）
node --check packages/brain/src/tick.js
node --check packages/brain/src/dispatcher.js
bash scripts/brain-deploy.sh

# 验证健康
docker exec cecelia-node-brain ls /app/src/dispatcher.js /app/src/tick-helpers.js  # 应都存在
curl localhost:5221/api/brain/tick/status | grep -o '"enabled":[^,]*'  # "enabled":true
```

---

## 1. 今天的真实进度（基线）

### 9 个 PR 全合（2026-04-24 至 2026-04-25）

| PR | Phase | 内容 | tick.js |
|---|---|---|---|
| #2592 | C6 | tick `WORKFLOW_RUNTIME=v2` flag + `dev-task` 接 runWorkflow | — |
| #2595 | C7 | 3 处 inline `PostgresSaver.fromConnString` → `getPgCheckpointer()` 单例 | — |
| #2596 | D1.1 | `report-48h.js` 抽出 | 3578 |
| #2600 | D1.2 | `drain.js` 抽出 | 3470 |
| #2602 | D1.3 | `tick-watchdog.js` 抽出 | 3409 |
| #2603 | D1.4 | `dispatch-helpers.js` 抽出（selectNext / autoCreate / processCortex）| 3119 |
| #2607 | D1.5 | `dispatcher.js` 抽出（dispatchNextTask + workflow runtime gate）| 2654 |
| #2611 | D1.6 | `tick-helpers.js` 抽出（routeTask / release / autoFail / getRamped）| 2435 |
| #2612 | hotfix | D1.6 漏 grep `routes/tasks.js`，import 路径修复 | — |

### 三层架构进度（看本质，不看 PR 数）

| 层 | 进度 | 说明 |
|---|---|---|
| **L1 Scheduler** | ~50% | tick.js 3694→2435（-34%），抽 6 个独立模块。但 `executeTick` 主循环 1600 行还混着 30+ scheduled job，**L1 没纯净**。离 ≤200 行目标差 ~2200 行 |
| **L2 Orchestrator** | ~70% | 骨架 + checkpointer 单例 + 5 `.graph.js` 全入库。**仅 dev-task 真接 runWorkflow** + 灰度 flag。`harness-initiative` / `content-pipeline` 表面上有 `.graph.js` 但**实际还是单 function**，executor.js 仍走 legacy 单步派发 |
| **L3 Executor** | ~95% | spawn / docker-executor 一直独立 |

### 稳定性收益现状

✅ dev 任务（< 30 分钟）有 checkpoint resume（C6 smoke 实测 thread_id=`{taskId}:1`，2 行 checkpoints）
✅ 6 个抽出模块解耦，单元测试隔离
❌ **harness 流水线（1-2h）Brain 重启清零**（Planner→GAN→Generator→Evaluator 全没 checkpoint）
❌ **content-pipeline 6 步出图同样清零**（research→copywrite→review→generate→image-review→export）
❌ tick.js executeTick 主循环 stale（30+ scheduled job 混在一起，决策路径不清晰）

### 6 个抽出模块行数（再 deploy 确认数据）

```
tick.js              2435  (-1259 from 3694)
dispatcher.js         536  (dispatchNextTask + _dispatchViaWorkflowRuntime)
dispatch-helpers.js   328  (selectNext + processCortex + autoCreate)
tick-helpers.js       257  (routeTask + release + autoFail + getRamped)
report-48h.js         158
drain.js              157
tick-watchdog.js      112
─────────────────────────
total              ~3983  (vs 原 3694：净增 ~289 行 due to header / import boilerplate)
```

---

## 2. 剩余 roadmap

### 关键节点优先级

```
[最高] C8a — harness-initiative 真图（解 1-2h harness 重启清零）
[最高] C8b — content-pipeline 真图（解 6 步出图重启清零）
[中]   D1.7 — executeTick 主循环抽出（需 tick-state.js shared state）
[中]   D2-D∞ — tick.js 余量瘦身到 ≤ 200 行
[低]   E — Observer 分离（监控/压力评估/自适应抽出 tick）
```

### 估时

| Phase | 工作量 | 说明 |
|---|---|---|
| C8a | 1 天 | harness-initiative.graph.js 重设计为多节点 graph（Planner / GAN sub-graph / DB upsert）+ executor.js 接线 + GAN 循环 sub-graph 设计 + manual smoke |
| C8b | 1 天 | content-pipeline.graph.js 同款重设计（6 节点：research/copywrite/copy-review/generate/image-review/export）|
| D1.7 | 3-5 天 | tick-state.js shared state + executeTick 抽到 tick-runner.js + 30+ scheduled job 拆 plugin |
| E | 3-5 天 | Observer 分离（alertness / metrics / health-monitor） |
| **总和** | **8-12 天** | 不含意外 |

---

## 3. C8a PRD — harness-initiative 真图重设计

### Goal

把 `packages/brain/src/workflows/harness-initiative.graph.js` 从单 function (`runInitiative`) 改成**真 LangGraph 多节点状态机**。每个节点之间有 pg checkpointer 持久化，Brain 重启后能从 GAN 第 N 轮的中点续跑（不重新跑 Planner）。

### Scope

- 改：`packages/brain/src/workflows/harness-initiative.graph.js`（528 行 → 估约 250-300 行 graph 定义 + 节点函数）
- 改：`packages/brain/src/executor.js` L2807-L2829 `harness_initiative` 分支
- 新建：`packages/brain/src/workflows/__tests__/harness-initiative-graph.test.js`（节点单测 + checkpoint resume 测试）

### 设计决策（按 spec §6.5 / handoff §6 决策表）

#### 节点拓扑

```
START → prep-initiative → run-planner → parse-task-plan
       ↓
   (条件 edge: planner 失败 → END with error)
       ↓
   gan-loop (sub-graph：proposer ↔ reviewer 多轮，含 retry)
       ↓
   (条件 edge: GAN 收敛 → continue / GAN 失败 → END with error)
       ↓
   db-upsert-subtasks → END
```

#### State 定义

```js
const InitiativeState = Annotation.Root({
  task: Annotation({ reducer: (_, n) => n }),
  initiativeId: Annotation({ reducer: (_, n) => n }),
  prdContent: Annotation({ reducer: (_, n) => n, default: () => null }),
  taskPlan: Annotation({ reducer: (_, n) => n, default: () => null }),
  ganRound: Annotation({ reducer: (_, n) => n, default: () => 0 }),
  ganVerdict: Annotation({ reducer: (_, n) => n, default: () => null }),
  contractDraft: Annotation({ reducer: (_, n) => n, default: () => null }),
  reviewFeedback: Annotation({ reducer: (_, n) => n, default: () => null }),
  result: Annotation({ reducer: (_, n) => n, default: () => null }),
  error: Annotation({ reducer: (_, n) => n, default: () => null }),
});
```

#### GAN sub-graph

GAN 循环本身是子图（spec §6.5 强烈推荐）。子图内：

```
START → run-proposer → run-reviewer
       ↓
   (条件 edge: APPROVED → END with verdict / REVISION → 计数 + 回 run-proposer / REJECTED → END with reject)
```

子图的 checkpoint 和外层共用 thread_id 命名空间（LangGraph 自动）。

#### spawn 调用问题（C6 smoke 发现）

C6 smoke 发现 LangGraph resume 时会 replay 上次未完成节点 → 重新调 spawn → 起重复容器。C8a 必须解决：

**方案**：每个节点函数体首句先查 state 是否已有该节点输出，有则跳过 spawn 直接返回 existing state（幂等）。

```js
async function runPlannerNode(state) {
  // 幂等门：state.taskPlan 已有 → resume 跳过 spawn
  if (state.taskPlan) return { taskPlan: state.taskPlan };

  const result = await spawn({ ... });
  // ... parse, return
}
```

#### Migration 切换

executor.js L2807 `harness_initiative` 分支：
- 默认（生产）走 legacy `runInitiative()` 函数（保留兼容）
- 新增 env flag `HARNESS_INITIATIVE_RUNTIME=v2` → 走 `runWorkflow('harness-initiative', task.id, attemptN, { task })`
- C6 已有 `WORKFLOW_RUNTIME=v2` flag for dev — C8a 用独立 flag 让 dev 和 harness 灰度独立切换

### Tasks（建议拆 1 PR）

1. 写 `harness-initiative.graph.js` 真图实现（StateGraph 定义 + 节点 + sub-graph）
2. 在 `workflows/index.js` `initializeWorkflows()` 注册 `harness-initiative` workflow（替代 C2 只注册 dev-task）
3. 改 executor.js 加 `HARNESS_INITIATIVE_RUNTIME=v2` env gate
4. 写测试：节点 5 个单测 + GAN 子图 3 cases + checkpoint resume manual smoke
5. Learning: docs/learnings/cp-XXX-c8a-harness-initiative.md

### DoD

- [BEHAVIOR] `harness-initiative.graph.js` 含 `StateGraph` + ≥ 5 个 `.addNode()`；Test: manual:`grep -c "addNode\|StateGraph" packages/brain/src/workflows/harness-initiative.graph.js`（应 ≥ 6）
- [BEHAVIOR] `workflows/index.js` 注册 `harness-initiative`；Test: manual:`grep -c "registerWorkflow.*harness-initiative" packages/brain/src/workflows/index.js`（== 1）
- [BEHAVIOR] executor.js 含 `HARNESS_INITIATIVE_RUNTIME` env 判断；Test: manual:grep
- [BEHAVIOR] 节点 5 个单测全 pass
- [BEHAVIOR] manual smoke：`HARNESS_INITIATIVE_RUNTIME=v2` 起任务 → 中途 kill Brain → restart → checkpoints 表 thread_id 匹配 + graph.invoke(null, config) resume 不重跑 Planner

### 风险

- 528 行 legacy `runInitiative` 含 Planner CLI 调用 / GAN 循环 / DB upsert / error path / 多种 edge case，节点拆分时不能漏。需把每个 try/catch 块映射到节点 + edge。
- LangGraph sub-graph API 用法（`addSubgraph` vs 嵌套 graph）—— spec §6.5 倾向 sub-graph，需读官方文档。
- spawn 幂等检查可能漏，造成生产容器重复创建（资源烧）。每节点都要写状态前置检查。

---

## 4. C8b PRD — content-pipeline 真图重设计

### Goal

`packages/brain/src/workflows/content-pipeline.graph.js`（625 行）目前也是单 function。改成 6 节点真图：

```
START → research → copywrite → copy-review → generate → image-review → export → END
```

每节点之间 pg checkpoint。任意一步崩溃 Brain 重启从该步前续跑。

### Scope

- 改：`packages/brain/src/workflows/content-pipeline.graph.js`
- 改：`packages/brain/src/routes/content-pipeline.js` POST `/run` 加 v2 gate
- 新建：节点单测 + smoke

### 设计要点

- 6 节点状态机，每节点对应现有 `.skill.md`（pipeline-research / pipeline-copywrite / pipeline-copy-review / pipeline-generate / pipeline-image-review / pipeline-export）
- State 包含每步产物（research / copywrite / images / final_post）
- 幂等门同 C8a（state.research 已有 → 跳过 research 节点 spawn）
- C8b 在 C8a 经验之上做，可以复用 C8a 的节点 helper / 测试模式

### 估时
1 天（设计 + 实现 + 测试）。

### DoD
（同 C8a 模式，6 节点全 pass + checkpoint resume smoke）

---

## 5. D1.7+ PRD — executeTick 主循环抽出

### Goal

把 tick.js 剩余 2435 行的核心 `executeTick`（~1600 行）从 tick.js 抽出。最终 tick.js ≤ 200 行（spec §6 / Phase D 目标）。

### 前置：tick-state.js

D1.7 第一步必须建 `packages/brain/src/tick-state.js` 把 module-level 状态收口：

```js
// tick-state.js
export const tickState = {
  loopTimer: null,
  recoveryTimer: null,
  tickRunning: false,
  tickLockTime: null,
  lastExecuteTime: 0,
  lastCleanupTime: 0,
  lastHealthCheckTime: 0,
  lastKrProgressSyncTime: 0,
  lastHeartbeatTime: 0,
  lastGoalEvalTime: 0,
  lastZombieSweepTime: 0,
  lastZombieCleanupTime: 0,
  lastPipelinePatrolTime: 0,
  lastPipelineWatchdogTime: 0,
  lastKrHealthDailyTime: 0,
  lastCredentialCheckTime: 0,
  lastCleanupWorkerTime: 0,
  lastOrphanPrWorkerTime: 0,
  lastConsciousnessReload: 0,
  // ... 其他 _lastXxxTime
};

export function resetTickStateForTests() { /* 重置全部 */ }
```

`tick.js` 和 `tick-runner.js`（D1.7 新建）都 import + 读写 `tickState.xxx`。

### 拆分思路

`executeTick` 当前一个 1600 行函数。**不要一次性抽走**，分 sub-PR：

#### D1.7a — tick-state.js + tick.js 改用 tickState 对象（不抽 executeTick）
- 新建 tick-state.js
- 改 tick.js 把 `let _lastXxxTime = 0` 替换为 `tickState.lastXxxTime`
- 单 PR 纯重构无行为变化
- ~150 行重命名 / 不抽函数

#### D1.7b — executeTick 整体抽到 tick-runner.js
- 直接 cp 函数体到新模块
- import tickState + 所有依赖
- tick.js re-export
- 估 ~1600 行 cp + 80 行 imports / boilerplate

#### D1.7c — scheduled job 拆分（30+ Promise.resolve().then() 异步任务）
- 每个 scheduled job 抽到对应模块（已有大部分如 dept-heartbeat / kr-progress-sync 等）
- tick-runner.js 只负责调用，不嵌入业务逻辑

### 估时
3-5 天（最大风险来自测试覆盖：tick.test.js / tick-throttle / tick-rampup 等 19 个 test 文件大量 vi.mock('../tick.js')，重新 wire 需小心）。

### 风险

- vi.mock 测试模式：现有 tests 把 `tick.js` 整个 mock，replace 后 mock 路径要更新
- 30+ scheduled job 各自有 `_lastXxxTime` 计时器，shared state 不能丢
- 错过 grep 一处 caller 就生产挂（参 D1.6 hotfix 教训）

---

## 6. E PRD — Observer 分离

### Goal

把"看天的决策层"从 tick 抽出独立运行：

- `alertness/` 子模块（已存在但被 tick 紧耦合）
- `health-monitor.js`
- 资源压力评估（`checkServerResources`）
- 自适应决策（决定是否 drain / pause / requeue）

让 Observer 独立 timer，不依赖 tick loop 周期。tick 只是观察 Observer 的输出。

### 估时
3-5 天。需 spec §7 Observer 设计。

---

## 7. 全局禁忌（今天踩坑总结）

### 操作禁忌

- ❌ 不 `git push origin main`
- ❌ 不 `gh pr merge --admin`（CI 必走）
- ❌ 不在 main 分支写代码（branch-protect.sh 拦截）
- ❌ 不跳 `node --check` 预检（feedback `brain_deploy_syntax_smoke`）
- ❌ 不让 subagent 直接改代码（C6 一次 subagent 自开新分支 + 删 worktree gitdir，70% 可靠率）

### Refactor 禁忌（D1.6 hotfix 教训）

- ❌ **删 tick.js export 前必须 grep 整个 `packages/brain/src/`（不只是 `__tests__/`）找所有 caller**
  - D1.6 漏了 `routes/tasks.js`，导致 P0 Brain 启动 SyntaxError 重启循环
  - Self-review checklist：`grep -rn "<symbol>" packages/brain/src/ --include="*.js" | grep -v node_modules`
- ❌ 不动 `_loopTimer` / `_recoveryTimer` / `_tickRunning` 这三个核心 loop state（必须 D1.7+ tick-state.js 时一次性迁，零散动会撕裂控制流）

### 应急恢复路径（Brain 启动崩，CI 还在跑）

```bash
# 从 hotfix worktree 直接重建 image 绕过 deploy 健康守护
cd /Users/administrator/worktrees/cecelia/<hotfix-branch>
bash scripts/brain-build.sh
docker compose up -d node-brain
```

### Subagent 派任务规范

若必须派 subagent（read-only 调研用），prompt 强写：
- 不得新开分支 / 不得 git checkout 其他 branch
- 不得改代码（read-only）
- 工作目录写死，不能 cd 离开
- 派完立刻 `git branch -a` 验未开新 branch + `git worktree list` 验未删 worktree

---

## 8. 一眼 checklist（新会话按顺序打勾）

### 接力第一步（5 分钟）

- [ ] 读 §0 5 份 SOT
- [ ] 跑 §0 Step 2 状态查询，确认 main HEAD ≥ #2612 / Brain 容器健康 / tick.js 行数 ~2435
- [ ] 读本 handoff §1 看清"今天做了什么"

### 决定先做哪块

**强烈推荐 C8a 优先**（§3）—— 解 harness 重启清零，是 Cecelia 内容生产线稳定性的最大单点。

- [ ] 注册 Brain task `POST /api/brain/tasks`（task_type=dev，PRD 从本 §3 直贴）
- [ ] `/dev --task-id <id>` 开工

### 验收闸（C8a 完工标志）

- [ ] PR 合并 + Brain redeploy + image 内 `harness-initiative.graph.js` 含 `StateGraph + addNode ≥ 5`
- [ ] manual smoke：`HARNESS_INITIATIVE_RUNTIME=v2` 起 harness task → 中途 kill Brain → restart → 续跑（不重跑 Planner）
- [ ] 24h 观察生产 harness 任务跑通无回退

### 下一棒

- C8a 稳 → 推 C8b（同款模式套 content-pipeline）
- C8b 稳 → 才考虑 D1.7（tick-state.js + executeTick 抽出）
- 别跳过先做 D1.7：D1.7 不解 harness/content 重启清零的痛点，先做没用

---

## 9. 参考资料

- **原 spec**：`docs/design/brain-orchestrator-v2.md`（§6 三层架构 + §6.5 sub-graph + §12 11 决策表）
- **整体 roadmap**：`docs/design/brain-v2-roadmap-next.md`
- **C6 接力 handoff**：`docs/design/brain-v2-c6-handoff.md`（已合，可对照本 handoff 看接力模式）
- **Memory 进度**：`~/.claude-account3/projects/-Users-administrator-perfect21-cecelia/memory/brain-orchestrator-v2.md`
- **Memory changelog**：`~/.claude-account3/projects/-Users-administrator-perfect21-cecelia/memory/changelog.md`（2026-04-24/25 条目，含今晚 9 PR + D1.6 hotfix 教训）
- **CLAUDE.md 全局规则**：`~/.claude-account3/CLAUDE.md` + `.claude/CLAUDE.md`

---

**本 handoff 冻结时间**：2026-04-25 15:00 UTC+8。
**下一会话**：Alex 直接说"接上 Brain v2 C8a，读 docs/design/brain-v2-c8-d-e-handoff.md 然后按 §0 冷启动 + §8 checklist 走"。
