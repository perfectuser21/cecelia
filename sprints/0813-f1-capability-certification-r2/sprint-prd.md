# Sprint PRD — F1 Capability 认证闭环：冻结 GP Contract identity 贯穿 Evaluator Receipt 与 Mapper

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环，当前 82%）
- **当前进度**：F1 可信认证闭环首轮（Run 3f722048 / PR #4855）失败，冻结 fixture 违反 migration 409、多 GP 串绑未解
- **本次推进预期**：+2%（重建 F1 从合同阶段起的可信认证闭环）

## 背景

首轮 Run 3f722048、PR #4855 已证明：产品 bootstrap 的既有 brain-integration 绿，但冻结 Sprint fixture 违反 migration 409；且实现按 Journey「最新 signed GP」推断身份，多 GP 场景会串绑（认证盖到错误 GP 上）。根因是 Task 阶段冻结的 GP Contract identity（gp_contract_id/version/hash）没有显式贯穿到 Evaluator Receipt 写入与 Mapper 判绿，writer/mapper 各自凭 Journey 猜测。本 sprint 从合同阶段重建闭环，禁止新增平行认证系统，复用现有表/API。

## Golden Path（核心场景）

系统从 [Task 冻结 GP identity] → 经过 [dispatcher/evaluator 携带 → writer 精确落 receipt → mapper 精确判绿] → 到达 [同 SHA 可信认证闭环，多 GP 不串绑]

具体：
1. Task payload 冻结 `gp_contract_id`/`gp_contract_version`/`gp_contract_hash`；dispatcher 与 evaluator 组装 task_bundle 时把这三项 identity 显式带入（不丢弃、不由下游重猜）。
2. Evaluator 产出 PASS/FIXED receipt 后，`persistTrustedEvaluatorReceipts` 从 task_bundle 显式读取冻结 GP identity，**精确验证并落库**到 `journey_assertion_receipts`；identity 缺失或与冻结值不一致 → fail-closed 抛错，禁止按 Journey 猜「最新 signed GP」。
3. Mapper（`packages/brain/src/map/state-resolver.js`）判某节点 green，必须同时满足：当前 SHA 匹配 + 当前 Impact Contract 匹配 + 精确 GP Contract 匹配 + receipt 为真实非 synthetic 的 PASS + 该节点全部 step links / Feature 子节点齐备；任一不满足不得 green。
4. 出口可观测：真实 Evaluator→Judge→PR merge→receipt→Mapper 同 SHA 走通，多 GP 并存时认证只落到冻结的那一个 GP，不串绑。

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- 冻结 GP identity 缺字段 / 与 receipt SHA 或 Impact Contract 不一致 → writer fail-closed 拒绝，不落半条。
- 同一 Journey 存在多个 signed GP → 认证必须精确命中冻结的 gp_contract_id，禁止落到「最新」那个。
- receipt 为 synthetic（executor_kind 非真实 runner / synthetic=true）→ Mapper 不得判 green。
- 首轮冻结 Sprint fixture 违反 migration 409（harness_gap_ledger）→ 修复 fixture 使其满足外键与约束。

## 范围限定

**在范围内**：
- 修复首轮冻结 fixture，使真 PostgreSQL fixture 完整播种外键链 `tasks → initiative_runs → harness_impact_contracts → harness_attempts → journey_assertion_receipts`。
- 冻结 GP Contract identity 显式贯穿 dispatcher/evaluator task_bundle → `persistTrustedEvaluatorReceipts` → mapper 判绿。
- writer 精确验证并落 GP identity；mapper 五重 green 判据（SHA/Impact Contract/GP Contract/非 synthetic PASS/子节点齐备）。
- TDD：先留 RED 日志再转 GREEN；CI 最短 smoke 进 PR，完整 fail-closed matrix 进 nightly。

**不在范围内**：
- 新增任何平行认证系统或新表（必须复用现有表/API）。
- Journey/GP 签发流程本身、UI/Dashboard 呈现。
- 非 F1 认证闭环外的 harness 节点改造。

## 假设

- [ASSUMPTION: 冻结 GP identity 三字段承载在 task_bundle.inputs.impact_gate 同层（复用现有 impact_gate.contract_id/contract_hash 邻位），具体载体键名由 Proposer 读 api_registry/task-bundle schema 后锁定。]
- [ASSUMPTION: 首轮 fixture 位于本 sprint_dir 或 packages/brain 测试 fixtures 下，违反的是 migration 409 harness_gap_ledger 的外键/约束。]
- [ASSUMPTION: step_id 未由 PrepPRD 显式锚定，按 none 处理。]

## 预期受影响文件

- `packages/brain/src/impact-contract/assertion-receipts.js`：`persistTrustedEvaluatorReceipts` 增加冻结 GP identity 的显式读取、精确校验与落库，去除按 Journey 猜最新 signed GP。
- `packages/brain/src/routes/harness-callback.js`：evaluator 回调组装 task_bundle 时透传冻结 GP identity。
- `packages/brain/src/map/state-resolver.js`：`getReceiptForNode`/判绿逻辑补 Impact Contract + 精确 GP Contract + 非 synthetic + 子节点齐备四重判据。
- `packages/brain/src/impact-contract/__tests__/assertion-receipts.test.js`：新增冻结 identity 精确校验 + 串绑防护的 RED→GREEN 测试。
- 真 PostgreSQL 集成 fixture（`packages/brain/src/__tests__/integration/` 下，播种五级外键链），修复违反 migration 409 的冻结 fixture。

## NFR 约束

<!-- 来源: decisions 表 category=nfr 为空；以下取自 PrepPRD 显式约束 -->
- 认证真相形态: 真 PostgreSQL fixture 播种完整外键链，禁止 mock/synthetic 冒充 PASS
- TDD 证据: 必须实际留存 RED 日志（Red→Green 时序进证据窗口前列）
- fail-closed: identity 缺失/不一致默认拒绝，不落半条 receipt
- CI 分层: 最短 smoke 进 PR required；完整 fail-closed matrix 进 nightly
- 复用约束: 禁止新增平行认证系统/新表，复用现有表与 API

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant / area 级 capture-triage learnings（择直接相关项注入；area 池另有 ~12 条通用学习未逐条列出） -->
- [validation-clock] 保留 validation_clock_required 默认 fail-closed；仅 gear=hotfix 且 payload 显式 pr_url/pr_head_sha 与 GitHub 实时观测完全一致时可建一次共享 clock，缺失/不一致一律拒绝（来源: area）
- [local_api-判绿] judge 机械闸⑤(meta_verification_gap) 对 local_api/无 UI smoke 会死锁：本类任务须在合同预先声明「验证真相形态」或对闸⑤放行（来源: area）
- [台账隔离] controller 台账 .harness/progress.md 必须保持在 git 追踪之外，否则随 sprint PR 污染 repo（来源: area）
- [证据窗口] evaluator .brain-result.json 须把一手证据（root-cause、Red→Green 时序、exit_code）排进 judge 消费窗口(前 8 条×600 字符)前列（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 journey 已完成 ability 的 golden_path；当前 journey 仅有 planned 态 ability，无 done/working 历史 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留空，最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl localhost:5221 + psql）。

```bash
# 占位：proposer 将填入真实脚本（local_api → curl + psql）
# 期望验收点（自然语言）：
# 1) 真 PostgreSQL fixture 播种 tasks→initiative_runs→harness_impact_contracts→harness_attempts→journey_assertion_receipts 五级外键链成功，不违反 migration 409。
# 2) persistTrustedEvaluatorReceipts 在冻结 GP identity 与 receipt SHA/Impact Contract 一致时落库；构造「Journey 存在更新 signed GP」场景，验证认证仍精确落到冻结的 gp_contract_id（不串绑）；identity 不全时 fail-closed 抛错。
# 3) state-resolver 对「当前 SHA + 当前 Impact Contract + 精确 GP + 非 synthetic PASS + 子节点齐备」判 green；缺任一（旧 SHA / synthetic / 缺子节点 / 错 GP）判非 green。
# 4) RED 日志留存证据存在（先红后绿时序可查）。
```

## journey_type: autonomous
## journey_type_reason: 改动集中在 packages/brain（receipt writer + mapper + fixture），纯后端认证闭环，无 UI/agent 协议参与。
## target_environment: local_api
## target_environment_reason: payload 显式提供 local_api，本地 evaluator 用 curl localhost:5221 + psql 验证 Brain 内部认证闭环。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
