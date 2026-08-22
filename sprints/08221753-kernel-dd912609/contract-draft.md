# Sprint Contract Draft (Round 1)

**Sprint**: diagnostic 类人审批准后 derive 消费该批准并重试原动作（无出口人审死等根除）[r49]
**journey_type**: autonomous
**target_environment**: local_api（postgres=false → 纯 derive/ground-truth 纯函数 vitest 重放；无 psql/无 curl）

## 锚定父路声明

独立小路（无父路）—— 本 sprint 是 harness kernel derive 纯函数路由的独立修复，不覆盖任何业务 Golden Path。

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

<!-- cecelia 仓库根目录无 product-map/generated/product-map.json，本段整体跳过，不阻塞。 -->

## Response Schema（推导来源: PRD 字面）

N/A — 任务无 HTTP 响应。本 sprint 全在 `packages/brain/src/orchestrator/` 纯函数（`derive` / `ground-truth`）内改动，无新增/变更 HTTP 端点。验收 oracle 为 `derive(observed)` 纯函数返回值（vitest 断言），非 curl 响应体。

## 已知约束（来自回归测试）

- [回归] `packages/brain/src/orchestrator/__tests__/derive.test.js` → `runner failure retries bounded（首次重派，第 3 次进人审，不再一刀终态）`：runner_failure ≤2 有界重派，第 3 次 exhausted → `wait:human_review` reason=`callback_runner_failure_exhausted`。本 sprint 在 exhausted 之后新增「批准消费」出口，**不得改动** exhausted 阈值本身。
- [回归] `derive.test.js` → `approval unlocks exactly one unsigned evidence repair` / evidence_repair 类 `verdict:human_review` 批准消费语义（`review_class:'evidence_repair'`）：本 sprint 的 diagnostic 消费与之同构但独立，不得破坏 evidence_repair 既有路径。
- [回归] `derive.test.js` → `human_review_rejected`（`currentHumanReviewRejection`）：REJECTED 批准锚定 `pr_head_sha` → mark_failed。本 sprint 只处理 APPROVED，不动 REJECTED。
- [回归] `ground-truth.js` `mergeApproval`/`reviewApproved`：`review_class === 'merge_gate'` + `detail.pr_head_sha === pr.head_sha` + 请求锚定。本 sprint **不得改动**该分支（Invariant [merge_gate 语义不变]）。
- [累积FR] 本 line 暂无历史（context-manifest: 无 done/working ability）。

## Golden Path

[diagnostic 人审被批准] → [ground-truth 观测消费该批准] → [derive 回主链重试原动作，脱离死等]

---

### Step 1: 非 merge_gate 原因触发 diagnostic 类 `wait:human_review`
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 步 + 「背景」（r40 hop174/177）

**可观测行为**: 某 callback（如 evaluator `runner_failure` 连续 3 次 exhausted，非 merge_gate 原因）令 `derive` 输出 `{phase:'review', action:'wait:human_review', reason:'callback_runner_failure_exhausted'}`；系统随后发起 diagnostic 类 `effect:human_review_requested`，其 detail 记录触发它的 callback hop（`callback_hop`）与 `review_reason`，observed 锚定当前 `pr.head_sha`。

**验证命令**（无批准态，负向 A）:
```bash
# 冻结测试内「无批准」用例：exhausted 后无 verdict:human_review → 仍 wait:human_review
npx vitest run sprints/08221753-kernel-dd912609/tests/diagnostic-human-review-consume.test.js \
  -t '无批准 diagnostic review 无对应 APPROVED verdict'
# 期望：exit 0（该 it 通过：action === wait:human_review, reason === callback_runner_failure_exhausted）
```

**硬阈值**: 无对应 APPROVED verdict 时 `derive().action === 'wait:human_review'`（不误放行）。

---

### Step 2: 人在该 open review request 上 approve
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 步

**可观测行为**: 决策日志新增一行 `verdict:human_review`，`detail.approved===true`、`detail.review_class !== 'merge_gate'`（diagnostic）、`detail.review_request_hop` 指向该 `effect:human_review_requested` 行、`detail.pr_head_sha` 锚定请求时的 `pr.head_sha`。

**验证命令**（stale 锚定，负向 B）:
```bash
# 批准 pr_head_sha 与请求不符（陈旧批准）→ 不消费，仍 wait
npx vitest run sprints/08221753-kernel-dd912609/tests/diagnostic-human-review-consume.test.js \
  -t 'stale 批准 pr_head_sha 与请求不符'
# 期望：exit 0（该 it 通过：action === wait:human_review）
```

**硬阈值**: `approval.pr_head_sha !== request.pr_head_sha` → `derive().action === 'wait:human_review'`（陈旧批准不消费）。

---

### Step 3: ground-truth 观测消费该批准（open_human_review=false + 触发 callback hop 入消费集合）
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 步 + 「范围限定·在范围内」

**可观测行为**: ground-truth 观测最新 open review request：若存在**对应 hop** 的 diagnostic 类 APPROVED verdict 且 `pr_head_sha` 与请求一致 → 该 review 视为已消费（`open_human_review=false`），并把**触发该 review 的 callback hop** 记入消费集合（复用 `latestUnconsumedAttemptResult` 的 `answeredCallbackHops` 语义）。

**验证命令**: 由 Step 4 的正向消费 + 重试用例覆盖（消费判定只依赖 decision log + observed，纯函数决定论重放）。

**硬阈值**: diagnostic APPROVED（hop/sha 双匹配）→ 触发 callback hop 进消费集合，`latestUnconsumedAttemptResult` 跳过该 hop。

---

### Step 4: `derive` 纯函数重判 → 回主链重试原动作（脱离死等）
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4-5 步 + 「假设」第 2 条

**可观测行为**: 触发 callback hop 已被消费 + review 已消费 → `attemptCallbackRoute` 不再命中该 callback（返回 null）→ `derive` 沿原动作（原 callback 触发的那个动作，evaluator role → `evaluate` 相位）前进，输出 **不是** `wait:human_review`。run 脱离人审死等，回主链继续推进。**不引入新 action 枚举**。

**验证命令**（正向消费 + 重试，本轮 RED 驱动）:
```bash
# 正向：diagnostic 批准（hop+sha 匹配）→ 消费并回主链重试原动作，绝不再 wait:human_review
npx vitest run sprints/08221753-kernel-dd912609/tests/diagnostic-human-review-consume.test.js \
  -t 'diagnostic 人审批准后 derive 消费该批准并重试原动作'
# 期望：exit 0（action !== wait:human_review 且 phase === evaluate）
# 现状（修复前）：该 it FAIL（derive 仍返回 wait:human_review）→ 这是本轮 TDD RED
```

**硬阈值**: diagnostic APPROVED（hop/sha 双匹配）→ `derive().action !== 'wait:human_review'` 且 `derive().phase === 'evaluate'`（回主链重试原 evaluator 动作）。

---

### Step 5（Invariant 守恒）: merge_gate 类批准语义完全不变
**来源**: `[FROM_PRD]` — PRD「边界情况·merge_gate 类批准」+ Invariant [merge_gate 语义不变]

**可观测行为**: `review_class === 'merge_gate'` 的批准不触发 diagnostic 消费分支（它仍由 `ground-truth.js` 的 `reviewApproved`/`mergeGate` 路径处理）；把一条 merge_gate 类批准喂给 diagnostic 场景，callback 仍未被消费 → `derive` 仍 `wait:human_review`。

**验证命令**:
```bash
# merge_gate 类批准不触发 diagnostic 消费 → 语义不变仍 wait
npx vitest run sprints/08221753-kernel-dd912609/tests/diagnostic-human-review-consume.test.js \
  -t 'merge_gate 类批准不触发 diagnostic 消费'
# 期望：exit 0（action === wait:human_review）
# 且 repo 既有 derive 全套（含 merge_gate/evidence_repair/rejected 用例）保持全绿
```

**硬阈值**: merge_gate 类批准喂入 diagnostic callback 场景 → `derive().action === 'wait:human_review'`；`packages/brain/src/orchestrator/__tests__/derive.test.js` 全绿零回归。

---

## 禁 mock 边清单

本单改动涉及**状态机/路由**（`derive` 的 attemptCallback 消费判定）与**观测层**（`ground-truth` 的 diagnostic 批准消费观测），属「禁 mock 被改的边」范畴：

- `derive` ↔ decision log 路由：冻结测试必须喂**真实 decisionLog 行**给**真实 `derive` 纯函数**，断言真实返回值——禁止 `vi.mock('../derive.js')` 或 stub `attemptCallbackRoute`/`latestUnconsumedAttemptResult`。（本 sprint 冻结测试即真调 `derive(observed)`，零 mock）
- `ground-truth` ↔ decision log 观测：若补充 ground-truth 层测试，必须用注入的 fake `pool` 返回**真实形状的 decision_log 行**（对齐 `ground-truth.test.js` 既有 fakePool 写法），断言真实 `collectGroundTruth` 输出的 `open_human_review`/消费集合——禁止 mock `collectGroundTruth` 本身。

> 说明：本 sprint runtime_resources.postgres=false，无真 Postgres；ground-truth 观测的验证以 fakePool 注入真实行为准（`collectGroundTruth` 是纯投影函数，pool 是唯一 I/O 边界，注入 fake pool 不违反「禁 mock 被改的边」——被改的是投影逻辑，不是 pool）。核心 derive 消费/重试路由为纯函数，零 I/O，直接真调。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | | diagnostic 类（非 merge_gate）人审批准后，ground-truth 观测消费该批准（open_human_review=false + 触发 callback hop 入消费集合），derive 回主链重试原动作，根除无出口人审死等 |
| **NFR（做得多好）** | | derive 纯函数、零 I/O、同一 decisionLog 决定论重放；消费判定只依赖 decision log + observed，无隐式副作用（PRD NFR） |
| **Invariant（永不违反）** | | ① merge_gate 类人审消费语义不变；② 冻结纪律 run 在途不合 PR；③ SHA 锚定 stale 批准不放行；④ merge 仅由 mergeGate 放行 |
| **判定点（怎么知道）** | | 见下方登记表 |
| **保质期（何时过期）** | | 批准锚定 `pr_head_sha`；head_sha 变化后旧批准即过期（stale 不消费），无独立 TTL |
| **死亡告警（停了谁知道）** | | N/A（本改动是「消除死等」的出口路由，非新增长驻能力；退化表现为 run 回到人审死等，由 harness run 收敛率指标可见） |
| **失败语义（挂了怎么办）** | | 保守失败=拦截：任一锚定条件不满足（无批准/hop 不符/sha 不符/merge_gate 类）→ 保持 `wait:human_review`，绝不误放行（宁可死等也不错误消费） |
| **效果确认（已发≠已生效）** | | 消费生效的确认=`derive().action !== 'wait:human_review'` 且回到原动作相位；由冻结测试正向用例机检 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| ⚠️ 一条 diagnostic 人审是否「已被批准且应被消费」 | A. 存在 `verdict:human_review` 行且 approved=true; B. A + `review_class !== merge_gate` + `review_request_hop` 命中对应 request + `pr_head_sha` 与请求一致（双锚定） | B（双锚定：class 分流 + hop 匹配 + sha 匹配） | 单看 approved 会误消费 stale 批准 / 误吞 merge_gate 语义（PRD 边界情况明确要求两条负向仍 wait） | 误消费 → 未经有效批准就自动重试原动作（绕过人审）= 自动化错误；漏消费 → 回到无出口死等（退回 bug 现状，不面客错误） |

> merge_gate 类判定点不在本表（本 sprint 不改其语义）。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| （示例：Brain API 超时） | 返回 503，不写入 DB | 是（幂等键=task_id） | 客户端重试，Brain 端 dedup |
| 无对应 diagnostic APPROVED verdict | 保持 `wait:human_review` | 是（纯函数决定论） | 继续等待人审 |
| 批准 `pr_head_sha` 与请求不符（stale） | 保持 `wait:human_review` | 是 | 继续等待针对当前 head_sha 的新批准 |
| 批准 `review_class === merge_gate` | 不触发 diagnostic 消费，语义交回 mergeGate 路径 | 是 | 既有 merge_gate 路径处理 |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本改动全在 harness kernel 内部纯函数，无对外暴露 agent / 无外部用户可写入接口。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认；纯函数改动，风险面收敛）
高风险面:
- 错输入: decisionLog 中 `verdict:human_review` 行缺 `review_request_hop` 或 `callback_hop`（null/字符串/负数）→ 消费判定必须 fail-closed 到 wait，不得抛异常/不得误消费
- 重复提交: 同一 diagnostic request 出现多条 APPROVED verdict（重复批准）→ 只消费一次，幂等，仍回主链重试原动作（不重复放大）
- 中途中断: 批准后 head_sha 又推进（新 callback 产生）→ 旧批准对新 head_sha 视为 stale，不误消费
- 边界值: exhausted 边界（正好第 2 次 vs 第 3 次 runner_failure）与 diagnostic 消费叠加时，不得越过 exhausted 阈值误判
发现分级: P0/P1（误消费导致绕过人审 / 破坏 merge_gate 语义 / derive 抛异常）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

## E2E 验收

```bash
#!/bin/bash
set -euo pipefail
# target_environment=local_api，本 sprint postgres=false：oracle 为 derive 纯函数 vitest 重放，无 psql/curl。
# late-bound identity：本脚本不写任何 attempt_id/capability UUID 字面值；纯函数重放无需运行时身份注入。
cd "${WORKSPACE_PATH:-/workspace}"

FROZEN="sprints/08221753-kernel-dd912609/tests/diagnostic-human-review-consume.test.js"

# 1. 冻结回归测试全绿（正向消费+重试 + 两条负向 wait + merge_gate 不变量）——sprints/** 从仓库根跑（根 vitest.config include 覆盖）
npx vitest run "$FROZEN" --reporter=basic

# 2. 语义守恒：repo 既有 derive 全套零回归（含 merge_gate / evidence_repair / rejected / runner_failure 有界重派）
#    死规则：packages/<pkg>/src/** 的 vitest 必须用子 shell 切进包根，用该包自己的 vitest.config
( cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/derive.test.js )

# 3. 观测层零回归：ground-truth 投影既有用例（diagnostic 消费观测新增后不得破坏既有 reviewApproved/mergeGate 观测）
( cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/ground-truth.test.js )

echo "✅ diagnostic 人审消费 Golden Path 验证通过（正向消费重试 + 双负向 wait + merge_gate 守恒 + 零回归）"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| diagnostic 批准消费+重试原动作 | `sprints/08221753-kernel-dd912609/tests/diagnostic-human-review-consume.test.js` | 消费该批准并重试原动作 / 无批准 diagnostic review 无对应 APPROVED verdict / stale 批准 pr_head_sha 与请求不符 / merge_gate 类批准不触发 diagnostic 消费 | 正向 it FAIL（现状 derive 仍返回 wait:human_review）→ 1 failed / 3 passed |
| 语义守恒（repo 既有 derive 套件，补充行） | `packages/brain/src/orchestrator/__tests__/derive.test.js` | runner failure retries bounded / approval unlocks exactly one unsigned evidence repair | 全绿（零回归守卫，非本轮红源） |
