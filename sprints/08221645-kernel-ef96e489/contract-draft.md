# Sprint Contract Draft (Round 1) — diagnostic 类人审批准后 derive 消费该批准并重试原动作

**journey_type**: autonomous
**target_environment**: local_api（本 sprint 为 kernel 纯函数状态机修复；因 runtime_resources.postgres=false，验收以真 `derive` 纯函数 vitest 为主，DB 观测层改动登记进「未覆盖真实链路清单」由 brain-integration CI 真 Postgres 覆盖）

contract-gate: present (cecelia worktree, packages/brain/src/lib/contract-gate.js 存在，走代码层 Contract Gate)
gp-anchor: skipped (product-map.json not found)

---

## 锚定父路声明

独立小路（无父路） —— 本 sprint 修复 harness kernel `derive` 状态机的一类「无出口人审死等」，不推进任何业务 Golden Path。

---

## Response Schema（推导来源: PRD 字面）

N/A — 任务无 HTTP 响应。本 sprint 改动落在 `packages/brain/src/orchestrator/derive.js`（纯函数状态机）与 `packages/brain/src/orchestrator/loop.js`（`loadRunDeadlineState` DB 观测层），无新增/修改任何 HTTP 端点、无 response body。可观测契约是 `derive(observed)` 的返回路由对象 `{phase, action, reason}`。

---

## Golden Path

覆盖父路 独立小路（无父路）。

[diagnostic 人审被 APPROVED] → [derive 观测消费该批准 + 记消费集合] → [derive 回主链重试原动作，不再 wait:human_review]

### Step 1: diagnostic 类人审被人工 APPROVED（触发条件已具备）
**来源**: `[FROM_PRD]` — PRD 第 21 行「某 hop 因非 merge_gate 原因（如 callback_runner_failure_exhausted）写下 effect:human_review_requested，人工审批写下一条 diagnostic 类 verdict:human_review 且 verdict=APPROVED」。

**可观测行为**: 决策日志 `orchestrator_decision_log` 中存在：一条 `effect:human_review_requested`（其 `observed.review_reason` 经 `reviewClassForReason` 归类为 `diagnostic`，`observed.pr.head_sha=SHA`），以及一条 `verdict:human_review`（`detail.approved=true`、`detail.review_class='diagnostic'`、`detail.review_request_hop` 指向请求 hop、`detail.pr_head_sha=SHA` 与请求快照一致）。此为输入前置，不在本改动范围内产生。

**验证命令**（构造该日志形状喂真 derive，见冻结测试 B-01 的 `decisionLog`）:
```bash
npx vitest run sprints/08221645-kernel-ef96e489/tests/diagnostic-human-review-consume.test.js -t "B-01 "
# 期望：exit 0（该场景下 derive 不再返回 wait:human_review）
```

**硬阈值**: 该场景 derive 返回 `action !== 'wait:human_review'` 且 `phase !== 'review'`。
**验证命令（可执行）**:
```bash
O=$(npx vitest run sprints/08221645-kernel-ef96e489/tests/diagnostic-human-review-consume.test.js -t "B-01 " 2>&1); echo "$O" | grep -qE "Tests +[1-9][0-9]* passed" && ! echo "$O" | grep -q " failed" || { echo "FAIL: B-01 未通过"; exit 1; }
```

---

### Step 2: derive 观测消费该批准 + 把触发 callback 记入消费集合
**来源**: `[FROM_PRD]` — PRD 第 22/36 行「复用 latestUnconsumedAttemptResult 语义，把触发该 review 的 callback hop 记入消费集合」。

**可观测行为**: `derive.js` 的 `latestUnconsumedAttemptResult` 在构建 `answeredCallbackHops` 消费集合时，除现有 `verdict:context_answer` / `reopen_gan_contract` 两类外，新增：对每条「`verdict:human_review` 且 `detail.approved===true`（或 `detail.verdict==='APPROVED'`）且 `detail.review_class==='diagnostic'`」的批准行，定位其 `detail.review_request_hop` 对应的 `effect:human_review_requested` 请求行；当请求行 `observed.pr.head_sha === 批准行 detail.pr_head_sha`（SHA 相符）时，把「hop 小于请求 hop 的最近一条 `verdict:attempt_callback`」的 hop 加入 `answeredCallbackHops`。SHA 不符 / 非 diagnostic / 无对应请求 → 不消费。

**验证命令**:
```bash
npx vitest run sprints/08221645-kernel-ef96e489/tests/diagnostic-human-review-consume.test.js -t "B-03 "
npx vitest run sprints/08221645-kernel-ef96e489/tests/diagnostic-human-review-consume.test.js -t "B-04 "
# 期望：exit 0（SHA 不符不消费；merge_gate 类不被 diagnostic 路径吞掉）
```

**硬阈值**: 触发 callback 被加入 `answeredCallbackHops` ⇔ (approved && review_class=='diagnostic' && SHA 相符)；否则不加入。
**验证命令（可执行）**:
```bash
O=$(npx vitest run sprints/08221645-kernel-ef96e489/tests/diagnostic-human-review-consume.test.js -t "B-0" 2>&1); echo "$O" | grep -qE "Tests +[3-9] passed" && ! echo "$O" | grep -q " failed" || { echo "FAIL: 消费判定条件不满足"; exit 1; }
```

---

### Step 3: derive 回主链重试原动作，run 走出死等
**来源**: `[FROM_PRD]` — PRD 第 23 行「原触发 callback 已被消费 → 不再返回 wait:human_review，而是回主链重试原动作」。

**可观测行为**: 触发 callback 被消费后，`attemptCallbackRoute(observed)` 返回 `null`（`latestUnconsumedAttemptResult` 找不到未消费的 attempt callback）→ `derive` 继续主链，按当前 `head_sha` 重判并重派原动作（如 evaluate 相位无 verdict → `spawn:evaluator`），run 继续收敛，不再 `wait:human_review`。

**验证命令**:
```bash
npx vitest run sprints/08221645-kernel-ef96e489/tests/diagnostic-human-review-consume.test.js
# 期望：exit 0，5 tests 全 PASS（B-01 回主链；B-02 无批准仍等；B-03 SHA 不符仍等；B-04 merge_gate 不变；INV merge_gate 正路 merge_pr）
```

**硬阈值**: 全部 5 条冻结断言 PASS。
**验证命令（可执行）**:
```bash
O=$(npx vitest run sprints/08221645-kernel-ef96e489/tests/diagnostic-human-review-consume.test.js 2>&1); echo "$O" | grep -qE "Tests +5 passed" || { echo "FAIL: 冻结套件未全绿"; exit 1; }
```

---

## 已知约束（来自回归测试 + 累积 FR）

- [tests/gp/f1/step3-runner-failure-retry.test.js] → runner_failure 有界重派（≤2 次）；第 3 次 → `wait:human_review` / `callback_runner_failure_exhausted`（本 sprint 的 diagnostic 触发前置，不得回退此语义）。
- [tests/gp/f1/step3-runner-failure-retry.test.js] → product 类失败（无 failure_class）照旧判终态，不被 runner_failure 放宽影响。
- [packages/brain/src/orchestrator/derive.js currentHumanReviewRejection] → REJECTED（同 SHA）人审 → `mark_failed` / `human_review_rejected`（本改动只碰 APPROVED 消费，不得影响 REJECTED 路径）。
- [packages/brain/src/orchestrator/ground-truth.js mergeApproval] → merge_gate 类批准（`review_class==='merge_gate'`）→ `reviewApproved=true` 放行 merge，语义本次禁止改动。
- [累积FR] context-manifest: 本 attempt runtime_resources.postgres=false，Brain context-manifest 端点依赖 DB 的可变状态；不作为本纯函数 sprint 的约束来源（unavailable for isolated attempt）。
- [累积FR] 本 line（journey e6f803f2）暂无已登记 golden_path 历史；相邻已修行为（#5021 seal 拒绝→reopen GAN、Test Contract 解析器支持分号）本 sprint 不得回退。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | diagnostic 类人审 APPROVED（review_class=diagnostic + SHA 相符）后，derive 消费触发它的原 attempt callback，回主链重试原动作，不再 wait:human_review |
| **NFR（做得多好）** | 非功能 | derive 为纯函数，无 I/O 延迟约束；单次重判 O(n) 遍历决策日志（n=hop 数，量级 <10^3），无新增 DB 往返 |
| **Invariant（永不违反）** | 不变量 | ①merge_gate 类批准消费/放行语义逐字节不变；②无对应 APPROVED 或 SHA 不符时禁止误判已消费（负向不放行）；③REJECTED 人审仍走 mark_failed |
| **判定点（怎么知道）** | 判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 失效 | 消费判定以 `review_request_hop` + `pr_head_sha` 双锚定；新 head_sha 产生后，旧 SHA 的批准自然失配不再消费（无长期缓存） |
| **死亡告警（停了谁知道）** | 告警 | 若该消费逻辑失效 → run 重回「无出口人审死等」，由 harness watchdog / 人审队列积压可观测（沿用现有 orchestrator_decision_log 留痕，不新增静默分支） |
| **失败语义（挂了怎么办）** | 故障 | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | 回执 | 消费生效 ⇔ 下一跳 derive 返回主链动作（非 wait:human_review），由冻结测试断言；生产侧 orchestrator_decision_log 出现主链 spawn 行即回执 |

### 判定点登记表（对模糊现实的判断假设 — decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息 |
| ⚠️ 某 verdict:human_review 是否「diagnostic 类批准」 | A. 直接读批准行 detail.review_class；B. 反查请求行 review_reason 经 reviewClassForReason 归类 | A. 读 detail.review_class（生产由 routes/harness-kernel-approvals.js 写入 = reviewClassForReason(request.review_reason)，SSOT 一致） | 批准行落库时已锚定 review_class，直接读避免二次归类漂移 | 误判 merge_gate 为 diagnostic → 错误消费 merge 前置 callback，破坏 merge_gate 语义（面客严重）→ 已由 B-04 冻结守卫 |
| ⚠️ 批准是否针对「本请求的候选」（防 stale 批准误放行） | A. 只比 review_request_hop；B. review_request_hop + pr_head_sha 双锚定 | B. 双锚定（批准行 detail.pr_head_sha === 请求行 observed.pr.head_sha） | 与既有 SQL NOT EXISTS / ground-truth mergeApproval 的双锚定契约一致 | 只比 hop → SHA 漂移的旧批准被当本轮消费 → 未验候选被放行继续（面客严重）→ 已由 B-03 冻结守卫 |
| 触发 review 的原 callback 是哪一条 | A. 请求行 detail 携带 callback_hop；B. hop < 请求 hop 的最近一条 attempt_callback | B（生产 runner_failure_exhausted 分支未在请求行持久化 callback_hop，SSOT 确认；请求紧随触发 callback 之后，最近一条即触发者） | 读代码确认 derive.js:583 exhausted 分支不带 callbackHop，loop.js:1681 请求 detail 只有 dispatch_hop（derive 迭代跳，非 callback 跳） | 定位错 callback → 消费错行；本单只在「已确认 diagnostic+SHA 相符」前提下定位，且 latestSpawn 护栏保证只消费最新一轮，误消费历史 callback 风险低 |

> 本表 ⚠️ 判定点（review_class 归类、SHA 双锚定）误判后果严重（破坏 merge_gate / 放行未验候选），已在 PrepPRD/PRD 边界情况明确拍板（PRD 第 27-29 行），非新增待确认项。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| （示例：Brain API 超时） | 返回 503，不写入 DB | 是 | 客户端重试 |
| 消费判定读到畸形/缺字段的 verdict 行 | fail-closed：不加入消费集合（视为未消费）→ 仍 wait:human_review | 是（纯函数，同输入同输出） | 保守等人审，不误放行 |
| SHA 不符 / 无对应请求 / 非 diagnostic | 不消费 → 仍 wait:human_review | 是 | 保守等人审 |
| 找不到 hop < 请求 hop 的 attempt_callback | 不加入消费集合（无可消费目标） | 是 | 保守等人审 |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本改动是 harness kernel 内部纯函数状态机，输入来自服务端自建的 `orchestrator_decision_log`（Brain 自写），非对外暴露 agent 接口。人审批准入口 `routes/harness-kernel-approvals.js` 有独立鉴权（`auth.approvedBy`），不在本 sprint 范围内。

---

## 禁 mock 边清单

本单改动涉及**状态机**（derive 消费判定 / 路由分叉）与**跨模块数据传递**（decisionLog 行 → derive 决策），命中「禁 mock 被改的边」规则：

- 代码 ↔ decisionLog 行（`derive` / `latestUnconsumedAttemptResult` 读的那条边）：冻结测试必须喂**真实形状**的 decisionLog 行、调**真 `derive`**（不 stub `attemptCallbackRoute` / `latestUnconsumedAttemptResult` / `reviewClassForReason`），零 mock。已满足：`sprints/08221645-kernel-ef96e489/tests/diagnostic-human-review-consume.test.js` 全程 `import { derive }` 真调，无 `vi.mock`/stub。
- 代码 ↔ DB 表 orchestrator_decision_log（`loop.js loadRunDeadlineState` 的 SQL 读路径）：本单收紧其 NOT EXISTS 消费判定（见下「未覆盖真实链路清单」）。该边禁 mock（禁 fake pool.query），必须真 Postgres 验证 —— 因本 attempt runtime_resources.postgres=false，登记为 brain-integration CI（真 PG）覆盖，本 attempt 不 mock、不伪验。

（derive 的死等根因边在纯函数侧，已零 mock 真验；DB 观测层边按规则不 mock，转真 PG 集成覆盖。）

---

## 真实调用方请求 shape

N/A — 本改动无「设备/agent 调服务端」的真实调用方链路。消费信号来自 Brain 自写的 `orchestrator_decision_log`；人审批准由 `routes/harness-kernel-approvals.js` 写入（其 detail 形状 `{verdict,approved,review_class,pr_head_sha,review_request_hop,...}` 已在冻结测试 `approval()` 构造器中逐字段对齐生产 SSOT，见该文件 routes/harness-kernel-approvals.js:171-190）。

---

## 未覆盖真实链路清单

| 真实链路点被 mock/未验顶替 | 为什么 | 真验证补位计划（谁/何时/什么环境） |
|---|---|---|
| `loop.js loadRunDeadlineState` 的 SQL 观测层（收紧 NOT EXISTS：diagnostic 请求仅当存在 `approved=true` 且 `pr_head_sha` 与请求快照 head_sha 相符的 `verdict:human_review` 时才判为已消费 `open_human_review=false`；SHA 不符 / 无批准 → 保持 `open_human_review=true`，不误关闭 deadline fence 的人审豁免） | 本 attempt `runtime_resources.postgres=false`，无法起真 Postgres 执行该 raw SQL；按「禁 mock 边」规则不得 fake pool.query 伪验 | generator 在 `packages/brain/src/__tests__/`（或 `*integration*` 命名）补 1 条真 PG 测试；由仓库 **brain-integration** CI job（起真 Postgres）执行覆盖。标记 `logic-done-pending`（DB 观测层接缝，真 PG 未在本 evaluator attempt 验） |

> 说明：本 sprint 的**死等根因**（PRD Golden Path 三步的可观测结果）100% 在 `derive` 纯函数侧，已由冻结套件真验全绿；`loadRunDeadlineState` 改动是与 derive 消费谓词对齐的观测层加固（影响 deadline fence 对 SHA 不符批准的处理），属零回归安全项，转真 PG 集成覆盖。harness-controller 会把本清单原样呈现进 PR 描述。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| diagnostic 人审消费 + 回主链 | `sprints/08221645-kernel-ef96e489/tests/diagnostic-human-review-consume.test.js` | B-01 回主链重试原动作，不再 wait:human_review / B-02 无对应 diagnostic APPROVED verdict / B-03 pr_head_sha 与请求快照 head_sha 不符 / B-04 merge_gate 类人审批准 / INV merge_gate 正路零回归 | → 1 failure（B-01 在未修 derive 前返回 wait:human_review；B-02/B-03/B-04/INV 为守卫，修复前后恒绿） |
| （补充）runner_failure 家族零回归 | `tests/gp/f1/step3-runner-failure-retry.test.js` | evaluator 的 runner_failure（首次）→ 同 run 重派 evaluator / 同一 run 第 3 次 runner_failure → 进人审 | 既有测试，修复前后恒绿（防 diagnostic 消费改动波及 runner_failure 有界重派家族） |

> Test File 列为完整真实路径（无省略号）。首行冻结测试 `sprints/08221645-kernel-ef96e489/tests/diagnostic-human-review-consume.test.js` 已落盘并进本轮 commit（封印闸 assertTestContractResolvable + runner finalizer HEAD 树校验均可解析）。BEHAVIOR 覆盖名为对应 `it()` 名的字面子串（B-01/B-02/B-03/B-04/INV 前缀）。

---

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api，纯函数无 DB）

> 本 sprint 死等根因在 `derive` 纯函数状态机，验收=真 `derive` 冻结套件全绿 + runner_failure 家族零回归守卫。因 runtime_resources.postgres=false，E2E 不起 DB/不打 Brain 5221（Brain 为共享实例，其可变状态非本 attempt 隔离资源，不作断言对象）；`loadRunDeadlineState` DB 观测层由 brain-integration CI 真 PG 覆盖（见「未覆盖真实链路清单」）。冻结测试位于 `sprints/**` 与 `tests/**`，由仓库根 vitest 配置直接展开，从仓库根跑（非 packages/<pkg>/src，无需子 shell）。

```bash
#!/bin/bash
set -euo pipefail

SPRINT_TEST="sprints/08221645-kernel-ef96e489/tests/diagnostic-human-review-consume.test.js"
GUARD_TEST="tests/gp/f1/step3-runner-failure-retry.test.js"

# 1. 冻结套件（真 derive，5 条断言）：修复后必须 5 passed 0 failed
OUT1=$(npx vitest run "$SPRINT_TEST" 2>&1)
echo "$OUT1" | tail -5
echo "$OUT1" | grep -qE "Tests +5 passed" || { echo "FAIL: 冻结套件未 5 passed"; exit 1; }
echo "$OUT1" | grep -q " failed" && { echo "FAIL: 冻结套件存在 failed"; exit 1; } || true

# 2. runner_failure 家族零回归守卫：既有 GP 测试必须仍全绿
OUT2=$(npx vitest run "$GUARD_TEST" 2>&1)
echo "$OUT2" | tail -5
echo "$OUT2" | grep -qE "Tests +[1-9][0-9]* passed" || { echo "FAIL: runner_failure 守卫未通过"; exit 1; }
echo "$OUT2" | grep -q " failed" && { echo "FAIL: runner_failure 守卫回归"; exit 1; } || true

echo "✅ Golden Path 验证通过：diagnostic 人审批准后 derive 消费并回主链，runner_failure 家族零回归"
```

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认；纯函数状态机，风险面有限）
高风险面:
- 错输入: verdict:human_review 行缺 `review_class` / 缺 `pr_head_sha` / `review_request_hop` 为非整数 → 消费判定必须 fail-closed（不消费，仍 wait:human_review），不得抛异常崩 derive
- 重复提交: 同一 review_request_hop 出现两条 APPROVED（幂等）→ 消费集合去重（Set），不得重复或错乱
- 中途中断: diagnostic 请求后 head_sha 已推进（新候选）→ 旧 SHA 批准应失配不消费（B-03 家族），验新候选不被旧批准误放行
- 边界值: 无任何 attempt_callback 早于请求 hop（只有 spawn 行）→ 找不到可消费目标，不消费、不崩；多轮 diagnostic 请求/批准并存 → 只消费与各自请求锚定的触发 callback，不跨轮串扰
发现分级: P0/P1（误消费 merge_gate 前置 / 放行未验候选 / derive 崩溃）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞
