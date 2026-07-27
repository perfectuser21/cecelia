# Sprint Contract Draft (Round 1)

## 锚定父路声明

覆盖父路 `Cecelia Harness Pipeline`（`bb8cc561-b3ee-4fec-b74d-2255694bd963`）第 1-8 步；本 sprint 只为 Draft PR `#4372` 重绑当前 `origin/main` 与 same-SHA authority 验收，不新增第二条父路。

## Notes

- contract-gate: enabled（`packages/brain/src/lib/contract-gate.js` 存在）。
- `origin/main` 于 2026-07-27 读取到 `1dc9d4107cc14f9bc509c1ef285845f1dfb13838`，与任务出生基线 `1dc9d4107` 一致；合同仍要求执行时再次 `git fetch origin main`，若不同则作废旧 evaluator/judge/human-review 证据并改绑新 merge-base。
- Draft PR `#4372` 当前为 `OPEN + draft`，head SHA=`4dc3b69aaca97e16fd4c8e28c35c4a8b6fd08f13`，`mergeable=CONFLICTING`；合同只允许在该 PR 上收敛，禁止新建 PR、禁止 Ready、禁止 merge。
- context-manifest: unavailable（`GET /api/brain/line/bb8cc561-b3ee-4fec-b74d-2255694bd963/context-manifest` 在 2026-07-27 返回 404）。
- PR `#4372` 的特征文件来自当前 head：`packages/brain/migrations/366_kernel_harness_f1_baseline.sql`、`packages/brain/scripts/smoke/kernel-harness-f1-baseline-smoke.sh`、`packages/brain/src/lib/kernel-harness-f1-baseline.js`、`packages/brain/src/lib/__tests__/kernel-harness-f1-baseline.test.js`。
- 本轮合同以恢复验收为目标：保留 proposer 证据 commit `dc21fddda` 与 reviewer attempt `575b687a` 仅作历史证据，不继承任何 approval。

## Response Schema（推导来源: api_registry推导 + PRD字面）

### Endpoint: `POST /api/brain/harness/kernel-reviews/:runId/approve`
**Success (HTTP 202)**:
```json
{"ok": true, "run_id": "<uuid>", "task_id": "<uuid>", "pr_head_sha": "<sha>", "review_request_hop": 3, "review_class": "<string>", "approved_by": "<string>", "approved_at": "<iso8601>"}
```
- `ok` (boolean, 必填): 来源——现有真实路由 [packages/brain/src/routes/harness-kernel-approvals.js](/workspace/packages/brain/src/routes/harness-kernel-approvals.js:174)
- `run_id` (string, 必填): 来源——同上
- `task_id` (string, 必填): 来源——同上
- `pr_head_sha` (string, 必填): 来源——同上
- `review_request_hop` (number, 必填): 来源——同上
- `review_class` (string, 必填): 来源——同上
- `approved_by` (string, 必填): 来源——同上
- `approved_at` (string, 必填): 来源——同上
**禁用字段名**: `approved`, `verdict`, `headSha`
**Error (HTTP 409)**:
```json
{"error": "stale_sha", "current_pr_head_sha": "<sha>"}
```

### Endpoint: `POST /api/brain/harness/kernel-reviews/:runId/reject`
**Success (HTTP 202)**:
```json
{"ok": true, "run_id": "<uuid>", "task_id": "<uuid>", "pr_head_sha": "<sha>", "review_request_hop": 3, "review_class": "<string>", "rejected_by": "<string>", "rejected_at": "<iso8601>"}
```
- `rejected_by` (string, 必填): 来源——现有真实路由 [packages/brain/src/routes/harness-kernel-approvals.js](/workspace/packages/brain/src/routes/harness-kernel-approvals.js:177)
- `rejected_at` (string, 必填): 来源——同上
**禁用字段名**: `rejected`, `approved`, `headSha`
**Error (HTTP 409)**:
```json
{"error": "human_review_request_not_found_for_sha"}
```

## 真实调用方请求 shape

### Human Review Approve
- Header: `x-approver-token: <HARNESS_REVIEW_APPROVER_TOKEN>`
- Body:
```json
{"task_id":"<uuid>","pr_head_sha":"<40-char sha>","review_request_hop":3,"approved_by":"<actor>"}
```

### Human Review Reject
- Header: `x-approver-token: <HARNESS_REVIEW_APPROVER_TOKEN>`
- Body:
```json
{"task_id":"<uuid>","pr_head_sha":"<40-char sha>","review_request_hop":3,"rejected_by":"<actor>"}
```

说明：来源为真实路由 [packages/brain/src/routes/harness-kernel-approvals.js](/workspace/packages/brain/src/routes/harness-kernel-approvals.js:25) 与现有 mounted Router 测试 [packages/brain/src/routes/__tests__/harness-kernel-approvals.test.js](/workspace/packages/brain/src/routes/__tests__/harness-kernel-approvals.test.js:122)。合同中的 approve/reject oracle 必须逐字段一致，禁止把 `pr_head_sha` 改成 `headSha`，禁止把 `review_request_hop` 放进 header。

## 已知约束（来自回归测试）

- [packages/brain/src/routes/__tests__/harness-kernel-approvals.test.js](/workspace/packages/brain/src/routes/__tests__/harness-kernel-approvals.test.js:167) → approve 成功必须返回 `202`、写 `verdict:human_review`、并把 open review 等待时间加回 deadline。
- [tests/regression/relay-50170af2/kernel-approval-bridge.test.js](/workspace/tests/regression/relay-50170af2/kernel-approval-bridge.test.js:234) → `reviewApproved` 只接受同 SHA 的 `approved:true` 人审 verdict；旧 SHA 不能借尸还魂。
- [packages/brain/src/__tests__/integration/kernel-wiring.pg.integration.test.js](/workspace/packages/brain/src/__tests__/integration/kernel-wiring.pg.integration.test.js:545) → same-SHA callback 必须从 PostgreSQL 真记录推导 `no_progress_same_sha`，不能靠 provider/hop 变化绕过。
- [packages/brain/src/routes/__tests__/harness-kernel-approvals.test.js](/workspace/packages/brain/src/routes/__tests__/harness-kernel-approvals.test.js:289) → 同一 SHA 可有两个不同 review request hop，各自仅可裁决一次。
- [packages/brain/src/__tests__/integration/migration-365-executor-kind-kernel-process.integration.test.js](/workspace/packages/brain/src/__tests__/integration/migration-365-executor-kind-kernel-process.integration.test.js:1) → 合法 migration-365 executor-kind 测试必须保持不动。
- [累积FR] 本 line 暂无历史。
- [累积FR] context-manifest: unavailable。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | 对 Draft PR `#4372` 的 F1 基线实现做恢复验收：重绑 main、收敛六个重叠面、双跑 migration 366、核对七个 smoke 模式、11 要素语义、approve/reject schema 与 same-SHA authority。 |
| **NFR（做得多好）** | 非功能需求 | 所有真验收必须 fail-closed；DB 仅允许显式隔离白名单；migration 连跑两次幂等；所有 authority 记录均需绑定当前 PR head SHA。 |
| **Invariant（永不违反）** | 安全/一致性 | 不创建第二个 PR；不改 `migration-365-executor-kind-kernel-process` 测试；不保留 legacy/new 并行路径；不使用 helper-existence/source-string theater 充当行为证明。 |
| **判定点（怎么知道）** | 现实判断 | 见下方登记表。 |
| **保质期（何时过期）** | 证据寿命 | `origin/main`、PR head SHA、evaluator/judge/human-review 任一变动即失效；旧 SHA 证据只能留档，不能继续充当 merge authority。 |
| **死亡告警（停了谁知道）** | 停摆发现 | `kernel-harness-f1-baseline-smoke.sh` 七模式、DevGate、approve/reject schema 或 authority 失配任一失败即非零；CI 与 evaluator 都必须红。 |
| **失败语义（挂了怎么办）** | 故障策略 | DB guard、SHA guard、authority guard 一律拒绝继续；允许记录 `logic-done-pending`，但禁止标 done 或 merge。 |
| **效果确认（已发≠已生效）** | 外部效果 | 以真实 DB 快照、真实 `migrate.js` schema-history、真实 `gh pr view` head、真实 human-review/evaluator/judge 记录、真实 approve/reject 路由响应确认。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ `origin/main` 是否需要重绑 merge-base | A. 继续沿用任务出生 SHA；B. 每次执行时真 fetch 后对比 | B. 真 fetch 后对比 | PRD 第 1 条硬要求 main 漂移则旧证据全部失效 | 旧证据错误继承，merge gate 假绿 |
| ⚠️ authority 记录是否仍属当前 PR head | A. 只看 run_id；B. run_id + 当前 PR head SHA + review_request_hop | B. 三者同时校验 | 现有 same-SHA/human-review 测试已把 SHA 作为 merge gate 事实 | 旧 verdict 误用到新 head，直接面客错误 |
| DB 收据是否安全可写 | A. 只看连接成功；B. 解析 host 非 loopback 且 DB 名在白名单 | B. fail-closed 白名单 | PRD 第 3 条硬要求 | 误写生产库，不可逆 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| `origin/main` 漂移 | 作废旧 evaluator/judge/human-review 证据并重绑新 merge-base | 是 | 不 merge，重跑全套 authority 验收 |
| DB 收据 host 为 loopback 或 DB 非白名单 | 立即退出，禁止调用 migration | 是 | 无放行 |
| migration 366 第二次执行产生差异 | 判定非幂等，exit 1 | 是 | 无放行 |
| approve/reject 返回字段漂移 | schema oracle 失败，exit 1 | 是 | 无放行 |
| authority 读取到旧 SHA | 标 stale，并阻止 merge | 是 | 人工 review 重新发起 |

### 输入对抗面

N/A — 本 sprint 不新增对外暴露 agent；但 `gh`、DB receipt、human review body 都属于外部输入，必须做白名单和字段级校验，拒绝 caller-built synthetic 记录。

## 接缝清单

1. `git fetch origin main ↔ PR #4372 head`：真 git/gh 读取 `origin/main` 和当前 head SHA，决定是否作废旧 evidence。
2. `migrate.js ↔ PostgreSQL`：通过 `HARNESS_TEST_DATABASE_URL` 真实执行 migration 366 两轮，并核对 schema history 与前后快照。
3. `harness-kernel-approvals route ↔ orchestrator_decision_log`：approve/reject 必须读当前 PR head、写同 SHA 人审 verdict。
4. `kernel-harness-f1-baseline-smoke.sh ↔ regression-contract.yaml/DoD.md/allowlist`：七种模式与六个重叠面必须在当前 PR head 上语义一致。

## 禁 mock 边清单

- `packages/brain/src/migrate.js ↔ packages/brain/migrations/366_kernel_harness_f1_baseline.sql ↔ PostgreSQL`（本单改 DB 写路径与 schema-history，测试必须真 PG）。
- `packages/brain/src/routes/harness-kernel-approvals.js ↔ orchestrator_decision_log / defaultPrHeadResolver`（本单验 same-SHA authority，不能用 caller-built verdict 替代真实路由读取）。
- `gh pr view ↔ PR #4372 当前 head`（本单验 current-head，不能用静态 JSON fixture 冒充最终 authority）。
- `kernel-harness-f1-baseline-smoke.sh ↔ DoD.md / DEFINITION.md / package.json / package-lock.json / smoke-allowlist.txt / regression-contract.yaml`（六个重叠面必须真文件比对，无并行 old/new path）。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。GitHub head、approve/reject 路由、migrate.js、真实 PG、真实 smoke/DevGate 均须真跑。）

## Golden Path

恢复任务进入现有 Draft PR `#4372` → 执行 main 新鲜度重绑 → 只收敛六个重叠面 →
在隔离 PG 双跑 migration 366 → 运行七个 F1 smoke 模式与六类真检查 →
验证 11 要素、approve/reject schema 与 same-SHA authority → 停在人工审批前。

### Step 1: 执行时先抓取当前 `origin/main`，决定是否重绑基线
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步。

**可观测行为**: 若执行时 `origin/main` 仍为 `1dc9d4107...`，允许沿用该 merge-base；若不同，则旧 evaluator/judge/human-review 证据立即失效，并在日志中记录新的 merge-base 和失效原因。

**验证命令**:
```bash
git fetch origin main
MAIN_SHA=$(git rev-parse origin/main)
[ -n "$MAIN_SHA" ] || { echo "FAIL: missing origin/main"; exit 1; }
echo "$MAIN_SHA"
```

**硬阈值**: `git fetch` 成功且 `MAIN_SHA` 非空；若不等于 `1dc9d4107cc14f9bc509c1ef285845f1dfb13838`，后续 authority 断言必须全部改绑到新 SHA。

### Step 2: 只在 Draft PR `#4372` 上语义收敛六个重叠面
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步。

**可观测行为**: 六个文件 `DoD.md`、`packages/brain/DEFINITION.md`、`packages/brain/package.json`、`packages/brain/package-lock.json`、`packages/quality/smoke-allowlist.txt`、`regression-contract.yaml` 全部与 PR head 语义一致，且无 conflict marker、无 legacy/new 并行路径。

**验证命令**:
```bash
gh pr diff 4372 --name-only | awk '
  BEGIN{need["DoD.md"]=1;need["packages/brain/DEFINITION.md"]=1;need["packages/brain/package.json"]=1;need["packages/brain/package-lock.json"]=1;need["packages/quality/smoke-allowlist.txt"]=1;need["regression-contract.yaml"]=1}
  {seen[$0]=1}
  END{
    for (k in need) if (!seen[k]) { print "FAIL missing " k; exit 1 }
  }'
git grep -nE '^(<<<<<<<|=======|>>>>>>>)' -- DoD.md packages/brain/DEFINITION.md packages/brain/package.json packages/brain/package-lock.json packages/quality/smoke-allowlist.txt regression-contract.yaml && exit 1 || true
```

**硬阈值**: 六个文件全部命中；冲突标记数=0；同一语义不得同时保留 `365_` 与 `366_` 平行旧新行为分叉。

### Step 3: 用真实 `migrate.js` 在隔离白名单库双跑 migration 366
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步。

**可观测行为**: `packages/brain/migrations/366_kernel_harness_f1_baseline.sql` 通过 `HARNESS_TEST_DATABASE_URL` 连续执行两次；前后快照记录 schema、journey、history rows 与 schema-history，无 loopback host、无生产库写入，第二次执行不产生额外差异。

**验证命令**:
```bash
: "${HARNESS_TEST_DATABASE_URL:?}"
timeout 240 bash packages/brain/scripts/smoke/kernel-harness-f1-baseline-smoke.sh unique-journey
timeout 240 bash packages/brain/scripts/smoke/kernel-harness-f1-baseline-smoke.sh history-and-backbone
```

**硬阈值**: DB host 非 `localhost/127.0.0.1`，数据库名命中显式隔离白名单；migration 两轮均 exit 0；schema history 有 366 记录且第二轮无新增业务差异。

### Step 4: 区分执行六类真实检查，不得用 helper/source-string 充数
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 步；`[AI_ADDED]` — 把“helper existence 不算”具体化为分开的真实入口，防止单个 smoke 假装覆盖全部类别。

**可观测行为**: `contract`、`integration`、`endpoint`、`runtime-nonregression`、`DevGate`、`gh current-head` 六类检查都被单独执行并可区分失败原因；任何一类缺失都 fail-closed。

**验证命令**:
```bash
: "${HARNESS_TEST_DATABASE_URL:?}"
timeout 240 bash packages/brain/scripts/smoke/kernel-harness-f1-baseline-smoke.sh runtime-nonregression
cd packages/brain && npx vitest run src/__tests__/integration/migration-365-kernel-harness-f1-baseline.integration.test.js src/routes/__tests__/harness-kernel-approvals.test.js --reporter=dot
cd /workspace && bash scripts/devgate/check-tdd-commit-order.sh
gh pr view 4372 --json headRefOid,isDraft,state,mergeable
```

**硬阈值**: 六类入口都真执行；`gh pr view` 返回当前 head；DevGate 真跑；禁止 `test -f`、`grep 文件字符串` 代替行为结论。

### Step 5: 按精确七个模式执行 `kernel-harness-f1-baseline-smoke.sh`
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4-5 步。

**可观测行为**: 脚本精确支持并执行 `unique-journey`、`history-and-backbone`、`cells-and-evidence`、`legacy-baseline`、`assertion-refs`、`endpoint-semantics`、`runtime-nonregression` 七种模式，无多余别名，无漏跑。

**验证命令**:
```bash
for mode in unique-journey history-and-backbone cells-and-evidence legacy-baseline assertion-refs endpoint-semantics runtime-nonregression; do
  timeout 240 bash packages/brain/scripts/smoke/kernel-harness-f1-baseline-smoke.sh "$mode"
done
```

**硬阈值**: 7/7 模式 exit 0；模式名逐字一致；任一 unknown case 必须 exit 2。

### Step 6: 证明精确 11 个 ledger elements 的名字与语义
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 步。

**可观测行为**: 不仅要有 11 个元素名字，还要对 `FR`、`NFR`、`Invariant`、`checkpoints`、`freshness`、`death_alert`、`failure_semantics`、`effect_confirmed`、`adversarial`、`ledger_status`、`axis_aligned` 各自给出字段语义 oracle；纯计数不算通过。

**验证命令**:
```bash
timeout 240 bash packages/brain/scripts/smoke/kernel-harness-f1-baseline-smoke.sh cells-and-evidence
node - <<'NODE'
const fs = require('fs');
const y = fs.readFileSync('regression-contract.yaml', 'utf8');
for (const k of ['FR','NFR','Invariant','checkpoints','freshness','death_alert','failure_semantics','effect_confirmed','adversarial','ledger_status','axis_aligned']) {
  if (!y.includes(k)) { console.error('FAIL missing element '+k); process.exit(1); }
}
NODE
```

**硬阈值**: 精确 11 名称全部存在，且 smoke 真验对应语义；不得只做 `count == 11`。

### Step 7: 证明 approve/reject 的字段级 schema oracle
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 步与要求 7。

**可观测行为**: approve 成功返回 `approved_by/approved_at`，reject 成功返回 `rejected_by/rejected_at`；旧 SHA 或重复裁决按真实路由返回 `409`；禁用字段 `approved/rejected/verdict` 不得冒充 response schema。

**验证命令**:
```bash
cd packages/brain && npx vitest run src/routes/__tests__/harness-kernel-approvals.test.js --reporter=dot
```

**硬阈值**: success/error 路径均真跑；响应 keys 与上方 Response Schema 逐字一致；字段级误差即 FAIL。

### Step 8: same-SHA authority 必须读取实际 evaluator、judge、human-review 与当前 PR head
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 步与要求 8。

**可观测行为**: authority 只能从真实 evaluator/judge/human-review 记录和当前 PR head 读取；新 head SHA 出现时，旧三类记录全部失效，不能用 caller-built JSON 续命。

**验证命令**:
```bash
cd packages/brain && npx vitest run src/__tests__/integration/kernel-wiring.pg.integration.test.js --reporter=dot
cd /workspace && npx vitest run tests/regression/relay-50170af2/kernel-approval-bridge.test.js --reporter=dot
```

**硬阈值**: same-SHA/no-progress、human-review same-SHA、new-head invalidation 都要真过；旧 head verdict 不得满足新 head merge gate。

### Step 9: Red 必须因缺行为而失败，并在人工审批前停止
**来源**: `[FROM_PRD]` — PRD 边界情况与要求 9。

**可观测行为**: 红测失败原因是缺恢复行为，不是缺模块/缺 vitest/config；所有恢复行为通过前 `review_required=true` 且流程停在人工审批前，不自动 merge。

**验证命令**:
```bash
cd /workspace && npx vitest run sprints/07272256-kernel-a851b8ee/tests/kernel-harness-f1-recovery.contract.test.ts --reporter=dot || true
```

**硬阈值**: 红测输出必须命中行为断言名，不得以 `Cannot find module`、`unknown option`、`vitest config` 之类环境错误作为唯一失败原因；最终 gate 仍需人工 approve/reject 才能继续。

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail

cd /workspace

git fetch origin main
MAIN_SHA=$(git rev-parse origin/main)
PR_JSON=$(gh pr view 4372 --json number,state,isDraft,headRefOid,mergeable)
PR_HEAD_SHA=$(echo "$PR_JSON" | jq -r '.headRefOid')
echo "$PR_JSON" | jq -e '.number == 4372 and .state == "OPEN" and .isDraft == true' >/dev/null

: "${HARNESS_TEST_DATABASE_URL:?}"
DB_HOST=$(node -e 'const u=new URL(process.argv[1]);process.stdout.write(u.hostname)' "$HARNESS_TEST_DATABASE_URL")
DB_NAME=$(psql -X -qAt "$HARNESS_TEST_DATABASE_URL" -c 'SELECT current_database()')
case "$DB_HOST" in localhost|127.0.0.1) echo "FAIL: loopback host $DB_HOST"; exit 1;; esac
case "$DB_NAME" in harness_*|*_test|preview_*) ;; *) echo "FAIL: db not allowlisted $DB_NAME"; exit 1;; esac

for mode in unique-journey history-and-backbone cells-and-evidence legacy-baseline assertion-refs endpoint-semantics runtime-nonregression; do
  timeout 240 bash packages/brain/scripts/smoke/kernel-harness-f1-baseline-smoke.sh "$mode"
done

cd packages/brain
npx vitest run \
  src/__tests__/integration/migration-365-kernel-harness-f1-baseline.integration.test.js \
  src/routes/__tests__/harness-kernel-approvals.test.js \
  src/__tests__/integration/kernel-wiring.pg.integration.test.js \
  --reporter=dot
cd /workspace

bash scripts/devgate/check-tdd-commit-order.sh

echo "$MAIN_SHA" > /tmp/kernel-f1-main-sha.txt
echo "$PR_HEAD_SHA" > /tmp/kernel-f1-pr-head-sha.txt
echo "OK: recovery contract verified on current main + PR4372 head"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| recovery 合同入口 | `sprints/07272256-kernel-a851b8ee/tests/kernel-harness-f1-recovery.contract.test.ts` | `migration 366 双跑与隔离库收据` | 缺 `366_kernel_harness_f1_baseline.sql`、缺七模式脚本或收据 guard 不满足时失败 |
| same-SHA authority | `sprints/07272256-kernel-a851b8ee/tests/kernel-harness-f1-recovery.contract.test.ts` | `same-SHA authority 与 approve reject schema` | 缺当前 SHA invalidate、approve/reject 字段漂移或依赖旧 SHA 时失败 |
