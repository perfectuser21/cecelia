# Sprint PRD — diagnostic 类人审批准后 derive 消费该批准并重试原动作（无出口人审死等根除）[r47]

## OKR 对齐

- **对应 KR**：KR「Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环」（当前 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（kernel harness 自治闭环去掉一处需人手工消费的死等）

## 背景

r40 hop174 / r41 hop55 实证（案卷 08b3b2b5、5bfc1af9）：diagnostic 类人审（由 `callback_runner_failure_exhausted`、`callback_semantic_refusal`、`callback_runner_failure_route_unknown` 等**非 merge_gate** 原因触发的 `wait:human_review`）在 Commander approve 后，只往决策日志写了一行 `verdict:human_review`（approved=true），但 `observed` 无对应字段被消费——`derive` 纯函数重判时 `latestUnconsumedAttemptResult` 仍把触发 review 的那次 callback 当「未消费」，于是 `attemptCallbackRoute` 再次命中，重新返回同一个 `wait:human_review`。批准对 derive 不可见 → 无出口人审死等，唯一解是 Commander 手工 append 一行消费记录。本 sprint 让批准被 ground-truth 观测消费，derive 自动回主链重试原动作。

## Golden Path（核心场景）

系统从 [diagnostic 人审挂起] → 经过 [Commander 批准 + ground-truth 观测消费] → 到达 [derive 回主链重试原动作]

具体：
1. [触发条件] run 因某次 attempt callback 判为 diagnostic 类失败（如 runner_failure 重试耗尽），derive 返回 `wait:human_review`，ground-truth 写入一条 open 的 `effect:human_review_requested`。
2. [系统处理] Commander 对该 open review request approve，写入 `verdict:human_review`（approved=true、review_class=diagnostic、review_request_hop 指向该请求、pr_head_sha 与请求快照一致）。
3. [系统处理] 下一跳 ground-truth 观测最新 open review request：若存在**同 review_request_hop 的 diagnostic 类 APPROVED verdict**，则视该 review 已消费（`open_human_review=false`），并把**触发该 review 的 callback hop** 记入 `latestUnconsumedAttemptResult` 消费所依据的 answered 集合（复用其消费语义）。
4. [可观测结果] `attemptCallbackRoute` 因该 callback hop 已被 answered 而返回 null，derive 越过 review 门回到主链，返回**重试原动作**（触发该 callback 的前序 dispatch/generator 动作，phase≠review），run 继续自治推进，无需人手工 append。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry / 决策日志契约推导；本 sprint 无新增 HTTP 端点。 -->

## 边界情况

- **merge_gate 类批准语义不变**：`review_class=merge_gate` 仍走既有 `mergeApproval`→`reviewApproved=true`→`merge_pr` 路径，diagnostic 消费逻辑不得改动 merge_gate 分支。
- **负向①（无批准仍 wait）**：open review request 存在但无对应 diagnostic APPROVED verdict → `open_human_review` 仍为 true，derive 仍返回 `wait:human_review`。
- **负向②（SHA 不符仍 wait）**：批准的 `pr_head_sha` 与 review request 快照的 head_sha 不一致 → 不消费，仍 `wait:human_review`（对齐 stale 批准不放行）。
- **hop 不匹配不消费**：APPROVED verdict 的 `review_request_hop` 不指向当前 open review request 的 hop → 不消费。
- 无 pr / candidate 场景与既有 diagnostic 挂起路径保持一致，消费只影响 answered 集合与 review 门可见性。

## 范围限定

**在范围内**：
- `packages/brain/src/orchestrator/ground-truth.js`：观测最新 open review request + diagnostic APPROVED 消费 → 输出 `open_human_review=false` 并把触发 callback hop 注入 answered 集合来源。
- `packages/brain/src/orchestrator/derive.js`：`latestUnconsumedAttemptResult` 的 answered 集合纳入「被 diagnostic 批准消费的 callback hop」，使 `attemptCallbackRoute` 越过已消费 callback，回主链重试原动作。
- `## Test Contract` 表登记本 sprint 全部冻结测试（RED→GREEN + 负向）。

**不在范围内**：
- merge_gate / evidence_repair / convergence 三类人审的既有消费语义（不改）。
- 新增 HTTP 端点、UI、Commander 侧审批入口改动。
- 改变 diagnostic 类的**触发**条件（何时进人审不变，只改批准后的**消费**）。

## 假设

- [ASSUMPTION: diagnostic 类 APPROVED verdict 由 Commander 写入时带齐 `approved=true`、`review_class=diagnostic`、`review_request_hop`、`pr_head_sha` 四字段；缺字段视为不消费（保守 wait）。]
- [ASSUMPTION: 「触发 review 的 callback hop」= 该 review request 请求快照锚定 / 其之前最近一条导致 diagnostic 挂起的 `attempt:callback` 行的 hop；由 proposer 在合同阶段与 `latestUnconsumedAttemptResult` 现有消费语义对齐确认。]
- [ASSUMPTION: F1 scope 无 active map manifest（MAP_MANIFEST_NOT_FOUND），scope 锚定沿用 payload.anchor 的 gp/step/journey id。]

## 预期受影响文件

- `packages/brain/src/orchestrator/ground-truth.js`: 增加 open review request 观测 + diagnostic 批准消费，输出 `open_human_review` 与 answered callback hop 来源。
- `packages/brain/src/orchestrator/derive.js`: `latestUnconsumedAttemptResult` answered 集合纳入被消费的 callback hop，使 diagnostic 批准后回主链。
- `tests/gp/f1/step3-diagnostic-review-approval-consumed.test.js`（新增冻结测试）: RED 复现批准后仍 wait，GREEN 后 derive 返回重试动作 + 两条负向断言。

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（node 跑纯 derive/ground-truth 冻结测试 + 必要时 curl localhost:5221 观察 run 不再停在 diagnostic wait）。

```bash
# 占位：proposer 将填入 local_api 脚本
# 期望验收点（自然语言）：
#  1. RED — 构造「diagnostic wait:human_review + 同 hop diagnostic APPROVED verdict」的决策日志，
#     修复前 derive(observed) 仍返回 action=wait:human_review（复现死等）。
#  2. GREEN — 修复后 ground-truth 输出 open_human_review=false，derive 返回 phase≠review 的重试原动作
#     （前序 dispatch/generator 动作），run 回主链自治推进。
#  3. 负向 — 无 APPROVED / pr_head_sha 不符两种输入下，derive 仍返回 wait:human_review。
#  4. merge_gate 回归 — merge_gate 类批准仍走 reviewApproved→merge_pr，未被 diagnostic 分支污染。
```

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step+feature 双源均返回空）；PrepPRD 未显式指定 -->
- 超时/延迟: 待定（PrepPRD 未指定；derive 为纯函数，无 I/O 延迟约束）
- 频控: 待定（无外呼）
- 版本要求: 无
- 可观测: 批准消费与「回主链重试原动作」必须在 orchestrator 决策日志留痕（复用现有 hop/行语义，不新增静默旁路）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant（step/journey_feature/area 三源查询：step/journey 为空；area 一条为多账号凭据隔离，与本 sprint 无关）。以下为本 sprint 合同锚定的 kernel 铁律，proposer 须落为对抗断言 -->
- [merge_gate 不变] diagnostic 批准消费不得改变 merge_gate 类 `reviewApproved→merge_pr` 语义（来源: 本 task 合同）
- [批准不可见即死等禁止] diagnostic 批准必须能被 derive 纯函数经 observed 消费，禁止依赖 Commander 手工 append 消费行（来源: 本 task 合同 / r40 hop174 案卷）
- [SHA 锚定] 批准 pr_head_sha 与 review request 快照不符者不得放行（stale 批准不消费）（来源: 本 task 合同）
- [INV-K3] 不确定原因（needs_context/unknown）默认归人审，不误判为产品代码失败（来源: derive.js code invariant）
- [INV-K4] no-progress 后禁止对相同 (run_id, failure_class, trigger_sha, role) 再派 generator-fix（来源: derive.js code invariant）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path（GET /journeys/:id/golden-paths 返回空数组） -->
- （本 line 暂无历史）

## journey_type: autonomous
## journey_type_reason: 仅改 packages/brain/ 内 kernel 纯函数 derive/ground-truth，无 UI / 无远端 agent 协议，属自治后端状态机。
## target_environment: local_api
## target_environment_reason: 纯 Brain kernel 逻辑，冻结测试在本地 node 跑，必要时 curl localhost:5221 观察 run，无需远端机器。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
