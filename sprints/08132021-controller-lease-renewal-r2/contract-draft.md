# Sprint Contract Draft (Round 1) — Controller heartbeat 续租 lease（修 30 分钟杀跑）

## 锚定父路声明

独立小路（无父路）——journey `e6f803f2` 全部 ability 状态 planned（无 done/working golden path），PrepPRD `step_id: none`，本刀是无父路的 Harness 自修独立路径。

## Unified Map 影响半径

`[MAP_NOT_CONFIGURED]` —— 本 task payload 无 `map_scope`/`map_repo`（manual_dispatch，未接 Unified Map），`must_run_assertions` 为空。不回退领域硬编码：已知回归约束改由「已知约束」章节 + 真 PG 集成回归覆盖。

## Response Schema（推导来源: PRD 字面）

N/A — 任务无 HTTP 响应。本刀是 `packages/brain` 内部 orchestrator + SQL 行为修复（`writeHeartbeat` UPDATE / `launchKernelProcess`→`runKernelMain`→loop 参数透传），无新增/变更 API 端点。Reviewer 第 6 维 verification_oracle_completeness 按「无 HTTP 响应」口径评估：oracle 完整性以真 PG 行为断言（psql + 真函数执行）计。

## 已知约束

来源 `[回归测试]`（`packages/brain/src/__tests__/integration/kernel-controller-lifecycle.pg.integration.test.js` + `kernel-controller-ownership.pg.integration.test.js`）：
- `reconcileOwnerlessKernelRuns` 对 `controller_session_id IS NULL` / `controller_lease_expires_at IS NULL` / `controller_lease_expires_at < now` 的活跃 v2 run fail-closed 回收（phase→failed，非 done）——本刀不得回退该行为，只新增「续租成功后 lease 未过期 → 不回收」。
- `finalizeKernelRun` 不清 `controller_session_id`（Controller ownership 记录 Kernel fatal 后存活）——本刀 UPDATE 不触碰该列。
- `createKernelRun` 在同一创建事务落 `controller_session_id` + `controller_lease_expires_at = now + leaseSeconds`，缺 session fail-closed 拒建——本刀复用，不改。
- `CONTROLLER_LEASE_DEFAULT_SECONDS = 1800`（`kernel-run-store.js`）是 lease 时长唯一 SSOT——续租复用同一常量，禁止第二处硬编码。

来源 `[累积FR]`：`context-manifest` 端点在本 proposer 环境不可达（Brain 未起）；PRD 累积 FR 段声明「本 line 暂无历史」（journey `e6f803f2` 全部 ability planned）。记：`context-manifest: unavailable`（无历史累积 FR 冲突）。

## 历史约束三源 → INV 映射（铁律逐条）

- INV-1 [单slot串行]：本刀不新增并行；单 run 串行心跳。→ N/A：不触及 slot 并发。
- INV-2 [禁写死环境]：lease 时长从 `CONTROLLER_LEASE_DEFAULT_SECONDS` 读取，不写死秒数；测试用注入 `now` 跨 30m 边界，不写死屏幕/时钟假设值。→ 覆盖（见 DoD INV-2）。
- INV-3 [真环境验证]：续租/CAS/回收全部在真 PostgreSQL 上验证（`*.pg.integration.test.js`，禁 mock DB 边）。→ 覆盖（见 DoD INV-3）。
- INV-4 [多租户默认]：测试用独立库 + 随机 initiative/task，不共享租户态。→ 覆盖（隔离库）。
- INV-5 [凭据安全] / INV-6 [日志脱敏]：本刀不新增凭据；`writeHeartbeat` 不落 session 明文到日志（沿用 heartbeat.js 无日志现状）。→ 覆盖（见 DoD INV-6）。
- INV-7 [端点鉴权] / INV-8 [租户隔离]：无新增端点；无跨租户读写。→ N/A：无 HTTP 面、无跨租户 SQL。
- INV-9 [无主fail-closed]：任何活跃 Kernel Run 前必先有有效 Controller ownership；错误/空 session 续租一律 CAS rowCount=0 → Kernel fail-closed；无主 run 仍被 reconcile 回收。→ 覆盖（见 DoD INV-9，本刀核心）。
- INV-10 [热修时钟]：本刀走 default 标准全链（PRD 明确不走 hotfix）；不建共享 validation 时钟。→ N/A：非 hotfix gear。

## Golden Path

[Controller 点火建 run（session+lease）] → [detached Kernel 携 session 心跳续租 CAS] → [超 30m 仍 active、仅假冒/终态被 reconcile 回收]

---

### Step 1: Controller 点火建 run，落 session + lease

**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步（第 18 行）。

**可观测行为**: `createKernelRun` 在同一事务落 `controller_session_id` 与 `controller_lease_expires_at = now + CONTROLLER_LEASE_DEFAULT_SECONDS`（1800s）；缺 session fail-closed 不建 run。（现网已具备，本刀不改，作为续租前提机检。）

**验证命令**:
```bash
# migration 415 两列存在（续租 UPDATE 的载体）
PSQL_CONN="${DATABASE_URL:-${DB:-postgresql://${DB_USER:-cecelia}@${DB_HOST:-localhost}:${DB_PORT:-5432}/${DB_NAME:-cecelia_test}}}"
# gate-allow: domain/db-no-time-window schema 列存在性探测（information_schema，非业务产出，无时间窗语义）
psql "$PSQL_CONN" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='initiative_runs' AND column_name IN ('controller_session_id','controller_lease_expires_at')" | grep -qx 2
```

**硬阈值**: 两列均存在（count=2）。

---

### Step 2: 创建端 session 经 launchKernelProcess→runKernelMain 可信透传给 detached child

**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步（第 19 行）：`launchKernelProcess` 把 `controllerSessionId` 作 `--controller-session-id` 传给 child，`runKernelMain` 解析并透传 loop，**禁止仅凭 run_id 续租**。

**可观测行为**: `buildKernelLaunchArgs` 产出的 argv 含 `--controller-session-id <sid>`；`parseArgs` 解析出 `controllerSessionId`；relay 把 `createKernelRun` 落库的同一 session 传入 `launchKernelProcess`。

**验证命令**:
```bash
cd packages/brain && npx vitest run src/__tests__/controller-session-passthrough.test.js --reporter=verbose
```

**硬阈值**: 3 个 it 全绿（parseArgs 认参 + args 含 `--controller-session-id sid` + resumeToken 透传）。

---

### Step 3: loop 每跳携 session 调 writeHeartbeat，UPDATE 同写心跳 + lease（GREATEST）

**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步（第 20 行）：UPDATE 同时写 orchestrator 三列心跳与 `controller_lease_expires_at = GREATEST(existing, now + lease)`，WHERE 含 `id` + `controller_session_id` + `phase NOT IN ('done','failed')`。

**可观测行为**: 正确 session + 活跃 phase 的心跳跨过 30m 边界后，`controller_lease_expires_at` 随心跳前移到 `now + 1800s`（未过期）；`GREATEST` 保证 lease 只增不减（过去时刻心跳不缩短已有租约）；run.phase 仍非 done/failed。

**验证命令**:
```bash
cd packages/brain && npx vitest run --config vitest.integration.config.js \
  src/__tests__/integration/kernel-controller-lease-renewal.pg.integration.test.js -t 'RED-1' --reporter=verbose
```

**硬阈值**: RED-1 + RED-1b 绿：lease 前移到 `now1+1800*1000`（严格晚于 now1）；过去时刻心跳保留原 lease。

---

### Step 4: CAS fail-closed —— rowCount=0（session mismatch / 终态）不静默续跑

**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 步（第 21 行）+ 边界情况（第 28-29 行）。

**可观测行为**: 错误/伪造 `controller_session_id` → CAS rowCount=0、lease 不动，Kernel fail-closed；`phase=done/failed` 的 run → rowCount=0、lease 不复活。

**验证命令**:
```bash
cd packages/brain && npx vitest run --config vitest.integration.config.js \
  src/__tests__/integration/kernel-controller-lease-renewal.pg.integration.test.js -t 'RED-2' --reporter=verbose
cd packages/brain && npx vitest run --config vitest.integration.config.js \
  src/__tests__/integration/kernel-controller-lease-renewal.pg.integration.test.js -t 'RED-3' --reporter=verbose
```

**硬阈值**: RED-2 绿（伪造 session rowCount=0 且 lease 不动）；RED-3 + RED-3b 绿（终态 run rowCount=0；省略 leaseSeconds 用 SSOT 默认续租）。

---

### Step 5: 出口 —— 续租跨 30m 后 reconcile 回收数=0，无主/假冒仍被回收

**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 步（第 22 行，出口可观测）。

**可观测行为**: 心跳持续跨过 30m 后 `reconcileOwnerlessKernelRuns` 对该 run 回收数=0（不再误杀）；伪造/错误 session 的续租不生效（CAS rowCount=0），无主 run 仍被 reconcile fail-closed 回收（phase→failed）。

**验证命令**:
```bash
# 全文件真 PG 端到端（含续租后 reconcile=0 与 mismatch 回收）
cd packages/brain && npx vitest run --config vitest.integration.config.js \
  src/__tests__/integration/kernel-controller-lease-renewal.pg.integration.test.js --reporter=verbose
```

**硬阈值**: 整文件退出码 0（RED-1/1b/2/3/3b 全绿）；RED-1 断言 `reconciled` 不含本 run，RED-2 断言 `reconciled` 含本 run 且 phase=failed。

---

## 真实调用方请求 shape

N/A — 本刀无外部设备/agent 调服务端的 HTTP 入口。`controllerSessionId` 是进程内创建端（`createKernelRun`）落库、经 CLI 参数（`--controller-session-id`）传给同机 detached child 的**进程内透传**，不涉及跨设备认证 header/body。真实"调用方"是 Kernel loop 自身的 `writeHeartbeat`，其 CAS 契约（`id`+`controller_session_id`+`phase`）在 RED-1..3 真 PG 逐字段验证。

## 第三方 API 真调

N/A — 本刀不依赖任何第三方 API（LLM/支付/短信/平台）。

## 未覆盖真实链路清单

- **loop `beat()` → `writeHeartbeat` 的 session 透传 + rowCount=0 fail-closed 退出**：本刀在 DoD 以 `[ARTIFACT]` 机检 `loop.js` 的 `beat` 调用携带 `controllerSessionId`、且 rowCount=0 分支返回 fail-closed exitReason（静态 grep）；`writeHeartbeat` 的 CAS 语义（rowCount 0/1）本身由 RED-1..3 真 PG 真执行覆盖。未用真实 detached 进程端到端跑「loop 连续心跳 40 分钟真机跨界」——补位计划：generator 追加 `loop.js` 单元测试（注入 fake `writeHeartbeat`，断言 beat 携 `controllerSessionId`、返回 rowCount=0 时 runLoop 以 `controller_lease_lost` fail-closed 退出），归入 brain-unit CI；真机长跑由生产 run 自举验证（见 PRD prep 证据 B 的审计 CAS）。

## 禁 mock 边清单

本单改动涉及【DB 写路径】（`writeHeartbeat` 的 UPDATE 触达 `initiative_runs.controller_lease_expires_at`）+【跨模块数据传递】（`controllerSessionId` 从 `createKernelRun`→`launchKernelProcess`→`runKernelMain`→loop→`writeHeartbeat`）+【状态机/生命周期】（CAS rowCount=0 → Kernel fail-closed 退出），因此以下边禁 mock：

- 代码 ↔ `initiative_runs` 表（`controller_lease_expires_at` / `controller_session_id` / `phase` 的续租 CAS 读写）：`kernel-controller-lease-renewal.pg.integration.test.js` 必须真 `pg.Pool` 连真 Postgres，禁 `vi.mock('pg')` / stub `writeHeartbeat` / stub `reconcileOwnerlessKernelRuns`。
- `writeHeartbeat` ↔ `reconcileOwnerlessKernelRuns`（同一 `initiative_runs` 行的续租与回收对账）：同一真库、同一 now 语义验证，禁用替身伪造 lease/rowCount。

允许 mock 的更外层无关边：`controller-session-passthrough.test.js` 只验纯参数装配（`parseArgs` / `buildKernelLaunchArgs`），不碰 DB、不 spawn 进程——非被改的 DB 写边，无需真 PG。

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

## Contract Gate

contract-gate: present（cecelia worktree，`packages/brain/src/lib/contract-gate.js` 存在，代码层 Gate 生效）；本合同验证命令均为真执行断言（npx vitest 真跑 exit-code 驱动 / psql 存在性探测已 gate-allow 留痕），无 `|| true` 吞错、无裸 curl。

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 系统对外承诺 | `writeHeartbeat` 增 `controllerSessionId`+lease 入参，UPDATE 写心跳三列 + `controller_lease_expires_at=GREATEST(existing, now+lease)`，WHERE 含 `id`+`controller_session_id`+`phase NOT IN('done','failed')`，返回 `{rowCount}` 供 CAS；`controllerSessionId` 从创建端经 `launchKernelProcess`→`runKernelMain`→loop 可信透传。 |
| **NFR（做得多好）** | 性能/可靠性 | lease 时长唯一 SSOT `CONTROLLER_LEASE_DEFAULT_SECONDS`（1800s）；续租只做单条 UPDATE（无额外表/无迁移）；心跳频率沿用现状（约 90s/跳，远小于 1800s）。 |
| **Invariant（永不违反）** | 硬红线 | 无主 fail-closed（INV-9）：错误/空 session 或终态 run 续租一律 rowCount=0 → Kernel fail-closed，不静默续跑；lease 只增不减（GREATEST，防时钟回拨误缩）。 |
| **判定点（怎么知道）** | 对模糊现实的判断 | 见下方登记表。 |
| **保质期（何时过期）** | 失效与退役 | lease 每跳滚动续 1800s；run 达 `deadline_at`（8h）由既有 deadline fence 收敛；migration 415 前无 session 历史 run 由 reconcile 回收（本刀不回填）。 |
| **死亡告警（停了谁知道）** | 告警手段 | 续租失败（rowCount=0）→ Kernel fail-closed 退出 + run 终态 failed（`OWNERLESS_RECOVERED_REASON_PREFIX`），既有 reconcile/watchdog 巡检可从 run 终态 + kernel 日志定位；审计续租/回收事件写 `cecelia_events`。 |
| **失败语义（挂了怎么办）** | 放行还是拦截 | 见下方失败语义声明。fail-closed（拦截）：续租 CAS 失败即退出，绝不静默续跑。 |
| **效果确认（已发≠已生效）** | 回执验证 | 续租的"生效"回执 = UPDATE 的 `rowCount`（1=续租成功，0=未命中）+ psql 复查 `controller_lease_expires_at` 前移；reconcile 的"未误杀"回执 = 回收列表不含该 run。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 记录 API 不稳定 | 静默丢消息 |
| ⚠️ run 的心跳身份是否可信（能否续租） | A. 仅凭 run_id 续租; B. `id`+`controller_session_id` CAS | B（CAS，携带创建端 session） | 仅凭 run_id 无法区分真 Controller 与假冒/串号，会给无主/错主 run 续命 | 静默给无主 run 续租 → 「无主 fail-closed」铁律被绕过（不可逆放行） |
| ⚠️ run 是否仍活跃（可续租） | A. 只查 phase 非 done; B. WHERE `phase NOT IN('done','failed')` 纳入 CAS | B（纳入同一 CAS 原子判定） | 分两步查再 UPDATE 有 TOCTOU 竞态；纳入 WHERE 原子 | 终态 run 被心跳复活 lease → 僵尸 run 继续跑 |
| lease 是否应前移（防回拨缩短） | A. 直接 `now+lease`; B. `GREATEST(existing, now+lease)` | B | 并发/时钟回拨下直接赋值会缩短已有租约、诱发误杀 | 误缩租约 → 又一次 30m 误杀 |

> ⚠️ 行判定点误判后果严重（不可逆放行 / 绕过无主铁律），属「升拍板点」级别。PrepPRD thin_prd 已显式拍定 CAS 三件套（`id`+`controller_session_id`+`phase NOT IN done/failed`）+ GREATEST，本刀按已拍板方案实现。`judgment-pending-user: 无`（方案已在 PRD 拍定）。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 续租 CAS rowCount=0（session mismatch/终态） | Kernel fail-closed 退出（非 0 exit），不续跑 | 是（幂等键=`id`+`controller_session_id`；重放同心跳只会再次 rowCount=0，无副作用） | 交既有 `reconcileOwnerlessKernelRuns` 回收 + 恢复流程重派 |
| 时钟回拨/并发心跳 | `GREATEST` 保留较晚 lease，UPDATE 幂等 | 是 | 无需降级（只增不减） |
| DB 写超时/连接失败 | UPDATE 抛错 → loop 既有错误路径处理；lease 不前移 | 是（下一跳重试同一 UPDATE） | 心跳落后 → lease 自然到期 → reconcile fail-closed 回收（不静默续跑） |

### 输入对抗面

N/A — 本刀无对外暴露 agent / 无外部用户可写入接口；`controllerSessionId` 为进程内创建端生成、经本机 CLI 参数透传，不接受外部不可信输入。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 续租 CAS + reconcile（真 PG） | `tests/kernel-controller-lease-renewal.pg.integration.test.js`（永久位 `packages/brain/src/__tests__/integration/`） | `RED-1`、`RED-1b`、`RED-2 + RED-5(mismatch)`、`RED-3`、`RED-3b` | 现网 `writeHeartbeat` 无 `controllerSessionId` 入参、不写 lease、返回 `undefined` → 全部断言 FAIL |
| session 透传（RED-4，纯装配） | `tests/controller-session-passthrough.test.js`（永久位 `packages/brain/src/__tests__/`） | `parseArgs 解析 --controller-session-id`、`buildKernelLaunchArgs 把创建时 controllerSessionId 透传给 detached child`、`buildKernelLaunchArgs 透传 resumeToken` | `buildKernelLaunchArgs is not a function` + `parseArgs` 无 `controllerSessionId` 字段 → 3 FAIL（本轮已实测 3 failed） |
| final-e2e 业务写入领域 oracle | `packages/brain/src/__tests__/kernel-controller-lease-renewal-e2e-oracle.test.js` | `用本轮唯一 run 的新鲜业务行断言 heartbeat、lease 与 phase` | 修复前提取脚本仅有 `information_schema` psql，缺 `created_at > NOW() - interval` → 1 FAIL（本轮已实测） |

> 「BEHAVIOR 覆盖」列每个名均为对应 `it()` 名的字面子串（下游字符串匹配用）。

## E2E 验收（final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 本刀无 HTTP 面（内部 orchestrator + SQL）。E2E 在隔离的真 PostgreSQL 数据库中以本轮唯一 UUID 驱动 `createKernelRun`→`writeHeartbeat`(续租)→`reconcileOwnerlessKernelRuns` 全真代码路径；30m 边界由注入 `now = 原 lease + 1min` 确定性跨越（lease 默认 1800s），并在清理前用 `psql` 绑定本轮唯一 `run_id` 验证新鲜业务行、heartbeat/lease 前移与 phase，不靠历史数据、CI 绿或真实等待。

```bash
#!/bin/bash
set -euo pipefail
# 无 HTTP 面：直接在真 PostgreSQL 上跑 Golden Path 全链（续租 + CAS + reconcile）。
cd packages/brain
export NODE_ENV=test
export PGHOST="${DB_HOST:-localhost}"
export PGPORT="${DB_PORT:-5432}"
export PGUSER="${DB_USER:-cecelia}"
export PGPASSWORD="${DB_PASSWORD:-}"
E2E_DB="kernel_lease_e2e_$(node -e "console.log(require('node:crypto').randomUUID().replaceAll('-', ''))")"
export DB_NAME="$E2E_DB"
TASK_ID="$(node -e "console.log(require('node:crypto').randomUUID())")"
INITIATIVE_ID="$(node -e "console.log(require('node:crypto').randomUUID())")"
CONTROLLER_SESSION_ID="$(node -e "console.log(require('node:crypto').randomUUID())")"
RUN_ID=""

cleanup_e2e() {
  set +e
  if [[ -n "${RUN_ID:-}" ]]; then
    psql -d "$E2E_DB" -v ON_ERROR_STOP=1 -v run_id="$RUN_ID" -v task_id="$TASK_ID" >/dev/null <<'SQL'
DELETE FROM initiative_runs WHERE id = :'run_id'::uuid;
DELETE FROM tasks WHERE id = :'task_id'::uuid;
SQL
  fi
  psql -d postgres -v db_name="$E2E_DB" -tA >/dev/null <<'SQL'
SELECT pg_terminate_backend(pid)
  FROM pg_stat_activity
 WHERE datname = :'db_name'
   AND pid <> pg_backend_pid();
SQL
  psql -d postgres -v db_name="$E2E_DB" >/dev/null <<'SQL'
DROP DATABASE IF EXISTS :"db_name";
SQL
}
trap cleanup_e2e EXIT

# 1. 隔离空库 migration bootstrap（真 schema，含 migration 415 controller ownership 两列）
psql -d postgres -v ON_ERROR_STOP=1 -v db_name="$E2E_DB" >/dev/null <<'SQL'
CREATE DATABASE :"db_name";
SQL
node src/migrate.js
# 目标列存在性机检（缺列直接 FAIL）
# gate-allow: domain/db-no-time-window schema 列存在性探测（information_schema，非业务产出，无时间窗语义）
psql -d "$E2E_DB" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='initiative_runs' AND column_name IN ('controller_session_id','controller_lease_expires_at')" | grep -qx 2 || { echo "FAIL: migration 415 两列缺失"; exit 1; }

# 2. 本轮唯一标识真调 createKernelRun → writeHeartbeat → reconcile。
export TASK_ID INITIATIVE_ID CONTROLLER_SESSION_ID
E2E_RESULT="$(node --input-type=module <<'NODE'
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { DB_DEFAULTS } from './src/db-config.js';
import { createKernelRun } from './src/orchestrator/kernel-run-store.js';
import { writeHeartbeat } from './src/orchestrator/heartbeat.js';
import { reconcileOwnerlessKernelRuns } from './src/orchestrator/kernel-controller-lifecycle.js';

const { Pool } = pg;
const pool = new Pool({ ...DB_DEFAULTS, database: process.env.DB_NAME, max: 2 });
try {
  await pool.query(
    `INSERT INTO tasks (id, title, status, priority, task_type, trigger_source, payload)
     VALUES ($1, $2, 'in_progress', 'P2', 'harness_initiative', 'api', $3::jsonb)`,
    [
      process.env.TASK_ID,
      `kernel-lease-e2e-${randomUUID()}`,
      JSON.stringify({ initiative_id: process.env.INITIATIVE_ID }),
    ],
  );
  const created = await createKernelRun(pool, {
    taskId: process.env.TASK_ID,
    initiativeId: process.env.INITIATIVE_ID,
    phase: 'planning',
    journeyId: null,
    abilityId: null,
    host: 'kernel-e2e',
    deadlineHours: 8,
    createdSource: 'kernel_dispatch',
    controllerSessionId: process.env.CONTROLLER_SESSION_ID,
  });
  if (!created.created) throw new Error('E2E run identifier was not created this round');

  const beforeLease = new Date(created.run.controller_lease_expires_at);
  const heartbeatAt = new Date(beforeLease.getTime() + 60_000);
  const heartbeat = await writeHeartbeat(pool, {
    runId: created.run.id,
    host: 'kernel-e2e',
    pid: process.pid,
    now: heartbeatAt,
    controllerSessionId: process.env.CONTROLLER_SESSION_ID,
  });
  if (heartbeat.rowCount !== 1) throw new Error(`heartbeat CAS rowCount=${heartbeat.rowCount}`);

  const reconciled = await reconcileOwnerlessKernelRuns(pool, {
    now: new Date(heartbeatAt.getTime() + 1000),
  });
  if (reconciled.some(({ runId }) => runId === created.run.id)) {
    throw new Error('freshly renewed run was reconciled as ownerless');
  }
  console.log(JSON.stringify({
    runId: created.run.id,
    beforeLease: beforeLease.toISOString(),
    heartbeatAt: heartbeatAt.toISOString(),
  }));
} finally {
  await pool.end();
}
NODE
)"
RUN_ID="$(jq -er '.runId' <<<"$E2E_RESULT")"
BEFORE_LEASE="$(jq -er '.beforeLease' <<<"$E2E_RESULT")"
HEARTBEAT_AT="$(jq -er '.heartbeatAt' <<<"$E2E_RESULT")"

# 3. 清理前由 psql 对本轮唯一业务行做领域 oracle；历史行无法命中 run_id + 新鲜度窗口。
ROW_COUNT="$(psql -d "$E2E_DB" -v ON_ERROR_STOP=1 \
  -v run_id="$RUN_ID" -v before_lease="$BEFORE_LEASE" -v heartbeat_at="$HEARTBEAT_AT" -tA <<'SQL'
SELECT count(*)
  FROM initiative_runs
 WHERE id = :'run_id'::uuid
   AND created_at > NOW() - interval '5 minutes'
   AND orchestrator_heartbeat_at = :'heartbeat_at'::timestamptz
   AND orchestrator_heartbeat_at > created_at
   AND controller_lease_expires_at > :'before_lease'::timestamptz
   AND controller_lease_expires_at > orchestrator_heartbeat_at
   AND phase = 'planning';
SQL
)"
ROW_COUNT="$(tr -d '[:space:]' <<<"$ROW_COUNT")"
[[ "$ROW_COUNT" == "1" ]] || { echo "FAIL: 本轮 run 的新鲜度/heartbeat/lease/phase oracle 未命中（count=$ROW_COUNT）"; exit 1; }
echo "DB_ORACLE_PASS run_id=$RUN_ID count=$ROW_COUNT"

# 4. 真 PG 集成回归：跨 30m 边界续租 + CAS fail-closed + reconcile 回收数=0 / mismatch 回收
npx vitest run --config vitest.integration.config.js \
  src/__tests__/integration/kernel-controller-lease-renewal.pg.integration.test.js \
  --reporter=verbose

# 5. controllerSessionId 可信透传红线（RED-4，纯装配）
npx vitest run src/__tests__/controller-session-passthrough.test.js --reporter=verbose

echo "OK: Controller lease 续租 Golden Path 已由本轮 run=$RUN_ID 的真 PostgreSQL 业务行验证"
```

**通过标准**: 脚本 exit 0（隔离库 migration 两列存在 + 本轮唯一 run 的新鲜业务行 `psql count=1` + heartbeat/lease 前移与 phase=planning + reconcile 不回收 + 集成文件全绿 + 透传测试全绿），随后清理本轮行并删除隔离数据库。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `writeHeartbeat` 传 `controllerSessionId=null`/空串 → 应 rowCount=0（不得因 SQL `= NULL` 恒 false 之外的路径误续租）；传不存在的 `runId` → rowCount=0。
- 重复提交: 同一心跳（同 now、同 session）连打两次 → 第二次 `GREATEST` 幂等，lease 不重复叠加、不缩短。
- 中途中断: 续租 UPDATE 与并发 `reconcileOwnerlessKernelRuns` 交错（同一 run）→ 不得出现「续租成功但仍被回收」或「回收后又被续活」（同一 now 语义下二选一，不振荡）。
- 边界值: `now` 恰等于 `controller_lease_expires_at`（lease 边界瞬间）→ 续租/回收判定一致（`< now` 严格小于语义，不得两边都命中）。
发现分级: P0/P1（无主 run 被续命 / 活跃 run 被误杀 / lease 缩短）→ 阻塞 merge；P2/P3（幂等叠加等非致命）→ 记 findings 不阻塞。
