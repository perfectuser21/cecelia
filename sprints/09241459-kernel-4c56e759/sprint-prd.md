# Sprint PRD — kernel 越过准入后 FROZEN_CONTRACT_ARTIFACTS_MISSING 装配闸死锁修复

## OKR 对齐

- **对应 KR**：KR-Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（消除一类越过准入后仍会静默耗跳终结的 kernel 死法）

## 背景

2026-09-24 13:06 run `60c1f156`（任务 3f7a3e71，接替 c74ca12f）在 MMV 越过节点准入，
commander/planner 共 6 次 attempt LAUNCHED（hop 1/6/11/13/19/24），13:17 exit
`assembly_fault:FROZEN_CONTRACT_ARTIFACTS_MISSING`（hops=19）。这是准入之后的下一道闸：
approved contract 已存在，但冻结合同产物（sprint-prd.md / contract-draft.md /
contract-dod.md / tests/*）从未落地，run 却一路 churn 到装配才被 dispatcher 硬 throw
终结。现状代码路径：`dispatcher.js:573` 在 generator 派发时零产物即 throw
`FROZEN_CONTRACT_ARTIFACTS_MISSING:approved_contract` → callback error_code 被
`derive.js:577-595 attemptCallbackRoute` 映射为 `MARK_FAILED / frozen_contract_artifacts_missing`
→ `failRun(assembly_fault:...)` 终结，无恢复、无早期诊断。

## Golden Path（核心场景）

系统从 [kernel run 越过准入] → 经过 [冻结合同产物装配闸检测缺失] → 到达 [确定性可诊断处理，而非静默耗跳终结]

具体：
1. [触发条件] kernel run 越过节点准入，持有 approved contract，但 sprint_dir 下的冻结产物
   （sprint-prd.md / contract-draft.md / contract-dod.md / tests/*）缺失或未物化。
2. [系统处理] 在进入装配（generator 派发）之前，装配闸即检测到冻结产物缺失，
   以确定性、可诊断的方式处理该条件——不再让 run 静默 churn 多次 attempt / 多跳后
   才在 dispatcher 硬 throw 终结。
3. [可观测结果] 该失败条件被一个能复现 run `60c1f156` 轨迹的 failing test 捕获：
   测试今日为红（复现"越过准入 → 冻结产物缺失 → assembly_fault"路径），修复后为绿；
   run 不再在冻结产物缺失时静默耗到第 19 跳才终结。

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- 冻结产物"部分缺失"（如仅缺 tests/，或仅缺 core 文档之一）与"全缺"应被同一闸一致处理。
- 越过准入但 approved contract 本身缺 SHA / 分支时，走既有 `approved_but_no_contract_*` 路，不在本 sprint 范围。
- 已有的 PERSIST_CONTRACT_APPROVAL 中 `artifacts.missing>0 → seal_rejected → reopen GAN` 可恢复路（loop.js:1115）不得被本次改动破坏。
- 幂等：同一 run 重跑 / 二次点火命中同一缺失条件时，行为必须与首次一致（不得随 hop 数漂移）。

## 范围限定

**在范围内**：
- kernel 装配闸对"冻结合同产物缺失"的检测时机与终结行为（`loop.js` / `dispatcher.js` / `derive.js` / `contract-artifacts.js` 中该条件的路由）。
- 一个复现 run `60c1f156` 轨迹的 failing test，永久保留进 CI 作回归。

**不在范围内**：
- 节点准入（MMV）逻辑本身。
- 冻结产物的生成内容质量 / seal 校验规则改写。
- 非 frozen-artifacts 类 assembly_fault（如 DIRECT_PROFILE_CONTRACT_INVALID、bundle size limit）。

## 假设

- [ASSUMPTION: task.payload 未提供 thin_prd；以 task 标题+描述（含 run 60c1f156 轨迹与文件指针）为产品意图锚定 scope。]
- [ASSUMPTION: "确定性可诊断处理"的具体形态（早期 fail-fast 精确诊断 vs 路由到可恢复 seal_rejected/reopen）为实现决策，由 proposer 在 GAN 阶段定；planner 只锁定"不得静默耗 19 跳终结"+"必须被复现测试捕获"两条可观测约束。]
- [ASSUMPTION: 复现测试落在 packages/brain/src/orchestrator/__tests__/ground-truth.test.js，覆盖 capability F1（对齐 frozen impact-contract 断言）。]

## 预期受影响文件

- `packages/brain/src/orchestrator/dispatcher.js`: 573 行 generator 派发零产物硬 throw 的检测时机/路由。
- `packages/brain/src/orchestrator/derive.js`: 577-595 行 attemptCallbackRoute 把 error_code 映射为 MARK_FAILED 的分流。
- `packages/brain/src/orchestrator/loop.js`: 装配闸 / PERSIST_CONTRACT_APPROVAL 缺失处理与 failRun 终结路径。
- `packages/brain/src/orchestrator/contract-artifacts.js`: 冻结产物收集/校验（FROZEN_CONTRACT_ARTIFACTS_MISSING throw 源）。
- `packages/brain/src/orchestrator/__tests__/ground-truth.test.js`: 复现 run 60c1f156 的 failing test（CI 回归）。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（返回空）+ PrepPRD 未显式指定 -->
- 超时/延迟: 待定（PrepPRD 未指定；decisions category=nfr 为空）
- 频控: 待定
- 版本要求: 无
- 可观测: 装配闸终结/处理路径必须留下可定位到 run_id + 缺失产物清单的诊断（复现测试即断言此点）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并 -->
- step 级：（本 line 暂无历史 — payload 无 journey_id/ability_id，golden-path-decisions 为空）
- journey_feature 级：（本 line 暂无历史 — 无 ability_id）
- area 级：现存 area invariant 均为 dashboard 三件套注册类，与本后端 kernel 修复无约束关系；不适用本 sprint

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path -->
- （本 line 暂无历史 — payload 无 journey_id，journeys/:id/golden-paths 不可锚定）

## E2E 验收

> Planner 初稿此区块留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入。

```bash
# 占位：proposer 将填入真实脚本（local_api → vitest + 必要时 curl localhost:5221 / psql）
# 期望验收点（自然语言）：
#   1) 复现测试 `npx vitest run packages/brain/src/orchestrator/__tests__/ground-truth.test.js`
#      在修复前为红——断言"越过准入 + 冻结产物缺失"轨迹今日会静默耗跳后 assembly_fault 终结。
#   2) 修复后该测试为绿——冻结产物缺失被装配闸确定性处理，run 不再静默耗到第 19 跳才终结，
#      且失败诊断可定位到 run_id 与缺失产物清单。
#   3) 既有 loop.js:1115 可恢复路（seal_rejected → reopen GAN）回归不破。
```

## journey_type: autonomous
## journey_type_reason: 改动仅落在 packages/brain/ kernel orchestrator 纯后端，无 UI / 无远端 agent 协议 / 非 engine hooks。
## target_environment: local_api
## target_environment_reason: Brain 内部 kernel 逻辑，本地 evaluator 跑 vitest + 必要时 curl localhost:5221，无需远端机器。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
