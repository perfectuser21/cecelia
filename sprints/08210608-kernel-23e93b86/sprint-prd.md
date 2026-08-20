# Sprint PRD — Diff Impact Gate 透传 Mapper reason_code 并对确定性结论 fail-closed 出口（r19）

## OKR 对齐

- **对应 KR**：Harness 零人碰 merge（Impact Contract 闸门可判定性）
- **当前进度**：进行中（runs f62c7e87 / d1360a48 因 `deny:impact:mapper_stale` 空转卡死）
- **本次推进预期**：消除一类无限重试空转根因

## 背景

Diff Impact Gate（`packages/brain/src/impact-contract/diff-gate.js`）复算影响半径后，step 3a 把 Mapper **任何** `freshness.status !== 'fresh'` 一律折叠成 `reason: 'mapper_stale', retryable: true`。但 Mapper 的非 fresh 有两种本质不同的语义：`stale` 是瞬态过期（刷新后可恢复，应重试），`unknown` 是**确定性结论**（如 `capability_not_in_active_projection` / `impact_anchor_missing` / `unsafe_assertion_ref`，永远不会靠重试自愈）。两者被折叠成同一个可重试出口，导致确定性拒绝被当作瞬态无限重试 → `deny:impact:mapper_stale` 空转（issue_ref: runs f62c7e87/d1360a48）。fail-closed 原则要求确定性不可判定必须走终局出口，而非假装可重试。

## Golden Path（核心场景）

系统（orchestrator loop）从 [调用 Diff Impact Gate] → 经过 [Mapper 复算返回非 fresh] → 到达 [按语义分流的可判定出口]

具体：
1. Gate 收到 Mapper 复算结果，`freshness.status !== 'fresh'`。
2. 当 `freshness.status === 'unknown'`（Map 的确定性结论）：Gate **透传** `freshness.reason_code` 作为 `reason`，并以 **fail-closed 终局出口**返回 `retryable: false`（不再让 loop 无限 `deny:impact` 重试）。
3. 当 `freshness.status === 'stale'`（瞬态过期）：保留 `retryable: true`；`reason` 同样优先透传 `freshness.reason_code`，无 reason_code 时才回退默认标签。
4. 可观测结果：diff-evaluate 返回体 `{ gate:'impact_unknown', reason:<透传的 reason_code>, retryable:<按语义 true|false> }`；确定性结论下 `reason` 不再恒为字面 `'mapper_stale'`，orchestrator 据 `retryable:false` 终局收敛，空转消失。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不负责定义技术规范。 -->

## 边界情况

- Mapper 完全不可达（抛错）→ 维持既有 `mapper_unavailable, retryable:true`，不受本次改动影响。
- `freshness` 缺失或结构异常 → 仍 fail-closed，不得假绿。
- 结构闸 `structure-gate.js` rule 3 存在同构折叠；本 sprint 若同步涉及 status 枚举断言，须按 invariant 做一次全仓库硬编码 sweep（见 Invariant 段），避免另一处继续空转。

## 范围限定

**在范围内**：`diff-gate.js` step 3a 非 fresh 出口的 reason 透传 + retryable 按 `stale`/`unknown` 语义分流；对应回归测试。
**不在范围内**：Mapper（`map/radius.js`）reason_code 产出逻辑本身；worktree 清理 Permission denied / provider_exit 判定（r33 复盘中的 worker 侧问题，非本 Gate 范畴）。

## 假设

- [ASSUMPTION: Mapper `/map/radius` 已按 `freshness: { status:'fresh'|'stale'|'unknown', reason_code:string|null }` 契约产出确定性 reason_code（map-client.js 合同已校验，radius.test.js 已覆盖 unknown+reason_code）。]
- [ASSUMPTION: 确定性终局出口沿用 loop 侧既有 `retryable:false` 语义即可让 attempt 收敛，无需新增 loop 分支。]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`: step 3a 非 fresh 出口——透传 `freshness.reason_code`，按 `status` 分流 `retryable`。
- `packages/brain/src/impact-contract/__tests__/diff-gate.test.js`: 新增回归——`unknown`+reason_code → `retryable:false` 且 reason 透传；`stale` → `retryable:true`（永久保留作回归）。

## NFR 约束

<!-- 来源: decisions 表 category=nfr 双源均空；以下为 PrepPRD/fail-closed 原则显式约束 -->
- 可判定性: 确定性不可判定（`unknown`）必须走 fail-closed 终局出口，禁止折叠成可重试；瞬态（`stale`）方可 `retryable:true`。
- 可观测: 出口 `reason` 必须透传 Mapper `reason_code`，便于 loop/寄存器定位空转根因，禁止恒为 `'mapper_stale'`。
- 无限重试防护: 同一确定性结论不得产生无界 `deny:impact` 重试。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/journey_feature 级本 task 无挂载）；全量注入不裁剪，下列为直接治理本 sprint 的条目 -->
- [status 枚举 sweep] GAN 新增/改动 status 枚举（如 stale/unknown）时须做一次全仓库硬编码断言 sweep（来源: area）
- [验证命令真跑] 合同验证命令必须实跑确认 exit code 语义；vitest 对 include 范围外路径绿态也 exit 0，须落在 include 内路径（来源: area）
- [脚本会话独享] evaluator 临时脚本必须落会话独享路径（含 session id），禁止共享 /tmp 固定文件名（来源: area）
- [generator 重试身份] generator 基础设施重试须保持 retry identity 不裂变新单（来源: area）
- [Brain URL 权威] Fleet/Generator 一律以 Brain URL 为权威，不得旁路（来源: area）
- [planner 分支] planner 必须用服务端签发的 PLANNER_BRANCH，禁止自行 checkout 漂移（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无已验收历史；journey golden-paths 仅有 planned 态 ability，无 done/working）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 按 target_environment=local_api 填入（vitest 回归 + exit code 真跑校验）。

```bash
# 占位：proposer 将填入真实脚本（local_api → vitest 定向跑 diff-gate 回归，须落 include 范围内路径确保 exit code 真实）
# 期望验收点（自然语言）：
#   1. (Red) 基线上，注入 mapClient 返回 { freshness:{ status:'unknown', reason_code:'capability_not_in_active_projection' } } 时，
#      新回归断言 result.reason === 'capability_not_in_active_projection' && result.retryable === false 应先失败（当前恒为 mapper_stale/true）。
#   2. (Green) 改后：unknown → reason 透传该 reason_code 且 retryable:false；stale → retryable:true 且 reason 透传（或默认标签兜底）。
#   3. 既有 fail-closed 用例（mapper_unavailable / revision_mismatch）全绿不回退。
```

## journey_type: autonomous
## journey_type_reason: 纯 packages/brain/ 后端 Impact Contract 闸门逻辑，无 UI / 无远端 agent 协议。
## target_environment: local_api
## target_environment_reason: payload 显式 target_environment=local_api；改动仅 packages/brain/，本地 evaluator 跑 vitest + curl localhost:5221 即可验。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
