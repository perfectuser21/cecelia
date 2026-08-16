# Sprint Contract Draft (Round 1)

覆盖父路 journey `e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29` 第 1-6 步（有头 /dev 收编：Work Router receipt 有头签发口）。

**journey_type**: dev_pipeline
**target_environment**: local_api（Brain 内部签发口 + psql 查 harness_attempts；curl localhost:5221）

contract-gate: cecelia worktree（packages/brain/src/lib/contract-gate.js 存在）→ 代码层 Contract Gate 生效，断言按速查表惯用法写。
gp-anchor: skipped (product-map.json not found)

---

## Response Schema（推导来源: PRD 字面 + api_registry 未查到 headed-attempts 同名端点 → 沿用 work-routing.js validate 既有字段命名）

### Endpoint: POST /api/brain/work-routing/headed-attempts

**入参 (application/json)**:
```json
{"task_id": "<uuid>", "branch": "<cp-*>", "base_sha": "<40hex>", "session_id": "<string, 可空>"}
```
- `task_id` (uuid, 必填): 来源——PRD 第 2/3 步「入参 task_id」
- `branch` (string, 必填): 必须匹配 `^cp-[a-z0-9][a-z0-9._-]{0,126}$`（validate 的 BRANCH 正则，session-* 拒绝）
- `base_sha` (string, 必填): 40 位小写 hex
- `session_id` (string, 可空): launcher `$CLAUDE_SESSION_ID`，写入 attempt 便于收尾定位

**Success (HTTP 201)**:
```json
{"routing_receipt_id": "<uuid>", "run_id": "<uuid>", "base_sha": "<40hex>", "route_token": "<64hex>"}
```
- `routing_receipt_id` (uuid, 必填): 该 task 的 `payload.routing_receipt_id`，来源——PRD 第 3 步返回契约
- `run_id` (uuid, 必填): createKernelRun 创建/复用的 `initiative_runs.id`
- `base_sha` (string, 必填): 回显入参 base_sha
- `route_token` (string=`^[a-f0-9]{64}$`, 必填): 只在签发时返回一次；即写入 `harness_attempts.callback_secret_hash` 的 64-hex 值（见判定点表「route_token↔callback_secret_hash」）。库内只存该 hash，不返回其它明文、不落日志。

**禁用字段名**: `callback_secret`（明文不得出现在响应）、`token`（用 `route_token`）、`attempt_id`（不外泄）、`id`（用 `routing_receipt_id`/`run_id`）。

**Error**:
- task 无 `routing_receipt_id`（或 task 不存在/非法 uuid）→ **HTTP 400** `{"error": "<string>"}`（不写库）。
- attempt 已 completed/expire 后再 `POST /work-routing/validate` → **HTTP 409** `{"valid": false, "reason_code": "run_attempt_inactive"}`（validate SQL 既有语义，不改）。

### Endpoint: 收尾 PATCH（attempt completed）
有头 attempt 结束（/dev 收尾或 PR merged）→ 走既有 attempt 收尾把该 headed attempt `status='completed'`（复用现有 attempt 收尾/心跳机制，不新增语义）。之后 validate 因 `status IN ('starting','running')` 不再命中 → 返回 409 `run_attempt_inactive`，闸自动收回。

---

## Golden Path

[新 session worktree（分支 session-*，无 lock）] → [hook 仅放行 worktree-manage.sh 精确路径] → [worktree-manage.sh --task-id：改 cp-branch + 调签发口领 attempt + 写六字段 lock/env] → [`echo ok` 过 hook（validate valid:true）] → [收尾 PATCH completed → validate 409 闸收回]

---

### Step 1: 无 lock 时 hook 仅放行 worktree-manage.sh 精确路径，其余 Bash 仍 block
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步（「无 lock，hook 仅对 `bash <repo>/packages/engine/skills/dev/scripts/worktree-manage.sh …`（精确路径匹配）放行，其余 Bash 仍 block」）

**可观测行为**: 在无 `.dev-lock.<branch>`、无 `CECELIA_ROUTING_*` scoped env 的 worktree 里：
- `tool_name=Bash` 且命令是 `bash <MAIN_REPO>/packages/engine/skills/dev/scripts/worktree-manage.sh …`（`bash` + 该绝对路径精确前缀）→ hook exit 0（放行）。
- 任意其它 Bash（如 `echo ok`）/ Edit / Write / 未知工具 → hook exit 2，`{"decision":"block","reason":"route_violation: …"}`。
- 只读工具 Read/Grep/Glob 照旧放行。

**验证命令**:
```bash
bash packages/engine/tests/integration/dev-mode-tool-guard.test.sh
# 期望：exit 0，新增 bootstrap 放行 case 与「非 worktree-manage Bash 仍 block」case 均 PASS
```
**硬阈值**: 测试脚本 exit 0；bootstrap 放行 case exit=0、其它 Bash case exit=2。

---

### Step 2: worktree-manage.sh init-or-check/create 见 --task-id → 改 cp-branch + 调签发口 + 写六字段 lock
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2/4 步

**可观测行为**: 有头会话在 session-* 或裸 worktree 跑 `worktree-manage.sh init-or-check <name> --task-id <routed>`：
- 分支从 `session-*` 改成 `cp-<MMDDHHNN>-<slug>`（session-* 过不了 validate）。
- 调 `POST /api/brain/work-routing/headed-attempts`（URL 走 `${CECELIA_ROUTING_HEADED_URL:-${BRAIN_URL:-http://localhost:5221}/api/brain/work-routing/headed-attempts}`，禁写死）。
- 用返回值把六字段 `routing_receipt_id/task_id/run_id/repo/base_sha/branch` 写进 `.dev-lock.<cp-branch>`，并导出 `CECELIA_ROUTING_VALIDATE_URL`（validate 端点）/`CECELIA_ROUTING_VALIDATION_TOKEN`（=route_token）等 env。

**验证命令**（针对真 Brain + 真 PG，见 ## E2E 验收 与 Brain 集成测试）:
```bash
# 见 B-05：init-or-check --task-id 后六字段齐全（jq -e）
jq -e '.routing_receipt_id and .task_id and .run_id and .repo and .base_sha and .branch' "$LOCK"
```
**硬阈值**: 六字段全非空；`branch` 匹配 `^cp-`；lock 内不含 `route_token`/`callback_secret` 明文键。

---

### Step 3: Brain 签发 headed attempt（校验 routing_receipt_id → createKernelRun 复用 → 写 harness_attempts）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步

**可观测行为**:
- task 无 `payload.routing_receipt_id` → 400，不写 `harness_attempts`。
- task 有 `routing_receipt_id` → 用现有 `createKernelRun`（controller identity 不变量）创建或**复用**同 task 的 active `initiative_runs`（幂等，不裂变新 run）→ 写一条 `harness_attempts`：`role` 取枚举内合法值、`status='running'`、`task_bundle.inputs.workspace_spec={branch,base_sha}`、headed 标记走既有约定 `lease_owner LIKE 'headed:%'`（复用 `createHeadedKernelAttempt`；role/attempt_kind 不越 CHECK 约束）、`callback_secret_hash` = 返回的 route_token。
- 返回 `{routing_receipt_id, run_id, base_sha, route_token}`。

**验证命令**（Brain pg 集成测试，真 Postgres）:
```bash
cd packages/brain && DATABASE_URL="${DB_URL:?}" npx vitest run --config vitest.integration.config.js \
  src/__tests__/integration/headed-attempts.pg.integration.test.js
```
**硬阈值**: 测试 exit 0；断言链 400 / 201+route_token / harness_attempts 新行 status=running + workspace_spec 正确 + role∈CHECK 枚举 + attempt_kind∈CHECK 枚举 + lease_owner LIKE 'headed:%'。

---

### Step 4: 领到 attempt 后 `echo ok`（Bash）通过 hook；validate valid:true
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 步

**可观测行为**: lock/env 就绪后，hook 读六字段 → `POST /validate` 带 `X-Harness-Route-Token: <route_token>` + branch + base_sha → Brain 命中 active headed attempt → `valid:true` → `echo ok` 放行。裸 session worktree（无 lock）跑 `echo` 仍 `route_violation`。

**验证命令**: 见 ## E2E 验收（真 Brain + 真 hook 执行）。
**硬阈值**: 领 attempt 后 hook exit 0；未领时 hook exit 2 且 reason 含 `route_violation`。

---

### Step 5: 收尾 PATCH completed → validate 409 run_attempt_inactive（闸自动收回）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 6 步 + 边界情况

**可观测行为**: 有头 attempt `status='completed'` 后，同一 receipt+run+token+branch+base_sha 再 `POST /validate` → 409 `{"valid":false,"reason_code":"run_attempt_inactive"}`；hook 随之把 `echo` 重新 block。

**验证命令**: 见 Step 3 集成测试末段 + ## E2E 验收 收尾段。
**硬阈值**: completed 后 validate HTTP 409 且 `reason_code=run_attempt_inactive`。

---

## 禁 mock 边清单

本单触及 DB 写路径（harness_attempts INSERT）、跨模块数据传递（worktree-manage.sh → Brain 签发口 → DB）、状态机（attempt running→completed→validate 收回）。以下边**禁 mock**，失败测试与 E2E 必须真跑：

- Brain headed-attempts handler ↔ Postgres 表 `harness_attempts`（本单新增 INSERT 写路径，pg 集成测试必须真 Postgres 验行落库，禁 vi.mock pool）。
- Brain headed-attempts handler ↔ `createKernelRun`/`initiative_runs`（本单复用 run 创建/复用不变量，集成测试必须真调 createKernelRun 打真 PG，验幂等复用不裂变新 run）。
- Brain headed-attempts ↔ `validateWorkRoutingIdentity`（同一真 PG 上 issue→validate→completed→validate 全链真跑，验 route_token 往返与 409 收回）。
- worktree-manage.sh ↔ Brain 签发口（## E2E 验收 段必须真调 localhost:5221 真 Brain，禁 mock curl；改 cp-branch + 写 lock 全真执行）。

**允许 mock 的外层边**：`dev-mode-tool-guard.test.sh` 中「有 lock 但 validate 返回 run_attempt_inactive → block」的 hook 分支逻辑用 curl 替身返回 `{"valid":false,"reason_code":"run_attempt_inactive"}`（测的是 hook 读响应后的 block 分支，不是被改的 DB 边；该 DB 边由 Brain 409 集成测试 + E2E 真验覆盖）。这符合「只许 mock 更外层的无关依赖」。

---

## 真实调用方请求 shape

有头 worktree（真实调用方）→ Brain 签发口 / validate 的认证与字段，与生产 hook（`dev-mode-tool-guard.sh` 第 91-98 行）逐字段一致：

- validate 认证：header `X-Harness-Route-Token: <64hex route_token>`（非 body；hook 走 scoped token header 分支）。签发口认证：走既有 internal token（`workRoutingAuthorization`：`Authorization: Bearer <CECELIA_INTERNAL_TOKEN>` 或 `x-internal-token`），不裸开（Invariant [端点鉴权]）。
- validate body 字段（hook 第 98 行逐字）：`{routing_receipt_id, task_id, run_id, repo, branch, base_sha}`。
- 签发口 body 字段：`{task_id, branch, base_sha, session_id}`。
- `route_token` 从签发口响应取得，经 `CECELIA_ROUTING_VALIDATION_TOKEN` env / lock 流转到 hook，hook 原样放进 `X-Harness-Route-Token`。

## 未覆盖真实链路清单

- 本合同无 `force_*`/stub/假数据顶替真实链路：Brain 侧真 Postgres、worktree-manage↔Brain 真 curl、hook 真执行。**唯一** mock 是 hook 单测里对「已被 Brain 409 集成测试覆盖的 inactive 分支」用 curl 替身（已在「禁 mock 边清单」显式登记，非真实链路缺口，属外层边界，N/A 真验补位）。

---

## 已知约束（来自回归测试）

- [回归] `packages/engine/tests/integration/dev-mode-routing-receipt-guard.test.sh` → scoped token（`X-Harness-Route-Token`）+ 六字段 lock + baseline 必须是 HEAD 祖先；Edit/未知工具无 receipt 必须 fail-closed；只读 Read 放行。**本单不得回退这些断言**。
- [回归] `packages/engine/tests/integration/dev-mode-tool-guard.test.sh` → Case A-E（lights 探活拦 ScheduleWakeup / Bash bg）必须保持通过。
- [回归] `packages/brain/src/routes/__tests__/work-routing.test.js` / `work-routing-validation-route.integration.test.js` → validate SQL 含 `attempt.callback_secret_hash = $7`、读 `x-harness-route-token`；**不改 SQL 语义**。
- [累积FR] context-manifest: journey e6f803f2 下 ability 仅 status=planned，无 done/working 已验收行为（PRD 已载明，无历史 FR 约束）。
- [MAP] task.payload.map_scope=`["F1"]`，但 map_repo=none 且 expected_files=[]（Step 1.0 查得）→ 影响半径无法计算，radius 跳过 → `[MAP_NOT_CONFIGURED]`，无 must_run_assertions/fact_revisions 注入。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR** | 做什么 | Brain 新增有头签发口 `POST /work-routing/headed-attempts`（已路由 task 领 headed attempt，返回 route_token）；Engine `/dev` 有 `--task-id` 时调签发口、改 cp-branch、写六字段 lock/env；Hook 补 worktree-manage.sh 精确路径 bootstrap 逃生口。 |
| **NFR** | 做得多好 | validate `--max-time 5`（不改）；attempt lease 超时自动 expire（复用现有心跳）；Brain semver bump 四处同步 + DevGate；hook 三要素。 |
| **Invariant** | 永不违反 | 同闸门不放松（c3617bdf）；validate SQL 语义不改；端点走既有鉴权；不写死环境假设值；route_token/callback_secret 只签发时返回一次、库内只存 hash、不落日志明文。 |
| **判定点** | 怎么知道 | 见判定点登记表 |
| **保质期** | 何时过期 | route_token 随 attempt 生命周期有效；attempt `completed`/`expire` 后失效（validate 409）。 |
| **死亡告警** | 停了谁知道 | 签发口不可达 → /dev 拿不到 receipt，hook fail-closed（编码被 block，主理人立即感知）；不假放行。 |
| **失败语义** | 挂了怎么办 | 见失败语义声明（fail-closed 拦截，不放行）。 |
| **效果确认** | 已发≠已生效 | 签发后必须 `POST /validate` 返回 `valid:true` 才算生效；psql 查 `harness_attempts` 真实 headed 行 status=running。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 | A | 记录 API 不稳定 | 静默丢消息 |
| ⚠️ route_token ↔ callback_secret_hash 如何对齐使 validate 通过 | A. route_token=明文, hash=sha256(明文)（PRD [ASSUMPTION] 写法）; B. route_token = 存入 callback_secret_hash 的 64-hex 摘要本身 | **B** | validate 冻结 SQL 第 72 行 `attempt.callback_secret_hash = $7`（$7=header 原值）→ header token 必须**等于**库内 hash 列值。方法 A 会让 `sha256(明文)==明文` 恒 false，validate 永不通过。故 route_token 即库内所存 hash（sha256 摘要），pre-image 明文不存不返；「库内只存 hash」成立。 | 选 A 则 validate 恒 false，闸永不放行，有头 /dev 死锁不解（面客：修闸任务本身撞死）。**PrepPRD [ASSUMPTION] 与冻结 SQL 冲突，本合同按 SQL 为准并 notes 标待确认。** |
| ⚠️ headed attempt 用哪个 role/attempt_kind（不越 CHECK 约束） | A. role='headed_dev'/attempt_kind='headed'（PRD 建议）; B. role∈现有枚举 + attempt_kind∈现有枚举 + lease_owner='headed:%' 标记 | **B** | 357 迁移 role CHECK IN (planner…reporter) 不含 headed_dev；361/362 attempt_kind CHECK IN (initial,fix,retry,resume,recovery) 不含 headed。方法 A 触发 CHECK 违约插入失败。复用 `createHeadedKernelAttempt` 既有约定（role='planner'|'generator'、lease_owner=`headed:<id>`）。 | 选 A 则 INSERT 抛 CHECK 违约，签发口 500，闸不解。**PRD [ASSUMPTION] role 建议与 CHECK 约束冲突，按约束为准。** |
| task 是否已路由（可领 attempt） | A. 查 `payload.routing_receipt_id` 非空; B. 查 work_routing_receipts JOIN | **A** | 签发口入口守卫；validate 侧 JOIN 已做完整校验，签发口只需 400 早拒无 receipt 的 task | 误放行未路由 task → 写脏 attempt，但 validate 侧 JOIN 仍会拒（双保险） |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| task 无 routing_receipt_id | 签发口 400，不写库 | 是（无副作用） | /dev 报错退出，主理人去走路由 |
| Brain 不可达 | worktree-manage 调用失败，无 lock/token | 是（可重跑 init-or-check） | hook 保持 fail-closed，不假放行 |
| 同 task 重复领 attempt | 复用 active initiative_run，不裂变新 run | 是（createKernelRun 幂等） | 返回既有 run_id |
| attempt completed/expire 后 validate | 409 run_attempt_inactive | 是（只读判定） | hook block，需重新 /dev 领 attempt |

### 输入对抗面

N/A — 签发口/validate 均为内部端点，走 internal token / route token 鉴权，非对外暴露 agent 任务（无 prompt injection 面）。

---

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

> 由 evaluator 作为独立 task 在 local_api 上执行：真 Postgres（`$DB_URL`）+ 真 Brain（localhost:5221）+ 真 hook + 真 worktree-manage.sh。覆盖 PRD E2E 5 个验收点。种子（已路由 task + receipt + active v2 run）由 generator 产出的 `sprints/08160845-kernel-0ca4b234/e2e-seed-routed-task.mjs` 用现有 store（`createRoutedTask` + `seedOwnedActiveV2Run`/kernel 授权 fixture 同款）真写，禁伪造。

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
export DATABASE_URL="$DB_URL"
BRAIN_PORT="${BRAIN_PORT:-5221}"
BASE_URL="http://127.0.0.1:${BRAIN_PORT}"
REPO_ROOT="$(git rev-parse --show-toplevel)"
WT_MANAGE="$REPO_ROOT/packages/engine/skills/dev/scripts/worktree-manage.sh"
HOOK="$REPO_ROOT/packages/engine/hooks/dev-mode-tool-guard.sh"
BRAIN_PID=""
WORK_ROOT="$(mktemp -d)"
cleanup() {
  [ -z "$BRAIN_PID" ] || kill "$BRAIN_PID" 2>/dev/null || true
  rm -rf "$WORK_ROOT" || true
}
trap cleanup EXIT

# 1. 空库 bootstrap：跑仓库真实 migrations，机检目标表存在
node packages/brain/scripts/run-migrations.mjs 2>/dev/null || node packages/brain/migrate.js 2>/dev/null || npm --prefix packages/brain run migrate
psql "$DB_URL" -tAc "SELECT to_regclass('harness_attempts') IS NOT NULL" | grep -qx t
psql "$DB_URL" -tAc "SELECT to_regclass('work_routing_receipts') IS NOT NULL" | grep -qx t

# 2. 启动真实 Brain 并等健康
( cd packages/brain && PORT="$BRAIN_PORT" DATABASE_URL="$DB_URL" node server.js ) >/tmp/harness-brain.log 2>&1 &
BRAIN_PID=$!
for i in $(seq 1 60); do
  curl -sf "$BASE_URL/api/brain/health" >/dev/null 2>&1 && break
  [ "$i" = 60 ] && { echo "FAIL: Brain 未就绪"; cat /tmp/harness-brain.log; exit 1; }
  sleep 1
done

# 3. 种子：真写一条已路由 coding task + receipt + active v2 run，回填 TASK_ID / BASE_SHA
SEED_JSON=$(node "$REPO_ROOT/sprints/08160845-kernel-0ca4b234/e2e-seed-routed-task.mjs")
TASK_ID=$(echo "$SEED_JSON" | jq -er '.task_id')
BASE_SHA=$(echo "$SEED_JSON" | jq -er '.base_sha')
echo "$BASE_SHA" | grep -Eq '^[a-f0-9]{40}$'

# 4. 起新 session worktree（分支 session-*，无 lock）——从 origin/main 起
BASE_MAIN=$(git rev-parse origin/main 2>/dev/null || git rev-parse HEAD)
git worktree add -b "session-e2e-$$" "$WORK_ROOT/wt" "$BASE_MAIN" >/dev/null 2>&1

run_hook() { # $1=tool_name $2=command $3=cwd
  printf '{"session_id":"e2e","cwd":"%s","tool_name":"%s","tool_input":{"command":"%s"}}' "$3" "$1" "$2" \
    | bash "$HOOK"; echo "HOOKEXIT:$?"
}

# 4a. 验收点①：无 task 时任意 Bash（echo）被 block
OUT=$(run_hook Bash "echo ok" "$WORK_ROOT/wt" 2>&1 || true)
echo "$OUT" | grep -q 'HOOKEXIT:2' || { echo "FAIL: 裸 session worktree echo 未 block"; exit 1; }
echo "$OUT" | grep -q 'route_violation' || { echo "FAIL: 缺 route_violation"; exit 1; }

# 4b. 验收点②：worktree-manage.sh 精确路径被 hook 放行（bootstrap 逃生口）
OUT=$(run_hook Bash "bash $WT_MANAGE init-or-check e2e --task-id $TASK_ID" "$WORK_ROOT/wt" 2>&1 || true)
echo "$OUT" | grep -q 'HOOKEXIT:0' || { echo "FAIL: worktree-manage.sh 未被 bootstrap 放行"; exit 1; }

# 5. 真跑 worktree-manage.sh init-or-check --task-id：领 attempt、改 cp-branch、写六字段 lock
export CECELIA_ROUTING_HEADED_URL="$BASE_URL/api/brain/work-routing/headed-attempts"
export BRAIN_URL="$BASE_URL"
( cd "$WORK_ROOT/wt" && bash "$WT_MANAGE" init-or-check e2e --task-id "$TASK_ID" ) >/tmp/wtm.log 2>&1 || { echo "FAIL: worktree-manage init-or-check"; cat /tmp/wtm.log; exit 1; }
CP_BRANCH=$(git -C "$WORK_ROOT/wt" rev-parse --abbrev-ref HEAD)
echo "$CP_BRANCH" | grep -Eq '^cp-' || { echo "FAIL: 分支未改成 cp-*: $CP_BRANCH"; exit 1; }
LOCK="$WORK_ROOT/wt/.dev-lock.$CP_BRANCH"
[ -f "$LOCK" ] || { echo "FAIL: lock 不存在 $LOCK"; exit 1; }
jq -e '.routing_receipt_id and .task_id and .run_id and .repo and .base_sha and (.branch|startswith("cp-"))' "$LOCK" >/dev/null || { echo "FAIL: 六字段不齐"; exit 1; }
jq -e 'has("route_token")|not' "$LOCK" >/dev/null || { echo "FAIL: lock 泄露 route_token 明文"; exit 1; }

# 6. 验收点③：领到 attempt 后 echo ok 通过 hook（真 validate valid:true）
OUT=$(run_hook Bash "echo ok" "$WORK_ROOT/wt" 2>&1 || true)
echo "$OUT" | grep -q 'HOOKEXIT:0' || { echo "FAIL: 领 attempt 后 echo 仍被 block"; cat /tmp/wtm.log; exit 1; }

# 7. 验收点④：psql 查 harness_attempts 存在该 run 的 headed 行（status=running + workspace_spec）
RUN_ID=$(jq -er '.run_id' "$LOCK")
CNT=$(psql "$DB_URL" -tAc "SELECT count(*) FROM harness_attempts WHERE run_id='$RUN_ID' AND status='running' AND lease_owner LIKE 'headed:%' AND task_bundle->'inputs'->'workspace_spec'->>'branch'='$CP_BRANCH' AND created_at > NOW() - interval '10 minutes'" | tr -d ' ')
[ "$CNT" -ge 1 ] || { echo "FAIL: 无 headed running 行"; exit 1; }

# 8. 验收点⑤：收尾 PATCH completed 后 validate → 409 run_attempt_inactive（echo 重新被 block）
psql "$DB_URL" -c "UPDATE harness_attempts SET status='completed', completed_at=NOW() WHERE run_id='$RUN_ID' AND status='running'"
RC=$(jq -er '.routing_receipt_id' "$LOCK"); TID=$(jq -er '.task_id' "$LOCK"); RP=$(jq -er '.repo' "$LOCK"); BS=$(jq -er '.base_sha' "$LOCK")
CODE=$(curl -s -o /tmp/vresp.json -w '%{http_code}' -X POST "$BASE_URL/api/brain/work-routing/validate" \
  -H 'Content-Type: application/json' -H "X-Harness-Route-Token: $(cat /tmp/route_token 2>/dev/null || echo deadbeef)" \
  -d "$(jq -nc --arg r "$RC" --arg t "$TID" --arg run "$RUN_ID" --arg repo "$RP" --arg b "$CP_BRANCH" --arg bs "$BS" '{routing_receipt_id:$r,task_id:$t,run_id:$run,repo:$repo,branch:$b,base_sha:$bs}')")
[ "$CODE" = "409" ] || { echo "FAIL: completed 后 validate 非 409: $CODE"; cat /tmp/vresp.json; exit 1; }
jq -e '.reason_code=="run_attempt_inactive"' /tmp/vresp.json >/dev/null || { echo "FAIL: reason_code 非 run_attempt_inactive"; exit 1; }

echo "✅ 有头 /dev 收编 Golden Path 验证通过（5 验收点全过）"
```

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: `POST /headed-attempts` body `branch="session-abc"`（非 cp-*）应 400/拒；`task_id` 非法 uuid 应 400；`base_sha` 非 40hex 应拒。
- 重复提交: 同一 task 连调两次 `headed-attempts` → 复用同一 run_id（不裂变新 initiative_run），第二次不产生第二条 active run。
- 中途中断: worktree-manage 领 attempt 后、写 lock 前进程被杀 → 重跑 init-or-check 应幂等复用 run，不留悬挂 attempt 阻塞。
- 边界值: hook 命令 `bash <非 worktree-manage 路径>` 伪装（如 `bash /tmp/worktree-manage.sh`）必须**不**被 bootstrap 放行（精确绝对路径匹配，防路径混淆）；`base_sha` 是 lock 值但非当前 HEAD 祖先 → hook 仍 block。
发现分级: P0/P1（闸放松/未路由可编码/route_token 泄露）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Hook bootstrap 逃生口 + inactive block | `packages/engine/tests/integration/dev-mode-tool-guard.test.sh`（新增 case） | `worktree-manage.sh 精确路径放行`、`非 worktree-manage Bash block`、`run_attempt_inactive block` | 现 hook 无逃生口 → 新 case FAIL |
| Brain 签发口 + validate 往返 | `packages/brain/src/__tests__/integration/headed-attempts.pg.integration.test.js` | `无 routing_receipt_id 返回 400`、`已路由 task 返回 route_token 且 harness_attempts running`、`validate 带 route_token 返回 valid true`、`completed 后 validate 409 run_attempt_inactive` | 端点未实现 → 404/无该行 FAIL |
