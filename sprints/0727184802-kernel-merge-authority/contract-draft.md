# Sprint Contract Draft (Round 8)

## 合同边界

- 本合同只覆盖 Harness / Kernel merge authority 的可信 ownership 判定、authenticated approve/reject、`human_review` 决策落账、per-SHA merge gate、merge head 原子锁定，以及标题型 CI / legacy merge caller 的 fail-closed；不修改或复用 PR #4372。
- 普通非 Kernel PR 的常规开发流程必须保持不变；唯一变化是不能再因为标题、body、branch 名或 PR 内脚本而获得 Harness merge authority。
- 优先复用现有 `initiative_runs`、`tasks.payload`、`orchestrator_decision_log` 字段；除非生成器证明现有结构无法承载 `approved_by/pr_head_sha/source/timestamp/repo/pr_number`，否则禁止新增 migration。
- `contract-gate`: enabled（`packages/brain/src/lib/contract-gate.js` 存在）。

## Response Schema（推导来源: PRD字面 + api_registry对齐）

补充说明：`/api/brain/registry` 当前可读但照相层已陈旧（最近扫描时间 2026-07-18，距今约 212 小时），且未发现可直接复用的 Kernel approvals endpoint 定义，因此本 sprint 的 approve/reject response schema 以 PRD 字面约束为准，并仅对齐现有 snake_case 风格。

### Endpoint: POST /api/brain/harness/kernel-reviews/:runId/approve
**Success (HTTP 202)**:
```json
{"ok":true,"run_id":"<uuid>","task_id":"<uuid>","repo":"owner/repo","pr_number":4379,"pr_head_sha":"<40-char-sha>","review_request_hop":3,"review_class":"merge_gate","approved_by":"alex","timestamp":"2026-07-27T18:48:02.000Z","source":"authenticated_route"}
```
- `ok` (boolean, 必填): 来源——NEW_PATTERN；沿现有 approvals route 成功布尔语义。
- `run_id` (string, 必填): 来源——PRD ownership tuple `run_id`。
- `task_id` (string, 必填): 来源——现有 route 字段。
- `repo` (string, 必填): 来源——PRD ownership tuple `repo`。
- `pr_number` (number, 必填): 来源——PRD ownership tuple `pr_number`。
- `pr_head_sha` (string, 必填): 来源——PRD ownership tuple `head_sha`。
- `review_request_hop` (number, 必填): 来源——现有 route 字段。
- `review_class` (string, 必填): 来源——现有 route 字段。
- `approved_by` (string, 必填): 来源——PRD 落账要求。
- `timestamp` (string, 必填): 来源——PRD 落账要求 `timestamp`。
- `source` (string, 必填): 来源——PRD 落账要求 `source`。
**禁用字段名**: `runId`, `taskId`, `head_sha`, `approved_at`
**Error (HTTP 4xx/5xx)**:
```json
{"error":"<string>"}
```

### Endpoint: POST /api/brain/harness/kernel-reviews/:runId/reject
**Success (HTTP 202)**:
```json
{"ok":true,"run_id":"<uuid>","task_id":"<uuid>","repo":"owner/repo","pr_number":4379,"pr_head_sha":"<40-char-sha>","review_request_hop":3,"review_class":"merge_gate","rejected_by":"alex","timestamp":"2026-07-27T18:48:02.000Z","source":"authenticated_route"}
```
- `rejected_by` (string, 必填): 来源——PRD 的 reject 对称语义。
- 其余字段与 approve 路由一致，来源同上。
**禁用字段名**: `runId`, `taskId`, `head_sha`, `rejected_at`
**Error (HTTP 4xx/5xx)**:
```json
{"error":"<string>"}
```

### Endpoint: merge_pr（内部动作）
N/A — 任务无新增公开 HTTP 响应；对外可观测契约是 `orchestrator_decision_log`、gh merge 参数与 merge 失败语义。

## 已知约束（来自回归测试）

- `[packages/brain/src/routes/__tests__/harness-kernel-approvals.test.js]` → `rejects an invalid approver token before any database access`
- `[packages/brain/src/routes/__tests__/harness-kernel-approvals.test.js]` → `accepts a current review request and commits an observable approval verdict`
- `[packages/brain/src/routes/__tests__/harness-kernel-approvals.test.js]` → `adds the open human-review wait back to deadline in the approval transaction`
- `[packages/brain/src/__tests__/integration/kernel-wiring.pg.integration.test.js]` → `approval 并发与 429: fails closed, writes once, and derives merge`
- `[packages/brain/src/orchestrator/__tests__/ground-truth.test.js]` → `reviewRequired 从 tasks.payload.review_required（string payload 兼容）；reviewApproved 锚定当前 head_sha`
- `[packages/brain/src/orchestrator/__tests__/ground-truth.test.js]` → `same-SHA evidence approval cannot satisfy the later merge gate after evaluator and judge PASS`
- `[packages/brain/src/orchestrator/__tests__/kernel-handlers.test.js]` → `merge 按 GitHub 真相处理 CLEAN / BEHIND / CONFLICTING`
- `[packages/brain/src/lib/__tests__/harness-finalize.test.js]` → `PR MERGED 但无 evaluator gate → allow:false 且 reason 含 evaluator`
- `[packages/brain/src/lib/__tests__/harness-finalize.test.js]` → `非 harness relay 任务 → applies:false（原逻辑不受影响）`
- `[packages/brain/src/__tests__/harness-ci-gate.test.js]` → `gh 命令抛错 → FAIL`
- `[.github/workflows/scripts/__tests__/should-auto-merge.test.sh]` → `harness PR（feat(harness):）→ 跳过 auto-merge`
- `[累积FR] context-manifest: unavailable`（`GET /api/brain/line/bb8cc561-b3ee-4fec-b74d-2255694bd963/context-manifest` 返回 404）

## 真实调用方请求 shape

### 人工 approve/reject 调用方

| 位置 | 真实 shape |
|---|---|
| Method | `POST` |
| Path | `/api/brain/harness/kernel-reviews/:runId/approve` 或 `/reject` |
| Header | `x-approver-token: <secret>` |
| Body | `{"task_id":"<uuid>","repo":"owner/repo","pr_number":4379,"pr_head_sha":"<40-char-sha>","review_request_hop":3,"approved_by":"alex"}` |
| Reject Body | `{"task_id":"<uuid>","repo":"owner/repo","pr_number":4379,"pr_head_sha":"<40-char-sha>","review_request_hop":3,"rejected_by":"alex"}` |

### 内部 merge 调用方

| 位置 | 真实 shape |
|---|---|
| Handler | `createKernelHandlers(...).merge_pr(ctx)` |
| 关键字段 | `ctx.runId`、`ctx.taskId`、`ctx.observed.pr.url`、`ctx.observed.pr.head_sha`、`ctx.observed.evaluateVerdict.pr_head_sha`、`ctx.observed.judgeVerdict.pr_head_sha`、`ctx.observed.reviewApproved` |
| 期望命令 | `gh pr merge <prUrl> --squash --delete-branch --match-head-commit <current_head_sha>` 或等价 compare-and-merge |

禁止 body 传 `runId/taskId/head_sha` 驼峰名、禁止只用标题/branch/script 判定 ownership。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求：系统对外承诺做什么 | 仅当 `repo + pr_number + run_id + head_sha` 与当前真实 PR head 完整匹配时，Kernel 才能批准并合并 Kernel-owned PR；普通 PR 不因标题/branch 被误分类。 |
| **NFR（做得多好）** | 非功能需求：性能/可靠性/并发阈值等 | approve/reject 与 merge 都必须原子 fail-closed；并发批准最多写一条 verdict；head 变化后旧证据立即失效。 |
| **Invariant（永不违反）** | 任何情况下不得打破的不变量 | merge authority 不得来自标题、body、branch 名、PR 内脚本或 draft 状态；所有 merge caller 必须服从同一 SHA 锚定 gate。 |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表。 |
| **保质期（何时过期）** | 该能力/数据/token 何时失效，谁负责退役 | human_review、evaluator、judge 证据仅对其对应 `pr_head_sha` 有效；head 一变立即过期。 |
| **死亡告警（停了谁知道）** | 该功能停止工作后，谁在多久内会知道，用什么告警手段 | approve/reject 拒绝路径与 merge 失败路径必须返回明确错误；Kernel run 再次轮询时由 orchestrator/ground-truth 读到 stale gate 并回到 evaluate/review。 |
| **失败语义（挂了怎么办）** | 故障时放行还是拦截？重试幂等？降级策略？ | 缺 token、缺 SHA、repo/pr/run/task 不匹配、stale SHA、ownership 缺失一律拦截且不写批准；merge 遇 stale head 必须失败并要求重跑 evaluator/judge/human_review。 |
| **效果确认（已发≠已生效）** | 每个对外动作如何确认真实生效？回执方式/时限/拿不到算什么 | 通过 `orchestrator_decision_log` 的 `verdict:human_review` 记录、`gh pr view` 的当前 `headRefOid` 与 `gh pr merge --match-head-commit` 实际参数确认；拿不到真 head 视为失败。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| ⚠️ PR 是否属于 Kernel-owned | A. 标题 `feat(harness)` / `cp-` branch / PR 内脚本；B. `repo + pr_number + run_id + head_sha` 与 run/task 真相绑定 | B. ownership tuple | PRD 明确禁止标题、body、branch、脚本充当授权证据 | 普通 PR 被误合并，或 Kernel PR 被未授权 caller 合并 |
| ⚠️ 人工批准是否仍然有效 | A. 只看最近 approval 行；B. approval `pr_head_sha` 与当前 `headRefOid` 完全一致 | B. SHA 锚定 | 现有 ground-truth 已以当前 head 过滤批准 | push 新 commit 后旧批准继续生效，产生越权合并 |
| ⚠️ merge 是否原子锁头 | A. `gh pr merge` 默认行为；B. `--match-head-commit <sha>` 或 compare-and-merge | B. 带 head 锁 | PRD 明示阻断 gate/merge TOCTOU | evaluator/judge/human_review 针对 A，最终却合并 B |

上述三个 ⚠️ 判定点都来自 PRD 拍板，无 `judgment-pending-user`。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 缺少 `x-approver-token` 或 token 错误 | 返回 401/503，不写 `verdict:human_review` | 是 | 人工补 token 后重试 |
| 缺少 `repo/pr_number/pr_head_sha/task_id/review_request_hop` | 返回 400，不写批准 | 是 | 请求方补齐 ownership tuple |
| run/task/PR/current head 任一不匹配 | 返回 404/409，不写批准 | 是 | 重新读取当前 PR 真相后再发起 |
| evaluator/judge/human_review 任一证据 stale | merge gate 拒绝 | 是 | 重跑 stale 的证据链 |
| merge 期间 head 改变 | `gh pr merge --match-head-commit` 失败，不合并 | 是 | 重新 evaluate/judge/human_review |
| ordinary PR 命中旧标题型 CI 旁路 | fail-closed，不自动 merge | N/A | 等 Kernel 权威或人工普通流程 |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本任务不新增对外 agent；外部输入仅为受控 approve/reject 请求与 GitHub PR 真相。

## Golden Path

覆盖父路 Kernel merge authority 第 1-3 步

[读取 run/task/PR 真相并把 review_required 锁进 gate] → [authenticated approve/reject 原子校验并落账] → [stale 证据失效] → [唯一 merge authority 原子锁头合并]

### Step 1: ownership 与人工审核前提只认 repo + pr_number + run_id + head_sha + review_required=true

**来源**: `[FROM_PRD]` — Golden Path 第 1 步、边界情况第 2/3 条、范围限定。

**可观测行为**: Kernel-owned 判定来自 run/task/PR 当前 head 的四元组；一旦 `tasks.payload.review_required=true`，系统进入必须人工审核的 merge gate。标题大小写、空格、改名、branch 前缀、body 改动、PR 内脚本修改都不再改变 merge authority。

**验证命令**:
```bash
node ./node_modules/vitest/vitest.mjs run \
  sprints/0727184802-kernel-merge-authority/tests/kernel-merge-authority.contract.test.ts \
  -t "标题 feat\\(harness\\) 或 cp- branch 本身不能决定 Harness merge authority|resolveKernelMergeAuthority 只接受 repo pr_number run_id head_sha 四元组"
node ./node_modules/vitest/vitest.mjs run \
  packages/brain/src/orchestrator/__tests__/ground-truth.test.js \
  -t "reviewRequired 从 tasks.payload.review_required（string payload 兼容）；reviewApproved 锚定当前 head_sha"
```

**硬阈值**: 三条测试都 exit 0；旧 `feat(harness)`/`cp-` 旁路不再是授权证据；缺少任一 ownership 字段或 `review_required=true` 但缺人工批准时都必须 fail-closed。

### Step 2: authenticated approve/reject 原子校验 task/run/PR/current head

**来源**: `[FROM_PRD]` — Golden Path 第 2 步、边界情况第 1 条。

**可观测行为**: approve/reject 请求必须携带 `task_id/repo/pr_number/pr_head_sha/review_request_hop` 与 token；只有 task、run、repo、pr_number、current head 全匹配时才写 `human_review` verdict。approve 成功写 `approved_by/pr_head_sha/source/timestamp/repo/pr_number/run_id`，reject 成功对称写 `rejected_by/pr_head_sha/source/timestamp/repo/pr_number/run_id`。

**验证命令**:
```bash
node ./node_modules/vitest/vitest.mjs run \
  sprints/0727184802-kernel-merge-authority/tests/kernel-merge-authority.contract.test.ts \
  -t "approve route 缺少 repo 或 pr_number 时拒绝且不写 human_review verdict|approve route 记录含 approved_by pr_head_sha source timestamp repo pr_number run_id 的 human_review detail|reject route 记录含 rejected_by pr_head_sha source timestamp repo pr_number run_id 的 human_review detail|reject route stale SHA 或 run/PR 不匹配时拒绝且不写 human_review verdict"
```

**硬阈值**: 缺 token/缺 repo/缺 pr_number/缺 SHA/不匹配时分别返回 401/400/409 且 `orchestrator_decision_log` 不新增 verdict；approve/reject 成功时 detail 必含调用人、`pr_head_sha`、`source`、`timestamp`、`repo`、`pr_number`、`run_id`。

### Step 3: review_required=true 且无当前 SHA 批准时任何 merge caller 都不能合并

**来源**: `[FROM_PRD]` — Golden Path 第 1/3 步、边界情况第 2/4 条。

**可观测行为**: 只要 `review_required=true` 且当前 head 没有有效 `human_review` 批准，Kernel、CI、legacy caller 一律不能 merge；首次变更就必须把 `review_required=true` 视为待审信号而不是可跳过元数据。

**验证命令**:
```bash
node ./node_modules/vitest/vitest.mjs run \
  sprints/0727184802-kernel-merge-authority/tests/kernel-merge-authority.contract.test.ts \
  -t "review_required=true 且无有效 human_review 批准时所有 merge caller 都不能合并"
node ./node_modules/vitest/vitest.mjs run \
  packages/brain/src/orchestrator/__tests__/ground-truth.test.js \
  -t "reviewRequired 从 tasks.payload.review_required（string payload 兼容）；reviewApproved 锚定当前 head_sha"
```

**硬阈值**: 两条测试都 exit 0，且 `mergeGate(...).allow == false`；不存在“review_required=true 但 caller 换条路径就能 merge”。

### Step 4: stale SHA 使既有 evaluator/judge/human_review 全失效

**来源**: `[FROM_PRD]` — Golden Path 第 3 步、边界情况第 4 条。

**可观测行为**: 批准 A 后 push B，旧 evaluator/judge/human_review 都不能继续放行 merge；系统回到等待重跑证据链。

**验证命令**:
```bash
node ./node_modules/vitest/vitest.mjs run sprints/0727184802-kernel-merge-authority/tests/kernel-merge-authority.contract.test.ts -t "mergeGate 对 stale human approval fail-closed 并要求重跑证据链"
```

**硬阈值**: `mergeGate(...).allow == false` 且 reason 指向 stale review/head mismatch；不存在“批准 A 合并 B”。

### Step 5: merge 只接受当前 head 的全量证据并原子锁头

**来源**: `[FROM_PRD]` — Golden Path 第 3 步、边界情况第 4/5 条。

**可观测行为**: merge handler 只在 evaluate/judge/human_review 全部锚定当前 head 时执行 merge，并使用 `--match-head-commit` 或 compare-and-merge。

**验证命令**:
```bash
node ./node_modules/vitest/vitest.mjs run sprints/0727184802-kernel-merge-authority/tests/kernel-merge-authority.contract.test.ts -t "merge_pr 调用 gh 时必须传 --match-head-commit 当前 head_sha"
```

**硬阈值**: 生成的 merge 命令必须显式含当前 `head_sha` 锁；无锁头参数视为 FAIL。

### Step 6: CI 与 legacy merge caller 一律 fail-closed

**来源**: `[AI_ADDED]` — Reviewer/Proposer 防造假补充，理由：PRD 明示“CI 和 legacy merge caller 必须 fail-closed”，但现状证据显示 `.github/workflows/scripts/should-auto-merge.sh` 仍可被标题与 PR 内容绕开，需要把这一点机械化。

**可观测行为**: 旧 should-auto-merge 标题逻辑不能再单独决定 merge；Kernel-owned PR 只能经 Kernel merge gate，普通 PR 即使标题写成 `feat(harness)` 也不能被误分类，脚本输出必须体现 fail-closed 语义而不是“仅凭标题跳过后默认安全”。legacy caller `finalizeHarnessTask` 即使看到 PR 已 MERGED，也必须额外校验当前 head 对应的 evaluator/judge/human_review 证据，否则拒绝放行终态。

**验证命令**:
```bash
node ./node_modules/vitest/vitest.mjs run sprints/0727184802-kernel-merge-authority/tests/kernel-merge-authority.contract.test.ts -t "标题 feat\\(harness\\) 或 cp- branch 本身不能决定 Harness merge authority"
```

**硬阈值**: 对只给 `branch/title` 的脚本调用不再输出可直接授权 merge 的结果，并显式返回 fail-closed 语义；普通 PR 不因标题误入 Harness 通道；`finalizeHarnessTask` 不得仅凭 `PR MERGED + evaluator gate` 放行。

## 接缝清单

1. `routes/harness-kernel-approvals.js` ↔ `orchestrator_decision_log`：批准落账必须与 run/head 校验在同一事务里完成。
2. `ground-truth.js` / `gates.js` ↔ 当前 PR `head_sha`：旧 verdict 对新 head 必须立即失效。
3. `kernel-handlers.js` ↔ `gh pr merge`：merge 参数必须携带当前 head 锁，避免 gate/merge TOCTOU。
4. `.github/workflows/scripts/should-auto-merge.sh` ↔ CI caller：标题/branch/script 不能再越权决定 merge authority。
5. `packages/brain/src/lib/harness-finalize.js` ↔ GitHub PR 真相：legacy finalize caller 不得绕过当前 head 的 human_review/judge gate。

## 禁 mock 边清单

- `packages/brain/src/routes/harness-kernel-approvals.js` ↔ `orchestrator_decision_log`（本单改 approve/reject 落账与原子校验，测试必须真走 route 逻辑，不能直接 stub 成功 verdict）
- `packages/brain/src/orchestrator/ground-truth.js` ↔ `packages/brain/src/orchestrator/gates.js`（本单改 stale SHA 失效语义，测试必须真跑当前 head 与 verdict 对比）
- `packages/brain/src/orchestrator/kernel-handlers.js` ↔ `gh pr merge` 参数组装（本单改 merge 锁头，测试必须真跑 merge handler 生成命令）
- `.github/workflows/scripts/should-auto-merge.sh` ↔ CI 决策调用（本单移除标题型旁路，测试必须真执行脚本而不是 mock 返回值）
- `packages/brain/src/lib/harness-finalize.js` ↔ `initiative_run_events` / GitHub PR state（本单改 legacy merge caller fail-closed，测试必须真跑 finalize 逻辑，不能 stub allow=true）

## 未覆盖真实链路清单

| 未覆盖点 | 原因 | 补位计划 |
|---|---|---|
| 真实 GitHub PR 上的 `gh pr merge --match-head-commit` | 合同阶段只产出脚本与红测，不实际改线上 PR | evaluator final-e2e 在当前 Kernel PR 上真调 `gh pr view`/`gh pr merge --match-head-commit` 验证 |
| branch protection required approvals=0 的仓库设置变更 | 仓库设置不在代码仓内 | 由主理人在 GitHub 设置侧补位，代码内通过 fail-closed 阻断旁路 |
| 真实 CI caller 与 GitHub Actions token 行为 | proposer 阶段不跑 GitHub Actions | generator 完成后以 workflow_dispatch 做一次真实仓库 smoke |

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail

cd /workspace

TASK_ID="${HARNESS_TASK_ID:-ea7f6b59-b2fd-48a4-940f-e267c9898889}"
TASK_JSON=$(curl -fsS --max-time 10 "http://localhost:5221/api/brain/tasks/$TASK_ID")
echo "$TASK_JSON" | jq -e --arg id "$TASK_ID" '
  (.id // .task.id) == $id
  and ((.payload.sprint_dir // .task.payload.sprint_dir) == "sprints/0727184802-kernel-merge-authority")
' >/dev/null

PR_URL=$(echo "$TASK_JSON" | jq -r '.pr_url // .payload.pr_url // .task.pr_url // .task.payload.pr_url // empty')
[ -n "$PR_URL" ] || { echo "FAIL: task 未提供 pr_url"; exit 1; }

CURRENT_SHA=$(gh pr view "$PR_URL" --json headRefOid --jq '.headRefOid')
[ -n "$CURRENT_SHA" ] || { echo "FAIL: gh 未返回 headRefOid"; exit 1; }

node ./node_modules/vitest/vitest.mjs run \
  sprints/0727184802-kernel-merge-authority/tests/kernel-merge-authority.contract.test.ts \
  packages/brain/src/routes/__tests__/harness-kernel-approvals.test.js \
  packages/brain/src/__tests__/integration/kernel-wiring.pg.integration.test.js \
  packages/brain/src/orchestrator/__tests__/ground-truth.test.js \
  packages/brain/src/orchestrator/__tests__/kernel-handlers.test.js

RESP_CODE=$(curl -s -o /tmp/kernel-approve-resp.json -w "%{http_code}" \
  -X POST "http://localhost:5221/api/brain/harness/kernel-reviews/11111111-1111-4111-8111-111111111111/approve" \
  -H "Content-Type: application/json" \
  -d "{\"task_id\":\"22222222-2222-4222-8222-222222222222\",\"repo\":\"perfectuser21/cecelia\",\"pr_number\":4379,\"pr_head_sha\":\"$CURRENT_SHA\",\"review_request_hop\":3,\"approved_by\":\"codex-e2e\"}")
[ "$RESP_CODE" = "401" ] || [ "$RESP_CODE" = "503" ] || { echo "FAIL: 未鉴权 approve 应 fail-closed，实际 $RESP_CODE"; cat /tmp/kernel-approve-resp.json; exit 1; }
cat /tmp/kernel-approve-resp.json | jq -e '.error | type == "string"' >/dev/null

DB_URL="${DB_URL:-postgresql://localhost/cecelia}"
COUNT=$(psql "$DB_URL" -t -c "SELECT count(*) FROM orchestrator_decision_log WHERE run_id='11111111-1111-4111-8111-111111111111' AND action='verdict:human_review' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$COUNT" = "0" ] || { echo "FAIL: 未鉴权 approve 不应写入 human_review verdict"; exit 1; }
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| ownership tuple、approve/reject、legacy finalize、merge lock、CI fail-closed | `sprints/0727184802-kernel-merge-authority/tests/kernel-merge-authority.contract.test.ts` | `标题 feat(harness) 或 cp- branch 本身不能决定 Harness merge authority` / `resolveKernelMergeAuthority 只接受 repo pr_number run_id head_sha 四元组` / `approve route 缺少 repo 或 pr_number 时拒绝且不写 human_review verdict` / `approve route 记录含 approved_by pr_head_sha source timestamp repo pr_number run_id 的 human_review detail` / `reject route 记录含 rejected_by pr_head_sha source timestamp repo pr_number run_id 的 human_review detail` / `reject route stale SHA 或 run/PR 不匹配时拒绝且不写 human_review verdict` / `review_required=true 且无有效 human_review 批准时所有 merge caller 都不能合并` / `mergeGate 对 stale human approval fail-closed 并要求重跑证据链` / `merge_pr 调用 gh 时必须传 --match-head-commit 当前 head_sha` / `finalizeHarnessTask 在 review_required=true 且缺当前 SHA human_review 时 fail-closed` | 实测红证据：`mergeGate` 仍允许 stale human approval；`merge_pr` 仍发 `gh pr merge ... --squash --delete-branch` 且缺 `--match-head-commit`；`.github/workflows/scripts/should-auto-merge.sh` 仍输出 `SKIP: harness-owned PR...` 而非 fail-closed；`packages/brain/src/harness-ci-gate.js` 尚未导出 `resolveKernelMergeAuthority`；`finalizeHarnessTask` 目前只看 `PR MERGED + evaluator gate`，未绑定当前 SHA 的 `human_review/judge`；本地未起 Postgres 时真实 PG 红测会以 `ECONNREFUSED 127.0.0.1:5432` 直接失败，说明接缝测试没有被 mock 掩盖 |
