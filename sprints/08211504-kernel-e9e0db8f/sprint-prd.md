# Sprint PRD — Diff Impact Gate 透传 reason_code + 确定性结论 fail-closed 出口（r19/r38）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（消除 harness kernel 无限重试空转，逼近"零人碰 merge"）

## 背景

Diff Impact Gate（`packages/brain/src/impact-contract/`）在 propose 后调用 Mapper 求本次改动的确定性影响结论。当前 Gate 把 Mapper 返回的**任何非 fresh / 不满足对账**情形一律折叠成笼统 `mapper_stale` 且 `retryable: true`——即使 Mapper 给出的是一个**确定性终态结论**（例如稳定的 projection/manifest mismatch，靠重试永远不会收敛）。结果是 attempt 反复落 `deny:impact:mapper_stale` 并被无限重派，run 空转（实证：runs f62c7e87 / d1360a48）。

r38 前置条件：F1 已认领 `tests/gp/` 与根文件（`DoD.md`/`.brain-versions/`/`DEFINITION.md`/`package-lock.json`），manifest v5 在 propose 前即 active，合同封印 pin v5 投影，全链投影首次完全一致——因此本 sprint 只需解决 Gate 侧的**结论折叠 + 无出口**缺陷。

## Golden Path（核心场景）

系统（Harness Diff Impact Gate）从 [收到 Mapper 确定性结论] → 经过 [按 reason_code 分流瞬态/终态] → 到达 [透传具体 reason_code 并对终态 fail-closed 终止空转]

具体：

1. **触发条件**：一个 `change_kind=capability_change` 的 attempt 在 propose 后进入 Diff Impact Gate；Gate 调用 Mapper，Mapper 返回带**具体 reason** 的结论（`mapper_unavailable` / `mapper_stale` / `revision_mismatch` / `revision_evidence_missing` / `manifest_digest_mismatch` / `projection_digest_mismatch`）。
2. **系统处理**：Gate 不再把上述结论统一折叠成 `mapper_stale`，而是——
   - **透传**：裁决结果携带 Mapper 的**具体 reason_code**（deny 事件标签为 `deny:impact:<具体 reason_code>`，而非笼统 `mapper_stale`）；
   - **分流**：对**瞬态**结论（Mapper 不可达 / DB 不可达等基础设施类）保持 `retryable: true`；对**确定性终态**结论（Map 已给出稳定判定、重试不可能收敛的 digest/revision 稳定 mismatch）走 **fail-closed 出口**（`retryable: false`，deny 并终止，不再回队重派）。
3. **可观测结果**：终态类 deny 携带其真实 reason_code 且 `retryable=false`，attempt 一次性判定失败并停止重派；`deny:impact:mapper_stale` 无限空转（f62c7e87 / d1360a48 类）不再复现。fail-closed 原则保留——任何真正不可判定情形仍返回 blocked，绝不假绿。

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- **瞬态 vs 终态误判**：基础设施类瞬态失败（`mapper_unavailable`、DB 不可达）绝不能被误判为终态而过早 fail-closed，必须保持可重试。
- **未知 reason_code**：Mapper 返回未枚举的新 reason 时，默认按 fail-closed 保守处理（不假绿），并透传原始 reason_code 供归因。
- **structure-gate 同源折叠**：`structure-gate.js` 存在同样的 `mapper_stale` 折叠（`buildBlockedResult('mapper_stale', 503)`），需一并对齐透传/分流，避免只修一半。
- **重试计数缺失**：确定性终态若无重试上界会永久空转——fail-closed 出口是唯一止损点，必须真正终止而非降级为更长退避。

## 范围限定

**在范围内**：
- `packages/brain/src/impact-contract/diff-gate.js` 中把 freshness/revision/digest 各分支的结论**透传具体 reason_code**（不再统一折叠成 `mapper_stale`）。
- 对**确定性终态**结论增加 **fail-closed 出口**（`retryable: false`），终止无限重派。
- `structure-gate.js` 同源折叠对齐。
- 覆盖上述行为的回归测试（先红后绿）。

**不在范围内**：
- Manifest v5 落盘 / F1 exact_paths 认领根文件（另一 in_progress 任务，已作为前置条件 active）。
- Mapper 本身的 freshness 计算逻辑。
- 重试次数上限的全局策略调整（本 sprint 只解决"终态不应重试"这一确定性分流，不改瞬态退避曲线）。

## 假设

- [ASSUMPTION: manifest v5 与 F1 根文件认领已在 propose 前 active，合同封印 pin v5 投影一致——本 sprint 不重复该修复]
- [ASSUMPTION: Mapper 已在其返回结构中区分"瞬态不可达"与"确定性判定"，Gate 可据 reason 分流；若 Mapper 未提供该区分，则按 reason 枚举白名单静态分流]
- [ASSUMPTION: `deny:impact:<reason_code>` 的 reason_code 透传即为下游归因/停止空转的充分信号]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`：freshness/revision/digest 分支透传具体 reason_code + 确定性终态 fail-closed 出口
- `packages/brain/src/impact-contract/structure-gate.js`：同源 `mapper_stale` 折叠对齐（透传 + 分流）
- `packages/brain/src/impact-contract/__tests__/diff-gate.test.js` / `harness-gates.test.js`：回归测试（确定性终态返回具体 reason_code 且 retryable=false）
- `packages/brain/src/orchestrator/__tests__/loop.test.js`：验证终态 deny 不再回队无限重派

## NFR 约束

<!-- 来源: decisions 表 category=nfr 空；以下为 PrepPRD（任务标题）显式行为约束 -->
- 重试边界: 确定性终态结论必须 `retryable: false`，禁止无限重试空转（PrepPRD 显式："无限重试"根因）
- 可观测: deny 事件必须携带 Mapper 具体 reason_code，禁止折叠成笼统 `mapper_stale`（PrepPRD 显式："透传 reason_code"）
- fail-closed: 任何不可判定情形仍返回 blocked，绝不假绿（保留 diff-gate.js 既有 fail-closed 原则）
- 版本要求: 无
- 频控: 无

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；step/feature 源为空，以下取 area 级中与本 sprint 相关者 -->
- [fail-closed] validation_clock_required 默认 fail-closed；缺失或不一致一律拒绝（来源: area）
- [infra-retry-identity] Generator 基础设施失败必须重试原始服务端派发动作，首次 generator 重派 generator（来源: area）
- [brain-url-authority] Fleet Worker 必须注入服务端权威 HARNESS_BRAIN_URL，预检 fail-closed，禁止手工为单 Attempt 绕过（来源: area）
- [planner-branch] Planner workspace 必须停在服务端签发的 planner_branch，Provider 可校验但不得 checkout/switch（来源: area）
- [judge-gate5-local_api] judge 机械闸⑤对 local_api/无 UI smoke 任务会死锁，需在合同预先声明验证真相形态或对闸⑤放行（来源: area）
- [contract-exit-code] 合同里的验证命令必须实跑确认 exit code 语义（vitest 对 include 范围外路径绿态也 exit 1），写进合同前先跑一次（来源: area）
- [judge-evidence-window] evaluator 产 .brain-result.json 必须把一手证据（root-cause 输出、Red→Green 时序、exit_code）排进 judge 消费窗口前 8 条（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；journey e6f803f2 golden-paths 均为 planned 状态，无 done/working 历史 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留占位；最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（curl localhost:5221 + vitest 单测），写进 contract-draft.md。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本
# 期望验收点（自然语言）：
#   1) 构造一个 Mapper 返回确定性终态（如稳定 projection_digest_mismatch）的场景，
#      evaluateDiffGate 返回 gate=impact_unknown、reason=projection_digest_mismatch（具体，非 mapper_stale）、retryable=false。
#   2) 构造瞬态场景（mapper_unavailable / DB 不可达），返回 retryable=true（保持可重试）。
#   3) structure-gate 同源场景对齐：确定性终态不再折叠成 mapper_stale。
#   4) 编排循环层：终态 deny 不回队重派（loop 不再无限空转）。
```

## journey_type: autonomous
## journey_type_reason: 改动仅落 packages/brain/ 后端 impact-contract 门禁逻辑，无 UI / 无远端 agent 协议，属自治后端。
## target_environment: local_api
## target_environment_reason: payload 显式 target_environment=local_api；验证走本地 evaluator（curl localhost:5221 + 本地 vitest 单测），无浏览器/Windows/微信面。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
