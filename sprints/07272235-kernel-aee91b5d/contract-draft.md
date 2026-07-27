# Sprint Contract Draft (Round 1)

contract-gate: active
覆盖父路 Kernel Knife1 Recovery 3 第 1-9 步

## Notes

- context-manifest: unavailable
- current-date: 2026-07-27
- historical-evidence-only: proposer commit `d8db6d9f07711fec53d5c88dce60ad03066dfeea` 与 reviewer attempt `6dc36461-01db-443c-9e71-31b7895386dd` 仅作历史证据，不得视为当前 approval
- current-main-baseline: 任务出生基线 `1dc9d4107`；执行时若 `origin/main` 已漂移，旧 merge-base 与旧 76 checks 立即失效
- production-db: forbidden
- context-scope: 仅复用既有 Draft PR `#4372`，不创建新 PR，不继承旧 approval

## Response Schema（推导来源: [api_registry推导/现有路由字面]）

### Endpoint: `POST /api/brain/harness/kernel-reviews/:runId/approve`
**Success (HTTP 202)**:
```json
{
  "ok": true,
  "run_id": "uuid",
  "task_id": "uuid",
  "pr_head_sha": "40-char-sha",
  "review_request_hop": 3,
  "review_class": "merge_gate",
  "approved_by": "review-owner",
  "approved_at": "2026-07-27T00:00:00.000Z"
}
```
- `ok` (boolean, 必填): 来源——现有 `harness-kernel-approvals` 路由成功返回
- `run_id` / `task_id` (string, 必填): 来源——现有路由与 `kernel-wiring.pg.integration.test.js`
- `pr_head_sha` (string, 必填): 来源——现有 stale-SHA 防线
- `review_request_hop` (number, 必填): 来源——现有 request/verdict 同 hop 绑定
- `review_class` (string, 必填): 来源——`reviewClassForReason(...)`
- `approved_by` / `approved_at` (string, 必填): 来源——现有批准事件写入 detail
**禁用字段名**: `approved`, `merge_ready`, `auto_merge`, `approval_id`, `headSha`
**Error (HTTP 4xx/5xx)**:
```json
{"error":"<string>","current_pr_head_sha":"<optional-40-char-sha>"}
```

### Endpoint: `POST /api/brain/harness/kernel-reviews/:runId/reject`
**Success (HTTP 202)**:
```json
{
  "ok": true,
  "run_id": "uuid",
  "task_id": "uuid",
  "pr_head_sha": "40-char-sha",
  "review_request_hop": 3,
  "review_class": "merge_gate",
  "rejected_by": "review-owner",
  "rejected_at": "2026-07-27T00:00:00.000Z"
}
```
- `rejected_by` / `rejected_at` (string, 必填): 来源——现有 reject 路由 detail 字段
**禁用字段名**: `approved`, `approved_by`, `approval_id`, `merge_ready`, `headSha`
**Error (HTTP 4xx/5xx)**:
```json
{"error":"<string>","current_pr_head_sha":"<optional-40-char-sha>"}
```

## 已知约束（来自回归测试）

- [packages/brain/src/routes/__tests__/harness-kernel-approvals.test.js] → `rejects an invalid approver token before any database access`
- [packages/brain/src/routes/__tests__/harness-kernel-approvals.test.js] → `accepts a current review request and commits an observable approval verdict`
- [packages/brain/src/routes/__tests__/harness-kernel-approvals.test.js] → `allows approvals for two GitHub head SHAs in the same run`
- [packages/brain/src/__tests__/integration/kernel-wiring.pg.integration.test.js] → same-SHA approval/evaluator/judge evidence 只对当前 `head_sha` 生效
- [packages/brain/src/orchestrator/__tests__/ground-truth.test.js] → `reviewRequired 从 tasks.payload.review_required（string payload 兼容）；reviewApproved 锚定当前 head_sha`
- [packages/brain/src/orchestrator/__tests__/ground-truth.test.js] → `same-SHA evidence approval cannot satisfy the later merge gate after evaluator and judge PASS`
- [packages/brain/src/orchestrator/__tests__/derive.test.js] → `当前 head_sha 无 evaluate 记录 → spawn:evaluator`
- [packages/brain/src/orchestrator/__tests__/derive.test.js] → `双 PASS && review_required && 未批准 → wait:human_review`
- [packages/brain/src/orchestrator/__tests__/gates.test.js] → `judge PASS 但 sha 不匹配 → 拒`
- [packages/brain/src/__tests__/integration/migration-365-executor-kind-kernel-process.integration.test.js] → 历史 migration 365 仍是合法历史文件，不能仓库级误杀
- [累积FR] context-manifest: unavailable

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求：系统对外承诺做什么 | 在 current `origin/main` 上重新绑定 PR `#4372` 的 F1 基线证据；以 migration `366_kernel_harness_f1_baseline.sql`、隔离测试库护栏、fail-closed F1 suite、同-SHA 审批链证明收口。 |
| **NFR（做得多好）** | 非功能需求：性能/可靠性/并发阈值等 | 生产库零写入；所有危险 URL 在写前 fail-closed；SHA 对账必须以 current head 为准；旧证据、旧 checks、旧 approval 在 head 变化后必须一起失效。 |
| **Invariant（永不违反）** | 任何情况下不得打破的不变量 | PR `#4372` 始终 `isDraft=true` 且 `autoMergeRequest=null`；`review_required=true` 仍由服务端控制；只允许隔离测试库；禁止 `|| true` 与 grep-only proxy 假绿。 |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 该能力/数据/token 何时失效，谁负责退役 | 所有 required context、evaluator PASS、judge PASS、human approval 只对同一 final head SHA 有效；任一新 commit 即过期。 |
| **死亡告警（停了谁知道）** | 该功能停止工作后，谁在多久内会知道，用什么告警手段 | evaluator fail-closed suite、judge/ground-truth 集成测试、legacy smoke、DevGate/current-SHA 检查在 CI 与本地验收中直接失败。 |
| **失败语义（挂了怎么办）** | 故障时放行还是拦截？重试幂等？降级策略？ | 一律 fail-closed；测试库护栏不过、migration 第二次漂移、同-SHA 证据缺任一条、Draft 状态变化、六语义面对账残留冲突均直接失败；不降级为 warning。 |
| **效果确认（已发≠已生效）** | 每个对外动作如何确认真实生效？回执方式/时限/拿不到算什么 | 通过真实 git/gh/PG/Brain route/smoke 组合验证：current main SHA、PR draft 状态、数据库当前库名与 server addr、decision_log 当前 SHA、F1 suite exact counts 全部可执行断言。 |

### 判定点登记表（对模糊现实的判断假设 — decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| ⚠️旧 merge-base 证据是否仍可复用 | A. 只看 merge-base 未冲突; B. 执行时重新抓 current `origin/main` 与 PR head SHA 对账 | B. 重新抓 current `origin/main` 与 PR head SHA 对账 | PRD 明确要求以 current main 现状为准，不认旧 merge-base | 静默复用过期 checks/approval，错误放行 |
| ⚠️approval/judge/evaluator 是否可视为同一 SHA 的有效证据 | A. 只看 PASS/approved 状态; B. 逐条核对 server-owned record 里的 `pr_head_sha` 与当前 head SHA | B. 核对 server-owned `pr_head_sha` | 现有 `ground-truth/derive/gates` 已按 SHA 锚定 | stale verdict 被复用，错误 merge/deploy |
| migration 366 第二次执行是否稳定 | A. 只看 `schema_version` 新增行; B. 对 schema/data/index/constraint 快照做双跑等价对比 | B. 快照等价对比 | PRD 明确禁止依赖脆弱五分钟 `schema_version` 行 | 二次执行 silently drift，生产恢复不可信 |
| evaluator 连接测试库是否安全 | A. 只看 env 变量名; B. 同时校验 URL host、db 名、`current_database()`、`inet_server_addr()` | B. 多重校验 | 单看 env 名无法阻止默认库/127.0.0.1 误连 | 测试污染生产或默认库 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| `origin/main` 漂移或 PR head 变化 | 旧 merge-base / old checks / old approvals 一律失效，重新 evaluate/judge/human review | 是 | 无降级，必须重新绑定 final SHA |
| `HARNESS_TEST_DATABASE_URL` 非法 | 在任何写入前退出非 0，不创建连接或事务 | 是 | 无降级 |
| migration 366 第二次执行后快照不等价 | 视为 recovery 失败并阻塞 | 是 | 无降级 |
| F1 suite 任一子项弱 oracle / 漏跑 | 直接 FAIL，不允许 `|| true` 或 grep-only 继续 | 是 | 无降级 |
| approval/judge/evaluator 证据 SHA 不一致 | 视为 stale record，不得 merge/deploy | 是 | 无降级 |

### 输入对抗面（对外暴露 agent 必填 — decisions 27b57469 第9要素）

N/A — 本 sprint 不新增对外用户输入面；仅收口 Brain/engine 内部 kernel recovery、DB 护栏与审批链证明。

## Risks

| 风险 | 机械缓解 | 验收证据 |
|---|---|---|
| 测试库污染到默认库/生产库 | evaluator 只认 `HARNESS_TEST_DATABASE_URL`；拒绝 `127.0.0.1`/default/production-like；要求 `host.docker.internal`；写前核对 `current_database()` 与 `inet_server_addr()` | 安全测试对 `cecelia`、`postgres`、`127.0.0.1`、非白名单库名均直接失败 |
| 历史 head/check 复用 | 任何 old 76 checks、old merge-base、old approval 在 current `origin/main` 或 PR head 变化后立即失效 | git/gh/ground-truth 套件对 `head_sha` 漂移必须重新 evaluate/judge/review |
| stale approval/judge/evaluator 复用 | 只读 query/fixture 逐条核对三类 server-owned records 绑定同一 final head SHA | same-SHA 集成测试与 merge gate 断言 |
| current-main drift 遮蔽语义冲突 | 六个重叠语义面按 current main 现状逐项对账，而非只看 merge-base | semantic-surface 套件与 zero conflict marker/parallel-path 断言 |

## 真实调用方请求 shape

### Caller: `POST /api/brain/harness/kernel-reviews/:runId/approve`
- 认证方式: `x-approver-token` header；严禁改到 body
- Path 参数: `runId`
- JSON body:
```json
{
  "task_id": "<uuid>",
  "pr_head_sha": "<40-char-sha>",
  "review_request_hop": 3,
  "approved_by": "<string>"
}
```
- Content-Type: `application/json`
- 关键约束: `task_id`、`pr_head_sha`、正整数 `review_request_hop` 必填；服务端当前 `pr_head_sha` 与 body 不同即 `stale_sha`

### Caller: `POST /api/brain/harness/kernel-reviews/:runId/reject`
- 认证方式: `x-approver-token` header；严禁改到 body
- Path 参数: `runId`
- JSON body:
```json
{
  "task_id": "<uuid>",
  "pr_head_sha": "<40-char-sha>",
  "review_request_hop": 3,
  "rejected_by": "<string>"
}
```
- 关键约束: 仍要求当前 `pr_head_sha` 精确匹配；不得用 body 里的 `approved=true`/`approved_by` 伪装拒绝路径

## 接缝清单

- `git/gh current origin/main + PR head` ↔ kernel recovery 决策：真目标验证方式为 `git fetch origin main` + `git rev-parse origin/main` + `gh pr view 4372 --json`
- `packages/brain/migrations/366_*` ↔ 隔离 PostgreSQL：真目标验证方式为同一 isolated DB 连续执行两次 migration 并比较 schema/data/index/constraint 快照
- `orchestrator_decision_log + tasks.payload.review_required + PR state` ↔ merge gate：真目标验证方式为同-SHA evaluator/judge/human approval 只读 fixture 与真实路由/ground-truth/gates 断言

## 禁 mock 边清单

- `packages/engine/src/harness/evaluate.js` ↔ 真 PostgreSQL 测试库连接守卫（本单改写 DB 写前护栏，测试必须真连隔离库验证 `current_database()` / `inet_server_addr()`）
- `packages/brain/migrations/366_kernel_harness_f1_baseline.sql` ↔ PostgreSQL schema/index/constraint（本单改写 DB 写路径，测试必须真 PG 双跑）
- `packages/brain/src/orchestrator/{ground-truth,derive,gates}.js` ↔ `orchestrator_decision_log` / PR head SHA（本单改状态机与跨模块证据接缝，测试必须真查/真断当前 SHA）
- `packages/brain/src/routes/harness-kernel-approvals.js` ↔ server-owned review records（本单改审批链 same-SHA 失效规则，测试必须真调路由或真 fixture，不 mock 被改边）
- `packages/brain/scripts/smoke/*` ↔ F1 equivalence suite（本单改 fail-closed 验收链，测试必须真执行 suite 入口，不允许只 stub 某一支 smoke）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## Golden Path

[入口：接管既有 Draft PR #4372] → [重绑 current `origin/main` 与 final head SHA] → [对 current main 做六重叠语义面对账] → [migration 366 双跑稳定 + evaluator 测试库护栏] → [F1 fail-closed suite exact oracle] → [same-SHA evaluator/judge/human approval 失效链证明] → [出口：PR 仍 Draft，required context 只绑定 final SHA，生产库零写入]

### Step 1: 执行时先抓 current `origin/main`，若不同于出生基线则作废旧 merge-base 证据
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步与第 18、30、82、102 行。

**可观测行为**: 收口基准永远是执行时的 `origin/main`；一旦 current main 已不同于 `1dc9d4107`，旧 merge-base 证据、旧 76 checks、旧 approval 不再被接受。

**验证命令**:
```bash
bash -c 'git fetch origin main --quiet && CUR=$(git rev-parse origin/main) && [ -n "$CUR" ] && [ "$CUR" != "1dc9d4107" ] && echo "$CUR" >/tmp/current-main.sha'
```

**硬阈值**: 必须在验收时实时抓取 `origin/main`；任何只读旧 merge-base 文件或缓存 SHA 的路径都不算通过。

---

### Step 2: 仅复用 Draft PR #4372，并对 current main 的六个重叠语义面逐项对账
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2-3 步与第 19-21、39 行。

**可观测行为**: PR `#4372` 仍存在且处于 Draft；六个已知重叠语义面对 current main 逐项比对后无 conflict marker、无 parallel old/new behavior path、无旧 merge-base 旁路。

**验证命令**:
```bash
bash -c 'gh pr view 4372 --json number,isDraft,autoMergeRequest,headRefOid > /tmp/pr4372.json && jq -e ".number==4372 and .isDraft==true and .autoMergeRequest==null and (.headRefOid|type==\"string\")" /tmp/pr4372.json >/dev/null'
```

**硬阈值**: `isDraft=true`、`autoMergeRequest=null`、六语义面对 current main 现状零冲突零双路径。

---

### Step 3: F1 基线只认 migration 366；语义上旧的 migration-365 合同点必须改绑到 366，但不误伤合法历史 363/364/365 文件
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4-5 步与第 21-22、31、50-51、104 行。

**可观测行为**: `packages/brain/migrations/366_kernel_harness_f1_baseline.sql` 成为唯一 F1 基线锚点；相关 integration/oracle 文案改绑 366；仓库其余历史 363/364/365 文件继续合法存在。

**验证命令**:
```bash
node -e "const fs=require('fs');const p='packages/brain/migrations/366_kernel_harness_f1_baseline.sql';if(!fs.existsSync(p))process.exit(1);const txt=fs.readFileSync(p,'utf8');if(!/schema_version|CREATE|ALTER|INSERT|INDEX|CONSTRAINT/i.test(txt))process.exit(1);"
```

**硬阈值**: F1 suite 不得再把目标 migration 写成 365；同时不能用仓库级 grep 禁止所有 `363|364|365`。

---

### Step 4: 在同一个隔离数据库连续执行 migration 366 两次，终态 schema/data/index/constraint 完全等价
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 步与第 22、33、104 行。

**可观测行为**: 第二次执行 migration 366 不产生 schema、data、index、constraint 漂移；稳定性判定不依赖五分钟 `schema_version` 行。

**验证命令**:
```bash
bash -c ': "${HARNESS_TEST_DATABASE_URL:?}"; psql "$HARNESS_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -c "SELECT 1" >/dev/null'
```

**硬阈值**: 同一 isolated DB 双跑后快照精确等价；若第二次出现任何额外 index/constraint/data 偏移则 FAIL。

---

### Step 5: evaluator 容器写前必须走 `HARNESS_TEST_DATABASE_URL` + `host.docker.internal` + 白名单库名 + `current_database()`/`inet_server_addr()` 四重护栏
**来源**: `[FROM_PRD]` — PRD Golden Path 第 6 步与第 23、32、63-64、105 行。

**可观测行为**: evaluator 若拿到 default/production-like/`127.0.0.1`/非 `host.docker.internal`/非 `*_test|preview_*` 的 URL，会在任何写入前直接失败。

**验证命令**:
```bash
node -e "import('./packages/engine/src/harness/evaluate.js').then(m=>{if(typeof m.validateHarnessTestDatabaseUrl!=='function')process.exit(1);}).catch(()=>process.exit(1))"
```

**硬阈值**: 只认 `HARNESS_TEST_DATABASE_URL`；禁止 fallback 到 `DATABASE_URL` / `DB_URL` / `localhost` / `127.0.0.1`。

---

### Step 6: F1 等价验收是 fail-closed 可执行套件，独立覆盖合同 oracle、真实集成测试、端点语义、运行时非回归、DevGate/current-SHA、七个 legacy smokes
**来源**: `[FROM_PRD]` — PRD Golden Path 第 7 步与第 24、65、106-107 行。

**可观测行为**: 单一 suite 串行跑完所有子项；没有 `|| true`、grep-only proxy、旁路 PASS；最终断言单一 F1 Journey、S0-S12、143 cells、精确 11 elements、8 legacy families。

**验证命令**:
```bash
node -e "const fs=require('fs');const p='packages/brain/scripts/smoke/kernel-f1-equivalence-smoke.sh';if(!fs.existsSync(p))process.exit(1);const t=fs.readFileSync(p,'utf8');if(/\\|\\| true/.test(t))process.exit(1);['contract oracle','integration','endpoint','runtime','devgate','git sha','legacy'].forEach(k=>{if(!t.toLowerCase().includes(k.replace(/ /g,''))&&!t.toLowerCase().includes(k.split(' ')[0]))process.exit(1);});"
```

**硬阈值**: suite 独立执行且 fail-closed；最终 exact oracle 必须断言 `1 journey / S0-S12 / 143 cells / 11 elements / 8 legacy families`。

---

### Step 7: 在隔离 fixture 或只读 query 路径证明 evaluator PASS、judge PASS、human approval 都是 server-owned records，且三者绑定同一 final head SHA
**来源**: `[FROM_PRD]` — PRD Golden Path 第 8-9 步与第 25-26、34、66-67、108-109 行。

**可观测行为**: evaluator PASS、judge PASS、human approval 三条记录都来自服务端；任一新 commit/head 变化时三者与 required checks 一起失效；PR `#4372` 仍 Draft，`review_required=true` 仍由服务端控制。

**验证命令**:
```bash
bash -c 'RESP=$(curl -sf http://localhost:5221/api/brain/health); echo "$RESP" | jq -e ".status==\"ok\" or .ok==true" >/dev/null'
```

**硬阈值**: 任何“修改真实 approval 记录后再证明”都不算；证明必须走只读 fixture/query 路径。

---

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="${ROOT:-$(pwd)}"
PR_NUMBER="${PR_NUMBER:-4372}"
TASK_BIRTH_BASELINE="${TASK_BIRTH_BASELINE:-1dc9d4107}"
TEST_DB_URL="${HARNESS_TEST_DATABASE_URL:?HARNESS_TEST_DATABASE_URL required}"

cd "$ROOT"

git fetch origin main --quiet
CURRENT_MAIN_SHA="$(git rev-parse origin/main)"
[ -n "$CURRENT_MAIN_SHA" ] || { echo "FAIL: missing origin/main sha"; exit 1; }
if [ "$CURRENT_MAIN_SHA" != "$TASK_BIRTH_BASELINE" ]; then
  echo "INFO: current main drifted from task birth baseline"
fi

PR_JSON="$(gh pr view "$PR_NUMBER" --json number,isDraft,autoMergeRequest,headRefOid)"
echo "$PR_JSON" | jq -e '.number == 4372 and .isDraft == true and .autoMergeRequest == null and (.headRefOid | type == "string")' >/dev/null
FINAL_HEAD_SHA="$(echo "$PR_JSON" | jq -r '.headRefOid')"
[ -n "$FINAL_HEAD_SHA" ] || { echo "FAIL: missing final head sha"; exit 1; }

node ./node_modules/vitest/vitest.mjs run \
  "sprints/07272235-kernel-aee91b5d/tests/kernel-pr4372-f1-recovery.contract.test.ts" \
  --reporter=verbose

node -e "import('./packages/engine/src/harness/evaluate.js').then(m=>{if(typeof m.validateHarnessTestDatabaseUrl!=='function')process.exit(1);return m.validateHarnessTestDatabaseUrl(process.env.HARNESS_TEST_DATABASE_URL,{requireReachableHost:true});}).then(r=>{if(!r||r.ok!==true)process.exit(1);}).catch(()=>process.exit(1))"

psql "$TEST_DB_URL" -v ON_ERROR_STOP=1 -c "SELECT current_database(), inet_server_addr();" >/tmp/kernel-f1-db-check.txt
grep -q "host.docker.internal" /etc/hosts || { echo "FAIL: host.docker.internal missing"; exit 1; }

bash packages/brain/scripts/smoke/git-sha-health-smoke.sh
bash packages/brain/scripts/smoke/review-gating-smoke.sh
bash packages/brain/scripts/smoke/harness-judge-smoke.sh
bash packages/brain/scripts/smoke/kernel-fleet-verification-smoke.sh
bash packages/brain/scripts/smoke/harness-lifecycle-gates-smoke.sh
bash packages/brain/scripts/smoke/harness-contract-sha-freeze-smoke.sh
bash packages/brain/scripts/smoke/review-approve-auth-smoke.sh

bash packages/brain/scripts/smoke/kernel-f1-equivalence-smoke.sh

F1_SUMMARY="$(bash packages/brain/scripts/smoke/kernel-f1-equivalence-smoke.sh --print-summary)"
echo "$F1_SUMMARY" | jq -e '.journeys == 1 and .cells == 143 and .elements == 11 and .legacy_families == 8 and .steps == ["S0","S1","S2","S3","S4","S5","S6","S7","S8","S9","S10","S11","S12"]' >/dev/null

echo "OK: final head sha=${FINAL_HEAD_SHA} current main sha=${CURRENT_MAIN_SHA}"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| current-main 漂移与 PR Draft 收口 | `sprints/07272235-kernel-aee91b5d/tests/kernel-pr4372-f1-recovery.contract.test.ts` | `current main 漂移会作废旧 merge-base 证据` | 缺少 current-main drift helper / route-proof 时 FAIL |
| migration 366 基线与双跑稳定 | `sprints/07272235-kernel-aee91b5d/tests/kernel-pr4372-f1-recovery.contract.test.ts` | `migration 366 文件存在且双跑稳定快照可验证` | migration 366 文件不存在时 FAIL |
| evaluator 测试库护栏 | `sprints/07272235-kernel-aee91b5d/tests/kernel-pr4372-f1-recovery.contract.test.ts` | `HARNESS_TEST_DATABASE_URL 写前 fail-closed` | evaluate.js 未导出守卫时 FAIL |
| F1 fail-closed suite | `sprints/07272235-kernel-aee91b5d/tests/kernel-pr4372-f1-recovery.contract.test.ts` | `F1 fail-closed 套件覆盖七个 legacy smokes 与 exact oracle` | suite 文件不存在或含 `|| true` 时 FAIL |
| same-SHA 审批链证明 | `sprints/07272235-kernel-aee91b5d/tests/kernel-pr4372-f1-recovery.contract.test.ts` | `同 SHA evaluator judge human review 只读证明路径存在` | 只读证明 helper/fixture 不存在时 FAIL |

