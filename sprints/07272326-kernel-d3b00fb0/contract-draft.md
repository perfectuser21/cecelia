# Sprint Contract Draft (Round 1)

contract-gate: active
覆盖父路 Preview workflow-route-authorities 第 1-5 步

## Notes

- context-manifest: unavailable
- registry freshness: api/db/test registry 最新扫描于 2026-07-18，已过期约 216h；仅作命名风格参考，PRD 仍为法律。
- github-oracle: 2026-07-27 经 `gh pr view 4372 --repo perfectuser21/cecelia` 实读，PR #4372 仍为 Draft，当前 `headRefOid=4dc3b69aaca97e16fd4c8e28c35c4a8b6fd08f13`。
- main-binding: 2026-07-27 经 `git ls-remote origin refs/heads/main` 实读，`origin/main=d37a5e57827900be2651fe39655690238513128f`；合同要求执行期绑定该 SHA 或更新 SHA，新 head 一出现旧收据立即失效。
- initiative_id: unavailable in proposer inputs；`task-plan.json` 以 `pending` 占位，不改变合同语义。
- review-required: PRD 明确 `review_required=true`；contract/evaluator 只读验证 Draft/head/授权记录，禁止 POST 人审、merge 或 deploy。
- database-safety: `TEST_DATABASE_URL` 必填；禁止 `DB_URL` / `DATABASE_URL` / `postgresql://localhost/cecelia` fallback；连接前必须用 `current_database()` + `inet_server_addr()` 验证不是 `cecelia`、不是默认/生产 loopback。
- red-evidence: 本轮 Red 只接受具名业务断言失败；不接受 vitest/config/import/基础设施启动失败伪装 Red。

## Response Schema（推导来源: [PRD字面/api_registry推导]）

### Endpoint: `POST /api/brain/preview/start`
**Success (HTTP 200)**:
```json
{
  "port": 5300,
  "db_name": "cecelia_preview_4372",
  "status": "starting"
}
```
- `port` (number, 必填): 来源——现有 `packages/brain/src/routes/preview.js` 成功响应。
- `db_name` (string, 必填): 来源——现有 `preview.js` 成功响应。
- `status` (string, 必填且字面量 `starting`): 来源——现有 `preview.js` 成功响应。
- 工作流实际请求字段（必须机械核对）: `pr_number`、`branch_name`、`Authorization`、`Content-Type`。
- 新增 authority 标识字段（允许扩展，但只能作标识/相等性主张）: `repository`、`base_repo`、`workflow_run_id`、`task_id`、`run_id`、`check_sha`、`review_required`。
**禁用字段名**: `tenant_id`, `target_environment`, `required_contexts`, `head_sha`, `draft_state`, `decision_reason`, `approved`, `merged`
**Error (HTTP 4xx/5xx)**:
```json
{
  "error": "<string>",
  "reason": "<stable-string-or-null>"
}
```

### Endpoint: `GET /api/brain/preview/status/:pr`
**Success (HTTP 200)**:
```json
{
  "pr_number": 4372,
  "status": "starting",
  "port": 5300,
  "db_name": "cecelia_preview_4372",
  "base_repo": "cecelia",
  "branch_name": "cp-07271751-51836fb2"
}
```
- `pr_number` / `status` / `port` / `db_name` / `base_repo` / `branch_name` (必填): 来源——现有 `preview_environments` 真表字段与现有 `getPreview()` 返回形状。
- authority 账本必须另行真查并落库: `repository`、`workflow_run_id`、`task_id`、`run_id`、`current_head_sha`、`draft_state`、`required_contexts`、`required_context_verdict`、`decision_reason`。
**禁用字段名**: `latest_row`, `recent_reason`, `caller_head_sha`, `fallback_sha`, `fake_contexts`
**Error (HTTP 4xx/5xx)**:
```json
{
  "error": "<string>",
  "reason": "<stable-string-or-null>"
}
```

## 已知约束（来自回归测试）

- [packages/brain/src/__tests__/preview-manager.test.js] → `allocates first free port in 5300-5399 range`
- [packages/brain/src/__tests__/preview-manager.test.js] → `returns existing allocation when same PR already has active record (idempotent)`
- [packages/brain/src/__tests__/preview-manager.test.js] → `resets status to starting on reuse`
- [packages/brain/src/__tests__/integration/preview-destroyer.test.js] → `only destroys latest live row when inactive history exists`
- [packages/brain/src/__tests__/integration/preview-destroyer.test.js] → `cleanup_failed when db_name invalid`
- [packages/brain/src/routes/__tests__/preview.test.js] → `POST /start returns port and db_name on success`
- [packages/brain/src/routes/__tests__/preview.test.js] → `GET /status/:pr_number returns preview record when found`
- [packages/brain/src/__tests__/review-preview-process-ownership.test.js] → `does not kill an unrelated process that already owns the requested port`
- [累积FR] context-manifest: unavailable

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求：系统对外承诺做什么 | 真实 preview workflow 必须直连 `POST /api/brain/preview/start` 与 `GET /api/brain/preview/status/:pr`；服务端只把调用方值当作标识/相等性主张，再用 DB/GitHub 真相完成 authority 校验、落隔离记录、写 decision log，并在 SHA/仓库/run/task/context/approval 任一不一致时稳定拒绝。 |
| **NFR（做得多好）** | 非功能需求：性能/可靠性/并发阈值等 | 业务 Red 只能在依赖加载完成后触发；工作流必须保留 HTTP status/body 原始收据；所有记录必须用 repository/run/task/current SHA 精确绑定，禁止“最近一条”近似匹配。 |
| **Invariant（永不违反）** | 任何情况下不得打破的不变量 | 不得改用 `harness-callback.js`、approval route 或 helper seam 代替真实 preview seam；不得写生产 merge/deploy/human approval；新 head 出现即旧收据失效。 |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 该能力/数据/token 何时失效，谁负责退役 | preview authority 收据在同一 PR head SHA 未变化前有效；GitHub PR #4372 出现新 head 后旧 receipt 必须立即作废，由 route/ground-truth 读取方负责失效。 |
| **死亡告警（停了谁知道）** | 该功能停止工作后，谁在多久内会知道，用什么告警手段 | workflow contract 测试、route PG contract、judge/evaluator 回归在 CI 内发现；preview route 真拒绝 reason 与 decision log 行缺失时，CI 与本地 E2E 立即失败。 |
| **失败语义（挂了怎么办）** | 故障时放行还是拦截？重试幂等？降级策略？ | authority 信息不全、SHA 不匹配、GitHub 必需 context 不满足、授权缺失、测试库不安全，一律 fail-closed；外部基础设施故障返回稳定 `external_infrastructure_failure`，不伪装业务 PASS。 |
| **效果确认（已发≠已生效）** | 每个对外动作如何确认真实生效？回执方式/时限/拿不到算什么 | workflow 必须保存 HTTP status/body 收据；route 必须在 isolated PG 与 `orchestrator_decision_log` 写同一 identity/SHA 记录；postmerge staging、production promotion、final report 必须各自产生独立记录并各自终态校验。 |

### 判定点登记表（对模糊现实的判断假设 — decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| ⚠️当前 head SHA 是否可信 | A. 调用方 body/header 自报；B. `gh pr view` / GitHub API 只读实查 | B. `gh pr view` / GitHub API 只读实查 | PRD 明确要求 server-owned current-SHA gate | 旧回执被错误放行，错误 merge/deploy 链路继续推进 |
| ⚠️review_required 授权是否已满足 | A. POST approval route；B. 只读 isolated DB 中已种下的人审 PASS / judge PASS / evaluator PASS 记录 | B. 只读 isolated DB 记录 | PRD 禁止 contract/evaluator 阶段 POST 人审或 merge | 执行体自批，绕过人工门 |
| required contexts 是否满足 | A. 调用方传 `required_contexts`；B. 服务端按 repo/PR/head 自行解析并核对每个 context | B. 服务端自行解析并逐项核对 | PRD 要求 caller 只提供 identifier/equality claim | 缺 context 被误判为通过，直接面客错误 |
| legacy adapter 是否真的走原路径 | A. 给新 route 打 legacy label；B. 直接调用 legacy adapter 原函数/原入口 | B. 调 legacy adapter 原入口 | PRD 明确指出“新 route + legacy label”不算 | 旧语义回归被假绿掩盖 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| `TEST_DATABASE_URL` 缺失或命中非测试库 | 在任何写入前报错并拒绝启动契约测试 | 否 | 无 fallback；必须显式补安全测试库 |
| workflow HTTP 422/500 或 body 缺失 | 记录原始 status/body，业务断言失败 | 是 | 不使用 `curl -f/-s` 吞响应；允许后续人工查看收据 |
| GitHub 读取当前 head/context 失败 | 返回稳定 `external_infrastructure_failure` | 是 | 不继续写 allow 记录 |
| SHA/仓库/run/task/context/approval 任一不匹配 | 写 deny 记录并保留精确 stable reason | 是 | 不触发 merge/deploy/approval |
| postmerge staging/promotion/report 任一阶段缺独立记录 | 当前阶段 fail-closed | 是 | 不允许拿其他阶段记录替代 |

### 输入对抗面（对外暴露 agent 必填 — decisions 27b57469 第9要素）

N/A — 本 sprint 只覆盖 GitHub workflow 与 Brain preview route 内部 authority 接缝，不新增外部可写 agent 输入面。

## 真实调用方请求 shape

### Workflow caller: `POST /api/brain/preview/start`
- 认证: `Authorization: Bearer <DEPLOY_TOKEN>`
- 头: `Content-Type: application/json`
- 当前真实 body 字段: `pr_number` (number), `branch_name` (string)
- 合同扩展字段: `repository` (string), `base_repo` (string), `workflow_run_id` (number|string), `task_id` (uuid), `run_id` (uuid), `check_sha` (40-char sha), `review_required` (boolean)
- 规则: route 只可把以上字段当标识或相等性主张；`target_environment`、`current_head_sha`、`required_contexts`、`draft_state` 必须由服务端自取真相，禁止从 caller body 信任。

### Workflow caller: `GET /api/brain/preview/status/:pr`
- 路径参数: `:pr` = workflow PR number
- 认证: 无新增 caller body；只读状态查询
- 规则: `status/:pr` 必须与 isolated PG 中该 PR 的 authority receipt、GitHub 当前 head、decision log 记录对账；禁止只返回“最近一条 preview_environments 行”就宣称通过。

## 接缝清单

- `.github/workflows/preview-deploy.yml` shell ↔ `POST /api/brain/preview/start` 真 HTTP 请求：必须真执行脚本并抓请求/响应收据。
- `packages/brain/src/routes/preview.js` ↔ `preview_environments` / `tasks` / `orchestrator_decision_log` 真 PostgreSQL：必须真落隔离行并按 repository/run/task/current SHA 精确查回。
- `preview.js` ↔ GitHub PR #4372 真相：必须真读 Draft/head/context，不能自喂 SHA。
- legacy adapter 原路径 ↔ 新 authority gate：必须证明原 pass/fail 语义保持、记录隔离不串线。
- postmerge staging / production promotion / final report 三阶段记录 ↔ orchestrator gate：必须分别建独立记录并独立终态校验。

## 禁 mock 边清单

- preview workflow shell ↔ preview route HTTP（本单改 workflow 请求权威字段与收据保存，测试必须真发 HTTP 请求）
- preview route ↔ `preview_environments` / `tasks` / `orchestrator_decision_log`（本单改 DB 写路径与对账，测试必须真 PostgreSQL）
- preview route ↔ GitHub PR #4372 head/draft/context 真相（本单改 server-owned authority gate，测试必须真读 GitHub，只读）
- preview route ↔ legacy adapter 原入口（本单要求旧语义验真，测试必须真调 legacy path）

## 未覆盖真实链路清单

- merge / deploy 外部执行体：合同与 evaluator 阶段按 PRD 只允许 spy 断言 `zero negative / one positive` 调用计数，不执行真实生产 merge 或 deploy；真生产动作留给人工批准后的后续阶段。

## Golden Path

[入口：PR #4372 的 preview workflow 触发] → [真实 `POST /api/brain/preview/start` 保存原始 HTTP 收据] → [preview route 用 DB/GitHub 真相解析 authority 并落隔离 PG + decision log] → [真实 `GET /api/brain/preview/status/:pr` 与 legacy adapter / generator-fix / postmerge 三段各自对账] → [出口：PR 仍为 Draft，零生产 mutation，只留下绑定最终 SHA 的独立证据]

### Step 1: workflow 真发 `POST /api/brain/preview/start`，同时机械保存 HTTP status 和 body
**来源**: `[FROM_PRD]` — PRD 第 18 行与 Golden Path 第 1 步直接定义。

**可观测行为**: start step 不使用 `curl -f/-s` 吞收据；无论 2xx/4xx/5xx，都能回收 body 与状态码，并把当前 workflow 请求字段逐项写入收据。

**验证命令**:
```bash
npx vitest run sprints/07272326-kernel-d3b00fb0/tests/preview-workflow-route-authority.contract.test.ts \
  -t 'workflow start step 保留原始 HTTP status/body 且逐项发送 authority identifiers' --reporter=verbose
```

**硬阈值**: 请求体至少包含 `pr_number/branch_name/repository/base_repo/workflow_run_id/task_id/run_id/check_sha/review_required`；失败响应也必须保留原始 body；若代码仍使用 `curl -sf` 或 `2>/dev/null` 丢 body，则该测试必须 FAIL。

---

### Step 2: preview route 只信 caller 的 identifier/equality claim，其余 authority 全部由服务端实查
**来源**: `[FROM_PRD]` — PRD 第 19-20、24-28 行。

**可观测行为**: route 用 isolated PG + GitHub PR #4372 当前 Draft/head/context 真相解析 `target_environment/base_repo/repository/workflow/task-run/current_head_sha/required_contexts`，并把 identity/SHA 绑定到单条 record 与 decision log。

**验证命令**:
```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" npx vitest run \
  sprints/07272326-kernel-d3b00fb0/tests/preview-route-authority.pg.contract.test.ts \
  -t 'preview route 只把 caller 字段当 identifier claim 并写 authority-bound receipt' --reporter=verbose
```

**硬阈值**: DB 读取必须用 `repository + workflow_run_id + task_id + run_id + current_head_sha` 精确定位；任何“最近一条”“只按 pr_number”“只按 task_id”的近似查找都不合格。

---

### Step 3: 每个稳定 blocker 与每个负向变体必须独立失败，stable reason 逐条精确
**来源**: `[FROM_PRD]` — PRD 边界情况段第 24-28 行。

**可观测行为**: `stale_check_sha`、`wrong_repo`、`wrong_run_task`、`missing_required_context`、`preview_required_failure`、`local_required_context_failure`、`missing_context_mapping`、`external_infrastructure_failure` 各自独立触发、独立写 deny reason，且不允许 OR 合并或 grep 文本当 oracle。

**验证命令**:
```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" npx vitest run \
  sprints/07272326-kernel-d3b00fb0/tests/preview-route-authority.pg.contract.test.ts \
  -t 'stable blocker' --reporter=verbose
```

**硬阈值**: 每个 blocker 至少 1 条正向 + 1 条 mutation/counterfactual；reason string 必须精确等于 PRD 稳定值；一条 combined object/OR 断言不能替代多个 blocker。

---

### Step 4: generator-fix、legacy adapter、status route 都必须回到同一真实 preview seam，对同一 current SHA 对账
**来源**: `[FROM_PRD]` — PRD 第 20、45-46 行与条款 5、8。

**可观测行为**: generator-fix 不是 helper existence；legacy adapter 不是“新 route + legacy label”；它们都必须走真实 route→DB→GitHub current SHA gate，并对同一 identity/SHA 写独立记录。

**验证命令**:
```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" npx vitest run \
  sprints/07272326-kernel-d3b00fb0/tests/preview-route-authority.pg.contract.test.ts \
  -t 'generator-fix uses the real preview seam|legacy adapter 原路径保持原 pass/fail 语义' --reporter=verbose
```

**硬阈值**: legacy 与 generator-fix 至少各有一条正向与一条负向；记录 identity 必须与 preview receipt 完全相等，SHA 不等即 FAIL。

---

### Step 5: postmerge staging / production promotion / final report 三阶段必须各自独立记录；contract/evaluator 阶段零生产 mutation
**来源**: `[FROM_PRD]` — PRD 第 28、68、77-79 行。

**可观测行为**: staging、promotion、report 各自写独立 record，且读取同一 final SHA 的 isolated evaluator PASS / judge PASS / human approval rows；新 head 产生时全部失效；contract/evaluator 阶段只允许 merge/deploy spies 计数，不允许真实生产动作。

**验证命令**:
```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" npx vitest run \
  sprints/07272326-kernel-d3b00fb0/tests/preview-route-authority.pg.contract.test.ts \
  -t 'postmerge staging|production promotion|final report|零生产 mutation' --reporter=verbose
```

**硬阈值**: 三阶段各自产生 1 条独立记录且各有负向 mutation；`mergeSpy=0/deploySpy=0/approvalPost=0` 在 contract 阶段必须成立；只有读取到同一 final SHA 的已种下审批记录后，正向用例才允许 `positiveSpy=1`。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| workflow 原始收据与 authority identifiers | `sprints/07272326-kernel-d3b00fb0/tests/preview-workflow-route-authority.contract.test.ts` | `保留原始 HTTP status/body`、`发送 authority identifiers`、`status step 保留 body/reason` | 当前 workflow 仍使用 `curl -sf` 且只发送 `pr_number/branch_name`，具名断言失败 |
| route authority / blocker / legacy / postmerge | `sprints/07272326-kernel-d3b00fb0/tests/preview-route-authority.pg.contract.test.ts` | `caller 字段当 identifier claim`、`stable blocker`、`generator-fix uses the real preview seam`、`legacy adapter 原路径保持原 pass/fail 语义`、`postmerge staging`、`production promotion`、`final report`、`零生产 mutation` | 当前 `preview.js` 仅返回 `port/db_name/status` 且无 authority gate；实现前这些具名业务断言应保持 Red |

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/usr/bin/env bash
set -euo pipefail

: "${TEST_DATABASE_URL:?必须显式提供 TEST_DATABASE_URL，禁止 fallback}"

node - <<'NODE'
const url = new URL(process.env.TEST_DATABASE_URL);
const db = url.pathname.replace(/^\\//, '');
if (!db || db === 'cecelia' || !/(_test|_scratch)$/.test(db)) {
  throw new Error(`拒绝非测试数据库: ${db || '<empty>'}`);
}
NODE

GH_JSON=$(gh pr view 4372 --json number,isDraft,headRefOid,headRefName,baseRefName,url --repo perfectuser21/cecelia)
echo "$GH_JSON" | jq -e '.number == 4372 and .isDraft == true and (.headRefOid | type == "string")'
HEAD_SHA=$(echo "$GH_JSON" | jq -r '.headRefOid')

TEST_DATABASE_URL="$TEST_DATABASE_URL" CONTRACT_PR_HEAD_SHA="$HEAD_SHA" \
  npx vitest run \
  sprints/07272326-kernel-d3b00fb0/tests/preview-workflow-route-authority.contract.test.ts \
  sprints/07272326-kernel-d3b00fb0/tests/preview-route-authority.pg.contract.test.ts \
  --reporter=verbose

echo "OK: preview workflow-route-authorities contract verified against current head $HEAD_SHA"
```
