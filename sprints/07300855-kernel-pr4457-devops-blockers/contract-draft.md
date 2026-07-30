# Sprint Contract Draft (Round 2)

## 合同锚点与范围

- 基线：既有 Draft PR #4457，分支 `cp-kernel-phase5b-a1-review-fixes`，起始 SHA `c0cd82fe298a8d1df812699507709d564a296f4e`。
- 只允许更新该 Draft PR；禁止新建重复 PR、转 Ready、merge、deploy。
- 本合同只覆盖四个 blocker、对应 Red/Green、同一最终 head 的 CI/evaluator/judge 证明和首次 merge 人工门。
- 明确不改：`packages/brain/migrations/381_*.sql`、`packages/brain/migrations/382_*.sql` 及其他生产 migration SQL；不做 Kernel cutover。

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
npx vitest run packages/engine/tests/scripts/quickcheck-vitest-exit-classification.test.ts --reporter=verbose
```

**硬阈值**: 聚焦测试 exit=0；测试至少覆盖“真实失败非零”“未知非零 fail-closed”“genuine OOM 三条件降级”三类。上述命令即阈值 oracle。

---

### Step 2: mutation seam 只由 node:test 收集并受 ratchet 约束
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 步。

**可观测行为**: `github-mutation-equivalence-seam.test.cjs` 不被 Vitest 收集，同时字面登记在 `test:node`，自动登记回归测试会阻止以后漏挂。

**验证命令**:
```bash
node --test packages/brain/src/__tests__/native-node-test-runner-registration.test.js && npm run test:node -w packages/brain
```

**硬阈值**: 两条命令均 exit=0；原生 runner 实际执行 mutation seam，Vitest exclude 与 `test:node` 登记同时成立。

---

### Step 3: OKR integration 仅连接 cecelia_test 的进程内真实 Router
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 步及「边界情况」测试库 preflight。

**可观测行为**: 集成测试在当前测试进程创建 Express app、挂载真实 OKR router、用 Supertest 发请求；router 与 fixture 共享同一个 `cecelia_test` PostgreSQL。测试不探测或调用 `BRAIN_URL`/localhost:5221，也不连接数据库 `cecelia`。

**验证命令**:
```bash
TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://localhost/cecelia_test}" npx vitest run packages/brain/src/__tests__/integration/okr-decomposition-flow.integration.test.js --config packages/brain/vitest.integration.config.js --reporter=verbose
```

**硬阈值**: preflight 数据库名必须匹配 `_test`（本合同明确使用 `cecelia_test`）；整套测试 exit=0，任一非测试 DB 或外部 Brain fallback 必须 exit≠0。

---

### Step 4: historical migration fixture 冻结 369–381
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 步及边界“382 及以后不得改变 historical fixture”。

**可观测行为**: 随机 schema fixture 通过 canonical runner 精确应用 369–381，并明确证明 382 未进入该 fixture；382 专属验证仍单独通过；生产 migration SQL 的 blob SHA 与基线一致。

**验证命令**:
```bash
TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://localhost/cecelia_test}" npx vitest run packages/brain/src/__tests__/integration/kernel-release-runs.integration.test.js --config packages/brain/vitest.integration.config.js --reporter=verbose && git diff --exit-code c0cd82fe298a8d1df812699507709d564a296f4e -- packages/brain/migrations/
```

**硬阈值**: 聚焦测试 exit=0；历史应用集合严格等于 369..381 且不含 382；migration 目录相对基线零 diff。

---

### Step 5: 统一回归保持 Kernel fail-closed 真相
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 5 步。

**可观测行为**: 四项聚焦回归及 Engine/Brain/PR-tier 检查全绿；atomic 输出仍为 `schema_valid=true`、`proof_complete=false`、`atomic_cutover_ready=false`、live proof `0/99`，manual cutover gate 必须非零。

**验证命令**:
```bash
npx vitest run packages/engine/tests/scripts/quickcheck-vitest-exit-classification.test.ts packages/quality/__tests__/ci-core-regression.test.js --reporter=verbose && npm test -w packages/brain && node scripts/ci/check-kernel-behavior-equivalence.mjs --check-report --format=json | jq -e '.schema_valid==true and .proof_complete==false and .atomic_cutover_ready==false and (.cell_atomic_coverage|length)==99 and ([.cell_atomic_coverage[]|select((.live_proven_invariant_ids|length)>0 or (.live_proven_probe_ids|length)>0)]|length)==0' && if node scripts/ci/run-kernel-equivalence-drill.mjs --gate --format=json; then echo 'FAIL: manual cutover gate 意外放行'; exit 1; fi
```

**硬阈值**: 正向检查全部 exit=0；manual gate exit≠0；live proof 0/99。

---

### Step 6: 当前验收只核对 Draft PR head，后续阶段按序追加证据并停在人工批准门
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 6 步与假设“同一最终 head”。

**可观测行为**: 本轮 evaluator 只核对其正在验收的 checkout SHA 等于 Draft PR #4457 当前 `headRefOid`，且 PR 保持 Draft、无 auto-merge；evaluator PASS 后 judge 才能在同一 SHA 判定，judge PASS 后 controller 才能请求主理人批准。任何阶段 head 漂移都使已有证据失效并要求重跑；批准前不得 merge/deploy。

**验证命令**:
```bash
FINAL_HEAD_SHA=$(git rev-parse HEAD); PR=$(gh pr view 4457 --repo perfectuser21/cecelia --json number,isDraft,headRefName,headRefOid,autoMergeRequest,state); echo "$PR" | jq -e '.number==4457 and .isDraft==true and .headRefName=="cp-kernel-phase5b-a1-review-fixes" and .autoMergeRequest==null and .state=="OPEN"' && test "$(echo "$PR" | jq -r '.headRefOid')" = "$FINAL_HEAD_SHA"
```

**硬阈值**: evaluator 时 PR=4457、Draft=true、OPEN、autoMergeRequest=null，checkout SHA=PR head；后续 judge/evaluator evidence SHA 必须等于同一最终 head，首次 merge 前必须有显式主理人批准。future-stage 证据不得作为 evaluator 自身的前置环境变量。

## 接缝清单

- [接缝×2] QuickCheck ↔ 真实 Vitest 子进程：用大输出、ANSI、真实 exit code 重复执行两次，结果不一致即 FLAKY。
- [接缝×2] OKR Router ↔ `cecelia_test` PostgreSQL：真实 Express/Supertest + 真 PG 重复两次，禁止生产 Brain/DB。
- GitHub Draft PR #4457 ↔ evaluator/judge/人工批准：只读核对同一 head；PR mutation 非幂等且由 controller 执行，因此不标重复执行。

## 禁 mock 边清单

- `scripts/quickcheck.sh` ↔ Vitest 子进程退出码与原始日志（不得 mock 分类输入为直接布尔值；测试必须真启动子进程）。
- `okr.js` 真实 Router ↔ `cecelia_test` PostgreSQL（不得 mock router、DB pool 或用生产 Brain 替代）。
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

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| Vitest 未知非零/失败摘要 | QuickCheck 非零 | 是 | 无 |
| 明确 OOM/worker + pass summary + 无 fail summary | 记录降级并继续 | 是 | 仅此三条件 |
| 测试 DB 不是 `_test` | 测试加载即失败 | 是 | 禁止回退 BRAIN_URL |
| migration 集合非 369–381 | 集成测试失败 | 是（随机 schema 清理后重跑） | 无 |
| CI/evaluator/judge/head 不一致 | 既有证据失效，保持 Draft并从漂移后的 head 重跑 | 查询幂等 | 无 |
| judge PASS 后仍未获人工批准 | 保持 Draft并阻塞 merge/deploy | 查询幂等 | 无 |

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
test "$FINAL_HEAD_SHA" = "$(gh pr view 4457 --repo perfectuser21/cecelia --json headRefOid --jq .headRefOid)"
npx vitest run packages/engine/tests/scripts/quickcheck-vitest-exit-classification.test.ts --reporter=verbose
node --test packages/brain/src/__tests__/native-node-test-runner-registration.test.js
npm run test:node -w packages/brain
npx vitest run packages/brain/src/__tests__/integration/okr-decomposition-flow.integration.test.js packages/brain/src/__tests__/integration/kernel-release-runs.integration.test.js --config packages/brain/vitest.integration.config.js --reporter=verbose
git diff --exit-code c0cd82fe298a8d1df812699507709d564a296f4e -- packages/brain/migrations/
npx vitest run packages/quality/__tests__/ci-core-regression.test.js --reporter=verbose
REPORT="$(node scripts/ci/check-kernel-behavior-equivalence.mjs --check-report --format=json)"
echo "$REPORT" | jq -e '.schema_valid==true and .proof_complete==false and .atomic_cutover_ready==false and (.cell_atomic_coverage|length)==99 and ([.cell_atomic_coverage[]|select((.live_proven_invariant_ids|length)>0 or (.live_proven_probe_ids|length)>0)]|length)==0'
if node scripts/ci/run-kernel-equivalence-drill.mjs --gate --format=json; then echo "FAIL: manual cutover gate 意外放行"; exit 1; fi
PR="$(gh pr view 4457 --repo perfectuser21/cecelia --json number,isDraft,headRefName,headRefOid,autoMergeRequest,state)"
echo "$PR" | jq -e '.number==4457 and .isDraft==true and .headRefName=="cp-kernel-phase5b-a1-review-fixes" and .headRefOid=="'"$FINAL_HEAD_SHA"'" and .autoMergeRequest==null and .state=="OPEN"'
echo "OK: 四 blocker 等价证明、0/99 fail-closed、evaluator checkout 与 Draft PR head 对齐"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| QuickCheck 分类 | `tests/devops-blockers-contract.test.ts` | QuickCheck 未具备三条件 OOM 分类 | 基线脚本对未知非零降级，断言失败 |
| node:test 登记 | `tests/devops-blockers-contract.test.ts` | mutation seam 未完成双登记 ratchet | 基线缺登记测试/双登记，断言失败 |
| OKR 隔离 | `tests/devops-blockers-contract.test.ts` | OKR integration 仍依赖外部 Brain | 基线含 BRAIN_URL/fetch/skip，断言失败 |
| migration 窗口 | `tests/devops-blockers-contract.test.ts` | historical fixture 未显式排除 382 | 新 migration 进入 runner 返回集合，集成预期失败 |
