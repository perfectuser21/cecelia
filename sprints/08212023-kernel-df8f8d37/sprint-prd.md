# Sprint PRD — Diff Impact Gate 透传 reason_code 并 fail-closed 出口（终结 mapper_stale 空转）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（消除一个把算力锁死在无限重试里的确定性空转坑）

## 背景

runs f62c7e87 / d1360a48 观测到 `deny:impact:mapper_stale` 无限重试空转。根因：Diff Impact Gate（`packages/brain/src/impact-contract/diff-gate.js` 步骤 3a）在 Mapper 返回 `freshness.status !== 'fresh'` 时，把**所有**非 fresh 结论一律折叠成硬编码 `reason: 'mapper_stale'` + `retryable: true`，丢弃了 Mapper 自己给出的确定性 `freshness.reason_code`。于是 `gateReceipt`（`reason: result.reason ?? result.reason_code`）永远只看到裸 `mapper_stale`，而一个**确定性、永远不会靠重试变 fresh** 的 Map 结论被当作可重试瞬时态，kernel 反复重跑同一 gate，任务空转不落地。

## Golden Path（核心场景）

系统（kernel impact gate）从 [对某 task 复算影响半径] → 经过 [Mapper 返回确定性非 fresh 结论] → 到达 [gate 透传真实 reason_code 且 fail-closed 落终态，不再空转]

具体：
1. [触发条件] kernel 在某 task 的 impact gate 阶段调用 `evaluateDiffGate`；Mapper 返回 `freshness.status !== 'fresh'` 且携带一个确定性 `freshness.reason_code`（表示该结论非瞬时、重试不会转 fresh）。
2. [系统处理] gate 不再把非 fresh 一律折叠成通用 `mapper_stale`：把 `mapperResult.freshness.reason_code` 透传到 gate 结果的 `reason_code` 字段；并依据该 reason_code 是否为确定性（终态）结论决定 `retryable`——确定性结论 → `retryable: false`（fail-closed 终态 deny）；仅当 reason_code 缺失或表示真正瞬时 staleness → 保留 `retryable: true`。
3. [可观测结果] `gateReceipt.reason` 展示真实 Map reason_code（不再是裸 `mapper_stale`）；确定性场景下 `receipt.retryable === false`，kernel 停止 `deny:impact:mapper_stale` 空转，task 落 blocked 终态而非无限重试。

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- `freshness.reason_code` 为 `null`/缺失：退回瞬时语义，`retryable: true`，保持旧行为，禁止把可刷新 staleness 也 fail-closed 卡死。
- Mapper 完全不可达（catch 分支 `mapper_unavailable`）：仍 `retryable: true`，本 sprint 不改该分支。
- `freshness.status` 为 `'unknown'` vs `'stale'`：确定性判定以 reason_code 为准，不得仅凭 status 字面拍板。

## 范围限定

**在范围内**：`diff-gate.js` 步骤 3a 的 `mapper_stale` 出口——透传 `freshness.reason_code` + 依确定性判 `retryable`；验证 `harness-gates.js` 的 `gateReceipt` 已能透传该 `reason_code`（若未透传则一并修）。
**不在范围内**：`mapper_unavailable` / `revision_mismatch` / `*_digest_mismatch` 等其它 `impact_unknown` 出口；Map 服务端 freshness 计算逻辑；kernel 重试调度器本身；merge 阶段 revalidation。

## 假设

- [ASSUMPTION: Map `/api/brain/map/radius` 返回的 `freshness.reason_code` 对确定性结论为非 null 稳定字符串，瞬时 staleness 为 null 或特定瞬时码；确定性判定的具体 reason_code 名单由 Proposer 依 map-client 契约与 Map 服务端实现在合同阶段锚定]
- [ASSUMPTION: kernel 消费 `retryable: false` 的 `impact_unknown` 会将 task 落 blocked 终态、不再入队重试]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`：步骤 3a `mapper_stale` 出口透传 `reason_code` + fail-closed（`retryable` 依确定性判定）
- `packages/brain/src/impact-contract/__tests__/diff-gate.test.js`：新增回归——确定性结论→`retryable:false`+真实 reason_code；瞬时/缺失→`retryable:true`
- `packages/brain/src/impact-contract/harness-gates.js`（验证/必要时修）：`gateReceipt` reason_code 透传路径

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step+feature 双源均空），PrepPRD 未显式给值 -->
- 超时/延迟: 待定（PrepPRD 未指定；沿用 map-client 既有 timeout）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 无
- 可观测: gate 落终态/透传 reason_code 的判定必须可从 gateReceipt.reason 观测（不得吞成裸 mapper_stale）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/journey_feature 两源为空）；下列为与本 scope 直接相关者，其余 area 级 capture-triage learnings 为通用工程学习不逐条注入 -->
- [status枚举] GAN 新增/变更 status 枚举值（如 'stale'）时须全仓库 grep status 硬编码断言同步（来源: area）
- [语义一致] 同一语义（如 mapper_stale/reason_code）在判变端与终验端必须同一处理策略，跨脚本语义分叉会开假绿面（来源: area）
- [失败不降级] 失败路径禁止 warning 降级，必须显式 FAIL + 非零退出（fail-closed 精神）（来源: area）
- [显式else] 调用"失败返回 null/false"契约的函数，写完成功分支必须显式 else 兜底（来源: area）
- [kernel时钟] Kernel 复用既有 PR 时采用 evaluator 校验时钟（来源: area）
- [系统] 真环境验证才算 done（来源: area）
- [系统] 单 slot 串行任务，并行只许跨 slot（来源: area）
- [系统] 测试默认多租户 / 租户隔离（来源: area）
- [系统] 端点鉴权（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；本 journey 无 done/working ability -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（curl localhost:5221 + node 单测）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本
# 期望验收点（自然语言）：
# 1. 单测：构造 freshness={status:'stale',reason_code:<确定性码>} 的 Mapper 桩，
#    evaluateDiffGate 返回 gate=impact_unknown、reason_code=<确定性码>、retryable=false（不再裸 mapper_stale）。
# 2. 单测：freshness={status:'stale',reason_code:null} → retryable=true（瞬时语义保留）。
# 3. gateReceipt(result) 的 reason 字段展示真实 reason_code，确定性场景 retryable=false。
```

## journey_type: autonomous
## journey_type_reason: 纯 packages/brain 后端 kernel gate 逻辑，无 apps/dashboard UI、无 agent 协议、无 engine hooks。
## target_environment: local_api
## target_environment_reason: kernel gate 单测 + curl localhost:5221 本地 evaluator 验证；payload.target_environment 显式为 local_api。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
