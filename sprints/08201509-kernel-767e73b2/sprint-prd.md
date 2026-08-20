# Sprint PRD — Diff Impact Gate 透传 reason_code + 确定性结论 fail-closed 出口

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：+1%（消除 harness impact 门禁的无限重试空转，回收算力）

## 背景

`packages/brain/src/impact-contract/diff-gate.js` 的 `evaluateDiffGate` 在校验 Mapper 可判定性时（步骤 3a），把 Mapper 返回的**任何** `freshness.status !== 'fresh'` 一律折叠成扁平的 `reason: 'mapper_stale'` + `retryable: true`。这丢弃了 map-client 已经算出的真实 `freshness.reason_code`（`{ status, reason_code }`），并且对**确定性/终态**结论（重试永远不会变 fresh）也标 `retryable: true`，导致 `deny:impact:mapper_stale` 无限重试空转。issue_ref 实证：runs `f62c7e87` / `d1360a48` 卡在 `deny:impact:mapper_stale` 空转不收敛。

本 sprint 修此点：门禁必须**透传** Mapper 的具体 `reason_code`，并对确定性终态给出 **fail-closed（不重试、直接 blocked）** 出口，只对真正的瞬时 stale 保留重试。

## Golden Path（核心场景）

系统从 [Mapper 返回非 fresh 结论] → 经过 [门禁按 reason_code 分流] → 到达 [终态 fail-closed 阻断 / 瞬态可重试]

具体：
1. [触发] `evaluateDiffGate` 调用 Mapper 复算影响半径，Mapper 返回 `freshness.status !== 'fresh'`（`stale` 或 `unknown`），并带具体 `freshness.reason_code`
2. [系统处理] 门禁不再把结果折叠成扁平 `mapper_stale`：把 Mapper 的 `freshness.reason_code` 原样透传到出口 `reason`（或专用字段），并据其判定是否为确定性终态
3. [可观测结果]
   - 确定性/终态结论（重试无法自愈）→ 出口 `retryable: false`，任务 fail-closed（blocked），不再无限重派
   - 真正瞬时 stale（可能自愈）→ 出口 `retryable: true`，保留原有重试
   - 两种出口的 `reason` 均携带 Mapper 的具体 `reason_code`，不再是无信息的裸 `mapper_stale`

<!-- Response Schema 由 Proposer 在 Step 1.1 读 map-client / diff-gate 出口契约后推导。 -->

## 边界情况

- Mapper 不可达（抛错）→ 维持既有 `mapper_unavailable` + `retryable: true`（本 sprint 不改）
- `freshness.reason_code` 为 null/缺失 → 门禁需有兜底（不得因缺 reason_code 崩溃或误判为 fresh）
- revision/manifest/projection digest mismatch 等既有确定性出口 → 不回退，保持 fail-closed 语义一致

## 范围限定

**在范围内**：`diff-gate.js` 步骤 3a（`mapper_stale` 折叠点）的 reason_code 透传与 retryable 分流；对应回归测试。
**不在范围内**：map-client 的 freshness 计算逻辑、Mapper 服务端 `/api/brain/map/radius`、其它 gate（structure-gate）、重派调度器本身。

## 假设

- [ASSUMPTION: 确定性终态由 map-client 已产出的 `reason_code` 取值区分（如 revision 永久分叉 / manifest 从未生成属终态；瞬时投影延迟属可重试）；具体 reason_code→terminal 映射表由 Proposer 在 GAN 阶段读 map-client 源码后锁定。]
- [ASSUMPTION: 出口对象在 `reason` 之外新增/透传 `reason_code` 字段供下游 RCA 去重消费，不破坏既有 `{ gate, reason, retryable }` 消费方。]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`: 步骤 3a mapper_stale 折叠点，改为透传 reason_code + 终态 fail-closed 分流
- `packages/brain/src/impact-contract/__tests__/diff-gate.test.js`: 新增 failing 回归（终态不重试、reason_code 透传、瞬态仍重试）
- `packages/brain/src/impact-contract/map-client.js`: 只读参考其 `freshness.reason_code` 契约，不改动

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step/feature 均空），PrepPRD 未显式指定；补 fail-closed 观测约束 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 可观测: 门禁 fail-closed 阻断必须留痕真实 `reason_code`（供 RCA `reason_code:layer:step` 去重消费），不得吞成裸 `mapper_stale`
- 版本要求: 无

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/feature 源为空）；仅注入 gate 相关铁律，area 级 capture-triage 运维学习条目为触发窄的运维笔记不作 gate 铁律注入 -->
- [fail-closed] Mapper 任何不可判定情形均返回 blocked，绝不假绿（来源: diff-gate 模块自身原则）
- [status枚举全仓grep] status/reason 枚举新增值时须全仓库 grep 硬编码断言同步（来源: area · decision 052e10a0）
- [retry身份] 基础设施类重试须保持 retry identity，不得让不可自愈条件伪装成可重试（来源: area · generator_infrastructure_retry_identity）
- [真环境验证] 真环境验证才算 done（来源: area · [系统]）
- [多租户] 测试默认多租户（来源: area · [系统]）
- [端点鉴权] 端点鉴权（来源: area · [系统]）
- [凭据安全] 凭据安全（来源: area · [系统]）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；本 line 仅 1 个 ability 且状态 planned，无 done/working 历史 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填 curl+node/vitest。

```bash
# 占位：proposer 将填入 local_api 脚本（node vitest 跑 diff-gate.test.js + 断言出口对象）
# 期望验收点（自然语言）：
#  1. Mapper 返回确定性终态 non-fresh（带 reason_code）→ evaluateDiffGate 出口 retryable=false 且 reason 含该 reason_code（不再无限重试）
#  2. Mapper 返回瞬时 stale → 出口 retryable=true 且 reason 含具体 reason_code（不再裸 mapper_stale）
#  3. 既有 mapper_unavailable / digest mismatch 出口语义不回退
```

## journey_type: autonomous
## journey_type_reason: 仅改动 packages/brain/ 后端 impact 门禁逻辑，无 UI / 无远端 agent 协议。
## target_environment: local_api
## target_environment_reason: payload 显式 target_environment=local_api；纯 Brain 后端逻辑，evaluator 本地跑 vitest + curl localhost:5221。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
