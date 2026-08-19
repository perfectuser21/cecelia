# Sprint PRD — Diff Impact Gate 透传 reason_code + 确定性结论 fail-closed 出口

## OKR 对齐

- **对应 KR**：KR-Cecelia基础稳固-KR1（系统稳定 — 连续24h不崩溃，自愈成功率≥90%，MTTR<30min）
- **当前进度**：82%（Objective「Cecelia 基础稳固」）
- **本次推进预期**：+1%（消除 kernel harness 确定性 deny 空转，恢复 harness 全链 fail-fast，提升自愈可信度）

## 背景

kernel harness（harness_runtime=kernel-v1）在 runs f62c7e87 / d1360a48 出现 `deny:impact:mapper_stale` 空转：
Diff Impact Gate 把**确定性** Map 结论（如 base_sha 冻结下永远不会自愈的 revision/digest 不一致、确定性 stale）
统一折叠成 `mapper_stale` 且 `retryable=true`，orchestrator 据此路由到 `infrastructure_blocked` →
每 90s 退避重试一次，直到 run deadline 才失败——本质是把"重试也不会变"的确定性结论当瞬态基础设施故障处理。
本 sprint（r20）在 judge deferred 白名单修复（1.273.89）打通 publish 后，验证该确定性→fail-closed 出口是否真正走通。

## Golden Path（核心场景）

系统从 [orchestrator 派发前调 Impact Gate] → 经过 [Gate 复算 Map 影响半径并判定结论确定性] → 到达 [确定性 deny 立即 fail-closed / 瞬态 stale 有限重试]

具体：
1. [触发] orchestrator 在 beforeGenerate/beforeEvaluate/beforeMerge 调 Impact Gate，Gate 调 Mapper 复算影响半径。
2. [系统处理·瞬态] Map 快照确实在刷新中（真瞬态 stale，下轮会变）→ 透传具体 reason_code（如 `mapper_stale` / `mapper_unavailable` / `db_unavailable`），`retryable=true`，交 kernel 有限重试。
3. [系统处理·确定性] Map 给出确定性结论（`revision_mismatch` / `manifest_digest_mismatch` / `projection_digest_mismatch` / `contract_missing` / 确定性 unknown——base_sha 冻结下重试不会改变）→ **原样透传该 reason_code，不折叠成 `mapper_stale`**，`retryable=false`。
4. [可观测出口·确定性] `gateVerdict = deny:impact:<确定性 reason_code>`（非 mapper_stale），`failure_class=impact_contract_invalid`，orchestrator 立即 `failRun('impact_gate_deterministic:<reason>')`，run/attempt 落 failed——**不进入 90s 退避重试，空转停止**。
5. [可观测出口·瞬态] 真瞬态 stale 仍保留 `retryable=true` 的有限重试语义（受 deadline + 同态 2 次上限约束）。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 diff-gate 返回结构 + api_registry 推导，Planner 不定义技术规范。 -->

## 边界情况

- Mapper 不可达 (`mapper_unavailable`) / DB 不可达 (`db_unavailable`)：属真瞬态 → `retryable=true`，不得被本次改动误判为确定性 fail-closed。
- 同一 reason_code 语义在 Gate 端（diff-gate.js）与 orchestrator 判定端（loop.js）必须一致，禁止两端语义分叉开假绿面。
- 连续同态 BLOCKED ≥2 次的既有兜底（blocked_same_state）不得被回退，作为二重保险保留。

## 范围限定

**在范围内**：
- Diff Impact Gate 对确定性 Map 结论的 reason_code 透传（不再折叠成 mapper_stale）。
- 确定性结论 `retryable=false` → orchestrator fail-closed 出口（immediate failRun）。
- 保留真瞬态 stale/unavailable 的有限重试语义。

**不在范围内**：
- Mapper 服务本身的 freshness 计算逻辑。
- 合同 drift 对账（CONTRACT_IMPACT_DRIFT / gap_dependencies）现有裁决路径。
- 90s 退避间隔、deadline 时长等 kernel 调度常量。

## 假设

- [ASSUMPTION: base_sha 冻结（frozen_baseline=true）场景下，revision/digest 不一致属确定性结论，重试不会自愈，应归 fail-closed。]
- [ASSUMPTION: 判定"确定性 vs 瞬态"以 Gate 返回的 reason_code 类别为准，不引入新的外部探测调用。]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`: 确定性 reason_code（revision/digest/确定性 stale）的 retryable 标记与透传，不再统一 mapper_stale+retryable。
- `packages/brain/src/orchestrator/loop.js`: gateVerdict 透传具体 reason_code + 确定性→fail-closed 出口路由（1410–1546 / 1656–1683 区）。
- `packages/brain/src/impact-contract/structure-gate.js`: 与 diff-gate 对齐的 mapper_stale/确定性区分（如适用）。
- `packages/brain/src/impact-contract/__tests__/*`、`packages/brain/src/orchestrator/__tests__/loop.test.js`、`packages/brain/src/__tests__/harness-judge.test.js`: 回归测试（含先写红的确定性→fail-closed 断言）。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step/feature 均空）+ PrepPRD（无 thin_prd），本 sprint 无显式 NFR 参数 -->
- 超时/延迟: 待定（decisions 与 PrepPRD 均未指定；沿用现有 run deadline）
- 重试有界: 确定性 deny 必须 0 重试（fail-closed）；瞬态重试受 deadline + 同态 2 次上限约束
- 可观测: 确定性 deny 的具体 reason_code 必须原样写入 intent.gateVerdict 与 run failure_reason

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级 88 条中注入 [系统] 核心铁律 + 与本 fix 直接相关的语义/fail-closed 学习条；capture-triage 学习噪音（无关本 sprint）未逐条注入 -->
- [语义一致] 同一语义（如 reason_code / git_sha=unknown）在判变端与终验端必须同一处理策略，跨脚本语义分叉会开假绿面（来源: area）
- [失败不降级] 失败路径禁止 warning 降级：显式 FAIL 变量 + 非零退出（fail-closed）（来源: area）
- [显式else] 调用"失败返回 null/false 表示失败"契约的函数，写完成功分支必须显式写 else 分支（来源: area）
- [status枚举排查] 涉及 status/reason 枚举的硬编码断言，GAN 新增枚举值时须全仓库排查（来源: area）
- [禁写死环境] 禁止写死环境假设值（来源: area·[系统]）
- [真环境验证] 真环境验证才算 done（来源: area·[系统]）
- [多租户默认] 测试默认多租户（来源: area·[系统]）
- [租户隔离] 记忆/数据按租户隔离（来源: area·[系统]）
- [凭据安全] 凭据不入库/不入日志（来源: area·[系统]）
- [日志脱敏] 日志脱敏（来源: area·[系统]）
- [端点鉴权] 端点鉴权（来源: area·[系统]）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；journey e6f803f2 当前仅含 planned ability，无 done/working -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填 curl+psql。

```bash
# 占位：proposer 将填入 local_api 真跑脚本（curl localhost:5221 + psql）
# 期望验收点（自然语言）：
# 1) 构造确定性 Map 结论（revision_mismatch / digest_mismatch / 确定性 stale）→ Impact Gate 返回该具体 reason_code 且 retryable=false（非 mapper_stale）。
# 2) orchestrator 对该确定性 deny 立即 failRun('impact_gate_deterministic:<reason>')，intent.gateVerdict = deny:impact:<具体reason>，run failed，无 90s 退避重试（空转停止）。
# 3) 构造真瞬态 stale/mapper_unavailable → 仍 retryable=true，保留有限重试语义（回归不破坏）。
```

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain 纯后端 harness 内核（impact gate + orchestrator），无 UI/agent 协议/engine 路径。
## target_environment: local_api
## target_environment_reason: payload 显式 target_environment=local_api；纯 Brain 内部，evaluator 本地 curl localhost:5221 + psql 验证。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
