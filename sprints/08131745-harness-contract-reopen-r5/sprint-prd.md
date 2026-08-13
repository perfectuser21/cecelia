# Sprint PRD — Harness 合同重开后批准证据原子换版（r5）

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：+1%（修复 Harness GAN 合同重开死锁，恢复自主闭环）

## 背景

生产 run `88a78d20` 在 `reopen_gan_contract` 后 `initiative_run.contract_id` 仍指向 v1 draft
合同（`44f40935` status=draft/version=1）。Round 2 Reviewer（attempt `525749d5`）APPROVED 了新
SHA `39033f38…`/新分支/新 artifacts 后，`materializeApprovedContract` 走「已附着合同」证据比对分支，
把旧 v1 draft 当成同轮批准证据，在 hop31 抛
`kernel_process_fatal: attached approved contract evidence mismatch`，Generator 从未启动，run 卡死。

根因：`reopen_gan_contract` 的附着动作与 `materializeApprovedContract` 未共用同一状态机语义——
旧 draft 附件让 run 提前进入「已有批准合同」路径，反而阻断了本轮新证据的原子换版。

## Golden Path（核心场景）

系统从 [reopen 后带 v1 draft 附件] → 经过 [Round 2 批准新证据、原子换版 v2] → 到达 [run.contract_id 指向 v2、Generator 启动]

具体：
1. [触发条件] `initiative_run` 已 `reopen_gan_contract` 且 `contract_id` 指向 v1 draft 合同；
   Round 2 Reviewer APPROVED 一份**新** SHA/branch/artifacts。
2. [系统处理] `materializeApprovedContract` 识别附着合同为 draft（非同轮批准证据），
   在单事务内**原子**：插入并批准 v2（携新证据）→ 将 v1 置 `superseded` → 把
   `run.contract_id` 切到 v2。draft 附件不再让 run 终态化。
3. [可观测结果] DB 中存在 v2 approved 合同、v1=superseded、`run.contract_id=v2.id`；
   Generator 得以按 v2 冻结基线启动。

**幂等重放**：以相同 v2 证据（SHA/branch/content/seal 全一致）再次调用，返回同一 v2 合同，不新建版本、不再 supersede。

**fail-closed 保持**：若附着合同**已是 approved**（非 draft）且新证据 SHA/branch/content/seal 任一不一致，仍抛 `attached approved contract evidence mismatch`，禁止静默换版。

## 边界情况

- 附着合同为 v1 **draft** + 新证据 → 原子换版 v2（本刀核心，当前会误抛 mismatch）。
- 附着合同为 v2 **approved** + 完全相同证据 → 幂等返回同一合同。
- 附着合同为 approved + 证据任一字段（sha/branch/prd_content/contract_content/seal）不一致 → fail-closed 抛错。
- 并发两次 Round 2 批准同一 run → 事务串行化后仅产生一个 v2，另一次幂等命中。
- run 无 `contract_id`（首轮）→ 保持既有插入路径不回归。

## 范围限定

**在范围内**：
- `packages/brain/src/orchestrator/contract-store.js` 的 `materializeApprovedContract` 状态机修复。
- `reopen_gan_contract` 持久化动作与 `materializeApprovedContract` 的语义对齐（draft 附件不阻断换版）。
- 真实 PostgreSQL RED→GREEN integration 回归测试，永久保留在 CI。

**不在范围内**：
- r4 Round 2 已批准合同的落实（GP journey-only identity、四类 legacy relay ownership、
  Controller lease CAS 续租、AI Evaluator 人类式验收、Judge 独立裁决、xian/headed 远端 relay
  续租存活证据核验）——本刀 GREEN 后由本任务**重新派发/创建继任任务**继续，不在本 sprint 代码改动内。

## 假设

- [ASSUMPTION: `initiative_contracts` 已有 `superseded` 状态枚举与 `(initiative_id, version)` 唯一约束（现有 supersede CTE 已依赖）。]
- [ASSUMPTION: 「同轮批准证据」判定依据为附着合同 `status`：draft=可原子换版，approved=证据须逐字段匹配否则 fail-closed；幂等键为现有 evidence_matches 比对字段。]

## 预期受影响文件

- `packages/brain/src/orchestrator/contract-store.js`: `materializeApprovedContract` 已附着合同分支改为按 draft/approved 分流，draft 走原子换版。
- `packages/brain/src/orchestrator/__tests__/contract-store.test.js`: 新增真实 PG RED 用例（reopen v1 draft + Round2 新证据 → 期望原子换版 v2，当前复现 mismatch）。
- `packages/brain/src/orchestrator/loop.js`: 如 reopen 附着与 materialize 需共用状态机语义，对齐 `materializeApprovedContractOrFail` 调用点（仅在必要时）。

## NFR 约束

<!-- 来源: decisions 表 category=nfr 为空（未配置）；以下为 thin_prd 显式产品法律 -->
- 原子性: 插入 v2 + supersede v1 + 切 run.contract_id 必须在**单事务**内完成，任一失败整体回滚。
- 幂等性: 相同 v2 证据重放返回同一合同，不产生新版本、不重复 supersede。
- fail-closed: 附着 approved 合同证据不一致必须抛错，禁止静默换版（安全红线）。
- 可观测: 换版/supersede/幂等命中路径必须可从 DB 状态断言（v2.status / v1.status / run.contract_id）。
- 测试口径: 必须真实 PostgreSQL integration，先 RED 后 GREEN；vitest include 范围需覆盖新用例（避免范围外绿态假通过）。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step/journey_feature 源为空（本 bugfix 未锚定 journey）；area 源仅 capture-triage 学习条目，无适用本刀的硬铁律 -->
- （本 line 暂无适用铁律；本刀自身确立的红线见 ## NFR 约束 的 fail-closed 与原子性两条）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；本任务 payload 无 journey_id，无法拉取累积 FR -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留空占位。最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（真实 PG + node vitest）。

```bash
# 占位：proposer 将填入 local_api 脚本（真实 PostgreSQL integration + vitest）。期望验收点：
#  1. RED：test DB 造 run.contract_id→v1 draft，调 materializeApprovedContract 传 Round2 新证据，修复前复现 mismatch。
#  2. GREEN：修复后返回 v2 approved；psql 断言 v2.status=approved、v1.status=superseded、run.contract_id=v2.id。
#  3. 幂等：相同 v2 证据重放返回同一 contract.id，版本数不增。
#  4. fail-closed：附着 approved 合同 + 篡改 sha/branch/content/seal 任一 → 仍抛 mismatch。
```

## journey_type: autonomous
## journey_type_reason: 改动落在 packages/brain/ 纯后端合同状态机，无 UI/agent 协议/engine 参与。
## target_environment: local_api
## target_environment_reason: 纯 Brain 后端 + 真实 PostgreSQL integration，本地 evaluator 用 vitest + psql（localhost:5221 / test DB）验证。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
