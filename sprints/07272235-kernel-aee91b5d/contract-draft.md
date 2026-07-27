# Sprint Contract Draft (Round 2)

contract-gate: active
覆盖父路 Kernel Knife1 Recovery 3 第 1-9 步

## Notes

- current-date: 2026-07-27
- execution-snapshot: `origin/main=1dc9d4107cc14f9bc509c1ef285845f1dfb13838`，`gh pr view 4372` 当前为 `isDraft=true`、`autoMergeRequest=null`、`headRefOid=4dc3b69aaca97e16fd4c8e28c35c4a8b6fd08f13`
- historical-evidence-only: proposer commit `d8db6d9f07711fec53d5c88dce60ad03066dfeea` 与 reviewer attempt `6dc36461-01db-443c-9e71-31b7895386dd` 仅作证据，不继承任何旧 approval
- current-main-drift-rule: 若后续执行时 `origin/main` 或 PR head SHA 改变，旧 merge-base、旧 76 checks、旧 evaluator/judge/human approval 一律作废并重绑新 SHA
- context-manifest: unavailable
- production-db: forbidden

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
- `ok` (boolean, 必填): 来源——现有 `harness-kernel-approvals` 路由
- `run_id` / `task_id` (string, 必填): 来源——现有路由与 `kernel-wiring.pg.integration.test.js`
- `pr_head_sha` (string, 必填): 来源——same-SHA 门禁
- `review_request_hop` (number, 必填): 来源——request/verdict hop 绑定
- `review_class` (string, 必填): 来源——`reviewClassForReason(...)`
- `approved_by` / `approved_at` (string, 必填): 来源——当前批准事件 detail
**禁用字段名**: `approved`, `merge_ready`, `auto_merge`, `approval_id`, `headSha`
**Error (HTTP 409)**:
```json
{"error":"stale_sha","current_pr_head_sha":"40-char-sha"}
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
**禁用字段名**: `approved`, `approved_by`, `approval_id`, `merge_ready`, `headSha`
**Error (HTTP 409)**:
```json
{"error":"stale_sha","current_pr_head_sha":"40-char-sha"}
```

## 已知约束（来自回归测试）

- [packages/brain/src/routes/__tests__/harness-kernel-approvals.test.js] → `rejects an invalid approver token before any database access`
- [packages/brain/src/routes/__tests__/harness-kernel-approvals.test.js] → `accepts a current review request and commits an observable approval verdict`
- [packages/brain/src/routes/__tests__/harness-kernel-approvals.test.js] → `allows approvals for two GitHub head SHAs in the same run`
- [packages/brain/src/__tests__/integration/kernel-wiring.pg.integration.test.js] → `the same run accepts one approval for each of two successive PR head SHAs`
- [packages/brain/src/orchestrator/__tests__/ground-truth.test.js] → `reviewRequired 从 tasks.payload.review_required（string payload 兼容）；reviewApproved 锚定当前 head_sha`
- [packages/brain/src/orchestrator/__tests__/ground-truth.test.js] → `same-SHA evidence approval cannot satisfy the later merge gate after evaluator and judge PASS`
- [packages/brain/src/orchestrator/__tests__/derive.test.js] → `当前 head_sha 无 evaluate 记录 → spawn:evaluator`
- [packages/brain/src/orchestrator/__tests__/derive.test.js] → `双 PASS && review_required && 未批准 → wait:human_review`
- [packages/brain/src/orchestrator/__tests__/gates.test.js] → `review_required && 未批准 → 拒`
- [packages/brain/src/__tests__/integration/migration-365-executor-kind-kernel-process.integration.test.js] → 历史 `363/364/365` 文件仍合法存在，不可仓库级误杀
- [累积FR] context-manifest: unavailable

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求：系统对外承诺做什么 | 在 current `origin/main` 上收口 Draft PR `#4372`；引入 migration `366_kernel_harness_f1_baseline.sql`、隔离 DB 双跑稳定、evaluator 测试库硬护栏、F1 fail-closed suite、same-SHA server-owned 审批链证明。 |
| **NFR（做得多好）** | 非功能需求：性能/可靠性/并发阈值等 | 生产库零写入；URL 护栏写前即拦；旧证据遇到 current-main 或 head drift 立即失效；suite 禁 `|| true` 与 grep-only proxy。 |
| **Invariant（永不违反）** | 任何情况下不得打破的不变量 | PR `#4372` 仍 `isDraft=true` 且 `autoMergeRequest=null`；`review_required=true` 继续由服务端控制；同一 final head SHA 才能同时满足 evaluator PASS、judge PASS、human approval。 |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 该能力/数据/token 何时失效，谁负责退役 | `origin/main`、PR head SHA、required checks、evaluator/judge/human review 的有效期都绑定到同一 final head SHA；新 commit 立刻过期。 |
| **死亡告警（停了谁知道）** | 该功能停止工作后，谁在多久内会知道，用什么告警手段 | F1 suite、kernel wiring PG integration、ground-truth/derive/gates 测试、七个 legacy smoke、DevGate/current-SHA 检查直接失败。 |
| **失败语义（挂了怎么办）** | 故障时放行还是拦截？重试幂等？降级策略？ | 一律 fail-closed；测试库护栏不通过、双跑漂移、same-SHA 证据缺失、Draft 状态变化、六语义面对账不净，全部阻塞；无 warning 降级。 |
| **效果确认（已发≠已生效）** | 每个对外动作如何确认真实生效？回执方式/时限/拿不到算什么 | 通过 `git fetch`、`gh pr view`、真实 PG、真实路由/集成测试、真实 smoke summary 对账；拿不到同-SHA 证据即视为未生效。 |

### 判定点登记表（对模糊现实的判断假设 — decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| ⚠️旧 merge-base 证据是否还能复用 | A. 只看 merge-base；B. 重新抓 current `origin/main` + 当前 PR head SHA | B. 重新抓 current `origin/main` + 当前 PR head SHA | PRD 明确要求对账基准是 current main 现状 | 静默复用过期 76 checks/approval |
| ⚠️同 SHA approval/judge/evaluator 是否仍有效 | A. 只看 PASS/approved；B. 逐条核对 server-owned record 的 `pr_head_sha` | B. 核对 `pr_head_sha` | 现有 ground-truth/derive/gates 全按 current head 锚定 | stale server record 被复用后错误 merge |
| migration 366 第二次执行是否稳定 | A. 只看 `schema_version`；B. 比较 schema/data/index/constraint 快照 | B. 快照等价对比 | PRD 明示不能依赖脆弱 `schema_version` 时间窗 | 二次执行 silently drift |
| evaluator 测试库是否安全 | A. 只看 env 名；B. URL host + DB 名 + `current_database()` + `inet_server_addr()` | B. 四重校验 | 单看 env 名无法阻止误连默认库/生产库 | 测试污染生产或默认库 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| current main 或 PR head drift | 旧 merge-base / old checks / old approvals / old evaluator / old judge 全失效 | 是 | 无降级，必须重绑 final SHA |
| `HARNESS_TEST_DATABASE_URL` 非法 | 写前直接退出非 0，拒绝连接/写入 | 是 | 无降级 |
| migration 366 双跑后快照不等价 | recovery 失败并阻塞 | 是 | 无降级 |
| F1 suite 缺任何子项或弱 oracle | 直接 FAIL，不允许旁路 PASS | 是 | 无降级 |
| `review_required=true` 但人工批准不是当前 SHA | merge gate 拒绝 | 是 | 无降级 |

### 输入对抗面（对外暴露 agent 必填 — decisions 27b57469 第9要素）

N/A — 本 sprint 只收口 Brain/engine 内部 kernel recovery、DB 守卫与审批链，不新增外部用户输入面。

## Risks

| 风险 | 机械缓解 | 验收证据 |
|---|---|---|
| 测试库污染 | evaluator 只认 `HARNESS_TEST_DATABASE_URL`；拒绝 production-like/default/`127.0.0.1`；要求 `host.docker.internal`；真查 `current_database()` 与 `inet_server_addr()` | guard 单测 + 真 PG 行为命令 |
| 历史 head/check 复用 | current-main/head drift 立即使 old 76 checks、old approvals、old verdicts 失效 | `gh pr view` + same-SHA tests |
| stale approval/judge/evaluator 复用 | 只读 fixture/query 必须逐条核对三类 record 的 `pr_head_sha` | ground-truth + kernel wiring PG integration |
| current-main drift 遮蔽语义冲突 | 六个重叠语义面必须直接对 current main 对账，不准只看 merge-base | surface manifest + zero-conflict/no-parallel-path suite |

## 真实调用方请求 shape

### Caller: `POST /api/brain/harness/kernel-reviews/:runId/approve`
- 认证方式: `x-approver-token` header；禁止挪到 body
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
- 关键约束: `task_id`、`pr_head_sha`、正整数 `review_request_hop` 必填；current PR head 不一致即 `stale_sha`

### Caller: `POST /api/brain/harness/kernel-reviews/:runId/reject`
- 认证方式: `x-approver-token` header；禁止挪到 body
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

## 六个重叠语义面

1. `origin/main` 漂移判定必须对 current main，不对旧 merge-base
2. PR `#4372` Draft/head-SHA/required checks 当前快照绑定
3. `harness-kernel-approvals` approve/reject 同 SHA schema 与 `stale_sha` 错误面
4. `ground-truth / derive / gates` 对 same-SHA evaluator/judge/human approval 的服务端门禁面
5. evaluator 测试库 URL/host/db-name/`current_database()`/`inet_server_addr()` 护栏面
6. migration `366` + F1 fail-closed suite + 七个 legacy smoke 聚合面

## 接缝清单

- `git/gh current-main + PR head` ↔ kernel recovery 决策：真目标验证 `git fetch origin main` + `git rev-parse origin/main` + `gh pr view 4372 --json`
- `packages/brain/migrations/366_*` ↔ 隔离 PostgreSQL：真目标验证同一 DB 连续执行两次 migration 并比较 schema/data/index/constraint 快照
- `packages/engine/src/harness/*` ↔ 容器内 evaluator DB 连接：真目标验证 `HARNESS_TEST_DATABASE_URL` 护栏 + `current_database()`/`inet_server_addr()`
- `orchestrator_decision_log` ↔ same-SHA merge gate：真目标验证 ground-truth/derive/gates + kernel wiring PG integration

## 禁 mock 边清单

- `packages/engine/src/harness/*` ↔ 真 PostgreSQL 测试库（本单改 evaluator 写前守卫，测试必须真连隔离库）
- `packages/brain/migrations/366_kernel_harness_f1_baseline.sql` ↔ PostgreSQL schema/data/index/constraint（本单改 DB 写路径，测试必须真 PG 双跑）
- `packages/brain/src/routes/harness-kernel-approvals.js` ↔ server-owned review records（本单改审批链 same-SHA 证明，测试不得 mock 被改边）
- `packages/brain/src/orchestrator/{ground-truth,derive,gates}.js` ↔ `orchestrator_decision_log`/PR head SHA（本单改状态机与跨模块证据接缝，测试必须真查当前 SHA）
- `packages/brain/scripts/smoke/*` ↔ F1 equivalence suite（本单改 fail-closed 验收链，测试必须真执行 suite 入口）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## Golden Path

[入口：接管既有 Draft PR #4372] → [Step1 current-main 对账] → [Step2 仅复用 PR #4372 并抓当前 head] → [Step3 六个语义面对 current main 对账] → [Step4 migration 366 成为唯一 F1 baseline] → [Step5 同一隔离 DB 双跑稳定] → [Step6 evaluator 测试库硬护栏] → [Step7 F1 fail-closed suite + 七个 legacy smokes] → [Step8 same-SHA server-owned evidence] → [Step9 出口：PR 仍 Draft，review_required 仍 server-owned，生产库零写入]

### Step 1: 执行时抓 current `origin/main`，判定是否需要作废旧 merge-base 证据
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步。

**可观测行为**: 合同总是以执行时 `origin/main` 为基准；若后续 drift，则 old evidence 失效。

**验证命令**:
```bash
bash -c 'git fetch origin main --quiet && CUR=$(git rev-parse origin/main) && [ -n "$CUR" ] && echo "$CUR"'
```

**硬阈值**: 必须实时抓取 `origin/main`；禁止只读旧 merge-base 文件。

---

### Step 2: 仅复用 Draft PR `#4372`，保持 `isDraft=true` 与 `autoMergeRequest=null`
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2、9 步。

**可观测行为**: 仍使用同一 Draft PR；不新建 PR、不复用旧 approval。

**验证命令**:
```bash
bash -c 'gh pr view 4372 --json number,isDraft,autoMergeRequest,headRefOid,state | jq -e ".number==4372 and .isDraft==true and .autoMergeRequest==null and .state==\"OPEN\" and (.headRefOid|type==\"string\")" >/dev/null'
```

**硬阈值**: PR 必须仍是 Draft；`autoMergeRequest` 必须为空。

---

### Step 3: 六个重叠语义面对 current main 做逐项对账
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步。

**可观测行为**: 六个面零 conflict marker、零 parallel old/new behavior path，对账基准是 current main。

**验证命令**:
```bash
node -e "import('./packages/brain/src/orchestrator/kernel-pr4372-current-main-surfaces.js').then(m=>{if(!Array.isArray(m.CURRENT_MAIN_SURFACES)||m.CURRENT_MAIN_SURFACES.length!==6)process.exit(1);}).catch(()=>process.exit(1))"
```

**硬阈值**: 必须显式列出 6 个 surface；不得退回 merge-base 语义。

---

### Step 4: F1 基线只认 `366_kernel_harness_f1_baseline.sql`
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 步。

**可观测行为**: F1 baseline 锚点切到 migration 366；相关 365 语义引用改绑 366；合法历史 363/364/365 不被误杀。

**验证命令**:
```bash
node -e "const fs=require('fs');const p='packages/brain/migrations/366_kernel_harness_f1_baseline.sql';if(!fs.existsSync(p))process.exit(1);const t=fs.readFileSync(p,'utf8');if(!/schema_version|create|alter|index|constraint|insert/i.test(t))process.exit(1);"
```

**硬阈值**: baseline 必须是 366；禁止仓库级 ban 历史 363/364/365。

---

### Step 5: 在同一隔离 DB 连续执行 migration 366 两次，终态完全等价
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 步。

**可观测行为**: 第二次执行后 schema/data/index/constraint 与第一次等价，不依赖脆弱 `schema_version` 时间窗。

**验证命令**:
```bash
node -e "require('fs').accessSync('packages/brain/src/__tests__/integration/migration-366-kernel-harness-f1-baseline.integration.test.js')"
```

**硬阈值**: 必须有真 PG 双跑集成测试；仅看 `schema_version` 不算通过。

---

### Step 6: evaluator 写前只认 `HARNESS_TEST_DATABASE_URL` + `host.docker.internal` + 白名单库名 + 实库回读
**来源**: `[FROM_PRD]` — PRD Golden Path 第 6 步。

**可观测行为**: 非法 URL 在任何写入前失败；合法 URL 仍要核对 `current_database()` 与 `inet_server_addr()`。

**验证命令**:
```bash
node -e "import('./packages/engine/src/harness/evaluate.js').then(m=>{if(typeof m.validateHarnessTestDatabaseUrl!=='function')process.exit(1);}).catch(()=>process.exit(1))"
```

**硬阈值**: 禁止 fallback 到 `DATABASE_URL`、`DB_URL`、`127.0.0.1`、默认库或生产库。

---

### Step 7: F1 等价验收必须是 fail-closed suite，并串行覆盖七个具名 legacy smokes
**来源**: `[FROM_PRD]` — PRD Golden Path 第 7 步。

**可观测行为**: suite 真执行合同 oracle、真实集成测试、端点语义、运行时非回归、DevGate/current-SHA 和七个具名 legacy smokes，并给出 exact summary。

**验证命令**:
```bash
node -e "const fs=require('fs');const p='packages/brain/scripts/smoke/kernel-f1-equivalence-smoke.sh';if(!fs.existsSync(p))process.exit(1);const t=fs.readFileSync(p,'utf8');for(const s of ['git-sha-health-smoke.sh','review-gating-smoke.sh','harness-judge-smoke.sh','harness-lifecycle-gates-smoke.sh','harness-contract-sha-freeze-smoke.sh','review-approve-auth-smoke.sh','evaluator-evidence-bridge-smoke.sh']){if(!t.includes(s))process.exit(1)}if(/\\|\\| true/.test(t))process.exit(1);"
```

**硬阈值**: exact summary 必须断言 `1 journey / S0-S12 / 143 cells / 11 elements / 8 legacy families`。

---

### Step 8: 在只读 fixture/query 路径证明 evaluator PASS、judge PASS、human approval 都是 server-owned records 且绑定同一 final head SHA
**来源**: `[FROM_PRD]` — PRD Golden Path 第 8 步。

**可观测行为**: 三条 server-owned records 必须同 SHA；新 commit/head 变化时三者和 required checks 一起失效。

**验证命令**:
```bash
node -e "import('./packages/brain/src/routes/harness-kernel-approvals.js').then(m=>{if(typeof m.buildReadOnlyHeadShaEvidenceFixture!=='function')process.exit(1);}).catch(()=>process.exit(1))"
```

**硬阈值**: 证明必须走只读 fixture/query；不得通过改写真实 approval 记录造证。

---

### Step 9: 出口状态仍是 Draft + review_required server-owned + production DB 零写入
**来源**: `[FROM_PRD]` — PRD Golden Path 第 9 步。

**可观测行为**: merge/deploy 仍等待 evaluator、judge、user approval 三者在同一 final SHA 上齐备；生产库不在范围内。

**验证命令**:
```bash
bash -c 'gh pr view 4372 --json isDraft,autoMergeRequest | jq -e ".isDraft==true and .autoMergeRequest==null" >/dev/null'
```

**硬阈值**: `review_required=true` 仍由服务端持有；evaluator PASS 不得替代 human approval。

---

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="${ROOT:-$(pwd)}"
PR_NUMBER="${PR_NUMBER:-4372}"
TASK_BIRTH_BASELINE_FULL="${TASK_BIRTH_BASELINE_FULL:-1dc9d4107cc14f9bc509c1ef285845f1dfb13838}"
TEST_DB_URL="${HARNESS_TEST_DATABASE_URL:?HARNESS_TEST_DATABASE_URL required}"

cd "$ROOT"

git fetch origin main --quiet
CURRENT_MAIN_SHA="$(git rev-parse origin/main)"
[ -n "$CURRENT_MAIN_SHA" ] || { echo "FAIL: missing origin/main"; exit 1; }

PR_JSON="$(gh pr view "$PR_NUMBER" --json number,isDraft,autoMergeRequest,headRefOid,state)"
echo "$PR_JSON" | jq -e '.number==4372 and .isDraft==true and .autoMergeRequest==null and .state=="OPEN" and (.headRefOid|type=="string")' >/dev/null
FINAL_HEAD_SHA="$(echo "$PR_JSON" | jq -r '.headRefOid')"
[ -n "$FINAL_HEAD_SHA" ] || { echo "FAIL: missing final head sha"; exit 1; }

if [ "$CURRENT_MAIN_SHA" != "$TASK_BIRTH_BASELINE_FULL" ]; then
  echo "INFO: current-main drift detected; all old evidence/checks/approvals are stale"
fi

node ./node_modules/vitest/vitest.mjs run \
  "sprints/07272235-kernel-aee91b5d/tests/kernel-pr4372-f1-recovery.contract.test.ts" \
  --reporter=verbose

node ./node_modules/vitest/vitest.mjs run \
  "packages/brain/src/routes/__tests__/harness-kernel-approvals.test.js" -t "accepts a current review request and commits an observable approval verdict" \
  "packages/brain/src/routes/__tests__/harness-kernel-approvals.test.js" -t "allows approvals for two GitHub head SHAs in the same run" \
  "packages/brain/src/__tests__/integration/kernel-wiring.pg.integration.test.js" -t "the same run accepts one approval for each of two successive PR head SHAs" \
  "packages/brain/src/orchestrator/__tests__/ground-truth.test.js" -t "same-SHA evidence approval cannot satisfy the later merge gate after evaluator and judge PASS" \
  "packages/brain/src/orchestrator/__tests__/derive.test.js" -t "双 PASS && review_required && 未批准 → wait:human_review" \
  "packages/brain/src/orchestrator/__tests__/gates.test.js" -t "review_required && 未批准 → 拒" \
  --reporter=verbose

node -e "import('./packages/engine/src/harness/evaluate.js').then(m=>m.validateHarnessTestDatabaseUrl(process.env.HARNESS_TEST_DATABASE_URL)).then(r=>{if(!r||r.ok!==true)process.exit(1);}).catch(()=>process.exit(1))"

psql "$TEST_DB_URL" -t -A -c "SELECT current_database() || '|' || COALESCE(inet_server_addr()::text,'')" | awk -F'|' 'NF==2 && $1 ~ /(_test$|^preview_)/ && $2 != \"127.0.0.1\" && length($2)>0 {ok=1} END{exit ok?0:1}'

bash packages/brain/scripts/smoke/git-sha-health-smoke.sh
bash packages/brain/scripts/smoke/review-gating-smoke.sh
bash packages/brain/scripts/smoke/harness-judge-smoke.sh
bash packages/brain/scripts/smoke/harness-lifecycle-gates-smoke.sh
bash packages/brain/scripts/smoke/harness-contract-sha-freeze-smoke.sh
bash packages/brain/scripts/smoke/review-approve-auth-smoke.sh
bash packages/brain/scripts/smoke/evaluator-evidence-bridge-smoke.sh

SUMMARY="$(bash packages/brain/scripts/smoke/kernel-f1-equivalence-smoke.sh --print-summary)"
echo "$SUMMARY" | jq -e '.journeys==1 and .steps==["S0","S1","S2","S3","S4","S5","S6","S7","S8","S9","S10","S11","S12"] and .cells==143 and .elements==11 and .legacy_families==8' >/dev/null

echo "OK final_head_sha=${FINAL_HEAD_SHA} current_main_sha=${CURRENT_MAIN_SHA}"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| current-main 六语义面对账 | `sprints/07272235-kernel-aee91b5d/tests/kernel-pr4372-f1-recovery.contract.test.ts` | `current-main 六个重叠语义面显式列出并对 current main 对账` | `kernel-pr4372-current-main-surfaces.js` 或 `CURRENT_MAIN_SURFACES[6]` 缺失时 FAIL |
| migration 366 基线与双跑稳定 | `sprints/07272235-kernel-aee91b5d/tests/kernel-pr4372-f1-recovery.contract.test.ts` | `migration 366 文件存在且双跑稳定快照可验证` | 366 migration 或 366 PG integration 不存在时 FAIL |
| evaluator 测试库护栏 | `sprints/07272235-kernel-aee91b5d/tests/kernel-pr4372-f1-recovery.contract.test.ts` | `HARNESS_TEST_DATABASE_URL 写前 fail-closed` | `validateHarnessTestDatabaseUrl` 缺失或未覆盖 host/db/current_database/inet_server_addr 约束时 FAIL |
| F1 fail-closed suite | `sprints/07272235-kernel-aee91b5d/tests/kernel-pr4372-f1-recovery.contract.test.ts` | `F1 fail-closed 套件覆盖七个具名 legacy smokes 与 exact oracle` | `kernel-f1-equivalence-smoke.sh` 缺失、缺 smoke 名或含 `|| true` 时 FAIL |
| same-SHA server-owned 证据 | `sprints/07272235-kernel-aee91b5d/tests/kernel-pr4372-f1-recovery.contract.test.ts` | `同 SHA evaluator judge human review 只读证明路径存在` | `buildReadOnlyHeadShaEvidenceFixture` 缺失时 FAIL |
