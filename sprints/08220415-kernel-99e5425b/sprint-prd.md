# Sprint PRD — Diff Impact Gate reason_code 透传 + 确定性码 fail-closed 出口

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（progress 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（消除 mapper_stale 无限重试空转，恢复 F1 造完真验 merge fence 直通）

## 背景

r42（1.273.99-113 十六批机制修复已上线）后，runs f62c7e87 / d1360a48 仍死于 Diff Impact Gate：
`evaluateDiffGate` 步骤 3a 把 Mapper 的**任意** freshness 非 fresh 情形一律折叠成裸 `mapper_stale` + `retryable: true`。
确定性结论（如 revision 不匹配、无锚点、resolver_error）本应 fail-closed 停机，却被当成瞬时可重试 → run 空转直到耗尽。
本 sprint 让 3a 透传 Mapper `freshness.reason_code`，按确定性/瞬时分流 `retryable`，并让 `gateReceipt` deny 标签带上具体 reason_code。
**冻结纪律**：run 在途 Commander 绝不合任何 PR；base_sha 冻结不变。

## Golden Path（核心场景）

系统（Diff Impact Gate）从 [Mapper 返回非 fresh freshness] → 经过 [reason_code 分流] → 到达 [带归因的 gate 裁决 + receipt]

具体：
1. `evaluateDiffGate` 步骤 3a 检测到 `mapperResult.freshness.status !== 'fresh'`（或 freshness 缺失）
2. 系统读取 `mapperResult.freshness.reason_code` 并写入 gate 结果的 `reason_code` 字段：
   - **确定性 reason_code**（白名单外的任何具体码，如 `no_anchor` / `revision_mismatch` / `fail_current_revision` / `resolver_error`）→ gate 结果 `retryable: false`（fail-closed 出口，停止无限重试）
   - **瞬时白名单码**（`fact_snapshot_stale` / `projection_revision_missing`）或 `reason_code == null`（含 freshness 缺失）→ 保留 `retryable: true`
3. 可观测结果：gate 结果携带具体 `reason_code`（不再裸 `mapper_stale`）；`gateReceipt` 透传该 reason_code，`deny` 标签 = 具体 reason_code
4. 出口：Commander 拿到带归因 receipt，确定性码走 fail-closed 不再空转；fence approve 后一次 merge

## 边界情况

- `mapperResult.freshness` 缺失（null）→ `reason_code = null` → `retryable: true`（保守当作瞬时，与 task 约定一致）
- 白名单外未知 reason_code → 归为确定性 → `retryable: false`（默认 fail-closed，宁停勿空转）
- `freshness.status === 'fresh'` → 不进 3a，进入既有 3b revision 对账，行为不变

## 范围限定

**在范围内**：
- `diff-gate.js` 步骤 3a 出口：透传 `freshness.reason_code` + 按确定性/瞬时白名单分流 `retryable`
- `harness-gates.js` `gateReceipt`：确保 diff gate `deny` 标签用具体 reason_code，不再裸 `mapper_stale`

**不在范围内**：
- `structure-gate.js` 的 `mapper_stale`（本 sprint 只改 diff gate 3a）
- Mapper / `state-resolver.js` 本身的 reason_code 生成逻辑
- 3b revision mismatch / manifest_digest / projection_digest 等其他出口

## 假设

- [ASSUMPTION: 瞬时白名单固定为 `fact_snapshot_stale` 与 `projection_revision_missing` 两码 + `null`，其余 reason_code 均视为确定性 fail-closed]
- [ASSUMPTION: `gateReceipt` 现有 `reason: result.reason ?? result.reason_code` 逻辑可复用，3a 结果把具体码写入 `reason_code`（或 `reason`）即可让 deny 标签归因]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`: 3a 分支透传 reason_code + retryable 分流（fail-closed）
- `packages/brain/src/impact-contract/harness-gates.js`: gateReceipt 确认 deny 标签透传具体 reason_code
- `packages/brain/src/impact-contract/__tests__/`: 新增复现 mapper_stale 无限重试的 failing test（回归保留）

## NFR 约束

<!-- 来源: decisions 表 category=nfr（空）+ task 描述显式约束，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 确定性 reason_code 必须 `retryable: false`，杜绝无限重试空转（本 sprint 核心 NFR）
- 版本要求: 无
- 可观测: gate 结果与 gateReceipt 必须携带具体 reason_code，`deny` 标签可归因（禁止裸 `mapper_stale`）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step(空) + journey_feature(空) + area 三源合并去重；仅列 harness/kernel 域相关铁律 -->
- [fail-closed] Mapper 任何不可判定情形均返回 blocked/impact_unknown，绝不假绿（来源: diff-gate.js 模块契约）
- [已有PR时钟] validation_clock_required 默认 fail-closed；仅 gear=hotfix 且 payload pr_url/pr_head_sha 与 GitHub 实时观测完全一致才建共享时钟（来源: area）
- [基础设施重试身份] Generator 基础设施失败必须重试原始服务端派发动作，禁止静态映射漂移（来源: area）
- [Planner分支] Planner workspace 必须停在服务端签发的 planner_branch，Provider 可校验但不得 checkout/switch（来源: area）
- [Brain URL 权威] Dispatcher 与 Fleet Worker 必须注入服务端权威 HARNESS_BRAIN_URL，预检 fail-closed，禁手工绕过（来源: area）
<!-- 另有多条 area 级 capture-triage learning 铁律（多账号授权隔离/nightly-red 文案/sparse-checkout 守卫等），与本 diff-gate sprint 无直接约束关系，略 -->

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；本 journey 现有 ability 均为 planned 状态，无 done/working -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留占位。最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（jest 单测 + curl localhost:5221）。

```bash
# 占位：proposer 将填入真实脚本（local_api → jest + curl+psql）
# 期望验收点（自然语言）：
# 1. 确定性 reason_code（如 revision_mismatch/resolver_error）输入 → evaluateDiffGate 返回 retryable=false 且 reason_code 为该具体码（非裸 mapper_stale）
# 2. 瞬时白名单码（fact_snapshot_stale/projection_revision_missing）与 null → 返回 retryable=true
# 3. gateReceipt 对上述 diff gate 结果的 deny 标签透传具体 reason_code，不出现裸 mapper_stale
# 4. 修复前该行为的 failing test 转红→转绿，并永久留在 CI 作回归
```

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain/ 纯后端 harness Diff Impact Gate 逻辑，无 UI / agent 协议 / engine
## target_environment: local_api
## target_environment_reason: Brain 内部裁决逻辑，evaluator 在本地跑 jest 单测 + curl localhost:5221 验证（payload 亦显式 target_environment=local_api）
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
