# Sprint PRD — diagnostic 类人审批准后 derive 消费该批准并重试原动作（无出口人审死等根除）[r49]

## OKR 对齐

- **对应 KR**：KR-Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（当前 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（根除 harness kernel 一类无出口人审死等，提升 run 收敛可信度）

## 背景

r40 hop174/177 实证：diagnostic 类人审（由 `callback_runner_failure_exhausted`、`callback_semantic_refusal` 等**非 merge_gate 原因**触发的 `wait:human_review`）被人 approve 后，系统只写了一行 `verdict:human_review` 日志，`observed` 里没有任何字段承载"这条 diagnostic 审已批准"。纯函数 `derive` 重放时读不到消费信号 → 仍旧计算出 `wait:human_review` → run 卡在人审死等、无出口。

r48 死于 seal 拒绝被 reviewer 重审死循环（#5022 已修 1.273.121）。本轮为同任务第 3 跑，聚焦 diagnostic 人审消费这一根因。

## Golden Path（核心场景）

系统从 [diagnostic 人审被批准] → 经过 [ground-truth 观测消费该批准] → 到达 [derive 回主链重试原动作，脱离死等]

具体：
1. 某 callback（如 `callback_runner_failure_exhausted`，非 merge_gate 原因）令 `derive` 输出 `wait:human_review`，系统发起 diagnostic 类 `human_review_requested`（记录触发它的 callback hop）
2. 人在该 open review request 上 approve，写入 `verdict:human_review` 行（review_class ≠ merge_gate，携带 `review_request_hop` 与 `pr_head_sha`）
3. ground-truth 观测最新 open review request：若存在**对应 hop** 的 diagnostic 类 APPROVED verdict 且 `pr_head_sha` 与请求一致 → 该 review 视为已消费（`open_human_review=false`），并把**触发该 review 的 callback hop** 记入消费集合（复用 `latestUnconsumedAttemptResult` 语义）
4. `derive` 纯函数重判：触发 callback hop 已被消费 + review 已消费 → 不再输出 `wait:human_review`，改为回主链重试原动作（原 callback 触发的那个动作）
5. 出口：run 脱离人审死等，回到主链继续推进

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- **无批准**：open review request 无对应 diagnostic APPROVED verdict → 仍 `wait:human_review`（不误放行）
- **stale 批准**：批准的 `pr_head_sha` 与请求 `pr_head_sha` 不符 → 仍 `wait:human_review`（陈旧批准不消费）
- **merge_gate 类批准**：review_class = merge_gate 的批准语义完全不变，仍走既有 `reviewApproved`/`mergeGate` 路径，不受本次改动影响

## 范围限定

**在范围内**：
- ground-truth 层对 diagnostic 类 APPROVED verdict 的消费观测（open_human_review=false + 触发 callback hop 记入消费集合）
- derive 主链：diagnostic 人审批准后回退到原动作重试的路由
- 冻结回归测试（正向消费 + 两条负向 wait）

**不在范围内**：
- merge_gate 类人审的任何语义变更
- 人审 UI / 通知 / Bark 副作用
- 新增人审触发原因

## 假设

- [ASSUMPTION: diagnostic 类批准以 `verdict:human_review` 行 + `review_class≠merge_gate` + `review_request_hop` + `pr_head_sha` 表达，与既有 merge_gate 批准同构，只是 review_class 不同]
- [ASSUMPTION: "重试原动作" = 触发 callback hop 记入消费集合后，derive 沿 `latestUnconsumedAttemptResult` 的下一个可路由动作前进，不引入新 action 枚举]

## 预期受影响文件

- `packages/brain/src/orchestrator/ground-truth.js`：观测 diagnostic 类 APPROVED verdict → 计算消费（open_human_review=false + 触发 callback hop 入消费集合）
- `packages/brain/src/orchestrator/derive.js`：`latestUnconsumedAttemptResult` / attemptCallback 路由消费语义扩展，批准后回主链重试原动作
- `packages/brain/src/orchestrator/loop.js`：`loadRunDeadlineState` 的 `open_human_review` 计算纳入 diagnostic 消费判定（如需）
- `packages/brain/src/orchestrator/__tests__/derive.test.js`：冻结回归测试（正向 + 负向）

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step/feature 均空），PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 无
- 可观测: derive 必须为纯函数、零 I/O，同一 decisionLog 决定论重放；消费判定只依赖 decision log + observed，不做隐式副作用

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature 均空；area 源 + task 合同显式铁律 -->
- [merge_gate 语义不变] merge_gate 类人审批准的消费语义（ground-truth.js reviewApproved / mergeGate）本 sprint 不得改动（来源: task 合同）
- [冻结纪律] run 在途 Commander 不合任何 PR（来源: task 合同）
- [SHA 锚定] 人审批准必须锚定当前 pr_head_sha，stale 批准不放行（来源: task 合同）
- [唯一 merge 权威] merge 仅由 mergeGate 放行（来源: 代码 F6）
- [凭据隔离] 多人协作禁止混用授权凭据——操作他人账号资源须用其本人授权（来源: area）
- [nightly-red 文案] 连续 ≥3 晚同一 job 红时，issue 贴失败 step 最后 20 行原始 stdout，不贴 PowerShell 截断输出（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无历史）<!-- journey golden-paths 仅有 status=planned 的 ability，无 done/working -->

## E2E 验收

> Planner 初稿此区块留空占位。**最终可执行的 E2E 脚本由 proposer 在 GAN 阶段产出**（target_environment=local_api → node --test 单测重放 + 必要时 curl localhost:5221 / psql 观测）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本
# 期望验收点（自然语言）：
#  1. 正向：构造 decisionLog 含 diagnostic human_review_requested + 对应 hop 的 APPROVED verdict(pr_head_sha 匹配)
#     → derive 返回"重试原动作"（非 wait:human_review），open_human_review 观测为 false
#  2. 负向A：无对应 APPROVED verdict → derive 仍返回 wait:human_review
#  3. 负向B：APPROVED 的 pr_head_sha 与请求不符 → derive 仍返回 wait:human_review
#  4. 语义守恒：merge_gate 类批准的既有测试全绿，路由未变
# 执行：node --test packages/brain/src/orchestrator/__tests__/derive.test.js
```

## journey_type: autonomous
## journey_type_reason: 改动全在 packages/brain/src/orchestrator/（Brain 后端 harness kernel 纯函数），无 UI / 无远端 agent 协议
## target_environment: local_api
## target_environment_reason: payload 显式 target_environment=local_api；本地 evaluator 走 node --test + curl localhost:5221 / psql 观测 Brain 内部状态
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
