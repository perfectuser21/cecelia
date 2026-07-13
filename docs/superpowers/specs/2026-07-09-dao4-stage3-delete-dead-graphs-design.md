# 刀4阶段3：删除废弃 LangGraph 死图 — 设计

> Brain task: `495e8a31-9feb-443f-925d-1a67ff4e37ab`　决策: `e8eb540e-284e-48c5-a98b-d971921588a2`
> 前置：刀4阶段1（staging_e2e 端点，已上生产）+ 阶段2（harness-controller Step 6 接回派生，已合并，PR #111）均已完成。用户拍板不等真实 sprint 端到端验证阶段2，直接执行阶段3。

## 背景

2026-07-04/05 起，harness pipeline 的编排从 LangGraph 图（`harness-task.graph.js` / `harness-initiative.graph.js`）切到单 session skill 接力（skill-relay，`harness-controller` skill）。`executor.js` 里对 `payload.orchestrator !== 'skill-relay'` 做了硬校验，不满足直接 terminal failed，不再降级走图——这意味着两个图文件的 `compile*Graph` 调用路径在生产运行时**物理不可达**，但代码本身、相关死分支、相关测试都还留在仓库里，构成认知负担和维护成本。本阶段目标：把这些确认死透的代码物理删除。

## 范围核实（与旧 handoff 文档的差异）

原 `docs/handoffs/202607081359-dao4-refactor.md` 阶段3 章节给的删除清单基本方向正确，但两处需要更新：

1. **多了一段 `executor.js` 死代码**：`_driveHarnessInitiative` 函数第 2906-3079 行，早于 skill-relay return 之后但仍在函数体内、显式标了 `/* eslint-disable no-unreachable */` 的旧图调用逻辑，一并删除。
2. **多了一个僵尸 smoke 脚本**：`packages/brain/scripts/smoke/reportnode-task-writeback-smoke.sh` 专测死图里 `reportNode` 函数的 SQL 写回逻辑，CI 通过 `packages/brain/scripts/smoke/*.sh` 通配收集，图删了这个脚本会红，且它测的本来就是死代码，一并删除。
3. **测试文件影响面比预期大 10 倍以上**：实际真实 import/mock/readFileSync 引用两个死图文件的测试有 85 个（原文档只提"删两图对应测试"，隐含个位数）。已逐个分类，见下节。

原文档提到"保留被活模块复用的 node 函数（mergePrNode/pollCiNode/reportNode/evaluateContractNode 等）"这条顾虑已核实过期——这几个函数名在其余活代码文件里出现，全部是注释里的历史背景说明，没有一处真实 import，可以放心整体删除。

## 删除/修改清单

### 直接删除的文件
- `packages/brain/src/workflows/harness-task.graph.js`
- `packages/brain/src/workflows/harness-initiative.graph.js`
- `packages/brain/scripts/smoke/reportnode-task-writeback-smoke.sh`
- 73 个 A 类测试文件（详见实现计划附录，测试对象是两图节点/图结构本身，删图后测试对象不存在，无回归覆盖损失）

### 修改（保留文件，删除引用死图的部分）
- `packages/brain/src/executor.js`：删 `_driveHarnessInitiative` 内 2906-3079 行不可达代码块
- `packages/brain/src/workflows/index.js`：删 `import { compileHarnessInitiativeGraph }`（L12）+ 对应 `registerWorkflow('harness-initiative', ...)` 注册块（L31-33）
- `packages/brain/src/lib/harness-thread-lookup.js`：删 harness-task(85-93)/harness-evaluate(100-108)/harness-gan(111-114)/harness-initiative(118-127) 四个分支，**保留** `lookupHarnessThread` 本体(54-131) + walking-skeleton 分支(74-83)
- `packages/brain/src/routes/harness-callback.js`：删 relay 前缀短路之后的旧图容器 resume 分支(95-107)
- `packages/brain/src/routes/harness-pending-reviews.js`：删 approve(83-98)/reject(118-136) 两处图 resume 分支
- `packages/brain/src/routes/harness-interrupts.js`：删 POST resume 图分支(100-122)
- `packages/brain/scripts/smoke/b43-harness-pipeline-e2e-smoke.sh`：删/改 `compileHarnessFullGraph` export 断言(56-61)
- 12 个 B 类测试文件：只删其中测"死分支"的 describe/mock，保留测活代码的部分（逐文件清单见实现计划附录）

### 明确不动
`harness-gan.graph.js`（proposer/reviewer 用）、`walking-skeleton-1node.graph.js`（活）、`harness-final-e2e.js`（`runFinalE2E` 被 `staging-e2e-runner.js` 用）、`harness-utils`/`shared`/`heartbeat`（图依赖它们，非反向）。

## 验证 / DoD

- [BEHAVIOR] `node --check` 全部改动文件语法通过
- [BEHAVIOR] `docker restart cecelia-node-brain`（或本地起服务）后 `/health` 返回 200，boot 不因缺失 import 崩溃
- [BEHAVIOR] `grep -rn "harness-task.graph.js\|harness-initiative.graph.js" packages/brain/src --include="*.js"` 除测试目录外应为空
- CI 全绿（含 smoke glob，`b43-harness-pipeline-e2e-smoke.sh` 更新后的断言、`reportnode-task-writeback-smoke.sh` 已删不再被收集）
- DevGate 三件套通过：`node scripts/facts-check.mjs` / `bash scripts/check-version-sync.sh` / `node packages/engine/scripts/devgate/check-dod-mapping.cjs`

## 风险

纯删除已确认死代码，不改变任何运行时行为（生产路径本来就走不到这些分支）。主要风险在测试删除的准确性——B 类文件如果分类判断错误，可能误删有效覆盖；缓解措施：CI 全绿作为客观兜底，且这批测试本身测的是已废弃 5 天以上、从未在生产触发的路径，误伤影响面可控。
