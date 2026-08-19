# Sprint PRD — Diff Impact Gate 透传 reason_code 并 fail-closed 出口

## OKR 对齐

- **对应 KR**：KR2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：+1%（消除 harness 内核一类无限空转，降低算力浪费）

## 背景

Diff Impact Gate（`packages/brain/src/impact-contract/diff-gate.js`）在 Mapper 复算影响半径后，只要 `freshness.status !== 'fresh'` 就一律折叠成 `reason: 'mapper_stale', retryable: true`。这把 Map 已经给出的**确定性结论**（该 diff 无法解析 / 坐标不存在）也当成瞬态陈旧，交给 kernel 无限重试。实证：runs f62c7e87 / d1360a48 出现 `deny:impact:mapper_stale` 空转（issue_ref）。`structure-gate.js` 第 124 行同一处理策略，存在同样折叠。修复方向 = 透传 Mapper 给出的具体 reason_code，并对确定性 unknown 走 fail-closed（retryable=false）出口。

## Golden Path（核心场景）

系统从 [orchestrator loop 对有 active impact contract 的 task 触发 Diff Impact Gate] → 经过 [Gate 依据 Mapper freshness 语义分流] → 到达 [有界重试或确定性拒绝，不再空转]

具体：
1. [触发条件] orchestrator loop 对一个带 active impact contract 的 task 调用 `runImpactDiffGate` 复算影响半径，Mapper 返回一个 `freshness.status !== 'fresh'` 的结果。
2. [系统处理] Gate 区分两类非 fresh：
   - **瞬态陈旧**（快照刷新中 / 滑动窗口未命中等）→ `retryable: true`，且**透传 Mapper 给出的具体 reason_code**（如 `fact_snapshot_stale`），不再一律写成 `mapper_stale`。
   - **确定性 unknown**（Map 已确定该 diff 不可解析 / 坐标不存在）→ **fail-closed 出口**：`retryable: false` 且透传具体 reason_code（如 `impact_unknown`），gate 判 deny 且不可重试。
3. [可观测结果] orchestrator loop 收到 gateVerdict：`retryable=false` 时立即终止该 intent 的重试（不再 `deny:impact:mapper_stale` 空转）；`retryable=true` 时按具体 reason_code 有界重试。

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- Mapper 返回的 freshness 缺失 reason 细分字段（只有 `status: stale`）→ 无法判定确定性时，保守按瞬态处理但仍透传原始 reason（不得静默丢弃）。
- `structure-gate.js` 的 `mapper_stale` 折叠必须与 diff-gate 采用**同一语义分流策略**（判变端与终验端不得分叉，否则开假绿面）。
- 现有断言 `expect(result.reason).toBe('mapper_stale')`（structure-gate.test.js:155、harness-gates.test.js:409）在新增语义值后需全仓库 grep 同步，避免遗留硬编码断言转红。

## 范围限定

**在范围内**：Diff Impact Gate（diff-gate.js 步骤 3a）与 structure-gate.js 的非 fresh 分流；透传具体 reason_code；确定性 unknown 的 fail-closed 出口；orchestrator loop 对 `retryable=false` 的终止消费；配套回归测试。
**不在范围内**：Mapper（queryImpactRadius）本身的 freshness 判定逻辑改造；影响半径对账（compareImpactContract）；impact contract 的持久化/extend 副作用。

## 假设

- [ASSUMPTION: Mapper 结果在 freshness 中已能区分「瞬态陈旧」与「确定性 unknown」；若字段不足，proposer/dev 阶段需与 Mapper 契约对齐后再落地分流。]
- [ASSUMPTION: Unified Map 未配置（payload 提供 map_scope=["F1"] 但缺 map_repo）→ scope 锚定退化为 F1「造完真验」golden path step，不做领域猜测。]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`: 步骤 3a 非 fresh 分流，透传 reason_code + fail-closed 出口
- `packages/brain/src/impact-contract/structure-gate.js`: 第 124 行同一折叠点同步修复
- `packages/brain/src/orchestrator/loop.js`: gateVerdict 对 `retryable=false` 的终止消费
- `packages/brain/src/routes/impact-contracts.js`: 响应 reason 语义/文档同步（第 207 行）
- `packages/brain/src/impact-contract/__tests__/harness-gates.test.js`: 回归断言（含 fail-closed 用例）
- `packages/brain/src/impact-contract/__tests__/structure-gate.test.js`: 断言从固定 `mapper_stale` 改为语义分流
- `packages/brain/src/orchestrator/__tests__/loop.test.js`: 空转终止回归

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step/feature 双源均空数组）+ PrepPRD；本 sprint 无显式 NFR -->
- 超时/延迟: 待定（PrepPRD 未指定，decisions 无值）
- 频控/重试: 确定性 unknown 必须 retryable=false（有界，杜绝无限重试空转）
- 版本要求: 无
- 可观测: gate 拒绝必须透传具体 reason_code（禁止折叠成通用 mapper_stale 遮蔽根因）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step/journey_feature 两源空数组；以下取 area 级中与本 gate 修复相关者 + [系统]核心；其余 area 级为 capture-triage 学习型，与本 diff-gate 修改无关，已略 -->
- [失败路径不降级] 任何失败路径禁止 warning 降级，必须显式 FAIL / 非零出口（来源: area）
- [显式else兜底] 调用「失败返回 null/false」契约的函数写完成功分支必须显式 else 兜底（来源: area）
- [语义跨端一致] 同一语义（如 mapper_stale/unknown）在判变端与终验端必须同一处理策略，禁跨脚本分叉（来源: area）
- [status枚举同步] status/reason 枚举硬编码断言，GAN 新增值时需全仓库 grep 同步（来源: area）
- [真环境验证] 真环境验证才算 done（来源: area）
- [禁写死环境] 禁止写死环境假设值（来源: area）
- [租户隔离] 记忆/数据按租户隔离，测试默认多租户（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；journey e6f803f2 golden-paths 仅含 planned ability（Agent 一键归零重置），无 done/working 历史 -->
- （本 line 暂无已验收历史）

## E2E 验收

> Planner 初稿此区块留占位，最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl localhost:5221 + node 单测）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本
# 期望验收点（自然语言）：
# 1. 瞬态非 fresh 输入 → gate 返回 retryable=true 且 reason_code 为具体值（非 mapper_stale 通用折叠）
# 2. 确定性 unknown 输入 → gate 返回 retryable=false（fail-closed）且透传具体 reason_code
# 3. orchestrator loop 收到 retryable=false 后终止重试，不再产生 deny:impact:mapper_stale 空转
# 4. diff-gate 与 structure-gate 对同一非 fresh 语义的分流结论一致
```

## journey_type: autonomous
## journey_type_reason: 改动仅落在 packages/brain/（impact-contract gate + orchestrator loop），纯后端内核逻辑，无 UI/agent 协议路径
## target_environment: local_api
## target_environment_reason: payload 显式 target_environment=local_api，验证走本地 evaluator（curl localhost:5221 + node 单测），与 journey_type=autonomous 一致
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
