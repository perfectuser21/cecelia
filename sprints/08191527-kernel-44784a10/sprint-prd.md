# Sprint PRD — Diff Impact Gate 透传确定性 reason_code + fail-closed 出口（r19 / r23 全链验证）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（消除 harness 编码闸空转，打通 publisher→CI→merge 全链）

## 背景

kernel harness 运行 f62c7e87 / d1360a48 在 `deny:impact:mapper_stale` 上空转（无限重试）。
根因：`diff-gate.js` 步骤 3a 把 Mapper 任何 `freshness.status ≠ 'fresh'` 的返回一律折叠成
通用 `reason:'mapper_stale', retryable:true`——即便 Mapper 给出的是**确定性结论**（携带明确
`freshness.reason_code`，本质不可恢复）。可重试标记让 orchestrator 反复重跑，真实卡点被吞没。
r23 在 r19 修复基础上做全链验证：judge 措辞修复 + publisher 回执 + worker 诊断均已上线，
本 sprint 验证 publisher→CI→merge 端到端跑通。

## Golden Path（核心场景）

系统从 [编码任务进入 Diff Impact Gate] → 经过 [Mapper 复算返回确定性 stale 结论] → 到达 [gate 透传真实 reason_code 并以 fail-closed 终态出口，orchestrator 停止空转]

具体：
1. 编码任务过 Diff Impact Gate，`evaluateDiffGate` 调用 Mapper 复算影响半径，Mapper 返回
   `{ freshness: { status: 'stale'|'unknown', reason_code: '<确定性码>' }, ... }`。
2. gate 检测 `freshness.status ≠ 'fresh'`：若 `freshness.reason_code` 非空（确定性结论）→
   把该 reason_code 原样透传进 verdict，并置 `retryable: false`（fail-closed 终态）；
   若 `reason_code` 为空/缺失（真·瞬时 stale）→ 保留 `reason: 'mapper_stale', retryable: true`。
3. 可观测出口：确定性场景返回 `gate: 'impact_unknown'`、`reason: <Mapper 原始 code>`、
   `retryable: false`；orchestrator 不再重试，真实卡点被暴露（不再 `deny:impact:mapper_stale` 空转）。

## 边界情况

- `freshness.reason_code` 为 null/缺失 → 视为真·瞬时 stale，保留 `retryable: true`（不得误杀可恢复场景）。
- `freshness.status === 'fresh'` → 完全不受影响，继续走原 revision/digest 对账与 compare 流程。
- Mapper 完全不可达（`mapperFn` throw）→ 仍走 `mapper_unavailable` + `retryable: true`，与确定性 stale 区分。

## 范围限定

**在范围内**：`diff-gate.js` 步骤 3a `mapper_stale` 分支——透传 `freshness.reason_code` +
按是否确定性判定 `retryable`（fail-closed 终态）；对应回归测试。
**不在范围内**：`structure-gate.js`（编码前闸，同名 `mapper_stale` 本 sprint 不动）；Mapper 自身
`reason_code` 生成逻辑；judge 措辞 / publisher 回执 / worker 诊断三处（r23 前序已上线，本 sprint 仅全链验证）。

## 假设

- [ASSUMPTION: Mapper `freshness.reason_code` 字段已由 map-client 透出（contract-schema 注释证实 `freshness: { status, reason_code }` 契约存在）；确定性结论以非空 reason_code 标识。]
- [ASSUMPTION: r23 描述的 judge/publisher/worker 三项已在前序 PR 合并，本 sprint 只验证 publisher→CI→merge 全链，不再改这三处代码。]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`：步骤 3a `mapper_stale` 分支加 reason_code 透传 + fail-closed retryable 判定。
- `packages/brain/src/impact-contract/__tests__/harness-gates.test.js`：加"确定性 reason_code 透传 + retryable=false"与"瞬时 stale 保留 retryable=true"的 failing→pass 回归测试。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step/feature 均空）+ PrepPRD；无显式值处留待定 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（本质是消除无限重试，retryable 判定即频控出口）
- 版本要求: 无
- 可观测: gate 拒绝必须携带真实 `reason_code`，禁止吞成 generic `mapper_stale`（本 sprint 核心可观测断言）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: step/journey_feature 级 DB invariant 均空；area 级 DB invariant 为 CI-infra 范畴（nightly-red/sparse-checkout），与 F1 diff-gate 不同 area，不注入；下列为本 gate 代码级 fail-closed 治理铁律 -->
- [fail-closed] Mapper 任何不可判定情形返回 blocked/impact_unknown，绝不假绿放行（来源: diff-gate 代码级治理原则）
- [不误杀] 只有携带确定性 reason_code 的结论才置 retryable=false；真·瞬时 stale 必须保留 retryable=true（来源: 本 sprint 边界铁律）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: journey e6f803f2 golden-paths 现存 ability 均为 planned 状态，无 done/working 已验收行为 -->
- （本 line 暂无已验收历史）

## E2E 验收

> Planner 初稿留占位，最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入。

```bash
# 占位：proposer 将填入真实脚本（local_api → node 单测 / curl localhost:5221）
# 期望验收点（自然语言）：
# 1) 构造 Mapper 返回 { freshness: { status:'stale', reason_code:'<确定性码>' } } →
#    evaluateDiffGate 返回 reason=该码、retryable=false（fail-closed，不空转）
# 2) 构造 Mapper 返回 { freshness: { status:'stale', reason_code:null } } →
#    仍返回 reason='mapper_stale'、retryable=true（瞬时可重试不被误杀）
# 3) 全链：本修复分支 publisher 出回执 → CI 全绿 → merge 成功
```

## journey_type: autonomous
## journey_type_reason: 变更落在 packages/brain/src/impact-contract（纯后端 harness 编码闸），无 UI/agent-bridge/engine 触点。
## target_environment: local_api
## target_environment_reason: payload 显式指定 local_api；被测为 Brain 内部 impact-contract 逻辑，本机 evaluator 跑单测 + curl localhost:5221 即可。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
