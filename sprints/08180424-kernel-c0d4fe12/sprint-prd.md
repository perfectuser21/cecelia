# Sprint PRD — Diff Impact Gate 透传确定性 reason_code 并 fail-closed 出口（r19）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（消除 harness 空转黑洞，提升调度可信度）

## 背景

Diff Impact Gate（`diff-gate.js`）步骤 3a 在 `mapperResult.freshness.status !== 'fresh'` 时，把**任意**不新鲜
情形硬编码折叠成 `reason:'mapper_stale', retryable:true`，丢弃了 Mapper 返回的 `freshness.reason_code`。
但 Map（`radius.js`）会产出**确定性**结论（`revision_mismatch`、`capability_not_in_active_projection` 等结构事实，
重试同一查询不会自愈）。折叠后 orchestrator（`loop.js:1454`）得到 `deny:impact:mapper_stale` 并无限重试空转
（issue_ref: runs f62c7e87/d1360a48 deny:impact:mapper_stale 空转）。

## Golden Path（核心场景）

系统从 [Gate 复算] → 经过 [透传 reason_code + 确定性判定] → 到达 [终态阻断，停止空转]

具体：
1. [触发条件] orchestrator 在 beforeGenerate/beforeEvaluate 调用 Diff Impact Gate，
   Map 复算影响半径返回 `freshness.status !== 'fresh'` 且携带**确定性** `reason_code`
   （如 `revision_mismatch` / `capability_not_in_active_projection`）
2. [系统处理] Gate 把该 `reason_code` **透传**到返回结果的 `reason` 与 `reason_code` 字段
   （不再硬编码 `mapper_stale`）；按确定性分类判定 `retryable`：
   - 确定性 reason_code → `retryable: false`（fail-closed 终态出口）
   - 真正瞬态（如 `fact_snapshot_stale`，事实正在重扫）或 `reason_code` 缺失 → `retryable: true`（向后兼容旧路径）
3. [可观测结果] orchestrator gateVerdict = `deny:impact:<确定性reason_code>`，任务被终态阻断
   （`retryable:false`），不再每 tick 重发同一 gate 无限空转

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- **瞬态 stale 不得误 fail-closed**：`fact_snapshot_stale`（事实正在重扫，可自愈）必须保持 `retryable:true`，不能被新逻辑挡死。
- **旧 Map 响应无 reason_code**：`freshness` 存在但 `reason_code` 为 null/undefined 时回退既有 `mapper_stale`+`retryable:true`（向后兼容）。
- **freshness 缺失** / 其余步骤（3b revision 校验、digest 校验、drift/extend 副作用）行为不变。

## 范围限定

**在范围内**：
- `diff-gate.js` 步骤 3a 的 reason_code 透传 + retryable 确定性分类
- 确定性 reason_code 集合的定义（与 `radius.js` 产出的确定性 freshness reason_code 对齐）
- 对应回归测试（failing→passing）

**不在范围内**：
- structure-gate.js / harness-gates.js beforeMerge 的 stale 路径（另有 merge 重校语义，本 sprint 不动）
- Map/radius.js 本身 reason_code 的产出逻辑
- orchestrator loop.js 的 retry 调度机制（只消费 gate 的 retryable，不改调度）

## 假设

- [ASSUMPTION: 确定性 reason_code 集合 = radius.js 产出的结构性 stale 码
  （revision_mismatch/projection_revision_mismatch/manifest_projection_mismatch/
  graph_projection_revision_mismatch/capability_not_in_active_projection/impact_anchor_missing/
  unsafe_assertion_ref/assertion_identity_ambiguous/capability_assertion_coverage_missing）；
  `fact_snapshot_stale` 归为瞬态可重试。最终清单由 Proposer 读 radius.js 核对后锁定。]
- [ASSUMPTION: gate 字段保持 `impact_unknown`（不改成 blocked），只调整 reason/reason_code/retryable，
  下游 loop.js 已按 `!['pass','extend'].includes(gate)` 走 deny 分支，无需改 loop.js。]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`: 步骤 3a 透传 reason_code + 确定性 retryable 分类
- `packages/brain/src/impact-contract/__tests__/diff-gate.test.js`: 新增确定性/瞬态两类回归断言

## NFR 约束

<!-- 来源: decisions 表 category=nfr（golden-path + feature 双源均为空），PrepPRD 无显式 NFR -->
- 超时/延迟: 待定（PrepPRD 未指定，沿用 gate 现有同步开销，不新增外部调用）
- 频控: 无
- 版本要求: 无
- 可观测: gate 返回的 reason_code 必须落进 orchestrator gateVerdict（`deny:impact:<reason_code>`），可在 run 日志追溯

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源；无本 line 相关铁律 -->
- [fail-closed] Mapper 任何不可判定情形绝不假绿放行（来源: diff-gate.js 模块契约；本 sprint 强化：确定性不可判定 → 终态阻断而非无限重试）
- （decisions 表 step/journey_feature/area 三源无本 line 直接相关铁律）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无历史：journey golden-paths 返回的 ability 均为 planned 态，无 done/working 可累积）

## E2E 验收

> Planner 初稿此区块留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出。

```bash
# 占位：proposer 将填入真实脚本（local_api → node 单测 + curl localhost:5221）
# 期望验收点（自然语言）：
# 1. 单测：mapperResult.freshness={status:'stale',reason_code:'revision_mismatch'} 时，
#    evaluateDiffGate 返回 reason==='revision_mismatch' 且 reason_code==='revision_mismatch' 且 retryable===false
#    （旧行为返回 reason:'mapper_stale', retryable:true——此即 failing 复现点）
# 2. 单测：mapperResult.freshness={status:'stale',reason_code:'fact_snapshot_stale'} 时，
#    retryable===true（瞬态可重试不被误挡）
# 3. 单测：freshness 无 reason_code 时回退 reason:'mapper_stale', retryable:true（向后兼容）
# 4. 端到端：orchestrator 消费该 gate 后 gateVerdict='deny:impact:revision_mismatch'（非 mapper_stale），任务终态阻断不空转
```

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain/ 后端 Diff Impact Gate 判定逻辑，无 UI/agent 协议/engine
## target_environment: local_api
## target_environment_reason: payload 显式指定 local_api，本地 evaluator 跑 node 单测 + curl localhost:5221 验 gate 出口
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
