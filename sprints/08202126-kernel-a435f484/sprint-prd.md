# Sprint PRD — Diff Impact Gate 确定性 Map 结论透传 reason_code 并 fail-closed 出口（不再折叠成 mapper_stale 无限重试）

## OKR 对齐

- **对应 KR**：KR「Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环」（当前 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（F1 造完真验闭环去掉 mapper_stale 空转黑洞，逼近"零人碰到 merge"）

## 背景

F1「造完真验」链路上，Diff Impact Gate（`evaluateDiffGate`）在合同真验阶段调用 Mapper 复算影响半径。当 Mapper 返回一个**确定性结论**（`freshness.status='stale'` 且携带具体 `reason_code`，如 `projection_revision_mismatch`——这是 Map 已判定、重试不会改变的固定原因）时，Gate 现状把**所有**非 `fresh` 情形一律折叠成通用 `reason: 'mapper_stale' + retryable: true`（`diff-gate.js:202-208`）。

下游 orchestrator 因 `retryable === true` 把它归类为 `infrastructure_blocked`（`loop.js:1542-1544`），进入无上限的 90s backoff 重试，直到 run 截止（默认 5400s）才失败——实证 runs `f62c7e87` / `d1360a48` 在 `deny:impact:mapper_stale` 上无限空转。同时具体 `reason_code` 被通用 `mapper_stale` 遮蔽（`gateReceipt` 的 `reason ?? reason_code`，`harness-gates.js:30`），可观测性丢失。已有一条红测 `harness-judge.test.js:1360-1394` 断言 mapper_stale 应 fail-closed 但当前空转。

## Golden Path（核心场景）

系统从 [Gate 收到确定性 stale 结论] → 经过 [透传 reason_code + 判定确定性] → 到达 [fail-closed 终止，不空转]

具体：
1. [触发] `evaluateDiffGate` 调用 Mapper，Mapper 返回 `freshness.status='stale'` 且 `freshness.reason_code` 为确定性原因（如 `projection_revision_mismatch`）。
2. [系统处理] Gate 不再把该结论折叠成通用 `reason:'mapper_stale' + retryable:true`；而是**透传** Mapper 的 `freshness.reason_code` 到 Gate 返回体，并对"确定性结论"走 **fail-closed 出口**：仍返回 `impact_unknown`（不假绿、仍 blocked），但 `retryable: false`。
3. [可观测结果] orchestrator 因 `retryable === false` 归类为 `impact_contract_invalid`，run 以 `impact_gate_deterministic:<reason_code>` **精确终止**，不再无限 backoff；Gate 返回体 / 回执含具体 `reason_code`（不再是通用 `mapper_stale`）。

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- **真·瞬态**：`freshness.status='unknown'` 且无确定性 `reason_code`（Mapper 尚未算出/投影延迟）→ 必须保留 `retryable: true`，走既有 infra backoff 刷新，禁止误判 fail-closed 把正常刷新窗口卡死。
- **Mapper 不可达**：`mapperFn` 抛错 / freshness 缺失 → 保持既有 `reason:'mapper_unavailable', retryable:true`（真不可达属瞬态）。
- **reason_code 为 null 但 status='stale'**：无法判定确定性 → 见假设，保守默认由 proposer 定。
- 并发多个 task 命中同一 stale 投影时，各自独立按确定性终止，不互相污染 backoff 计数。

## 范围限定

**在范围内**：`evaluateDiffGate`（`diff-gate.js`）步骤 3a mapper_stale 分支的 **reason_code 透传** + **确定性结论 fail-closed（retryable:false）出口**，以及该出口在 orchestrator 侧被正确归类为终止而非无限重试的端到端可观测效果。
**不在范围内**：Mapper（`/api/brain/map/radius`）自身 freshness/reason_code 的计算逻辑；重试次数上限的调度参数调优；drift/extend 等其它裁决分支。

## 假设

- [ASSUMPTION: "确定性结论"判据 = `freshness.status !== 'fresh'` 且 `freshness.reason_code` 非空（是 Map 已给出的固定原因）；`status='unknown'` 且无 reason_code 视为真·瞬态保留重试。最终判据边界由 proposer 在 GAN 阶段与 Mapper 契约核对后锁定。]
- [ASSUMPTION: `structure-gate.js:123` 存在同源分支（同样 collapse 成 mapper_stale + retryable:true）。若 proposer 判定同一根因需并修以防结构闸侧继续空转，则一并纳入；否则本 sprint 仅锚定 diff-gate 主分支。]
- [ASSUMPTION: 透传后下游归类是否需在 `loop.js` DETERMINISTIC_IMPACT_ERROR_CODES / `gateReceipt` 侧配合（让 reason_code 不被通用 reason 遮蔽），由 proposer 依 retryable=false 已能触发 `impact_contract_invalid` 的既有链路判定，最小改动优先。]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`：步骤 3a mapper_stale 分支——透传 `freshness.reason_code`，确定性结论改 `retryable: false`。
- `packages/brain/src/impact-contract/__tests__/diff-gate.test.js`（或 harness-gates.test.js）：新增/转红回归——确定性 stale 结论断言 reason_code 透传 + retryable:false，且 unknown 瞬态仍 retryable:true。
- `packages/brain/src/impact-contract/harness-gates.js`（可能）：确保 `gateReceipt` 不用通用 reason 遮蔽具体 reason_code。
- `packages/brain/src/impact-contract/structure-gate.js`（可能，见假设）：同源分支并修。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step+feature 均空），PrepPRD 无 thin_prd 显式 NFR -->
- 超时/延迟: 待定（PrepPRD 未指定；Gate 判决为进程内同步，无新增外呼）
- 频控: 待定（本 sprint 目标恰是消除无限重试空转）
- 版本要求: 无
- 可观测: 确定性终止必须在 run 失败原因中携带具体 reason_code（`impact_gate_deterministic:<reason_code>`），失败留痕不吞

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step/feature 空，注入 area 级系统铁律 + 本域直接相关铁律 -->
- [fail-closed] Mapper 任何不可判定情形均返回 blocked，绝不假绿（来源: 本域 diff-gate 头部铁律）
- [真环境验证] 真环境验证才算 done，禁止仅凭"测试通过"空泛断言收尾（来源: area）
- [失败契约显式处理] 调用"失败返回 null/false"契约的函数，写完成功分支必须显式写 else 处理失败（来源: area）
- [语义一致] 同一语义（如 mapper_stale/reason_code）在判变端与终验端必须同一处理策略，跨脚本语义分叉会开假绿面（来源: area）
- [status 枚举全扫] 涉及 status 枚举硬编码断言、GAN 新增状态值时须做一次全仓库扫描（来源: area）
- [catch 计数] catch 吞错的后台路径必须带失败计数/告警，禁止静默无限重试（来源: area）
- [多租户默认] 测试默认多租户，租户隔离（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；本 journey 无 done/working ability -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留占位。最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（curl localhost:5221 + node -e 直调）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（node -e 直调 evaluateDiffGate + mock mapper）
# 期望验收点（自然语言）：
#  1. mock Mapper 返回 freshness.status='stale', reason_code='projection_revision_mismatch'
#     → evaluateDiffGate 返回体 reason_code === 'projection_revision_mismatch'（透传，非通用 mapper_stale）
#     → retryable === false（fail-closed 出口）
#  2. mock Mapper 返回 freshness.status='unknown'（无 reason_code，真瞬态）
#     → retryable === true（保留刷新重试，未被误 fail-closed）
#  3. 既有红测 harness-judge.test.js:1360-1394（确定性 unknown→fail-closed）转绿
```

## journey_type: autonomous
## journey_type_reason: 改动仅在 packages/brain（impact-contract Gate 后端裁决），无 UI/agent 协议/engine 介入，属纯后端自治链路。
## target_environment: local_api
## target_environment_reason: payload 显式 target_environment=local_api；验证走本地 evaluator（node -e 直调 + curl localhost:5221），无浏览器/远端机器。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
