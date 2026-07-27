# Sprint Contract Draft (Round 1)

Sprint: P0 Preview CI Recovery 5 real workflow runner route PG GH 07272342
journey_type: autonomous target_environment: local_api

独立小路（无父路）

## Response Schema（推导来源: PRD字面 + 真实调用方 `.github/workflows/preview-deploy.yml` + `packages/brain/src/routes/preview.js`）

### Endpoint: POST /api/brain/preview/start
**Success (HTTP 200)**:
```json
{"port": 5300, "db_name": "cecelia_preview_4372", "status": "starting"}
```
- `port` (number, 必填): 来源 [FROM_PRD]，必须为 server-owned 分配值。
- `db_name` (string, 必填): 来源 [FROM_PRD]，必须为隔离 PG 库名。
- `status` (string, 必填): 来源 [FROM_PRD]，固定允许值 `starting`。

**Stable rejection (HTTP 409 | 422 | 503)**:
```json
{"error": "preview authorization rejected", "reason": "stale_check_sha"}
```
- `error` (string, 必填): 来源 [AI_ADDED]，统一人类可读摘要，避免调用方分叉解析。
- `reason` (string, 必填): 来源 [FROM_PRD]，仅允许：
  `stale_check_sha` `wrong_repo` `wrong_pr` `wrong_workflow_run` `wrong_run_task`
  `missing_required_context` `preview_required_failure`
  `local_required_context_failure` `missing_context_mapping`
  `external_infrastructure_failure`

**Forbidden fields**: `callback_url` `helper_source` `recorder_path` `approval_token` `merge_performed` `deploy_performed`

### Endpoint: GET /api/brain/preview/status/:pr
**Success (HTTP 200)**:
```json
{
  "pr_number": 4372,
  "branch_name": "cp-preview-current-sha",
  "status": "starting",
  "port": 5300,
  "db_name": "cecelia_preview_4372",
  "repository": "perfectuser21/cecelia",
  "workflow_name": "Preview Deploy",
  "workflow_run_id": "123456789",
  "run_id": "f96afb28-9df6-47f9-a959-9e556c25e058",
  "task_id": "5d7ea601-38e0-4dc6-99ec-c4b4e00ebef9",
  "current_sha": "d37a5e57827900be2651fe39655690238513128f",
  "draft": true,
  "review_required": true
}
```
- `pr_number` `branch_name` `status` `port` `db_name`: 来源 [FROM_PRD]。
- `repository` `workflow_name` `workflow_run_id` `run_id` `task_id` `current_sha` `draft` `review_required`: 来源 [AI_ADDED]，理由：PRD要求三权威、Draft、run/task/current SHA 与 route/status 可机械核对。

**Stable rejection (HTTP 409 | 422 | 503)**:
```json
{"error": "preview authorization rejected", "reason": "wrong_repo"}
```

**禁用字段名**: `latest_row_id` `guessed_sha` `approval_posted` `human_approval_posted`

## 已知约束（来自回归测试）

- [packages/brain/src/routes/__tests__/preview.test.js] -> `POST /start` 现有契约已固定 200/400/503/500 分支，`GET /status/:pr` 已固定 200/404，新增 current-SHA 门禁不能回退这些基础状态码。
- [packages/brain/src/__tests__/preview-manager.test.js] -> 同 PR 重跑必须复用 live row 并把状态重置到 `starting`，不能让旧 `active` 假装本轮已就绪。
- [packages/brain/src/__tests__/integration/preview-destroyer.test.js] -> preview 相关真 PG 测试已存在，repo 对真实库/真实 worktree 集成测试有先例，本 sprint 不得退回全 mock。
- [packages/brain/src/__tests__/integration/kernel-wiring.pg.integration.test.js] -> 同一 run 接受 successive PR head SHA，head 变化后旧授权必须失效。
- [累积FR] context-manifest: unavailable
- [累积FR] （本 line 暂无历史）

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求：系统对外承诺做什么 | 真实 preview workflow 只经 `/api/brain/preview/start` 与 `/api/brain/preview/status/:pr` 进入 Brain；route 以 server-owned current SHA、隔离 PG、真实 GitHub PR 事实与 decision log 决定是否放行。 |
| **NFR（做得多好）** | 非功能需求：性能/可靠性/并发阈值等 | Red/Green 只能在 runner/server/isolated PG/GitHub 只读预检通过后执行；每个稳定 reason 仅 1 条独立 test + 1 条独立 counterfactual；所有 cleanup 在 finally 完成。 |
| **Invariant（永不违反）** | 任何情况下不得打破的不变量 | 不触生产 DB；review_required=true 且 PR Draft 时不得真实 merge/deploy/human approval POST；head SHA 一变旧 receipt 全失效。 |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表。 |
| **保质期（何时过期）** | 该能力/数据/token 何时失效，谁负责退役 | `current_sha` 与 GitHub PR head 绑定；任意新 head 出现时旧 authorization/receipt/approval rows 立即失效。 |
| **死亡告警（停了谁知道）** | 该功能停止工作后，谁在多久内会知道，用什么告警手段 | workflow runner 或 GitHub oracle 不可达时 route 返回 `external_infrastructure_failure`，Red 命令立即失败并在最终报告记录。 |
| **失败语义（挂了怎么办）** | 故障时放行还是拦截？重试幂等？降级策略？ | GitHub/PG/上下文缺失一律 fail-closed；不允许 fallback 到本地默认库、helper 路径或旧 receipt；可重试仅限在新 head 与完整上下文下重跑真实 workflow。 |
| **效果确认（已发≠已生效）** | 每个对外动作如何确认真实生效？回执方式/时限/拿不到算什么 | `/preview/start` 200 仅代表 server-owned 记录已写入；还需 `/preview/status/:pr` 与 `orchestrator_decision_log` 共同确认 current SHA、repository、workflow、run/task identity 与 Draft/approval 链一致。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| ⚠️ 当前 head 是否仍可放行 | A. 读取调用方 body 里的 SHA; B. route 向 GitHub 只读查询 PR 当前 head 并与 server-owned expected SHA 比较 | B. GitHub 只读 head 为准 | PRD明确要求 server-owned current SHA 门禁，禁止 caller-built authority | 旧 SHA 误放行，旧 receipt/approval 被复用到新 head |
| ⚠️ TEST_DATABASE_URL 是否真的指向隔离 PG | A. 只看 env 存在; B. 解析 receipt 并查询 `current_database()` + `inet_server_addr()` + host 分类 | B. 真连库核验 | 仅看 env 字符串无法防本地默认 socket/loopback/生产库误连 | 生产库被测试写入 |
| ⚠️ 三权威是否真正一致 | A. 只看 route 本地缓存; B. GitHub Draft/head + PG rows + decision log identity 逐字段核对 | B. 三方真相交叉核对 | PRD要求 Draft/三权威/后合并链不可退化成单账本 | 错误 SHA、错误 PR 或错误 workflow 仍被视为授权通过 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| `TEST_DATABASE_URL` 缺失、歧义或连到 loopback/default/prod | 启动前立即拒绝，返回非 0，绝不 import/start child server | 否 | 无降级，必须修正 receipt |
| GitHub PR #4372 只读查询失败 | 返回 `external_infrastructure_failure`，不复用历史 head | 是，待 GitHub oracle 恢复后重跑 | 无降级 |
| SHA、repo、PR、workflow_run、run_task 任一不匹配 | 返回对应稳定 reason，旧 rows 保留供审计但不授权 | 是，新上下文修正后可重跑 | 无降级 |
| preview/staging/prod/final-report/evaluator/judge/human approval 任一记录缺失 | `/status` 与最终报告标失败，禁止后续 merge/deploy | 是，补齐当前 SHA 的真实记录后再验 | 不允许伪造 POST 补账 |

### 输入对抗面（对外暴露 agent 必填）

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| GitHub Actions workflow body/header | 中 | route 只接受白名单字段与 Bearer token，不信任 caller 提供的 authority 结论 | 非白名单字段忽略并记录；authority 以 server-owned/GitHub 只读事实为准 |

## 真实调用方请求 shape

来源：`.github/workflows/preview-deploy.yml` 2026-07-27 当前内容。

```
POST /api/brain/preview/start
Headers:
  Authorization: Bearer ${DEPLOY_TOKEN}
  Content-Type: application/json
Body:
  {"pr_number": ${GITHUB_EVENT_NUMBER}, "branch_name": "${GITHUB_HEAD_REF}"}

GET /api/brain/preview/status/:pr
Headers:
  (none required by current workflow)
Path:
  /api/brain/preview/status/${GITHUB_EVENT_NUMBER}
```

DoD 中所有 start/status 断言必须复用以上 header/body/path 字面形状，禁止把 authority 标识改塞到 body-only helper 或 callback payload。

## 未覆盖真实链路清单

- GitHub merge/deploy/human approval 真 POST: 本 sprint 明确禁止真实执行，只允许负向 spy `0/0` 与单条完整授权链上的 merge/deploy spy `1/1` 后立即停止；该禁区由合同显式保留，不视为静默缺口。

## 禁 mock 边清单

- `.github/workflows/preview-deploy.yml` job shell ↔ `POST /api/brain/preview/start`（本单改真实调用方到 route 的边，测试必须跑实际 workflow 片段语义）
- `GET /api/brain/preview/status/:pr` ↔ `preview_environments` / `orchestrator_decision_log`（本单改状态真相来源，测试必须真查 PG）
- preview route ↔ GitHub PR #4372 只读 head/Draft 查询（本单改 server-owned current SHA 门禁，不能 mock GitHub 结果）
- preview route ↔ legacy adapter entry `POST /api/brain/preview/allocate`（本单要求 legacy entry 继续走真实 current-SHA 门禁）
- 代码 ↔ isolated PostgreSQL receipt guard（本单新增 TEST_DATABASE_URL 无 fallback 预检，测试必须真连 receipt 指向的隔离 PG）

## Risks

| 风险 | 触发场景 | Mitigation |
|------|----------|------------|
| GitHub oracle outage | `gh`/GitHub API 暂时不可用 | route 统一返回 `external_infrastructure_failure`；E2E 显式记录并 fail-closed。 |
| TEST_DATABASE_URL receipt 歧义/误导 | receipt 指向 localhost/default/prod/Unix socket | 启动前真连库并断言 `current_database()` 白名单、`inet_server_addr()` 非空非 loopback。 |
| head change stale authorization | Green 前 PR head 变化 | 每次 start/status/approval 读取当前 head；发现变化立即作废旧 rows。 |
| actual workflow runner isolation | workflow 语义在本地 shell 中退化为假 runner | E2E 用受控 child runner 执行真实 workflow shell 片段并保留原始 HTTP status/body。 |
| rollback/cleanup 漏删 | isolated rows/processes 留脏 | 所有命令包在 `finally` cleanup，删除 preview rows、decision log fixtures、child processes。 |

## Golden Path

[真实 workflow runner 预检] -> [TEST_DATABASE_URL 隔离 PG 真连守卫] -> [真实 preview start 请求] -> [server-owned ground truth 写入 decision log] -> [status route 回读当前 SHA/Draft/三权威] -> [独立 stable reason 验证] -> [新 head 使旧 receipt 失效] -> [legacy adapter 继续走真链路] -> [B5 存储链与 spy 审计] -> [停在用户批准前]

### Step 1: Red 前预检必须先证明 TEST_DATABASE_URL 是隔离 PG
**来源**: `[FROM_PRD]` — 边界情况与硬门 2 明确要求任何 import/start/write 之前必须真连隔离 PG，并拒绝 `cecelia`/默认/loopback。

**可观测行为**: 预检脚本在启动 Brain、导入 route、写任何测试数据之前，必须解析 `TEST_DATABASE_URL` 并查询 `current_database()` 与 `inet_server_addr()`；命中 `cecelia`、localhost、127/8、`::1`、Unix/default socket 或空地址时立即失败。

**验证命令**:
```bash
node sprints/07272343-kernel-5d7ea601/tests/preview-current-sha-gate.test.ts --preflight-db
```

**硬阈值**: `current_database()` 属隔离白名单且 `inet_server_addr()` 非空、非 loopback、非 Unix socket。

---

### Step 2: 真实 workflow runner 以真实调用方 shape 打 `/preview/start`
**来源**: `[FROM_PRD]` — Golden Path 第 1 步要求真实 `.github/workflows/preview-deploy.yml` 对真实 mounted route 发起请求，并逐项校验 Authorization/Content-Type/pr_number/branch_name/authority。

**可观测行为**: 受控 runner 按 workflow 当前 shell 语义发送 `POST /api/brain/preview/start`；返回 HTTP 200 时 body 顶层 keys 必须严格等于 `["db_name","port","status"]`，禁止出现 forbidden fields。

**验证命令**:
```bash
node sprints/07272343-kernel-5d7ea601/tests/preview-current-sha-gate.test.ts --case start-success-exact-shape
```

**硬阈值**: HTTP 200；`port` 为 number；`db_name` 为 string；`status=="starting"`；`Authorization` 与 `Content-Type` 被 route 真接收且逐项断言。

---

### Step 3: start 成功后 route 把 server-owned ground truth 写入同一隔离 PG
**来源**: `[FROM_PRD]` — Golden Path 第 2 步与 B2 要求 route->same isolated PG->server-owned ground truth->`orchestrator_decision_log` exact identity/repository/workflow/task/run/current SHA。

**可观测行为**: `preview_environments` 与 `orchestrator_decision_log` 中出现同一 current SHA、repo、workflow、run/task identity 的新记录，且不是 latest-row 模糊匹配。

**验证命令**:
```bash
node sprints/07272343-kernel-5d7ea601/tests/preview-current-sha-gate.test.ts --case decision-log-ground-truth
```

**硬阈值**: 精确按 `run_id + workflow_run_id + task_id + current_sha + repository` 命中 1 行；旧 SHA 行不得被覆写成新 SHA。

---

### Step 4: `/preview/status/:pr` 返回 exact status-route keys 与 Draft/current SHA
**来源**: `[FROM_PRD]` — Golden Path 第 3 步要求 status route 逐项返回成功键与状态键，并保持 Draft/三权威。

**可观测行为**: `GET /api/brain/preview/status/4372` 返回固定 keys 集合，包含 current SHA、Draft、review_required、repo/workflow/run/task identity，不含 forbidden fields。

**验证命令**:
```bash
node sprints/07272343-kernel-5d7ea601/tests/preview-current-sha-gate.test.ts --case status-success-exact-shape
```

**硬阈值**: HTTP 200；顶层 keys 严格等于 contract 中定义的 status-route keys；`draft==true`；`review_required==true`。

---

### Step 5: 每个 stable reason 各有 1 个独立 test 与 1 个独立 counterfactual
**来源**: `[FROM_PRD]` — 硬门 4 明确列出 10 个稳定 reason，禁止 regex/OR/combined table-only assertion。

**可观测行为**: `stale_check_sha` `wrong_repo` `wrong_pr` `wrong_workflow_run` `wrong_run_task` `missing_required_context` `preview_required_failure` `local_required_context_failure` `missing_context_mapping` `external_infrastructure_failure` 分别独立触发，各自只返回本 reason。

**验证命令**:
```bash
node sprints/07272343-kernel-5d7ea601/tests/preview-current-sha-gate.test.ts --case stable-reasons
```

**硬阈值**: 10 个 reason 独立通过；每个 reason 各有 1 条 executable test 和 1 条 mutation/counterfactual，互不复用断言。

---

### Step 6: 新 head 出现时旧 authorization 与旧 positive receipts 全部失效
**来源**: `[FROM_PRD]` — 边界情况第 2 条与 B3 明确要求新 head 立即作废旧 SHA 结论。

**可观测行为**: 同一 PR 先以旧 SHA 成功，再把 GitHub 当前 head 改为新 SHA 后重跑，旧 receipt/status/approval rows 被视为 stale，只有新 current SHA 可再次通过。

**验证命令**:
```bash
node sprints/07272343-kernel-5d7ea601/tests/preview-current-sha-gate.test.ts --case head-change-invalidates-old-receipts
```

**硬阈值**: 旧 SHA 请求命中 `stale_check_sha`；新 SHA 请求恢复 200；旧 positive rows 保留审计但不再授权。

---

### Step 7: named actual legacy adapter entry 继续走同一 current-SHA 真链路
**来源**: `[FROM_PRD]` — B4 明确要求调用命名 actual legacy adapter entry，证明原始 pass/fail 与隔离不回退。

**可观测行为**: 旧入口 `POST /api/brain/preview/allocate` 在 pass/fail 两条路径上与新链路共用同一 SHA/PG 守卫，不允许绕过 authority 校验。

**验证命令**:
```bash
node sprints/07272343-kernel-5d7ea601/tests/preview-current-sha-gate.test.ts --case legacy-adapter-entry
```

**硬阈值**: legacy entry 在正确 authority 下返回端口，在错误 SHA 或错误 repo 下返回对应稳定 reason。

---

### Step 8: B5 独立存储 staging/prod/report/evaluator/judge/human approval，并停在用户批准前
**来源**: `[FROM_PRD]` — B5 与 review_required 假设明确要求 separate actual stored rows + distinct evaluator PASS/judge PASS/human approval rows on one current final SHA and actual GitHub Draft/head；不得真实 merge/deploy/human approval POST。

**可观测行为**: 对同一 current final SHA，隔离 PG 中分别存在 staging E2E、production promotion、final report、evaluator PASS、judge PASS、human approval rows；负向 spy `merge/deploy == 0/0`，单条完整授权链正向 spy `1/1` 后立即停止，不产生真实外部动作。

**验证命令**:
```bash
node sprints/07272343-kernel-5d7ea601/tests/preview-current-sha-gate.test.ts --case final-chain-storage-and-spies
```

**硬阈值**: 6 类记录各自独立存在并锚定同一 current SHA；PR 仍为 Draft；无真实 merge/deploy/human approval POST。

---

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/usr/bin/env bash
set -euo pipefail

SPRINT_DIR="sprints/07272343-kernel-5d7ea601"
TEST_FILE="$SPRINT_DIR/tests/preview-current-sha-gate.test.ts"
: "${TEST_DATABASE_URL:?TEST_DATABASE_URL required}"
: "${GH_TOKEN:?GH_TOKEN required for read-only PR #4372 checks}"
: "${DEPLOY_TOKEN:?DEPLOY_TOKEN required}"

cleanup() {
  if [ -n "${BRAIN_PID:-}" ] && kill -0 "$BRAIN_PID" 2>/dev/null; then
    kill "$BRAIN_PID" 2>/dev/null || true
    wait "$BRAIN_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

node "$TEST_FILE" --preflight-db

node packages/brain/src/server.js >/tmp/preview-kernel-brain.log 2>&1 &
BRAIN_PID=$!

DEADLINE=$((SECONDS + 60))
until curl -sS -o /tmp/brain-health.json -w '%{http_code}' http://localhost:5221/api/brain/health | grep -qx '200'; do
  [ "$SECONDS" -lt "$DEADLINE" ] || { echo "FAIL: within 60s brain health not ready"; exit 1; }
  sleep 2
done
grep -q '"status"' /tmp/brain-health.json || { echo "FAIL: brain health body missing status"; cat /tmp/brain-health.json; exit 1; }

node "$TEST_FILE" --case start-success-exact-shape
node "$TEST_FILE" --case decision-log-ground-truth
node "$TEST_FILE" --case status-success-exact-shape
node "$TEST_FILE" --case stable-reasons
node "$TEST_FILE" --case head-change-invalidates-old-receipts
node "$TEST_FILE" --case legacy-adapter-entry
node "$TEST_FILE" --case final-chain-storage-and-spies

echo "OK: preview current-SHA gate E2E passed"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 隔离 PG 预检 | `sprints/07272343-kernel-5d7ea601/tests/preview-current-sha-gate.test.js` | `requires TEST_DATABASE_URL before import or server start` | 现状未实现 receipt 级隔离守卫时 fail |
| start 请求精确 shape | `sprints/07272343-kernel-5d7ea601/tests/preview-current-sha-gate.test.js` | `returns exact start success keys port db_name status` | 现状 route 未做 current-SHA authority 校验时 fail |
| decision log 身份落库 | `sprints/07272343-kernel-5d7ea601/tests/preview-current-sha-gate.test.js` | `persists exact decision log identity for current sha` | 现状无该 ground-truth 记录时 fail |
| status exact keys | `sprints/07272343-kernel-5d7ea601/tests/preview-current-sha-gate.test.js` | `returns exact status route keys for current sha draft review required` | 现状 `/status` 仅回原始 preview row 时 fail |
| stable reasons | `sprints/07272343-kernel-5d7ea601/tests/preview-current-sha-gate.test.js` | `returns stable reason stale_check_sha` `returns stable reason wrong_repo` `returns stable reason wrong_pr` `returns stable reason wrong_workflow_run` `returns stable reason wrong_run_task` `returns stable reason missing_required_context` `returns stable reason preview_required_failure` `returns stable reason local_required_context_failure` `returns stable reason missing_context_mapping` `returns stable reason external_infrastructure_failure` | 现状 reason 未独立冻结时 fail |
| head 变化作废旧 receipt | `sprints/07272343-kernel-5d7ea601/tests/preview-current-sha-gate.test.js` | `invalidates previous positive receipts when github head changes` | 现状旧 receipt 仍可复用时 fail |
| legacy adapter | `sprints/07272343-kernel-5d7ea601/tests/preview-current-sha-gate.test.js` | `legacy allocate entry preserves pass fail and isolated pg` | 现状旧入口未挂 current-SHA gate 时 fail |
| B5 存储链与 spy | `sprints/07272343-kernel-5d7ea601/tests/preview-current-sha-gate.test.js` | `stores staging production report verdict approval rows on one final sha` | 现状链条未分层存储或 spy 次数不对时 fail |
