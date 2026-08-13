# Sprint Contract Draft (Round 1)

**Sprint**: Fleet Worker 实例 ownership fence 与 quarantined attempt 确定终态
**journey_type**: autonomous ｜ **target_environment**: local_api
**contract-gate**: cecelia worktree（`packages/brain/src/lib/contract-gate.js` 存在，代码层 gate 生效）
**gp-anchor**: skipped (product-map.json not found)

## Map 影响半径

- `map_scope=cecelia` / `map_repo=perfectuser21/cecelia`，但 `payload.expected_files=null` → `affected_business_nodes=[]`、`must_run_assertions=[]`。无 Unified Map 硬回归断言注入本合同。
- `fact_revisions` / `freshness`：本轮无（radius 未产出）。

## Response Schema（推导来源: PRD 字面）

**N/A — 任务无 HTTP 响应。** 本 sprint 改动是 Brain 内部编排/状态机 + fleet-worker 进程脚本，无新增/变更 HTTP 端点。观察面是 **DB 行状态**（`harness_attempts` / `orchestrator_decision_log`）与 **Docker 容器存活/归属**，非 HTTP body。Reviewer 第 6 维按 DB/Docker oracle 审查（见 DoD [BEHAVIOR]）。

---

## Golden Path

**锚定父路声明**：独立小路（无父路）。PrepPRD `step_id=none`，journey e6f803f2 下现有 ability 均 planned，无已验收父路可挂。

`[Worker-B 启动 / expired attempt quarantined]` → `[startup reconcile / reconcileExpiredAttempt]` → `[只作用本实例 namespace + quarantined 确定终态]` → `[Worker-A 存活 + run 解卡]`

### Step 1: Worker-B 启动 reconcile 不误杀 Worker-A 容器（Path A 步 1-3）
**来源**: `[FROM_PRD]` — PRD「Golden Path Path A 步 1-3」+「范围限定/在范围内 第 1-2 条」直接定义。

**可观测行为**: 同一 Docker daemon 上，Worker-A（data root RA）与 Worker-B（同 canonical `machine_id=us-mac-m4`、不同端口、data root RB≠RA）并存。Worker-B 的 startup reconcile 只 stop/rm 属于**自己 instance namespace** 的容器；Worker-A 的容器全程存活、未收到 SIGKILL / `docker rm`。

**锁定实现契约（proposer 锁，generator 必须遵守）**:
- 容器 ownership label 新增 `cecelia.fleet.instance_namespace`（由 data root 持久化身份派生）。`labelsFor()` 写入该 label。
- `docker.listOwned({ workerId, instanceNamespace })` 过滤 **同时**按 `worker_id` **且** `instance_namespace`（`docker ps --filter label=cecelia.fleet.worker_id=<id> --filter label=cecelia.fleet.instance_namespace=<ns>`）。
- `reconcile()` orphan 回收循环只作用于本实例 namespace 的容器。

**验证命令**（真实 Docker，见 ## E2E 验收 Part 3；单元 RED 见 tests/instance-namespace-fence.red.test.cjs）:
```bash
# 本实例 namespace=nsB 的 listOwned 绝不回 Worker-A 的 nsA 容器
ATTEMPT_RUNNER_PATH="$PWD/packages/brain/scripts/fleet-worker/attempt-runner.cjs" node /tmp/fence-listowned.cjs
# 期望：OK: listOwned 只回本实例 namespace 容器（exit 0）
```
**硬阈值**: Worker-A 容器 `docker inspect -f '{{.State.Running}}'` = `true`（reconcile 全程未被 rm）；跨 namespace 泄漏容器数 = 0。

---

### Step 2: instance namespace 由 data root 持久化、重启复用（Path A 步 4）
**来源**: `[FROM_PRD]` — PRD「Path A 步 4」+「边界情况/同一 data root 只允许一个 namespace」+ ASSUMPTION 第 1 条。

**可观测行为**: Worker 首次启动在 `${CECELIA_FLEET_DATA_ROOT}` 下落盘一份持久化身份文件；从中派生稳定 `instance_namespace`。进程重启后读取同一文件 → 派生出**同一** namespace → 不误杀自己重启前的旧容器，亦不被他人收割。

**锁定实现契约**:
- 持久化身份文件路径：`${dataRoot}/state/instance-namespace.json`（`fleet-worker.cjs` 从 data root 派生/持久化，传 `instanceNamespace` 进 `createAttemptRunner`）。
- 派生须**稳定 + 可持久化 + 重启复用**；派生源缺失/损坏时 **fail-closed**（宁可不收割，不误杀他人容器 —— 不得回退成"按 machine_id 收割"）。

**验证命令**（真实进程级，见 ## E2E 验收 Part 3b）:
```bash
# 同一 data root 启动两次，派生 namespace 必须一致
NS1=$(node /tmp/derive-namespace.cjs "$RA"); NS2=$(node /tmp/derive-namespace.cjs "$RA")
[ -n "$NS1" ] && [ "$NS1" = "$NS2" ] || { echo "FAIL: 同 data root namespace 不稳定 ($NS1 vs $NS2)"; exit 1; }
```
**硬阈值**: 同 data root 两次派生 namespace 字面相等且非空；不同 data root 派生 namespace 不相等。

---

### Step 3: quarantined expired attempt 一次事务确定终态（Path B 步 1-2）
**来源**: `[FROM_PRD]` — PRD「Golden Path Path B 步 1-2」+「范围限定/在范围内 第 3 条」直接定义。

**可观测行为**: `reconcileExpiredAttempt` 遇 `inspect.status=quarantined` 时，在**单个 PostgreSQL 事务**内：把原 attempt 标 `failed`（专属 `error_code=worker_attempt_quarantined_terminalized`）+ 写一条 append-only `orchestrator_decision_log` evidence 行。**不再** fall-through 到 `worker_attempt_state_unresolved`。

**锁定实现契约（proposer 锁死，防字段漂移）**:
- 专属 error_code = **`worker_attempt_quarantined_terminalized`**（新增，须加入 `expired-attempt-reconciler.js` 的 `TERMINAL_CODES` 集合；区别于既有 `worker_attempt_missing_after_lease` / `worker_attempt_replacement_required_after_lease`）。
- `reconcileExpiredAttempt` 新增 `quarantined` 分支：走 `terminalizeRecovery`（复用现有单事务 `createExpiredAttemptAuthority.terminalize` 权威路径，failed + evidence 同事务），返回 `status: 'replacement_required'`（loop.js 已识别并推进的终态之一）。
- **禁用值**：quarantined 路径的返回 `status` 严禁为 `infrastructure_blocked`；返回 `signature` 严禁为 `worker_attempt_state_unresolved`。

**验证命令**（真实 PostgreSQL，见 ## E2E 验收 Part 2）:
```bash
# 原 attempt 变 failed 且 error_code 专属
psql "$DATABASE_URL" -tAc "SELECT error_code FROM harness_attempts WHERE id='$ATTEMPT_ID'" | grep -qx worker_attempt_quarantined_terminalized || { echo "FAIL: error_code 不符"; exit 1; }
```
**硬阈值**: `harness_attempts.status='failed'` 且 `error_code='worker_attempt_quarantined_terminalized'`；`orchestrator_decision_log` 新增恰 1 条 `action='effect:expired_attempt_reconciled'` evidence 行。

---

### Step 4: 允许 derive fresh replacement，run 解卡（Path B 步 3-4）
**来源**: `[FROM_PRD]` — PRD「Path B 步 3-4」+ ASSUMPTION 第 3 条（复用 cancelAndReplace 同级终态权威路径）。

**可观测行为**: quarantined 分支返回 `replacement_required` 后，loop.js（第 596 行 `['missing_terminalized','replacement_required']` 分支）推进 tick，下一跳 derive 为该 run 生成一条 fresh replacement attempt；run 从 generate 卡点解除。

**验证命令**（真实 PostgreSQL，见 ## E2E 验收 Part 2）:
```bash
# run 下在原 failed attempt 之后存在一条 replacement attempt（时间窗防历史冒充）
C=$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM harness_attempts WHERE run_id='$RUN_ID' AND id<>'$ATTEMPT_ID' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$C" -ge 1 ] || { echo "FAIL: 未 derive replacement"; exit 1; }
```
**硬阈值**: 该 run 下 replacement attempt count ≥ 1（5 分钟时间窗内）。

---

### Step 5: 重复 reconcile 幂等（边界 / RED-4）
**来源**: `[FROM_PRD]` — PRD「边界情况/重复 reconcile 幂等」+ NFR「幂等性」。

**可观测行为**: 对已 terminalize 的 quarantined attempt 再次 `reconcileExpiredAttempt`：因原 attempt 已 `failed`（`expired()` 判定要求 status ∈ starting/running）→ 返回 `not_expired`；**不重复 terminalize、不新增 decision evidence、不再写无限 deny**。

**验证命令**（真实 PostgreSQL，见 ## E2E 验收 Part 2）:
```bash
# 二次 reconcile 后 decision_log 计数不变（幂等）
[ "$DLOG_AFTER2" = "$DLOG_AFTER1" ] || { echo "FAIL: 二次 reconcile 新增 deny/终态行（非幂等）"; exit 1; }
```
**硬阈值**: 二次 reconcile 前后 `orchestrator_decision_log` 行数相等；无新增 `deny:infrastructure_blocked` 行。

---

## 已知约束

### 来自回归测试（Step 1.2）
- `packages/brain/scripts/fleet-worker/attempt-runner.test.cjs` → `restart reconciliation cleans owned orphans without deleting another Attempt`（现有测试，1940 行）：断言 **不同 worker_id**（`xian-mac-m4`）的 foreign 容器不被 remove，**同 worker_id 未记录** 的 `unrecorded-owned-container` 被 remove。
  **⚠️ 本 sprint 直接冲击该断言**：加 namespace fence + 旧容器 fail-closed 后，`unrecorded-owned-container`（无 `instance_namespace` label）将不再被 remove。**generator 必须更新该现有测试**：给"应被本实例回收"的容器补上**本实例 namespace** label，才能保留其 remove 断言；对无 namespace 的旧容器改为断言 fail-closed（不 remove）。禁止删除该回归。
- `packages/brain/src/orchestrator/expired-attempt-reconciler.test.js` → 现有各分支（missing/terminal/prepared/running）断言：新增 quarantined 分支不得破坏这些既有分支返回值。

### 来自累积 FR（Step 1.3）
- `context-manifest: unavailable`（`/api/brain/line/e6f803f2/context-manifest` 返回 404，端点不可达）。
- 本 line 暂无已验收历史 FR（journey e6f803f2 下现有 ability 均 planned）。

### 铁律（Invariant，controller 注入 + PRD 显式）
- INV-1 [不互杀]：修复禁止以 stop/删除其他 Worker 或生产容器为手段 → 见 DoD INV-1。
- INV-2 [验证命令实跑]：合同验证命令必须实跑确认 exit code 语义 → 本合同全部 [BEHAVIOR] Test: 为真实 psql/docker/node exit-code 断言，无 vitest include-范围外绿态兜底。
- INV-3 [judge 证据窗口]：evaluator 产 `.brain-result.json` 须把一手证据（psql/docker 断言输出）放进 judge 消费窗口前 8 条×600 字符 → evaluator 侧义务，合同在 ## E2E 验收 末尾统一 echo 关键断言结果。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | ① 容器 ownership 加稳定 instance namespace（data root 派生/持久化），reconcile 只作用本实例 namespace；② `quarantined` expired attempt 一次事务 failed(专属 code)+evidence+允许 replacement。 |
| **NFR（做得多好）** | | 幂等（重复 reconcile 不重复终态/无限 deny）；fail-closed（归属不明禁收割）；真实 Docker+真实 PostgreSQL 回归进 CI。 |
| **Invariant（永不违反）** | | [不互杀] 绝不以 stop/删他人 Worker 或生产容器为修复手段；append-only evidence 只增不改；同一 data root 只允许一个稳定 namespace。 |
| **判定点（怎么知道）** | | 见下方登记表。 |
| **保质期（何时过期）** | | instance namespace 与 data root 同生命周期（持久化文件在则永久复用，data root 销毁即退役）；quarantined 终态 attempt 永久 failed。 |
| **死亡告警（停了谁知道）** | | 若 fence 失效再次互杀：生产 Worker attempt 被 quarantine + run 卡 generate → 现有 expired-attempt reconcile 路径 + brain tick 可观测；本 sprint 的 evidence 行即告警数据源。 |
| **失败语义（挂了怎么办）** | | 见下方失败语义声明。核心：namespace 派生源缺失/损坏 → fail-closed（不收割），宁可容器泄漏也不误杀。 |
| **效果确认（已发≠已生效）** | | quarantined 终态以 DB 行（attempt=failed + evidence 行 + replacement 行）为回执；fence 以 Docker 容器存活（`docker inspect Running=true`）为回执，均在同一 E2E 内真验。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 记录 API 不稳定 | 静默丢消息 |
| ⚠️ 某容器是否归本实例所有（可安全回收） | A. 仅按 machine_id 派生 worker_id（现状，互杀根因）; B. worker_id + 持久化 instance_namespace 双标签; C. 无 namespace label 一律 fail-closed | B（有 namespace）+ C（无 namespace fail-closed） | data root 隔离才是实例边界，machine_id 会 collide；旧容器归属不可知须保守 | **静默误杀他人生产容器**（21:29 生产事故根因）——不可逆 |
| ⚠️ expired attempt 的 `inspect.status=quarantined` 该走哪条终态 | A. fall-through unresolved 无限 deny（现状）; B. 视为确定终态 failed(专属 code)+允许 replacement | B | quarantine=容器已被移除/removal in progress，Worker 无法恢复该 attempt，继续 deny 只会永久卡 run | run 永久卡 generate（本 sprint 事故第二根因） |

> ⚠️ 两个判定点误判后果均为"不可逆/直接卡死生产"，属"升拍板点"级别。PrepPRD 已在 thin_prd 显式定调（namespace fence + quarantined 确定终态 + fail-closed），无待确认残留。`judgment-pending-user: 无`。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| namespace 持久化文件缺失/损坏 | fail-closed：不收割任何容器（含疑似自己的） | 是（下次启动读到修复的文件再正常派生） | 宁可容器泄漏（后续人工/更保守回收），绝不误杀 |
| quarantined terminalize 事务失败（DB 不可达/冲突） | ROLLBACK，原 attempt 状态不变，返回 infrastructure_blocked（本次这条 legacy 语义仅用于**真基础设施故障**，非 quarantined 逻辑分支） | 是（幂等键=attempt id + lease_generation + `status IN (starting,running)` + `lease_expires_at<NOW()` 守卫） | 下一 tick 重试；成功后转入 failed 终态 |
| 二次 reconcile 已 failed attempt | 返回 `not_expired`，无副作用 | 是 | 无需降级 |

### 输入对抗面

**N/A** —— 本 sprint 无对外暴露 agent/接口，输入源为 Brain 内部 tick 与 fleet-worker 本机启动，非外部用户可写入。

---

## 禁 mock 边清单

本单改动涉及：状态机（`reconcileExpiredAttempt` quarantined 终态分支）、DB 写路径（`harness_attempts` UPDATE + `orchestrator_decision_log` INSERT 同事务）、生命周期钩子（fleet-worker startup reconcile）、跨模块数据传递（fleet-worker → attempt-runner 的 instanceNamespace + docker 容器 label）。以下边**禁 mock**，回归必须真跑：

- `reconcileExpiredAttempt` ↔ 真实 `createExpiredAttemptAuthority(pool).terminalize`（真 PostgreSQL）：quarantined→failed+evidence 单事务必须对真库验行落库，禁止 mock terminalize/pool。→ 由 `packages/brain/src/__tests__/integration/expired-attempt-quarantined.pg.integration.test.js`（真 PG，注册进 `POSTGRES_INTEGRATION_TESTS`）+ ## E2E 验收 Part 2 覆盖。
- `attempt-runner.reconcile()` ↔ 真实 `createDockerAdapter` 的 `listOwned`/容器 label 过滤（真 Docker daemon）：namespace fence 的 label 过滤必须对真 daemon 验，禁止 mock docker.listOwned。→ 由 `packages/brain/scripts/fleet-worker/instance-namespace-fence.integration.test.cjs`（真 Docker）+ ## E2E 验收 Part 3 覆盖。
- `fleet-worker.cjs` ↔ data root 持久化身份文件（真文件系统）：namespace 派生/重启复用必须真读写盘，禁止 mock fs。→ 由 `fleet-worker.test.js` 进程级 + ## E2E 验收 Part 3b 覆盖。

> **单元 RED 说明**：`sprints/.../tests/*.red.test.*` 两份可独立运行的 RED 只钉住"分支路由/回收决策"（用 recording fake docker 与 fake launcher 隔离外层边界），**不作为 RED-3/RED-5 的权威回归**——权威回归是上述真 PG/真 Docker 集成。此拆分是两层验证（单元逻辑红 + evaluator 真环境 E2E）的标准形态，已在 ## 未覆盖真实链路清单 登记。

---

## 真实调用方请求 shape

**N/A** —— 本 sprint 无"设备/agent 调服务端"链路。调用方是 Brain 内部 `loop.js`（调 `reconcileExpiredAttempt`）与 fleet-worker 本机启动（调 `reconcile()`），均为进程内/同机调用，无跨网认证 shape。

## 未覆盖真实链路清单

| 真实链路点 | 被什么顶替 | 为什么 | 真验证补位计划（谁/何时/何环境） |
|---|---|---|---|
| reconciler quarantined DB 写边 | `tests/expired-attempt-quarantined-branch.red.test.js` 用 fake terminalize | proposer 环境 `runtime_resources.postgres=false`，无法起真 PG；单元红只证分支路由 | generator 写 `expired-attempt-quarantined.pg.integration.test.js`（真 PG，注册 CI）；evaluator ## E2E Part 2 真 PG 复演。 |
| 容器 ownership label 过滤边 | `tests/instance-namespace-fence.red.test.cjs` 用 recording fake docker | proposer 环境无 Docker daemon；单元红只证 reconcile 回收决策 | generator 写 `instance-namespace-fence.integration.test.cjs`（真 Docker）；evaluator ## E2E Part 3 真 daemon `listOwned`/`docker inspect` 复演。 |

---

## E2E 验收（final-e2e 跑 — target_environment=local_api，真实 Docker + 真实 PostgreSQL）

**journey_type**: autonomous ｜ **target_environment**: local_api

> 单块脚本。evaluator 需真实 Docker daemon + 真实 PostgreSQL（`DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`，缺省 localhost:5432/cecelia）。两个集成测试文件由 generator 落地（见 ## 禁 mock 边清单）。不可用 = 环境未就绪 = FAIL，禁止 skip 兜底。

```bash
#!/bin/bash
set -euo pipefail

REPO_ROOT="$PWD"
BRAIN_ROOT="$REPO_ROOT/packages/brain"
ATTEMPT_RUNNER="$BRAIN_ROOT/scripts/fleet-worker/attempt-runner.cjs"

# 0. 前置：真实 docker + 真实 psql（不可用=FAIL，不 skip）
command -v docker >/dev/null || { echo "FAIL: docker CLI 不可用"; exit 1; }
docker version --format '{{.Server.Version}}' >/dev/null 2>&1 || { echo "FAIL: docker daemon 不可达"; exit 1; }
command -v psql >/dev/null || { echo "FAIL: psql 不可用"; exit 1; }

DB_HOST="${DB_HOST:-localhost}"; DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-cecelia}"; DB_PASSWORD="${DB_PASSWORD:-}"
export PGPASSWORD="$DB_PASSWORD"
ADMIN_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/postgres"
TESTDB="fleet_fence_e2e_$$"
export DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${TESTDB}"
RUN_ID="92a67d1a-2c3a-4819-9930-09d841f31bd8"
ATTEMPT_ID="863fdc22-ad3e-4e89-a8ce-6323cf9b9917"
CANARY="cecelia-fleet-a-canary-$$"

cleanup() {
  docker rm -f "$CANARY" >/dev/null 2>&1 || true
  psql "$ADMIN_URL" -c "DROP DATABASE IF EXISTS \"$TESTDB\"" >/dev/null 2>&1 || true
  rm -f /tmp/fence-listowned.cjs
}
trap cleanup EXIT

# 1. 空库 bootstrap（真实 migration，RED-5 空库自举）
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$TESTDB\"" >/dev/null
( cd "$BRAIN_ROOT" && DB_HOST="$DB_HOST" DB_PORT="$DB_PORT" DB_USER="$DB_USER" DB_PASSWORD="$DB_PASSWORD" DB_NAME="$TESTDB" NODE_ENV=test node src/migrate.js ) >/tmp/fence-migrate.log 2>&1
psql "$DATABASE_URL" -tAc "SELECT to_regclass('harness_attempts') IS NOT NULL" | grep -qx t || { echo "FAIL: harness_attempts 表缺失（migration 未跑）"; exit 1; }

# 2. Path B — quarantined 一次事务闭环 + 幂等（真实 PostgreSQL，禁 mock terminalize/pool）
#    generator 集成测试自带 run/attempt 造数 + 真实 authority 调用 + 幂等二跑。
( cd "$BRAIN_ROOT" && DB_HOST="$DB_HOST" DB_PORT="$DB_PORT" DB_USER="$DB_USER" DB_PASSWORD="$DB_PASSWORD" \
  npx vitest run --config vitest.integration.config.js \
  src/__tests__/integration/expired-attempt-quarantined.pg.integration.test.js --reporter=dot ) \
  || { echo "FAIL: quarantined 真 PG 集成测试未通过"; exit 1; }

# 3. Path A — 双实例共享 Docker fence（真实 Docker，禁 mock listOwned）
( cd "$BRAIN_ROOT" && npx vitest run --config vitest.integration.config.js \
  scripts/fleet-worker/instance-namespace-fence.integration.test.cjs --reporter=dot ) \
  || { echo "FAIL: 双实例 Docker fence 集成测试未通过"; exit 1; }

# 3b. 独立真 Docker oracle：本实例 namespace=nsB 的 listOwned 绝不回 Worker-A 的 nsA 容器（canary 全程存活）
CID_A=$(docker run -d --name "$CANARY" \
  --label cecelia.fleet.worker_id=us-mac-m4 \
  --label cecelia.fleet.attempt_id=0ca01d4b-0ca0-41d4-8ca0-1d4b0ca01d4b \
  --label cecelia.fleet.run_id=11111111-1111-4111-8111-111111111111 \
  --label cecelia.fleet.instance_namespace=nsA \
  busybox sleep 300)
cat > /tmp/fence-listowned.cjs <<'NODEEOF'
const os=require('node:os'),fs=require('node:fs'),path=require('node:path');
const { createDockerAdapter } = require(process.env.ATTEMPT_RUNNER_PATH);
(async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(),'fence-rt-'));
  const docker = createDockerAdapter({ runtimeRoot });
  const owned = await docker.listOwned({ workerId:'us-mac-m4', instanceNamespace:'nsB' });
  const leaked = owned.filter(c => (c.labels||{})['cecelia.fleet.instance_namespace'] !== 'nsB');
  if (leaked.length) { console.error('FAIL: 跨 namespace 泄漏', leaked.map(c=>c.containerId)); process.exit(1); }
  console.log('OK: listOwned 只回本实例 namespace 容器');
})().catch(e => { console.error('FAIL', e && e.message); process.exit(1); });
NODEEOF
ATTEMPT_RUNNER_PATH="$ATTEMPT_RUNNER" node /tmp/fence-listowned.cjs || { echo "FAIL: listOwned 跨 namespace 泄漏（互杀风险）"; exit 1; }
docker inspect -f '{{.State.Running}}' "$CID_A" | grep -qx true || { echo "FAIL: Worker-A canary 容器被误杀/停止"; exit 1; }

echo "✅ Golden Path A+B 验证通过：双实例不互杀 + quarantined 确定终态闭环 + 幂等"
```

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `reconcileExpiredAttempt` 的 `inspect` 返回未知/畸形 status（如 `undefined` / `"paused"` / `"dead"`）时，是否仍 fail-closed 不误 terminalize，且不回退到无限 deny 卡死。
- 重复提交: 同一 quarantined attempt 被两个并发 tick 同时 reconcile —— 单事务 lease 守卫是否只允许一次 terminalize（另一并发返回冲突而非重复写 evidence）。
- 中途中断: namespace 持久化文件在 reconcile 进行中被删/截断 —— 是否 fail-closed（本轮不收割），下次启动能否恢复同一 namespace。
- 边界值: 同 machine_id 三实例（RA/RB/RC）共享 daemon，两两互不收割；无 `instance_namespace` label 的历史容器在任意实例下都 fail-closed。
发现分级: P0/P1（误杀他人容器 / run 再次永久卡 / 重复 terminalize 破坏 append-only）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| namespace fence（回收决策） | `sprints/.../tests/instance-namespace-fence.red.test.cjs` | `不得 remove 属于另一实例 namespace(nsA) 的容器`；`旧无 namespace 标签的容器必须 fail-closed` | 2 failures（当前 remove 被调用）|
| quarantined 确定终态（分支路由） | `sprints/.../tests/expired-attempt-quarantined-branch.red.test.js` | `quarantined 必须 terminalize（专属 error_code），不得留在 unresolved deny`；`quarantined 返回 loop 可推进的 replacement_required` | 2 failures（当前 infrastructure_blocked）|
| 真实 Docker fence（RED-5） | `packages/brain/scripts/fleet-worker/instance-namespace-fence.integration.test.cjs`（generator 落地）| 双 data root 不互杀 | 见 ## E2E Part 3 |
| 真实 PG quarantined 闭环（RED-3/4/5） | `packages/brain/src/__tests__/integration/expired-attempt-quarantined.pg.integration.test.js`（generator 落地，注册 POSTGRES_INTEGRATION_TESTS）| quarantined→failed(专属 code)+evidence+replacement+幂等 | 见 ## E2E Part 2 |
