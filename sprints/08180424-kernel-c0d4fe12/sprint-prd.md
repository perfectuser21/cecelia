# Sprint PRD — Diff Impact Gate 透传 reason_code + 确定性 stale 结论 fail-closed 出口（r19）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（消除 harness impact 门禁的无限重试空转，保证算力不被坏 run 空烧）

## 背景

Diff Impact Gate（`packages/brain/src/impact-contract/diff-gate.js` 的 `evaluateDiffGate`）在 Mapper 复算影响半径后，
只要 `freshness.status !== 'fresh'` 就一律折叠成 `reason: 'mapper_stale', retryable: true`，
丢弃 Mapper 自己给出的 `freshness.reason_code`。

当 Mapper 给出的是**确定性结论**（`freshness.status === 'stale'` 且带 reason_code，即"地图已知过期、盲目重试不会自愈"）时，
`retryable: true` 让上游把它当瞬时抖动无限重试 → 实测 runs `f62c7e87` / `d1360a48` 出现 `deny:impact:mapper_stale` 空转。
本 sprint 让 Gate 透传 reason_code，并对确定性 stale 结论给一个 fail-closed（`retryable: false`）终态出口，让坏 run 被 block 而不是空烧算力。

## Golden Path（核心场景）

系统从 [Gate 调用 Mapper] → 经过 [按 freshness 结论分流] → 到达 [透传 reason_code + 确定性结论终止]

具体：
1. `evaluateDiffGate` 拿到 active contract，调用 Mapper 复算影响半径，得到 `freshness = { status, reason_code }`。
2. `freshness.status === 'fresh'`：行为不变，进入既有对账/裁决（pass/extend/drift）。
3. `freshness.status === 'stale'`（确定性结论）：Gate 返回 `gate: 'impact_unknown'`，
   **`reason_code` 透传** Mapper 的 `freshness.reason_code`（不再压成通用 `mapper_stale`），
   且 **`retryable: false`**（fail-closed 终态出口，上游据此 block 任务，不再无限重试）。
4. `freshness.status === 'unknown'`（不可判定/瞬时）：仍返回 `reason: 'mapper_stale'`、`retryable: true`（保留可重试语义），
   但也把 `reason_code`（若有）透传到结果里。
5. 可观测出口：runs `f62c7e87` / `d1360a48` 这类确定性 stale 场景不再空转；Gate 结果携带 Mapper 的 `reason_code`，
   确定性 stale run 走向 blocked 终态，而非无限 retry。

## 边界情况

- `freshness.status === 'stale'` 但 `reason_code` 缺失（null）：仍走 fail-closed 终态（`retryable: false`），reason_code 透传为 null，不得回退成无限重试。
- `freshness.status === 'unknown'`：必须保持 `retryable: true`——这是真正的瞬时/不可判定态，误判成终态会把可自愈的 run 冤杀。
- Mapper 抛异常 / DB 不可达 / revision 不对齐等既有 impact_unknown 分支：行为不变，不在本 sprint 范围。

## 范围限定

**在范围内**：`evaluateDiffGate` 步骤 3a（freshness 校验分支）的 reason_code 透传 + 确定性 stale 的 fail-closed（`retryable: false`）出口；对应回归测试。
**不在范围内**：Mapper（map-client / map/radius 路由）本身、上游 orchestrator 的 block/重试计数逻辑、revision/digest mismatch 分支、drift/extend 裁决逻辑。

## 假设

- [ASSUMPTION: `freshness.status === 'stale'` 语义为"确定性结论（盲目重试不会自愈）"，`'unknown'` 为"不可判定/瞬时"——据 map-client.js 合同（`['fresh','stale','unknown']`）推断。]
- [ASSUMPTION: 上游消费 Gate 结果的 `retryable` 字段决定是否重试；`retryable: false` 即 fail-closed 终态 block，无需本 sprint 改上游。]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`：步骤 3a freshness 分支——透传 `reason_code` + 确定性 stale fail-closed 出口。
- `packages/brain/src/impact-contract/__tests__/diff-gate.test.js`：新增复现 bug 的 failing test（确定性 stale → retryable:false + reason_code 透传；unknown → 仍 retryable:true）作为回归。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（本 task/ability/journey 均返回空），PrepPRD 未显式指定 -->
- 超时/延迟: 待定（PrepPRD 未指定，Gate 为进程内纯函数，无网络 NFR）
- 频控: 无
- 版本要求: 无
- 可观测: 确定性 stale 终止时结果须携带 Mapper 的 `reason_code`，供上游日志/审计归因（避免 `deny:impact:mapper_stale` 无 reason 的黑盒空转）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: impact-contract 子系统契约（diff-gate.js 顶注 fail-closed 原则）；Brain decisions API 对本 ability(step/feature) 返回空，area 级仅有与本 scope 无关的 nightly-red 文案铁律，已按相关性排除 -->
- [fail-closed] Mapper 任何不可判定情形均返回 blocked/impact_unknown，绝不假绿（来源: 子系统契约）
- [不冤杀瞬时态] `freshness.status === 'unknown'` 必须保留 `retryable: true`，只有确定性结论才可 fail-closed 终止（来源: 本 sprint 边界铁律）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；journey e6f803f2 现存 ability 均为 planned 态，无 done/working 历史 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（node 单测 / curl+psql）。

```bash
# 占位：proposer 将填入真实脚本（local_api → node --test / vitest 直接跑 diff-gate.test.js）
# 期望验收点（自然语言）：
#   1) 构造 Mapper 返回 freshness={status:'stale', reason_code:'<X>'} → evaluateDiffGate 结果
#      gate='impact_unknown' 且 reason_code==='<X>'（透传）且 retryable===false（fail-closed 终态）。
#   2) 构造 freshness={status:'unknown'} → 结果 retryable===true（瞬时态仍可重试，未被误杀）。
#   3) 全量回归 diff-gate.test.js 既有 fresh/drift/extend/mapper 异常用例全绿。
```

## journey_type: autonomous
## journey_type_reason: 改动仅落在 packages/brain/ 纯后端 impact-contract 门禁逻辑，无 UI/agent 协议/engine 参与。
## target_environment: local_api
## target_environment_reason: payload 显式指定 local_api；evaluateDiffGate 为 Brain 进程内纯函数，本机 node 单测 + curl localhost:5221 即可验收。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
