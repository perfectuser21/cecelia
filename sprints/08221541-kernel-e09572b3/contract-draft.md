# Sprint Contract Draft (Round 1) — diagnostic 类人审批准后 derive 消费并重试原动作

**journey_type**: autonomous
**target_environment**: local_api（纯 Brain kernel 纯函数，冻结测试本地 node/vitest 跑；postgres:false — 不依赖 Postgres）
**锚定父路声明**: 覆盖父路 F1 golden_path `d738a2b2-e686-4640-a7f2-e0d29491aa63` 第 3 步「造完真验」（diagnostic 人审出口接缝）
gp-anchor: skipped (product-map.json not found — cecelia 仓无 product-map/generated/product-map.json)
contract-gate: present (packages/brain/src/lib/contract-gate.js 存在，cecelia 仓，代码层 Contract Gate 生效)
map: [MAP_NOT_CONFIGURED]（task.payload.map_scope=["F1"] 但 map_repo=null → 不做地图半径断言，不回退领域硬编码）

---

## Response Schema（推导来源: N/A）

N/A — 任务无 HTTP 响应。本 sprint 仅改 `packages/brain/src/orchestrator/` 内两个纯函数
（`derive.js` / `ground-truth.js`），无新增/改动 HTTP 端点，无 response body。契约 oracle
是 derive/ground-truth 纯函数返回值，由冻结 vitest 断言，非 HTTP schema。

---

## 已知约束（来自回归测试 + 累积 FR）

- [tests/gp/f1/step3-runner-failure-retry.test.js] runner_failure 有界重派（≤2），第 3 次进人审 `callback_runner_failure_exhausted`——本 sprint 只改「进人审后被批准的消费」，**不得**改变「何时进人审」（触发条件不变）。
- [packages/brain/src/orchestrator/__tests__/derive.test.js] `verdictForAuthority` SHA+contract_identity 锚定语义、`deriveVerdictChain` 双 PASS→merge fence——本 sprint 消费逻辑不得旁路这些。
- [packages/brain/src/orchestrator/human-review-class.js] `reviewClassForReason`：`awaiting_human_review`→merge_gate；`evidence_invalid:*`/`unknown:missing_failure_signature`→evidence_repair；`failure_set_*`→convergence；其余（含 `callback_semantic_refusal`/`callback_runner_failure_*`）→diagnostic。消费逻辑仅对 `review_class==='diagnostic'` 生效。
- [ground-truth.js `mergeApproval`] merge_gate 批准消费语义（approved+review_class===merge_gate+pr_head_sha===当前 pr.head_sha+request 快照锚定）→ `reviewApproved=true`。本 sprint 不改此分支。
- [累积FR] （本 line 暂无历史 — GET /journeys/:id/golden-paths 返回空数组）
- [累积FR / context-manifest] context-manifest: unavailable（Brain line 端点本环境未返回累积 FR，按无历史处理）

---

## Golden Path

[diagnostic 人审挂起] → [Commander 批准 + ground-truth/derive 观测消费] → [derive 回主链重试原动作]

### Step 1: run 因 attempt callback 判 diagnostic 类失败，derive 返回 wait:human_review
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步 / 背景段（r40 hop174 案卷）

**可观测行为**: 某次 attempt callback（如 blocked evaluator → `callback_semantic_refusal`，或
runner_failure 重试耗尽 → `callback_runner_failure_exhausted`）经 `attemptCallbackRoute` →
derive 返回 `{phase:'review', action:'wait:human_review'}`，随后写入一条 open 的
`effect:human_review_requested`（`review_reason` 属 diagnostic 类，快照锚定 pr.head_sha）。

**验证命令**:
```bash
# 冻结测试 B-02：无批准时 derive 仍进人审（证明触发条件与既有一致）
npx vitest run sprints/08221541-kernel-e09572b3/tests/step3-diagnostic-review-approval-consumed.test.js -t "B-02" --reporter=verbose 2>&1 | grep -qaE '✓.*B-02'
```
**硬阈值**: 无批准输入下 derive 返回 `phase=review, action=wait:human_review, reason=callback_semantic_refusal`（B-02 通过 → exit 0）

---

### Step 2: Commander 对 open review request approve（写 diagnostic APPROVED verdict）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步

**可观测行为**: 决策日志新增一行 `verdict:human_review`，`detail` 含
`approved=true`、`review_class='diagnostic'`、`review_request_hop`（指向该 open 请求 hop）、
`pr_head_sha`（与请求快照 head_sha 一致）。此为 Commander 侧既有 approve 端点行为，本 sprint 不改端点。

**验证命令**:
```bash
# 冻结测试 B-05：pure helper 只对 diagnostic 有效批准（四字段齐 + SHA/hop 锚定）收割触发 callback hop
npx vitest run sprints/08221541-kernel-e09572b3/tests/step3-diagnostic-review-approval-consumed.test.js -t "B-05" --reporter=verbose 2>&1 | grep -qaE '✓.*B-05'
```
**硬阈值**: `diagnosticApprovalConsumedCallbackHops(log)` 对有效 diagnostic 批准含触发 callback hop=10；对 merge_gate 类 / hop 不匹配 / SHA 不符**均不**含 hop=10（B-05 通过 → exit 0）

---

### Step 3: 下一跳 ground-truth/derive 观测消费该批准
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步 + `[AI_ADDED]` 消费判据下沉为共享纯函数（理由：postgres:false 下须 DB-free 可测，且 derive 纯函数必须自洽从 decisionLog 判据消费，禁把消费逻辑埋进只能靠真 DB 才能验的 collectGroundTruth）

**可观测行为**:
- 共享纯函数 `diagnosticApprovalConsumedCallbackHops(decisionLog)`（`derive.js` 导出）扫描 diagnostic 类 APPROVED verdict，按 PRD 假设 line48 与 `latestUnconsumedAttemptResult` 语义对齐锚定「触发该 review 的 callback hop」（= review_request_hop 指向的 `effect:human_review_requested` 行之前、`latestUnconsumedAttemptResult` 同款判据会选中的最近一条 attempt 结果行的 hop），收割进 answered 集合。
- `derive.js` `latestUnconsumedAttemptResult` 把收割集合并入 `answeredCallbackHops`。
- `ground-truth.js` 导出并复用同一判据的 `openHumanReviewFromLog(decisionLog)`，`collectGroundTruth` 返回体新增 `open_human_review` 字段（消费后置 false），作为 answered 集合来源 / loop·watchdog 可见性留痕（NFR：不新增静默旁路）。

**验证命令**:
```bash
# 冻结测试 B-06：ground-truth openHumanReviewFromLog 消费后 false、未消费/stale 仍 true
npx vitest run sprints/08221541-kernel-e09572b3/tests/step3-diagnostic-review-approval-consumed.test.js -t "B-06" --reporter=verbose 2>&1 | grep -qaE '✓.*B-06'
# ARTIFACT：collectGroundTruth 返回体真的挂了 open_human_review 字段（非仅 helper）
grep -q "open_human_review" packages/brain/src/orchestrator/ground-truth.js
```
**硬阈值**: `openHumanReviewFromLog` 有效批准→false，无批准/stale→true（B-06 通过）；`ground-truth.js` 源码含 `open_human_review` 装配（grep 命中）

---

### Step 4: derive 越过 review 门回主链，返回重试原动作
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 步（无出口死等根除的核心可观测结果）

**可观测行为**: callback hop 已被 answered → `attemptCallbackRoute` 返回 null → derive 越过
review 门回到主链 → 返回**触发该 callback 的前序 dispatch 动作**（本例 blocked evaluator →
`{phase:'evaluate', action:'spawn:evaluator', reason:'no_evaluate_verdict_for_head_sha'}`），
phase≠review，run 继续自治推进，无需 Commander 手工 append 消费行。

**验证命令**:
```bash
# 冻结测试 B-01：批准被消费后 derive 不再 wait:human_review，返回 phase≠review 的重试原动作
npx vitest run sprints/08221541-kernel-e09572b3/tests/step3-diagnostic-review-approval-consumed.test.js -t "B-01" --reporter=verbose 2>&1 | grep -qaE '✓.*B-01'
```
**硬阈值**: derive 返回 `phase=evaluate, action=spawn:evaluator`（phase≠review 且 action≠wait:human_review）；B-01 通过 → exit 0

---

### Step 5（边界回归）: merge_gate 类批准语义不变
**来源**: `[FROM_PRD]` — PRD 边界情况「merge_gate 类批准语义不变」+ Invariant「merge_gate 不变」

**可观测行为**: `review_class=merge_gate` 仍走既有 `mergeApproval`→`reviewApproved=true`→
`merge_pr`，diagnostic 消费逻辑不改动 merge_gate 分支、不误消费 merge_gate 批准的 callback。

**验证命令**:
```bash
# 冻结测试 B-04：merge_gate 双 PASS + reviewApproved → merge_pr（回归护栏）
npx vitest run sprints/08221541-kernel-e09572b3/tests/step3-diagnostic-review-approval-consumed.test.js -t "B-04" --reporter=verbose 2>&1 | grep -qaE '✓.*B-04'
```
**硬阈值**: derive 返回 `phase=merge, action=merge_pr, reason=all_gates_passed`（B-04 通过 → exit 0）

---

## 真实调用方请求 shape

N/A — 本 sprint 无「设备/agent 调服务端」的真实调用方；改动全在 Brain kernel 内部纯函数
（derive/ground-truth 消费决策日志行），无跨机/跨进程认证 shape。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）— 冻结测试全部真调 `derive` / `diagnosticApprovalConsumedCallbackHops`
/ `openHumanReviewFromLog` 纯函数与真实决策日志行，无 `force_*`/stub/假数据；无第三方 API。

## 禁 mock 边清单

本单改动涉及【状态机】（derive 人审门/回主链）+【跨模块数据传递】（ground-truth↔derive 共享
消费判据）+【生命周期钩子】（diagnostic 人审批准消费）：

- 决策日志（decisionLog 行）↔ `derive.derive` / `latestUnconsumedAttemptResult` / `attemptCallbackRoute`（本单改了「批准如何被 derive 消费」这条边，测试必须真调 `derive(observed)`，禁 stub/vi.mock `attemptCallbackRoute`、`latestUnconsumedAttemptResult`、`diagnosticApprovalConsumedCallbackHops`）
- 决策日志 ↔ `ground-truth.openHumanReviewFromLog`（本单改了 open_human_review 判据，测试必须真调该纯函数，禁 mock）
- `derive.js` ↔ `ground-truth.js` 共享消费判据（本单让两者复用同一 `diagnosticApprovalConsumedCallbackHops`，测试禁用替身顶替其一）

> 本单为纯函数逻辑改动，无 DB 写路径（postgres:false）；上述边全部以真实纯函数 + 真实
> 决策日志行断言，无 Postgres 依赖，故无 integration-命名真 PG 测试需求。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | diagnostic 类人审批准后，derive 纯函数经决策日志观测消费该批准（收割触发 callback hop 进 answered 集合），越过 review 门回主链重试触发该 callback 的前序 dispatch 动作；ground-truth 暴露 `open_human_review`。 |
| **NFR（做得多好）** | 非功能 | derive/ground-truth 均纯函数无 I/O，无延迟/频控约束（PrepPRD 未指定）。 |
| **Invariant（永不违反）** | 不变量 | ①merge_gate 类 reviewApproved→merge_pr 语义不变；②diagnostic 批准必须经 observed/decisionLog 被 derive 消费，禁依赖 Commander 手工 append；③批准 pr_head_sha 与 review request 快照不符者不消费（stale 不放行）；④INV-K3 不确定原因默认归人审；⑤INV-K4 no-progress 后禁重派 generator-fix。 |
| **判定点（怎么知道）** | 模糊现实判断 | 见下方登记表 |
| **保质期（何时过期）** | 失效 | 批准锚定 review request 快照 head_sha；HEAD 推进后旧快照批准不再对新 SHA 生效（既有 SHA 锚定语义承接，无新增 token 保质期）。 |
| **死亡告警（停了谁知道）** | 告警 | 消费失效则 run 重新停在 diagnostic `wait:human_review`（回归原死等症状），由既有 run 停滞/deadline watchdog 与冻结回归测试 B-01 兜底暴露。 |
| **失败语义（挂了怎么办）** | 故障 | 见下方失败语义声明（保守 wait，缺字段不消费）。 |
| **效果确认（已发≠已生效）** | 回执 | derive 返回值即回执：消费成功=返回 phase≠review 的重试动作；未消费=仍 wait:human_review。冻结测试逐条断言返回值，非「测试通过」空泛断言。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 | A | 记录 API 不稳 | 静默丢消息 |
| ⚠️ 某条 diagnostic APPROVED verdict 是否消费了「正确的」触发 callback | A. review_request_hop→request 行→其前最近一条 `latestUnconsumedAttemptResult` 同款判据选中的 attempt 结果行 hop；B. 批准 detail 直接携带 callback_hop 字段 | A（复用 `latestUnconsumedAttemptResult` 消费语义反推） | PRD 假设 line48：批准端点不写 callback_hop，只有 review_request_hop；须与既有 answered 语义对齐避免误消费/漏消费 | 误消费错误 callback → 越过不该越过的 review 门放行错动作（面客错误级，故标 ⚠️） |
| ⚠️ 批准是否「新鲜」（非 stale 复用） | A. verdict.pr_head_sha === request 快照 pr.head_sha; B. 不校验 SHA | A | Invariant「SHA 锚定」+ 对齐 merge_gate mergeApproval 既有 stale 防护 | 放行 stale 批准 → 对已换 SHA 的候选错误放行（不可逆 merge/推进风险，故标 ⚠️） |
| review_class 是否 diagnostic | A. `reviewClassForReason(request.review_reason)` 或 approve verdict 的 review_class 字段 === 'diagnostic' | A | 消费仅限 diagnostic，merge_gate/evidence_repair/convergence 走各自既有消费 | 误把 merge_gate 当 diagnostic 消费 → 污染 merge fence |

> judgment-pending-user: 上述两条 ⚠️ 判定点（触发 callback hop 反推、stale SHA 校验）PrepPRD/对齐会未显式拍板，合同按保守语义（对齐既有 answered/mergeApproval）落定，待主理人复核。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| diagnostic APPROVED 缺 approved/review_class/review_request_hop/pr_head_sha 任一字段 | 不消费 | 是（纯函数，同输入同输出） | 保守回落 `wait:human_review`（等补齐或人工） |
| review_request_hop 指向不存在/非 open 的请求 | 不消费 | 是 | 保守 wait |
| pr_head_sha 与 request 快照不符（stale） | 不消费 | 是 | 保守 wait（stale 批准不放行） |
| 触发 callback hop 反推不到 | 不消费该批准 | 是 | 保守 wait，不误收割 |

### 输入对抗面

N/A — 本 sprint 无对外暴露 agent 输入；消费判据只读 Brain 内部权威决策日志行
（`verdict:human_review` 由受信 approve 端点写入，`verdict:attempt_callback` 由 runner 回写），
非外部用户可写入面。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| diagnostic 批准消费+回主链重试（冻结测试，本 sprint 唯一冻结产物） | `sprints/08221541-kernel-e09572b3/tests/step3-diagnostic-review-approval-consumed.test.js` | B-01 批准被消费; B-02 无对应 diagnostic APPROVED; B-03 pr_head_sha; B-04 merge_gate; B-05 diagnosticApprovalConsumedCallbackHops; B-06 openHumanReviewFromLog | 3 failed \| 3 passed（B-01/B-05/B-06 红：death loop + 缺 `diagnosticApprovalConsumedCallbackHops`/`openHumanReviewFromLog` 导出；B-02/B-03/B-04 绿=回归护栏，须保持绿） |

> 冻结测试落 `sprints/08221541-kernel-e09572b3/tests/`（根 vitest include 覆盖 `sprints/**`，从仓库根 `npx vitest run sprints/...` 直跑）。BEHAVIOR 覆盖名（B-01…B-06）均为 it() 名字面子串，可 `grep -F` 命中。

---

## E2E 验收（final-e2e 跑 — target_environment=local_api，纯 kernel 纯函数，无 Postgres 依赖）

```bash
#!/bin/bash
set -euo pipefail
cd "${WORKSPACE_PATH:-/workspace}"
SPRINT_DIR="sprints/08221541-kernel-e09572b3"
TEST_FILE="$SPRINT_DIR/tests/step3-diagnostic-review-approval-consumed.test.js"

# 1. 冻结测试文件存在（frozen 产物）
test -f "$TEST_FILE" || { echo "FAIL: 冻结测试缺失 $TEST_FILE"; exit 1; }

# 2. 修复后全部 6 条冻结测试从仓库根 vitest 绿（sprints/** 在根 vitest include 内，DB-free）
OUT=$(npx vitest run "$TEST_FILE" --reporter=verbose 2>&1)
echo "$OUT" | tail -30
echo "$OUT" | grep -qaE 'Test Files +1 passed' || { echo "FAIL: 冻结测试未全绿"; exit 1; }
echo "$OUT" | grep -qaE 'Tests +6 passed' || { echo "FAIL: 期望 6 条全绿"; exit 1; }

# 3. 核心行为逐条断言（回主链重试 + 死等根除 + 回归护栏）
for T in B-01 B-02 B-03 B-04 B-05 B-06; do
  echo "$OUT" | grep -qaE "✓.*$T" || { echo "FAIL: $T 未通过"; exit 1; }
done

# 4. 消费判据为共享纯函数（禁埋进只能靠真 DB 才验的 collectGroundTruth）+ ground-truth 装配 open_human_review
grep -q "export function diagnosticApprovalConsumedCallbackHops\|export const diagnosticApprovalConsumedCallbackHops" packages/brain/src/orchestrator/derive.js \
  || { echo "FAIL: derive.js 未导出 diagnosticApprovalConsumedCallbackHops"; exit 1; }
grep -q "open_human_review" packages/brain/src/orchestrator/ground-truth.js \
  || { echo "FAIL: ground-truth.js 未装配 open_human_review"; exit 1; }

# 5. 全量 derive/ground-truth 单测无回归（不 stub 被改的边；改到接缝层必跑既有守卫）
(cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/derive.test.js ./src/orchestrator/__tests__/ground-truth.test.js 2>&1 | tail -20)

echo "✅ diagnostic 人审批准消费 + 回主链重试 Golden Path 验证通过"
```

> 说明：本 sprint postgres:false，无 DB 写路径 —— oracle 为真调 derive/ground-truth 纯函数 +
> 真实决策日志行的冻结 vitest，非「测试通过」空断言（逐条断言 derive 返回相位/动作）。
> 冻结测试位于 `sprints/**` 走仓库根 vitest（合规）；第 5 步既有包内单测用子 shell `cd packages/brain`
> 跑（用该包自身 vitest 配置，遵守 9.25 工作目录死规则）。

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: diagnostic APPROVED verdict 缺字段（无 review_class / review_request_hop / pr_head_sha）→ 必须保守不消费，仍 wait:human_review（不得因半批准放行）
- 重复提交: 同一 review request 出现两条 diagnostic APPROVED（重复批准）→ 幂等消费，只收割一次触发 callback hop，不误伤后续无关 callback
- 中途中断: 消费后 HEAD 推进（新 PR SHA）再来一条旧 SHA 批准 → 旧批准对新 SHA 不生效（stale 锚定），新 SHA 无批准仍 wait
- 边界值: 多条 diagnostic 挂起（连续两次不同 callback 各自进人审各自批准）→ 各自只消费自己的触发 callback hop，不串消费；merge_gate 与 diagnostic 混合日志下互不污染
发现分级: P0/P1（误消费错误 callback / stale 放行 / merge_gate 被污染 → 面客错误或不可逆推进）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞
