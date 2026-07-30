# Sprint Contract Draft (Round 8)

## 合同锚点与范围

- 基线：既有 Draft PR #4457，分支 `cp-kernel-phase5b-a1-review-fixes`，起始 SHA `c0cd82fe298a8d1df812699507709d564a296f4e`。
- 只允许更新该 Draft PR；禁止新建重复 PR、转 Ready、merge、deploy。
- 本合同只覆盖四个 blocker、对应 Red/Green、同一最终 head 的 CI/evaluator/judge 证明和首次 merge 人工门。阶段严格单向：evaluator 只验四 blocker 与 exact-head required checks；judge 消费 evaluator 证据；post-judge controller gate 再验 evaluator/judge/复核请求/人工批准。
- 明确不改：`packages/brain/migrations/381_*.sql`、`packages/brain/migrations/382_*.sql` 及其他生产 migration SQL；不做 Kernel cutover。
- 冻结输入：本分支必须包含从 `cp-kernel-phase5b-a1-review-fixes` 原样复制的 `sprint-prd.md`；`git diff --exit-code cp-kernel-phase5b-a1-review-fixes -- sprints/07300855-kernel-pr4457-devops-blockers/sprint-prd.md` 必须为零。

## Response Schema（推导来源: PRD字面）

N/A — 本 Sprint 不新增 HTTP endpoint 或响应 schema；验收对象是 runner 退出码、测试 runner 登记、真实测试库集成行为、migration 应用集合及 PR 状态。

## 已知约束（来自回归测试与累积 FR）

- `[packages/brain/src/__tests__/integration/kernel-release-runs.integration.test.js]` → `uses the canonical runner to upgrade an N-1 schema from 368 through 381`
- `[packages/quality/__tests__/ci-core-regression.test.js]` → `checked-in Kernel 等价报告与真实合同完全一致且保持 0/99 fail-closed`
- `[packages/brain/scripts/fleet-worker/github-mutation-equivalence-seam.test.cjs]` → 原生 `node:test` mutation seam 已存在，必须由 `node --test` 执行。
- `[累积FR]` 本 line 暂无历史。
- context-manifest: PRD 已明确“本 line 暂无历史”，本轮不另加范围。

## Golden Path

独立小路（无父路）

维护者定位既有 Draft PR #4457 的四个 blocker → 四项 Red/Green → 聚焦与统一回归 → 同一 head 的 CI/evaluator/judge → Draft + 人工批准门。

### Step 1: QuickCheck 对 Vitest 非零退出 fail-closed
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 步及「边界情况」前两条。

**可观测行为**: 大输出真实失败、ANSI 失败摘要或未知非零退出均令 QuickCheck 非零；只有明确 OOM/worker 签名、存在 pass summary、且不存在 fail summary 时，才允许兼容性降级为零。

**验证命令**:
```bash
npm test --workspace packages/engine -- --run tests/scripts/quickcheck-vitest-exit-classification.test.ts --reporter=verbose
```

**硬阈值**: 聚焦测试 exit=0；测试至少覆盖“真实失败非零”“未知非零 fail-closed”“genuine OOM 三条件降级”三类。上述命令即阈值 oracle。

---

### Step 2: mutation seam 只由 node:test 收集并受 ratchet 约束
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 步。

**可观测行为**: `github-mutation-equivalence-seam.test.cjs` 不被 Vitest 收集，同时字面登记在 `test:node`，自动登记回归测试会阻止以后漏挂。

**验证命令**:
```bash
npm exec --workspace packages/brain -- vitest run src/__tests__/native-node-test-runner-registration.test.js --reporter=verbose && npm run test:node --workspace packages/brain
```

**硬阈值**: 两条命令均 exit=0；Vitest 运行登记 ratchet，ratchet 证明 seam 被 Vitest exclude 且已登记进 `test:node`，随后原生 runner 实际执行 seam。

---

### Step 3: OKR integration 仅连接 cecelia_test 的进程内真实 Router
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 步及「边界情况」测试库 preflight。

**可观测行为**: 集成测试在当前测试进程创建 Express app、挂载真实 OKR router、用 Supertest 发请求；router 与 fixture 共享同一个 `cecelia_test` PostgreSQL。测试不探测或调用 `BRAIN_URL`/localhost:5221，也不连接数据库 `cecelia`。

**验证命令**:
```bash
TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://localhost/cecelia_test}" npm exec --workspace packages/brain -- vitest run src/__tests__/integration/okr-decomposition-flow.integration.test.js --config vitest.integration.config.js --reporter=verbose
```

**硬阈值**: preflight 数据库名必须匹配 `_test`（本合同明确使用 `cecelia_test`）；整套测试 exit=0，任一非测试 DB 或外部 Brain fallback 必须 exit≠0。

---

### Step 4: historical migration fixture 冻结 369–381
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 步及边界“382 及以后不得改变 historical fixture”。

**可观测行为**: 随机 schema fixture 通过 canonical runner 精确应用 369–381，并明确证明 382 未进入该 fixture；382 专属验证仍单独通过；生产 migration SQL 的 blob SHA 与基线一致。

**验证命令**:
```bash
TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://localhost/cecelia_test}" npm exec --workspace packages/brain -- vitest run src/__tests__/integration/kernel-release-runs.integration.test.js --config vitest.integration.config.js --reporter=verbose && git diff --exit-code c0cd82fe298a8d1df812699507709d564a296f4e -- packages/brain/migrations/
```

**硬阈值**: 聚焦测试 exit=0；历史应用集合严格等于 369..381 且不含 382；migration 目录相对基线零 diff。

---

### Step 5: 合同明确列出的回归保持 Kernel fail-closed 真相
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 5 步。

**可观测行为**: 本合同的“本地聚焦检查集”仅指 QuickCheck 聚焦测试、node:test 登记 ratchet、Brain `test:node`、两个真 PG integration、quality core regression、生产 migration SQL 零 diff、atomic report check 与 manual gate；所有正向项全绿且 manual gate 保持非零。这不宣称未列出的整仓/runner 基础设施检查已绿，也不等同于 Step 6 的“GitHub required checks 集”。atomic 输出仍为 `schema_valid=true`、`proof_complete=false`、`atomic_cutover_ready=false`、live proof `0/99`。

**验证命令**:
```bash
npm test --workspace packages/engine -- --run tests/scripts/quickcheck-vitest-exit-classification.test.ts --reporter=verbose && npm exec --workspace packages/brain -- vitest run src/__tests__/native-node-test-runner-registration.test.js --reporter=verbose && npm run test:node --workspace packages/brain && TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://localhost/cecelia_test}" npm exec --workspace packages/brain -- vitest run src/__tests__/integration/okr-decomposition-flow.integration.test.js src/__tests__/integration/kernel-release-runs.integration.test.js --config vitest.integration.config.js --reporter=verbose && npm test --workspace packages/quality -- --run __tests__/ci-core-regression.test.js --reporter=verbose && git diff --exit-code c0cd82fe298a8d1df812699507709d564a296f4e -- packages/brain/migrations/ && node scripts/ci/check-kernel-behavior-equivalence.mjs --check-report --format=json | jq -e '.schema_valid==true and .proof_complete==false and .atomic_cutover_ready==false and (.cell_atomic_coverage|length)==99 and ([.cell_atomic_coverage[]|select((.live_proven_invariant_ids|length)>0 or (.live_proven_probe_ids|length)>0)]|length)==0' && if node scripts/ci/run-kernel-equivalence-drill.mjs --gate --format=json; then echo 'FAIL: manual cutover gate 意外放行'; exit 1; fi
```

**硬阈值**: 上述“本地聚焦检查集”的正向检查全部 exit=0、生产 migration SQL 零 diff、manual gate exit≠0、live proof 0/99。GitHub required checks 不属于该本地集合，只由 Step 6 对 exact final head 的权威集合验证。

---

### Step 6: exact final PR head 的 GitHub required checks 全部成功
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 6 步与假设“同一最终 head”。

**可观测行为**: GitHub 返回 PR #4457 exact final head 的 required checks 集合；集合非空，且每一项结论均为 `SUCCESS`。PR 保持 Draft、OPEN、无 auto-merge，checkout 与 `headRefOid` 完全相同。

**验证命令**:
```bash
FINAL_HEAD_SHA=$(git rev-parse HEAD); PR=$(gh pr view 4457 --repo perfectuser21/cecelia --json number,isDraft,headRefName,headRefOid,autoMergeRequest,state); CHECKS=$(gh pr checks 4457 --repo perfectuser21/cecelia --required --json name,state,bucket); echo "$PR" | jq -e --arg h "$FINAL_HEAD_SHA" '.number==4457 and .isDraft==true and .headRefName=="cp-kernel-phase5b-a1-review-fixes" and .headRefOid==$h and .autoMergeRequest==null and .state=="OPEN"' && echo "$CHECKS" | jq -e 'length>0 and all(.[]; .state=="SUCCESS")'
```

**硬阈值**: required 集合数量≥1且失败/未完成数量=0；PR=4457、Draft=true、OPEN、autoMergeRequest=null，checkout SHA=PR head。

---

### Step 7: post-judge controller gate 绑定同 head verdict 并证明阶段顺序
**来源**: `[AI_ADDED]` — Reviewer R3/R7 要求移除 evaluator 自我依赖，并把同 head evaluator/judge 证明与顺序 oracle 移到 judge 之后、发起人工复核之前。

**可观测行为**: 该命令仅由 post-judge controller gate 执行，不属于 evaluator E2E。`orchestrator_decision_log` 对本 run 的最新 `verdict:evaluate` 与 `verdict:judge` 均为 PASS，二者 `detail.pr_head_sha` 等于 GitHub PR #4457 当前 `headRefOid`；随后 controller 才允许写 `effect:human_review_requested`。任一缺失、非 PASS、SHA 漂移或 hop 非递增均失败。

**验证命令（Stage: post-judge-controller；evaluator 不执行）**:
```bash
FINAL_HEAD_SHA=$(gh pr view 4457 --repo perfectuser21/cecelia --json headRefOid --jq .headRefOid); psql "${DB_URL:-postgresql://localhost/cecelia}" -v ON_ERROR_STOP=1 -Atc "WITH e AS (SELECT hop,detail FROM orchestrator_decision_log WHERE run_id='2ef32848-e3df-473b-ad4e-548216a33092' AND action='verdict:evaluate' ORDER BY hop DESC LIMIT 1), j AS (SELECT hop,detail FROM orchestrator_decision_log WHERE run_id='2ef32848-e3df-473b-ad4e-548216a33092' AND action='verdict:judge' ORDER BY hop DESC LIMIT 1) SELECT 1 FROM e,j WHERE e.detail->>'verdict'='PASS' AND j.detail->>'verdict'='PASS' AND e.detail->>'pr_head_sha'='${FINAL_HEAD_SHA}' AND j.detail->>'pr_head_sha'='${FINAL_HEAD_SHA}' AND e.hop<j.hop" | grep -qx 1
```

**硬阈值**: evaluator PASS=1、judge PASS=1，二者 SHA 都精确等于当前 final head，且 evaluator hop < judge hop；该 gate 通过前不得写 review-request。

---

### Step 8: 权威人工批准回执才能解除首次 merge 门
**来源**: `[AI_ADDED]` — Reviewer R2 要求禁止使用可伪造环境变量代表人工批准。

**可观测行为**: Step 7 通过后 controller 写 `effect:human_review_requested`，主理人在受信 host 上通过生产已挂载路由 `POST /api/brain/harness/kernel-reviews/:runId/approve`，携带仅存在于 Brain/主理人凭据域的 `x-approver-token`，产生 `verdict:human_review`。回执必须 `gate_verdict=allow`、`approved=true`、`review_class=merge_gate`，并携带该路由逐字段校验的 `kernel-post-diff-risk/v1` 权威 proof，绑定 task/run/request hop/同一 PR head。合同不接受 `HUMAN_APPROVED=1` 等本地布尔环境变量、PR 评论文本、普通文件或仅有 `approved_by` 的裸 DB 行作为授权。controller 最多轮询 1800 秒；超时保持 Draft并结束为等待批准，不得 merge/deploy。

**主理人批准动作（Stage: trusted-host-operator；fleet-worker 不得执行）**:
```bash
RUN_ID='2ef32848-e3df-473b-ad4e-548216a33092'; TASK_ID='0138c756-65e1-44c6-a2ae-51a0ee47f7d4'; FINAL_HEAD_SHA=$(gh pr view 4457 --repo perfectuser21/cecelia --json headRefOid --jq .headRefOid); REVIEW_REQUEST_HOP=$(psql "$DB_URL" -Atc "SELECT hop FROM orchestrator_decision_log WHERE run_id='${RUN_ID}' AND action='effect:human_review_requested' ORDER BY hop DESC LIMIT 1"); POST_DIFF_RISK=$(psql "$DB_URL" -Atc "SELECT observed->'post_diff_risk' FROM orchestrator_decision_log WHERE run_id='${RUN_ID}' AND hop=${REVIEW_REQUEST_HOP}"); jq -n --arg task "$TASK_ID" --arg sha "$FINAL_HEAD_SHA" --argjson hop "$REVIEW_REQUEST_HOP" --arg by "$KERNEL_APPROVER_ID" --argjson risk "$POST_DIFF_RISK" '{task_id:$task,pr_head_sha:$sha,review_request_hop:$hop,approved_by:$by,post_diff_risk:$risk}' | curl -sf -X POST "http://localhost:5221/api/brain/harness/kernel-reviews/${RUN_ID}/approve" -H "Content-Type: application/json" -H "x-approver-token: ${HARNESS_REVIEW_APPROVER_TOKEN:?trusted host credential required}" --data-binary @- | jq -e --arg sha "$FINAL_HEAD_SHA" '.ok==true and .review_class=="merge_gate" and .pr_head_sha==$sha'
```

**批准后验证命令（Stage: post-judge-controller；evaluator 不执行）**:
```bash
FINAL_HEAD_SHA=$(gh pr view 4457 --repo perfectuser21/cecelia --json headRefOid --jq .headRefOid); DEADLINE=$((SECONDS+1800)); until psql "${DB_URL:-postgresql://localhost/cecelia}" -v ON_ERROR_STOP=1 -Atc "WITH e AS (SELECT hop,detail FROM orchestrator_decision_log WHERE run_id='2ef32848-e3df-473b-ad4e-548216a33092' AND action='verdict:evaluate' ORDER BY hop DESC LIMIT 1), j AS (SELECT hop,detail FROM orchestrator_decision_log WHERE run_id='2ef32848-e3df-473b-ad4e-548216a33092' AND action='verdict:judge' ORDER BY hop DESC LIMIT 1), r AS (SELECT hop,observed,detail FROM orchestrator_decision_log WHERE run_id='2ef32848-e3df-473b-ad4e-548216a33092' AND action='effect:human_review_requested' ORDER BY hop DESC LIMIT 1), a AS (SELECT hop,observed,gate_verdict,detail FROM orchestrator_decision_log WHERE run_id='2ef32848-e3df-473b-ad4e-548216a33092' AND action='verdict:human_review' ORDER BY hop DESC LIMIT 1) SELECT 1 FROM e,j,r,a WHERE e.detail->>'verdict'='PASS' AND j.detail->>'verdict'='PASS' AND e.detail->>'pr_head_sha'='${FINAL_HEAD_SHA}' AND j.detail->>'pr_head_sha'='${FINAL_HEAD_SHA}' AND e.hop<j.hop AND j.hop<r.hop AND r.hop<a.hop AND r.hop::text=a.detail->>'review_request_hop' AND a.gate_verdict='allow' AND a.detail->>'approved'='true' AND a.detail->>'review_class'='merge_gate' AND a.detail->>'pr_head_sha'='${FINAL_HEAD_SHA}' AND r.observed->'pr'->>'head_sha'='${FINAL_HEAD_SHA}' AND a.observed->'pr'->>'head_sha'='${FINAL_HEAD_SHA}' AND a.observed->'post_diff_risk'->>'schema_version'='kernel-post-diff-risk/v1' AND a.observed->'post_diff_risk'->'bindings'->>'task_id'='0138c756-65e1-44c6-a2ae-51a0ee47f7d4' AND a.observed->'post_diff_risk'->'bindings'->>'run_id'='2ef32848-e3df-473b-ad4e-548216a33092' AND a.observed->'post_diff_risk'->'bindings'->>'hop'=r.hop::text AND a.observed->'post_diff_risk'->'bindings'->>'head_sha'='${FINAL_HEAD_SHA}' AND a.observed->'post_diff_risk'=r.observed->'post_diff_risk' AND a.detail->'post_diff_risk'=r.detail->'post_diff_risk' AND coalesce(a.detail->>'approved_by','')<>''" | grep -qx 1; do [ "$SECONDS" -lt "$DEADLINE" ] || { echo "PENDING: 1800s 内无权威批准，保持 Draft，禁止 merge/deploy"; exit 2; }; sleep 15; done
```

**硬阈值**: evaluator hop < judge hop < review-request hop < approval hop；权威 request+approval 联表有且仅有匹配 final head 的最新链；1800 秒内无回执则 exit=2、保持 Draft，禁止 merge/deploy。总等待显著小于 28800 秒整次运行预算。

## 接缝清单

- [接缝×2] QuickCheck ↔ 真实 Vitest 子进程：用大输出、ANSI、真实 exit code 重复执行两次，结果不一致即 FLAKY。
- [接缝×2] OKR Router ↔ `cecelia_test` PostgreSQL：真实 Express/Supertest + 真 PG 重复两次，禁止生产 Brain/DB。
- GitHub Draft PR #4457 ↔ evaluator/judge/人工批准：只读核对同一 head；PR mutation 非幂等且由 controller 执行，因此不标重复执行。

## 禁 mock 边清单

- `scripts/quickcheck.sh` ↔ Vitest 子进程退出码与原始日志（不得 mock 分类输入为直接布尔值；测试必须真启动子进程）。
- `routes/okr-hierarchy.js` 真实 Router ↔ `cecelia_test` PostgreSQL（不得 mock router、DB pool 或用生产 Brain 替代）。
- canonical migration runner ↔ 随机 schema 的 `schema_version`（不得 mock `runMigrations` 或 PostgreSQL）。
- `package.json test:node` ↔ Node 原生 runner、`vitest.config.js` ↔ Vitest collection（登记与收集必须真跑）。

## 真实调用方请求 shape

N/A — 本 Sprint 不新增或修改设备/agent/webhook 调服务端的生产请求 shape；OKR 请求由测试内 Supertest 模拟现有 HTTP 调用方，沿用真实 router 的 `Content-Type: application/json` 与既有 payload 字段，不新增双路径。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 等价修复四个 blocker，并让同一 Draft PR head 获得可信验证。 |
| NFR（做得多好） | 未知失败 fail-closed；数据库隔离；migration 范围精确；证据锚定同一 SHA。 |
| Invariant（永不违反） | 不碰生产 Brain/DB，不改生产 migration SQL，不虚报 0/99，不新建/Ready/merge/deploy PR。 |
| 判定点（怎么知道） | 见下表。 |
| 保质期（何时过期） | 测试与 ratchet 随代码长期保留；PR head 证据在 head 变化时立即失效并须重跑。 |
| 死亡告警（停了谁知道） | 任一 focused/CI/evaluator/judge 非零阻塞 PR；主理人在 Draft PR 检查页可见。 |
| 失败语义（挂了怎么办） | 一律 fail-closed、保持 Draft；只允许三条件 OOM 降级。 |
| 效果确认（已发≠已生效） | 真实 runner exit、真 PG、migration 集合、同 head GitHub 状态共同确认。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ Vitest 非零是否属于可降级 worker OOM | A. 任意非零且无 ` FAIL `；B. OOM/worker 签名 + pass summary + 无 fail summary | B | PRD 明确三条件并要求未知失败 fail-closed | 真实测试失败被静默放行 |
| OKR 是否完全隔离生产 | A. 环境约定；B. DB 名 preflight + in-process router | B | 可执行且不依赖外部 Brain | 污染生产数据 |
| historical fixture 是否偷跑 382 | A. 文件扫描；B. runner 返回应用版本精确集合 | B | 直接观察真实 migration runner | 随机 fixture 随新增 migration 漂移 |
| ⚠️ 首次 merge 是否获主理人批准 | A. 假设 Draft 足够；B. judge PASS 后由 controller 获取显式 approval evidence | B | PRD 强制人工批准且 payload 指定 post-evaluator gate | 未授权 merge |

notes:
- judgment-pending-user: 首次 merge 是否获主理人批准（执行时必须取得显式 approval evidence）。
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` 存在)。
- remaining-infra-risks: GitHub required-check 配置漂移、self-hosted runner 不可用、GitHub/数据库查询暂时不可达均不由 focused 回归证明；Step 6-8 任一不可用或不确定均保持 Draft。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| Vitest 未知非零/失败摘要 | QuickCheck 非零 | 是 | 无 |
| 明确 OOM/worker + pass summary + 无 fail summary | 记录降级并继续 | 是 | 仅此三条件 |
| 测试 DB 不是 `_test` | 测试加载即失败 | 是 | 禁止回退 BRAIN_URL |
| migration 集合非 369–381 | 集成测试失败 | 是（随机 schema 清理后重跑） | 无 |
| CI/evaluator/judge/head 不一致 | 既有证据失效，保持 Draft并从漂移后的 head 重跑 | 查询幂等 | 无 |
| judge PASS 后 1800 秒仍未获人工批准 | gate exit=2，保持 Draft并结束为等待批准 | 查询幂等 | 禁止以环境变量或评论替代回执 |

### 输入对抗面

N/A — 不对外暴露 agent 或新增外部可写接口；QuickCheck 恶意/异常日志形态已作为边界输入覆盖。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 给 QuickCheck fixture 注入无 OOM 签名的 exit=137、ANSI `FAIL`、截断 summary。
- 重复提交: 连续两次运行 QuickCheck 与两个真 PG integration，确认锁和随机 schema 不串扰。
- 中途中断: Vitest 子进程输出大日志时强制结束，确认未知非零不降级。
- 边界值: 空日志、仅 pass summary、仅 OOM 签名、同时含 pass/fail summary、migration 目录出现 383。
发现分级: P0/P1（假绿、生产 DB 触达、未授权 PR mutation）阻塞 merge；P2/P3 记 findings 不阻塞。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "${REPO_ROOT:-/workspace}"
export TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://localhost/cecelia_test}"
FINAL_HEAD_SHA="$(git rev-parse HEAD)"
PR="$(gh pr view 4457 --repo perfectuser21/cecelia --json number,isDraft,headRefName,headRefOid,autoMergeRequest,state)"
echo "$PR" | jq -e --arg h "$FINAL_HEAD_SHA" '.number==4457 and .isDraft==true and .headRefName=="cp-kernel-phase5b-a1-review-fixes" and .headRefOid==$h and .autoMergeRequest==null and .state=="OPEN"'
npm test --workspace packages/engine -- --run tests/scripts/quickcheck-vitest-exit-classification.test.ts --reporter=verbose
npm exec --workspace packages/brain -- vitest run src/__tests__/native-node-test-runner-registration.test.js --reporter=verbose
npm run test:node --workspace packages/brain
TEST_DATABASE_URL="$TEST_DATABASE_URL" npm exec --workspace packages/brain -- vitest run src/__tests__/integration/okr-decomposition-flow.integration.test.js src/__tests__/integration/kernel-release-runs.integration.test.js --config vitest.integration.config.js --reporter=verbose
git diff --exit-code c0cd82fe298a8d1df812699507709d564a296f4e -- packages/brain/migrations/
npm test --workspace packages/quality -- --run __tests__/ci-core-regression.test.js --reporter=verbose
REPORT="$(node scripts/ci/check-kernel-behavior-equivalence.mjs --check-report --format=json)"
echo "$REPORT" | jq -e '.schema_valid==true and .proof_complete==false and .atomic_cutover_ready==false and (.cell_atomic_coverage|length)==99 and ([.cell_atomic_coverage[]|select((.live_proven_invariant_ids|length)>0 or (.live_proven_probe_ids|length)>0)]|length)==0'
if node scripts/ci/run-kernel-equivalence-drill.mjs --gate --format=json; then echo "FAIL: manual cutover gate 意外放行"; exit 1; fi
CHECKS="$(gh pr checks 4457 --repo perfectuser21/cecelia --required --json name,state,bucket)"
echo "$CHECKS" | jq -e 'length>0 and all(.[]; .state=="SUCCESS")'
echo "OK: evaluator 已验证本地聚焦检查集与 exact-head GitHub required checks 集；judge/人工批准证据由 post-judge controller gate 后续验证"
```

## Post-judge controller gate（不由 evaluator 执行）

1. evaluator 完成并写 `verdict:evaluate` 后，judge 才能运行并写 `verdict:judge`。
2. controller 执行 Step 7 的同-head与 `evaluator hop < judge hop` oracle；通过后才写 `effect:human_review_requested`。
3. controller 执行 Step 8 的最长 1800 秒权威 approval gate，验证完整顺序 `evaluator < judge < review-request < approval`；超时保持 Draft。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| QuickCheck 分类 | `tests/devops-blockers-contract.test.ts` | QuickCheck 大输出真实失败与未知非零均 fail-closed，仅三条件 OOM 降级 | 大输出 `FAIL` 被 pipefail+grep SIGPIPE 错分为降级，`status` 行为断言失败 |
| node:test 登记 | `tests/devops-blockers-contract.test.ts` | mutation seam 仅由 test:node 收集且 Vitest collection 排除 | 真实 `test:node` TAP 不含 seam 用例，stdout 行为断言失败 |
| OKR 隔离 | `tests/devops-blockers-contract.test.ts` | OKR integration 在进程内 Router 上执行且不因外部 Brain 缺失而跳过 | `BRAIN_URL=127.0.0.1:1` 时整套 pending，`numPendingTests===0` 行为断言失败 |
| migration 窗口 | `tests/devops-blockers-contract.test.ts` | historical migration fixture 真跑 canonical runner 时只应用 369-381 | 真 PG 上 canonical runner 返回包含 382，现有 `resolves.toEqual(369..381)` 行为断言失败 |

## TDD Red 证据（Round 8）

依赖准备命令：`npm ci --workspace packages/engine --workspace packages/brain --workspace packages/quality --ignore-scripts`（本轮 exit=0，安装锁文件指定的 Vitest/Supertest/pg）。Red 使用 workspace/config-aware 命令，不读取源码字符串自证；本 proposer 容器把可达的 `cecelia_test` URL 显式注入：

```bash
TEST_DATABASE_URL=postgresql://cecelia@host.docker.internal/cecelia_test npm test --workspace packages/engine -- --config ../../sprints/07300855-kernel-pr4457-devops-blockers/tests/vitest.config.mjs --reporter=verbose
```

实跑 Red：外层 Vitest v3.2.4 正常收集 1 个文件/4 个 `it()`，exit=1、4/4 failed。失败分别落在 QuickCheck 未知非零 status、`test:node` TAP 缺 seam 用例、OKR assertions 全为 pending、以及真 `cecelia_test` 中 canonical runner 尝试执行 382 后令 `resolves.toEqual(369..381)` 失败；无 module/config/startup failure。`host.docker.internal` 仅是本次 proposer 执行面的解析结果，evaluator/CI 必须通过其自身 `$TEST_DATABASE_URL` 注入测试库，不得写死该主机名。
