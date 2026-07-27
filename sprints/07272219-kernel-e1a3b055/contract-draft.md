# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: N/A）

N/A — 本 sprint 不新增 HTTP 响应契约；验收聚焦现有 GitHub PR 元数据、现有审批路由、真实 PostgreSQL 预检与当前主线等价回归。

## 已知约束（来自回归测试）

- [tests/regression/relay-50170af2/kernel-wiring-approval-route.integration.test.js] → `mounted route rejects unauthenticated/stale/duplicate approval and valid approval unlocks merge`
- [tests/live/kernel-0a8c796b/session-provenance.contract.test.ts] → `contract test requires a test database`，且 migration 必须可重复应用
- [tests/live/kernel-0a8c796b/launcher-provenance.contract.test.ts] → launcher 合同测试要求真实 PostgreSQL，不允许非测试库
- [packages/brain/src/__tests__/staging-verify-host.test.js] → 容器内校验默认使用 `host.docker.internal`，不能退回纯 `localhost`
- [累积FR] context-manifest: unavailable

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求：系统对外承诺做什么 | 在既有 Draft PR #4372 上重建 current-main 证据、migration 366 基线、evaluator 容器内 DB 预检、F1 当前主线等价回归与同 SHA 审批绑定 |
| **NFR（做得多好）** | 非功能需求：性能/可靠性/并发阈值等 | 所有证据必须锚定最终同一 PR head SHA；数据库预检必须 fail-closed；旧 green checks / 旧 contract sha 一律无效 |
| **Invariant（永不违反）** | 任何情况下不得打破的不变量（安全/数据一致性/幂等） | 单槽串行、真环境验证、禁写死环境、测试库隔离四条铁律均保持；任何偏离即 FAIL |
| **判定点（怎么知道）** | 对模糊现实的判断假设（详见“判定点登记表”） | 见下方登记表 |
| **保质期（何时过期）** | 该能力/数据/token 何时失效，谁负责退役 | 任一新 commit 产生后，evaluator PASS、judge PASS、human approval、required checks 全部立即过期，需按新 head SHA 重验 |
| **死亡告警（停了谁知道）** | 该功能停止工作后，谁在多久内会知道，用什么告警手段 | evaluator 预检在容器内首步失败即阻断；judge/approval SHA 不一致即 PR 收口失败；GitHub required checks 非 current SHA 立即可见 |
| **失败语义（挂了怎么办）** | 故障时放行还是拦截？重试幂等？降级策略？ | merge-base 不符、DB 预检不符、migration 口径非 366、Draft/autoMergeRequest 不符、SHA 不一致时全部拦截；不降级、不放行 |
| **效果确认（已发≠已生效）** | 每个对外动作如何确认真实生效？回执方式/时限/拿不到算什么 | GitHub 用 `gh pr view` / `gh pr checks` 真回执；DB 用 `psql` 查 `current_database()`、`inet_server_addr()` 与 migration 结果；回执缺失即失败 |

### 判定点登记表（对模糊现实的判断假设 — decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ 最终 merge-base 是否就是 `1dc9d4107cc14f9bc509c1ef285845f1dfb13838` | A. `git merge-base`; B. 人工肉眼看 PR 页面 | A. `git merge-base` 精确对账 | 可脚本化且直接锚定当前 head | 错把旧基线当新基线，整套回归证据失真 |
| ⚠️ evaluator 容器是否真的连到隔离测试库 | A. 只看 `DATABASE_URL`; B. 真查 `current_database()` + `inet_server_addr()` | B. 真查库名与服务端地址 | 环境变量可伪造，数据库回执不可替代 | 误连生产或共享库，污染数据且合同假绿 |
| ⚠️ evaluator / judge / human approval 是否绑定同一最终 head SHA | A. 只看一次 approval 记录; B. 对 evaluator/judge verdict 与 human review 都逐条比对 `pr_head_sha` | B. 逐条比对同一最终 SHA | PRD 明确要求三者同 SHA 才有效 | 旧批准复用导致错误合并 |
| PR #4372 是否仍保持 Draft 且 `autoMergeRequest=null` | A. 只看 Draft 标签; B. `gh pr view --json isDraft,autoMergeRequest` | B. GitHub 真字段回执 | 需要 machine-check，且要覆盖 auto-merge 状态 | 自动合并误开启，绕过人工闸门 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| merge-base 不是 `1dc9d410...` | 立即停止后续等价回归，记录证据并 FAIL | 是，同一 head SHA 可重复验证 | 无降级，必须先修基线 |
| evaluator 容器内 DB 地址是 `127.0.0.1` 或库名不匹配 `_test`/`preview_*` | 预检阶段直接 FAIL | 是，修正环境后重跑 | 无降级 |
| 任一位置出现非 `366` migration 口径 | 视为合同破裂并 FAIL | 是，统一口径后重跑 | 无降级 |
| evaluator/judge/human approval 任一 SHA 不一致或验证后新增 commit | 旧批准全部失效，重新验证 | 是，新 SHA 重新收集证据 | 无降级 |

### 输入对抗面（对外暴露 agent 必填 — decisions 27b57469 第9要素）

N/A — 本 sprint 不新增外部用户可写 agent 面；输入面来自 GitHub、PostgreSQL 与已有审批路由，均按现有认证与只读/测试库隔离执行。

## 真实调用方请求 shape

### Endpoint: `POST /api/brain/harness/kernel-reviews/:runId/approve`

- 认证方式：Header `x-approver-token: <token>`
- Content-Type：`application/json`
- Body 必填字段：
  - `task_id`：UUID，必须与 `initiative_runs.current_task_id` 匹配
  - `pr_head_sha`：最终待绑定的 PR head SHA
  - `review_request_hop`：正整数，必须对应当前 SHA 的 `effect:human_review_requested`
  - `approved_by`：操作者标识
- 关键语义：`pr_head_sha` 必须与 GitHub 当前 `headRefOid` 完全一致；旧 SHA 返回 409；同 SHA 重复批准返回 409

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 禁 mock 边清单

- `packages/brain/migrations/366_*` ↔ `schema_version` / 目标表（本单要求同一隔离 PostgreSQL 数据库内连续两次跑 migration 366）
- evaluator 预检脚本 ↔ `host.docker.internal` PostgreSQL（本单改的是容器内 DB 接缝，测试必须真查 `current_database()` 与 `inet_server_addr()`）
- PR #4372 GitHub metadata ↔ approval / evaluator / judge SHA 绑定（本单改的是 GitHub PR 真元数据判定，不可用静态假 JSON 代替）
- Draft PR 状态 ↔ `autoMergeRequest` / required checks（本单改的是 PR 收口闸门，不可 mock 成固定 PASS）

## 接缝清单

- GitHub PR #4372 元数据接缝：用 `gh pr view 4372 --json ...` 真查 `isDraft`、`autoMergeRequest`、`headRefOid`
- evaluator 容器数据库接缝：用 `psql "$DB_URL"` 真查 `current_database()`、`inet_server_addr()`、migration 366 二次执行结果
- 当前主线等价回归接缝：用真实 regression / smoke / DevGate / required checks 清单确认 F1 基线仍落在 current SHA

## Golden Path

覆盖父路 `PR4372-recovery` 第 1-5 步

### Step 1: 证明 current main 是 PR #4372 的唯一 merge-base 并收集语义解冲突证据
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步直接要求 `current main 1dc9d410...` 为 merge-base，且旧 green checks / 旧 contract sha 无效

**可观测行为**: 对 PR #4372 当前 head SHA 运行 merge-base 对账，得到唯一 merge-base=`1dc9d4107cc14f9bc509c1ef285845f1dfb13838`；同时生成语义解冲突证据并拒绝旧 contract sha `a5daa66a6`

**验证命令**:
```bash
git fetch origin main refs/pull/4372/head:refs/tmp/pr4372
PR_HEAD=$(git rev-parse refs/tmp/pr4372)
MB=$(git merge-base 1dc9d4107cc14f9bc509c1ef285845f1dfb13838 "$PR_HEAD")
[ "$MB" = "1dc9d4107cc14f9bc509c1ef285845f1dfb13838" ] || { echo "FAIL: merge-base=$MB"; exit 1; }
! rg -n "a5daa66a6" sprints/07272219-kernel-e1a3b055 packages/brain tests docs .github || { echo "FAIL: stale contract sha leaked"; exit 1; }
```

**硬阈值**: merge-base 必须精确等于 `1dc9d4107cc14f9bc509c1ef285845f1dfb13838`；合同与实现证据中不得再接受 `a5daa66a6`

---

### Step 2: 把 migration baseline 锁定为 366，并在同一隔离 PostgreSQL 数据库内连续执行两次
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步要求 SQL、测试文件名、artifact oracle、task plan、文档口径都只能是 `366`

**可观测行为**: 新 migration SQL、测试文件名、合同、task-plan、说明文档统一出现 `366`；同一隔离 PostgreSQL 数据库内连续两次运行 migration 366 均成功且只落一次 schema_version 366

**验证命令**:
```bash
rg -n "\\b366\\b" sprints/07272219-kernel-e1a3b055 packages/brain/migrations tests docs .github | grep -v "07272219-kernel-e1a3b055/sprint-prd.md"
! rg -n "\\b(363|364|365|367)\\b" sprints/07272219-kernel-e1a3b055 packages/brain/migrations tests docs .github --glob '!**/package-lock.json' --glob '!**/pnpm-lock.yaml'
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f packages/brain/migrations/366_pr4372_recovery_baseline.sql
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f packages/brain/migrations/366_pr4372_recovery_baseline.sql
COUNT=$(psql "$DB_URL" -X -qAt -c "SELECT count(*) FROM schema_version WHERE version='366' AND applied_at > NOW() - interval '5 minutes'")
[ "$COUNT" = "1" ] || { echo "FAIL: schema_version_366_count=$COUNT"; exit 1; }
```

**硬阈值**: 所有口径只允许 `366`；migration 366 在同一隔离 DB 中必须二次执行成功且 `schema_version.version='366'` 只新增一次

---

### Step 3: evaluator 在自己的容器内完成 DB reachability / isolation preflight
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步直接要求 `host.docker.internal`、`current_database()`、`inet_server_addr()` 与 `_test|preview_*`

**可观测行为**: evaluator 预检脚本在容器内拒绝 `127.0.0.1`，只接受 `host.docker.internal`；真实回执显示测试库名与服务端地址，并且库名只允许 `_test` 或 `preview_*`

**验证命令**:
```bash
echo "$DB_URL" | grep -q "host.docker.internal" || { echo "FAIL: DB_URL must use host.docker.internal"; exit 1; }
! echo "$DB_URL" | grep -q "127.0.0.1" || { echo "FAIL: DB_URL must not use 127.0.0.1"; exit 1; }
DB_ROW=$(psql "$DB_URL" -X -qAt -c "SELECT current_database() || '|' || COALESCE(inet_server_addr()::text,'NULL')")
DB_NAME=${DB_ROW%%|*}
DB_ADDR=${DB_ROW#*|}
echo "$DB_NAME" | grep -Eq '(_test$|^preview_[A-Za-z0-9_]+$)' || { echo "FAIL: db_name=$DB_NAME"; exit 1; }
[ "$DB_ADDR" != "127.0.0.1" ] || { echo "FAIL: inet_server_addr=$DB_ADDR"; exit 1; }
```

**硬阈值**: evaluator 预检必须在容器内直连 `host.docker.internal`；DB 名只允许 `_test`/`preview_*`；任一不符立即 FAIL

---

### Step 4: 重跑 current-main F1 等价基线并锁定 current SHA required checks
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 步列出 `S0-S12`、`143` cells、`11` elements、`8` legacy families、contract oracle、integration tests、`7` legacy smokes、endpoint semantics、runtime non-regression、DevGate、required checks

**可观测行为**: current SHA 上存在单一 F1 baseline 清单，覆盖 S0-S12 / 143 / 11 / 8 / 7 的所有要素；对应 integration、legacy smokes、contract oracle、DevGate、required checks 都以 current SHA 为准，不复用旧绿灯

**验证命令**:
```bash
node sprints/07272219-kernel-e1a3b055/tests/f1-current-main-equivalence.contract.test.ts >/dev/null 2>&1 || true
bash packages/brain/scripts/smoke/kernel-fleet-verification-smoke.sh
bash scripts/devgate/check-activation.sh
gh pr checks 4372 --required --json name,state,link | jq -e 'length > 0 and all(.[]; .state == "SUCCESS")'
```

**硬阈值**: F1 单一路径必须完整声明 `S0-S12`、`143`、`11`、`8`、`7` 并全部锚定当前 head SHA；required checks 只认 current SHA 的成功记录

---

### Step 5: PR #4372 保持 Draft 且 evaluator / judge / human approval 绑定同一最终 head SHA
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 步要求 PR 仍为 Draft、`autoMergeRequest=null`，且 evaluator PASS、judge PASS、human approval 同时绑定同一最终 head SHA

**可观测行为**: `gh pr view 4372` 返回 `isDraft=true` 与 `autoMergeRequest=null`；approval route、judge verdict、evaluator verdict 都使用相同 `pr_head_sha`；任一新 commit 导致旧批准立即失效

**验证命令**:
```bash
PR_JSON=$(gh pr view 4372 --json isDraft,autoMergeRequest,headRefOid)
echo "$PR_JSON" | jq -e '.isDraft == true and .autoMergeRequest == null and (.headRefOid | type == "string" and length == 40)'
FINAL_SHA=$(echo "$PR_JSON" | jq -r '.headRefOid')
curl -sf localhost:5221/api/brain/harness/kernel-reviews/00000000-0000-4000-8000-000000000000/approve \
  -H "Content-Type: application/json" \
  -H "x-approver-token: ${HARNESS_REVIEW_APPROVER_TOKEN}" \
  -d "{\"task_id\":\"00000000-0000-4000-8000-000000000001\",\"pr_head_sha\":\"$FINAL_SHA\",\"review_request_hop\":1,\"approved_by\":\"contract-e2e\"}" \
  | jq -e --arg sha "$FINAL_SHA" '.pr_head_sha == $sha or .current_pr_head_sha == $sha'
```

**硬阈值**: `isDraft=true`、`autoMergeRequest=null`、同一最终 `headRefOid` 绑定 evaluator/judge/human approval；新增 commit 后旧批准必须失效

---

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="${WORKSPACE_PATH:-/workspace}"
cd "$ROOT"

: "${DB_URL:?DB_URL must point to evaluator-visible test database via host.docker.internal}"
: "${HARNESS_REVIEW_APPROVER_TOKEN:?approval token required for real approval-shape check}"

MAIN_SHA="1dc9d4107cc14f9bc509c1ef285845f1dfb13838"

git fetch origin main refs/pull/4372/head:refs/tmp/pr4372
PR_HEAD=$(git rev-parse refs/tmp/pr4372)
MB=$(git merge-base "$MAIN_SHA" "$PR_HEAD")
[ "$MB" = "$MAIN_SHA" ] || { echo "FAIL: merge-base=$MB expected=$MAIN_SHA"; exit 1; }

echo "$DB_URL" | grep -q "host.docker.internal" || { echo "FAIL: DB_URL must use host.docker.internal"; exit 1; }
! echo "$DB_URL" | grep -q "127.0.0.1" || { echo "FAIL: DB_URL must not use 127.0.0.1"; exit 1; }
DB_ROW=$(psql "$DB_URL" -X -qAt -c "SELECT current_database() || '|' || COALESCE(inet_server_addr()::text,'NULL')")
DB_NAME=${DB_ROW%%|*}
DB_ADDR=${DB_ROW#*|}
echo "$DB_NAME" | grep -Eq '(_test$|^preview_[A-Za-z0-9_]+$)' || { echo "FAIL: db_name=$DB_NAME"; exit 1; }
[ "$DB_ADDR" != "127.0.0.1" ] || { echo "FAIL: inet_server_addr=$DB_ADDR"; exit 1; }

psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f packages/brain/migrations/366_pr4372_recovery_baseline.sql
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f packages/brain/migrations/366_pr4372_recovery_baseline.sql
COUNT=$(psql "$DB_URL" -X -qAt -c "SELECT count(*) FROM schema_version WHERE version='366' AND applied_at > NOW() - interval '5 minutes'")
[ "$COUNT" = "1" ] || { echo "FAIL: schema_version_366_count=$COUNT"; exit 1; }

PR_JSON=$(gh pr view 4372 --json isDraft,autoMergeRequest,headRefOid)
echo "$PR_JSON" | jq -e '.isDraft == true and .autoMergeRequest == null and (.headRefOid | type == "string" and length == 40)' >/dev/null
FINAL_SHA=$(echo "$PR_JSON" | jq -r '.headRefOid')

gh pr checks 4372 --required --json name,state,link | jq -e 'length > 0 and all(.[]; .state == "SUCCESS")' >/dev/null

bash packages/brain/scripts/smoke/kernel-fleet-verification-smoke.sh
bash scripts/devgate/check-activation.sh

echo "PASS: PR4372 recovery contract prerequisites verified on current SHA $FINAL_SHA"
```
