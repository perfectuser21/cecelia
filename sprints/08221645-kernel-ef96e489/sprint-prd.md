# Sprint PRD — diagnostic 类人审批准后 derive 消费该批准并重试原动作

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（根除 harness kernel 一类"无出口人审死等"，提升自治收敛可信度）

## 背景

r48：本任务第 2 跑。r47（run 6abf8fba）死于 seal 拒绝逃逸成 process-fatal，#5021（1.273.120）已修（seal 拒绝→reopen GAN，Test Contract 解析器支持分号）。

真正要修的功能缺陷（r40 hop174/177 实证案卷 `08b3b2b5`）：diagnostic 类人审（由 `callback_runner_failure_exhausted` 等**非 merge_gate 原因**触发）在人工 approve 后，只写了一条 `verdict:human_review` 日志行；但 `derive` 纯函数的观测（observed）里没有对应字段反映"该批准已被消费"。`latestUnconsumedAttemptResult` 的 `answeredCallbackHops` 消费集合只认 `context_answer` / `reopen_gan_contract` 两类动作，不认 diagnostic 人审批准——于是触发人审的原 callback 永远算"未消费"，derive 重判仍返回 `wait:human_review` → 无出口人审死等。

## Golden Path（核心场景）

系统从 [diagnostic 人审被批准] → 经过 [ground-truth 观测消费该批准 + 记消费集合] → 到达 [derive 回主链重试原动作，不再死等]。

具体：

1. [触发条件] 某 hop 因非 merge_gate 原因（如 `callback_runner_failure_exhausted`）写下 `effect:human_review_requested`，人工审批写下一条 diagnostic 类 `verdict:human_review` 且 verdict=APPROVED，其 `review_request_hop` 指向该请求 hop，且 `pr_head_sha` 与请求记录的 head_sha 一致。
2. [系统处理] ground-truth 观测层（`loadRunDeadlineState`）识别"最新 open review request 存在对应 hop 的 diagnostic 类 APPROVED verdict 且 SHA 相符"，则该 review 视为已消费 → `open_human_review=false`；同时把触发该 review 的 callback hop 记入消费集合（复用 `latestUnconsumedAttemptResult` 语义），使该 callback 不再被判为未消费。
3. [可观测结果] `derive` 纯函数重判时，原触发 callback 已被消费 → 不再返回 `wait:human_review`，而是回主链重试原动作（继续 generate/evaluate/主链推进）；run 走出死等继续收敛。

## 边界情况

- **无批准**：存在 open review request 但没有对应 hop 的 APPROVED diagnostic verdict → 仍 `open_human_review=true`，derive 仍 `wait:human_review`（不得误放行）。
- **SHA 不符**：存在 APPROVED diagnostic verdict 但其 `pr_head_sha` 与请求记录的 head_sha 不一致 → 视为未消费，仍 `wait:human_review`。
- **merge_gate 类批准**：merge_gate 原因触发的人审，其批准语义**保持不变**（本次改动不得影响 merge 门的人审消费路径）。
- **多请求并存**：只对"最新 open review request"做消费判定，历史已消费请求不回滚。

## 范围限定

**在范围内**：
- `loadRunDeadlineState` 观测层：diagnostic 类 APPROVED 判定 → `open_human_review=false` + 记消费集合。
- `derive` / `latestUnconsumedAttemptResult` 消费语义：diagnostic 人审批准使原触发 callback hop 计入 answered/consumed 集合，回主链重试原动作。
- 冻结回归测试 + 合同 `## Test Contract` 表登记。

**不在范围内**：
- merge_gate 类人审的现有语义（保持逐字节不变）。
- seal 拒绝→reopen GAN 路径（#5021 已修，不重做）。
- 人审 UI / 通知 / dispatcher 派发路径。
- 其他 failure_class 的路由规则。

## 假设

- [ASSUMPTION: diagnostic 类与 merge_gate 类的区分依据为触发 review 的原因（`review_reason` / callback failure_class 非 merge_gate），具体判定键由 proposer 读代码 SSOT 确认]
- [ASSUMPTION: 冻结纪律遵守——run 在途期间 Commander 不合任何 PR，本 sprint 仅产出 PRD 与合同，不触碰其它 open PR]
- [ASSUMPTION: 消费信号以 `review_request_hop` + `pr_head_sha` 双重锚定，与既有 SQL NOT EXISTS 契约一致]

## 预期受影响文件

- `packages/brain/src/orchestrator/loop.js`：`loadRunDeadlineState` — diagnostic 类 APPROVED verdict + SHA 相符时 `open_human_review=false`，并暴露被消费的 callback hop。
- `packages/brain/src/orchestrator/derive.js`：`latestUnconsumedAttemptResult` / `attemptCallbackRoute` — 把 diagnostic 人审批准纳入消费集合，回主链重试原动作；merge_gate 语义不变。
- `packages/brain/src/__tests__/`（新增冻结测试文件）：登记 B-01/B-02/B-03/B-04 全部冻结断言。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step + feature 双源均为空）+ PrepPRD -->
- 超时/延迟: 待定（PrepPRD 未指定；derive 为纯函数，无 I/O 延迟约束）
- 频控: 无
- 版本要求: harness_runtime=kernel-v1
- 可观测: 人审消费与放行/驳回判定必须留痕于 `orchestrator_decision_log`（沿用现有决策日志，不新增静默分支）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step(空) + journey_feature(空) + area 三源合并去重；仅注入 kernel/harness 相关铁律 -->
- [merge_gate 语义不变] merge_gate 类人审批准的消费语义本次禁止改动（来源: task 描述铁律）
- [冻结纪律] run 在途期间 Commander 不合任何 PR（来源: task 描述铁律）
- [负向不放行] 无对应 APPROVED 或 SHA 不符时禁止误判为已消费（来源: task 描述铁律）
- [planner_role_branch] planner 只在服务端签发的 PLANNER_BRANCH 上工作，禁止自行 checkout/switch（来源: area）
- [kernel_pr_validation_clock] Kernel 对既有 PR 采用 evaluator validation clock（来源: area）
- [generator_retry_identity] generator 基础设施重试保持身份一致性（来源: area）
- [fleet_brain_url_authority] Fleet Generator 以 Brain URL 为权威（来源: area）
- <!-- 另有约 15 条 area 级 [capture-triage] learning 类 invariant 与本 kernel 人审消费改动无直接关联，未逐条注入 -->

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: journey e6f803f2 已完成 ability 的 golden_path；journeys/:id/golden-paths 返回空 -->
- （本 line 暂无已登记 golden_path 历史；相邻已修行为见背景：#5021 seal 拒绝→reopen GAN、Test Contract 解析器支持分号，本 sprint 不得回退）

## E2E 验收

> 本 sprint target_environment=local_api，验收为 kernel 纯函数 + 观测层单元测试（jest）。Planner 初稿留占位；可执行 E2E 脚本由 proposer 在 GAN 阶段填入，并在合同 `## Test Contract` 表登记全部冻结测试（BEHAVIOR 单元格多值用 / 或分号分隔均可）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（jest 单测 + 可选 curl localhost:5221/psql 观测层校验）
# 期望验收点（自然语言）：
#   B-01 diagnostic 人审 APPROVED（hop 匹配 + SHA 相符）→ open_human_review=false，触发 callback 计入消费集合，derive 回主链重试原动作（不再 wait:human_review）
#   B-02 无对应 diagnostic APPROVED verdict → open_human_review=true，derive 仍 wait:human_review
#   B-03 APPROVED 但 pr_head_sha 与请求不符 → 视为未消费，derive 仍 wait:human_review
#   B-04 merge_gate 类人审批准语义不变（现有消费/放行路径逐字节等价，零回归）
```

## journey_type: autonomous
## journey_type_reason: 改动落在 packages/brain/src/orchestrator/（kernel derive/loop 纯后端），无 UI/agent 协议/engine 介入。
## target_environment: local_api
## target_environment_reason: payload 显式指定 local_api；验收为本地 evaluator 跑 jest 纯函数单测 + curl localhost:5221/psql 观测校验。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
