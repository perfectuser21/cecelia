# Sprint Contract Draft (Round 1)

Sprint: runner 原语 — 一次执行 = 一行 task_runs（Brain 全执行路径 + 脚本步统一留痕并投影 Notion）
target_environment: local_api ｜ journey_type: autonomous

> contract-gate: cecelia worktree（packages/brain/src/lib/contract-gate.js 存在）→ 代码层 Contract Gate 生效，本合同断言按「Contract Gate 合规惯用法速查表」书写。
> gp-anchor: skipped (product-map.json not found)  ← cecelia 仓无 product-map/generated/product-map.json，GP-Anchor 段整体跳过，不阻塞。

---

## Response Schema（推导来源: migration 059 列契约 + api_registry 现有 execution-callback shape）

本 sprint 无「新 HTTP 端点返回体」；对外接触面复用现有 `POST /api/brain/execution-callback`（execution.js:46），因此 Response Schema 表达的是 **run 原语入参契约 + task_runs 列映射**（唯一写口的数据契约）。

### run 原语（packages/brain/src/lib/task-run.js，唯一写 task_runs 入口）

```
startRun({ taskId, runId, source, context? }) -> { id, run_id, created:boolean } | null
finishRun({ runId, status, exitCode?, artifacts?, error? }) -> { updated:boolean }
findBareRuns(pool, { windowMinutes }) -> Array<{ task_id, dispatched_at }>
normalizeRunStatus(status) -> 'running'|'success'|'failed'|'timeout'|'cancelled'   // 未知抛错
buildRunContext({ source, ... }) -> object                                          // 缺 source 抛错
buildRunResult({ exitCode?, artifacts? }) -> { exit_code:number|null, artifacts:array }
detectBareRuns(dispatchedTaskIds, runTaskIds) -> string[]                            // 纯集合差
```

### task_runs 列映射（沿用 migration 059 现有列，PRD 需求字段 → 列）

| PRD 需求字段 | task_runs 列（059 已存在） | 说明 |
|---|---|---|
| task_id | `task_id uuid` | FK tasks(id) |
| 执行路径 | `context->>'source'` | 存进 059 已有的 `context jsonb`（其注释含 agent/skill/model/provider/... 语义），source 为必填键 |
| 开始时间 | `started_at timestamptz` | 059 DEFAULT now() |
| 结束时间 | `ended_at timestamptz` | finishRun 补齐 |
| exit code | `result->>'exit_code'` | 存进 059 已有的 `result jsonb` |
| 产物引用 | `result->'artifacts'` | 引用（路径/URL/ID）数组，不落大 blob（PRD 假设③） |
| 状态 | `status text` | 枚举字面用 059 注释：`running`/`success`/`failed`/`timeout`/`cancelled`（PRD 散文写「succeeded」→ normalizeRunStatus 归一到 `success`，以 DB SSOT 为准） |
| 幂等键 | `run_id text` (UNIQUE idx_task_runs_run_id) | 一次执行 = 恰好一行 |

**禁用字段名**（不得新增同义列/键顶替既有语义）：`exit`（用 `exit_code`）、`succeeded`（用 `success`）、`path`（用 `context.source`）、`output`（用 `result.artifacts`）。

**新增列（PRD 假设明确「若缺列由 Proposer 在合同阶段提出加列」）**：
task_runs 仅缺「Notion 投影记账列」。新增 migration `packages/brain/migrations/466_task_runs_notion_projection.sql`，
`ALTER TABLE task_runs ADD COLUMN IF NOT EXISTS notion_id text`、`... notion_synced_at timestamptz`、`... notion_digest text`
（**纯 additive，不改 059 现有列**，与 decisions/journeys 等所有被投影表的记账约定逐字一致，供 lib/notion-projection-engine.js 的 pushRegisteredRows 增量与去重）。
⚠️ 见八要素判定表：此列触碰 PRD「不改表结构」边界的解读，属须主理人确认的判定点（judgment-pending-user）。

---

## Golden Path

锚定父路声明: 独立小路（无父路）—— 链 bf5088a3 第 1 棒 F1 执行基座，PRD「累积 FR」段注明本 line 无已验收前序 ability。

[执行路径/脚本步开始] → [startRun 落一行 running] → [脚本步 ssh 回调经 execution-callback 补留痕] → [finishRun 补齐终态/exit/产物] → [notion-push-sync 投影] → [晨报暴露裸跑 AMBER]

### Step 1: 执行路径或脚本步开始一次执行，调 startRun 落一行 running
**来源**: `[FROM_PRD]` — Golden Path 第 1-2 步 + 范围「lib 层 run 原语 startRun/finishRun（唯一写 task_runs 入口）」

**可观测行为**: 任一执行路径（dispatcher/executor/openclaw-agent-executor/cecelia-run/bridge）或脚本步开始时，task_runs 立即出现一行 `status='running'`、`context->>'source'` 为该执行路径名、`started_at` 非空、`ended_at` 为空。

**验证命令**（真 PG；E2E 用真实 seed task + 直调回执通道触发；见 ## E2E 验收）:
```bash
psql "$DB_URL" -tAc "SELECT status, ended_at IS NULL, context->>'source' FROM task_runs WHERE run_id='$RUN_ID'"
# 期望：running|t|<source>
```

**硬阈值**: 恰好 1 行；status=running；context.source 非空。
验证命令: `[ "$(psql "$DB_URL" -tAc "SELECT count(*) FROM task_runs WHERE run_id='$RUN_ID'")" = "1" ]`

---

### Step 2: 唯一写口 + 幂等（同一次执行只对应一行）
**来源**: `[FROM_PRD]` — 铁律「单一写口」+「必经留痕」+ 边界「同一次执行重复调用『开始』→ 幂等」

**可观测行为**: 重复 startRun 同一 run_id 不产生第二行（UNIQUE run_id + ON CONFLICT DO NOTHING）；且全仓除 lib/task-run.js 外无任何执行路径直插 task_runs（单一写口）。

**验证命令**:
```bash
# 幂等：两次 start 后仍 1 行（E2E 内触发，见下）
[ "$(psql "$DB_URL" -tAc "SELECT count(*) FROM task_runs WHERE run_id='$RUN_ID'")" = "1" ] || { echo FAIL; exit 1; }
# 单一写口：源码里除 lib/task-run.js 外零 INSERT INTO task_runs
BAD=$(grep -rlE "INSERT[[:space:]]+INTO[[:space:]]+task_runs" packages/brain/src --include=*.js | grep -v "src/lib/task-run.js" | grep -v "__tests__" || true)
[ -z "$BAD" ] || { echo "FAIL: 绕过唯一写口: $BAD"; exit 1; }
```

**硬阈值**: 幂等后行数=1；单一写口违规文件数=0。

---

### Step 3: 脚本步（采收线 harvest 为样板）经 ssh 回调把 run 写回 Brain
**来源**: `[FROM_PRD]` — Golden Path 第 3 步 + 假设②「ssh 回调通道复用现有 device_job 回调机制，不新建通道」

**可观测行为**: 脚本步通过既有 `POST /api/brain/execution-callback`（run_id 关联）回写；回执处理路径经 run 原语确保该 run_id 的 task_runs 行存在（startRun 幂等 upsert）并在终态 status 时 finishRun 补齐——同一次执行始终一行。

**验证命令**:
```bash
# 复用真实回执通道 shape（见 ## 真实调用方请求 shape），终态回执后该 run 恰好一行且已结束
curl -sf -X POST localhost:5221/api/brain/execution-callback -H 'Content-Type: application/json' \
  -d "{\"task_id\":\"$TASK_ID\",\"run_id\":\"$RUN_ID\",\"status\":\"completed\",\"exit_code\":0,\"result\":{\"artifacts\":[\"pr:1\"]}}" | jq -e '.success==true' || { echo FAIL; exit 1; }
```

**硬阈值**: 回执 HTTP 2xx 且 success=true；该 run_id 落库 1 行。

---

### Step 4: finishRun 补齐结束时间/exit code/产物引用/终态
**来源**: `[FROM_PRD]` — Golden Path 第 4 步

**可观测行为**: 执行结束调 finishRun（或经回执触发），同一行补齐 `ended_at`、`result->>'exit_code'`、`result->'artifacts'`、`status ∈ {success,failed,timeout,cancelled}`；已结束的 run 再次 finish 不覆盖（ended_at 守卫，边界「崩溃未结束 → 保持 running」「回调丢失/超时 → 不得伪造 succeeded」）。

**验证命令**:
```bash
psql "$DB_URL" -tAc "SELECT status, ended_at IS NOT NULL, result->>'exit_code', jsonb_array_length(COALESCE(result->'artifacts','[]'::jsonb)) FROM task_runs WHERE run_id='$RUN_ID'"
# 期望：success|t|0|1
```

**硬阈值**: ended_at 非空；exit_code=回执值；artifacts 长度≥1；status=success。

---

### Step 5: notion-push-sync 增加 task_runs 投影面
**来源**: `[FROM_PRD]` — Golden Path 第 5 步 + 范围「notion-push-sync 增加 task_runs 投影面」

**可观测行为**: `runNotionPushSync(pool)` 新增 `pushTaskRuns(pool, token)`（沿用 lib/notion-projection-engine.js 的 pushRegisteredRows 约定：SELECT 未同步行 → buildTaskRunNotionProperties → 落 notion_id/notion_synced_at/notion_digest）；投影内容含开始/结束/exit/产物。投影失败不阻塞执行主链（边界④「DB 为真相源」）。

**验证命令**（无 Notion token 时以「投影函数已接线 + 记账列存在 + fail-open」为可机检 oracle；真 Notion 页由带 token 的 evaluator 段核）:
```bash
# 5a. runNotionPushSync 已调用 pushTaskRuns（接线存在）
node -e "const c=require('fs').readFileSync('packages/brain/src/notion-push-sync.js','utf8'); if(!/pushTaskRuns\s*\(/.test(c)||!/async function pushTaskRuns/.test(c)) process.exit(1)"
# 5b. 记账列已由 migration 466 加上（真 PG）
psql "$DB_URL" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='task_runs' AND column_name IN ('notion_id','notion_synced_at','notion_digest')" | grep -qx 3
```

**硬阈值**: pushTaskRuns 被 runNotionPushSync 调用；task_runs 三记账列均存在。

---

### Step 6: 晨报「裸跑检测」AMBER（有 dispatch_events 无 task_runs）
**来源**: `[FROM_PRD]` — Golden Path 第 6 步 + 范围「晨报增加『裸跑检测』AMBER 规则」

**可观测行为**: 晨报（morning-cockpit-bark / daily-report-generator）经 `findBareRuns(pool,{windowMinutes})` 检出窗口内「有 dispatched 事件但无对应 task_runs」的 task，晨报正文出现 AMBER 裸跑行；无裸跑时不出现该行（且不误报有 run 的执行）。

**验证命令**（真 PG；E2E 造一个裸跑 task 后断言 findBareRuns 命中）:
```bash
node --input-type=module -e "
import pool from './packages/brain/src/db.js';
import { findBareRuns } from './packages/brain/src/lib/task-run.js';
const bare = await findBareRuns(pool, { windowMinutes: 60 });
if (!bare.some(b => b.task_id === process.env.BARE_TASK_ID)) { console.error('FAIL: 未检出裸跑'); process.exit(1); }
console.log('OK bare='+bare.length); await pool.end();
"
```

**硬阈值**: 造的裸跑 task 被检出；有 run 的 task 不被误报。

---

## 真实调用方请求 shape（规则 A — 脚本步/设备回调走既有 execution-callback）

脚本步（harvest/device_job）经 ssh 把 run 状态写回 Brain，**复用现有 `POST /api/brain/execution-callback`**（execution.js:46，PRD 假设②「不新建通道」）。生产调用方字段（execution.js:65-76 逐字段摘录）：

| 字段 | 类型 | run 原语用途 |
|---|---|---|
| `task_id` | uuid（必填，缺→400） | task_runs.task_id |
| `run_id` | text | task_runs.run_id（幂等键；回执现有幂等：decision_log run_id+status，execution.js:135-144） |
| `status` | text（running/completed/completed_no_pr/failed/quota_exhausted/timeout/cancelled） | normalizeRunStatus → task_runs.status |
| `exit_code` | int | result.exit_code |
| `result` | jsonb（含 artifacts / pr_url） | result.artifacts |
| `checkpoint_id`/`duration_ms`/`iterations`/`stderr`/`attempt`/`failure_class` | 现有列 | 旁路上下文（可入 context/result，非本 sprint 断言项） |

**认证方式**: 与现网一致——body 传 `task_id`/`run_id`（execution-callback 现网即 body 制，无 x-agent-id header 要求）。DoD 构造的回执 body 与本表逐字段一致，禁止双路径分叉（不得 body 传 run_id 而实现读 header）。

---

## 禁 mock 边清单（规则 v9.12 — 本单涉调度/状态机/跨模块数据传递/生命周期钩子/DB写路径）

- 代码 ↔ `task_runs` 表：startRun INSERT / finishRun UPDATE 写路径 —— 集成测试必须真 Postgres 验行落库与幂等，禁 `vi.mock('../db.js')`。
- `dispatch_events` ↔ `task_runs`：findBareRuns 跨表 LEFT JOIN 裸跑检测 —— 必须真 PG 两表联查，禁替身。
- execution-callback 处理 ↔ run 原语：回执 status 驱动 startRun/finishRun 这条边（跨模块 + 状态机）—— 真 PG 验（E2E 走真实 HTTP + 真 DB）。
- 执行路径（dispatcher/executor/openclaw-agent）状态迁移 → startRun 生命周期钩子接线 —— 见「未覆盖真实链路清单」：callback 边真验；其余路径接线以单一写口 grep + 接线 grep 为 logic 断言，逐路径真机 harvest 真验登记为 logic-done-pending（真验成本高）。

对应真 PG 测试：`packages/brain/src/__tests__/integration/task-run-primitive.pg.integration.test.js`（已登记 vitest.config.js POSTGRES_INTEGRATION_TESTS，brain-integration 跑）。

---

## 未覆盖真实链路清单（规则 C）

| 被 mock/未真验的链路点 | 为什么 | 真验证补位计划（谁/何时/什么环境） |
|---|---|---|
| Notion 投影真实落页（pushTaskRuns 真推到 Notion DB） | 单测/CI 无 Notion token，getToken 抛错则 runNotionPushSync 直接 return（fail-open） | 带 NOTION token 的 evaluator 段 / 生产 notion-push-sync 轮询后人工核对 Notion 「task_runs」库页面；DoD Step 5 以接线 + 记账列存在为 CI oracle，真页留痕为接缝 |
| dispatcher/executor/openclaw/cecelia-run/bridge 五路径逐条真机接线触发 | 逐路径起真实派发/真机执行成本高，E2E 用回执通道代表脚本步一路 | 真机 harvest 采收批（8 步）跑通后 psql 核 8 行 task_runs（PRD 验收 E2E 原意）；本 sprint 标 logic-done-pending，harvest 真跑段由后续棒/evaluator 真机执行 |

（本合同回执 E2E 无 force_*/stub 假数据；上述两项为环境不可得的接缝，显式登记，不静默假绿。）

---

## 已知约束（来自回归测试 + 累积 FR）

- [回归测试] `src/__tests__/receipt-collector.test.js` → action_receipts 台账 record/resolve 幂等 + fail-open（run 原语沿用同款 fail-open：DB 错误 console.warn 不抛，never breaks main flow）。
- [回归测试] `src/__tests__/executor-error-message.test.js:133` → checkExitReason 读 task_runs（本 sprint 只增写口，不得改动既有读语义/列含义）。
- [回归测试] `src/alertness/healing.js:497,514,800` → healing 按 task_runs 的 `pid`/`status='running'` 对比活跃进程（本 sprint 写 running/终态须与该读一致：running 行必须真代表在跑，崩溃悬挂 running 由晨报暴露而非静默改写）。
- [累积 FR] 链 bf5088a3 第 1 棒，本 line 无历史已验收 ability（PRD 累积 FR 段）。
- [context-manifest] journey_id=none → 无 line context-manifest 端点可拉；记一行 context-manifest: n/a (journey_id=none)。
- [Unified Map] task.payload 无 map_scope/map_repo（database_foundation 格无 must_run 断言，PRD 说明改挂 F1 开发闭环既有断言）→ 标 [MAP_NOT_CONFIGURED]，must_run_assertions 为空，验收引用 F1 既有断言（本 sprint 的真 PG 集成测试 + 单一写口 + 回执 E2E）。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | lib 层 run 原语 startRun/finishRun 为唯一写口；Brain 全执行路径 + 脚本步经它「一次执行=一行 task_runs」；notion-push-sync 投影；晨报裸跑 AMBER。 |
| **NFR（做得多好）** | | run 写库为执行主链**非阻塞旁路**，失败 fail-open（console.warn）不阻断执行（PRD NFR）；无显式超时/频控阈值（PrepPRD 未指定）。 |
| **Invariant** | | ①单一写口（仅 lib/task-run.js 写 task_runs）②必经留痕（有执行必有恰好一行 run，不裸跑）③DB 为真相源（Notion 投影失败不反向抹除/伪造 run 状态）。 |
| **判定点** | | 见下方登记表（run 是否「结束」的判定，尤其崩溃/回调丢失场景）。 |
| **保质期** | | task_runs 留痕长期留存；OpenClaw 侧 run 证据仅保 7 天（feishu-task-ledger.js:359），本表不受该窗约束，为本地真相源。 |
| **死亡告警** | | run 原语停写 → 出现「有 dispatch_events 无 task_runs」= 裸跑 → 晨报 AMBER（本 sprint 即该告警的实现）；悬挂 running 亦经晨报/healing 可见。 |
| **失败语义** | | 见下方失败语义声明。 |
| **效果确认** | | 每次执行以 task_runs 行为回执：start=running 行存在；finish=ended_at+exit_code+status 补齐；未补齐即视为未确认（保持 running，不伪造终态）。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 聊天记录 API 不稳 | 静默丢消息 |
| ⚠️ run 是否「已结束」 | A. 收到终态回执(execution-callback status∈终态)→finishRun; B. 超时无回执即判 failed | A（只认真实终态回执；无回执保持 running，由晨报暴露悬挂） | 边界「回调丢失/超时→不得伪造 succeeded」「崩溃未结束→留 running」 | 伪造 succeeded 会让失败执行被当成功，直接面客错误 |
| ⚠️ task_runs 是否需新增 notion 记账列 | A. ALTER 加 notion_id/synced_at/digest(与全库投影表一致); B. working_memory 游标记账不改表 | A | 与 decisions/journeys 等所有被投影表逐字一致，复用 pushRegisteredRows；PRD 假设明确允许缺列时加列 | 触碰 PRD「不改表结构」边界解读——judgment-pending-user: 是否允许 additive 记账列（须主理人/对齐会确认；若否则退回方案 B） |
| run 归属哪条执行路径 | A. context.source 由调用方显式传; B. 由堆栈/env 推断 | A（buildRunContext 缺 source 抛错，强制显式） | 显式 > 推断，避免误归属 | source 缺失=留痕不可归因，无法定位裸跑来源 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| startRun 时 DB 错误 | console.warn，返回 null，**不阻断执行主链**（旁路） | 是（run_id UNIQUE + ON CONFLICT DO NOTHING） | 执行继续；该次可能成裸跑 → 晨报 AMBER 暴露 |
| finishRun 时 DB 错误 | console.warn，不抛 | 是（WHERE run_id AND ended_at IS NULL，已终态不重写） | run 保持 running，晨报暴露悬挂 |
| 回执丢失/超时 | 不 finishRun | 是 | 保持 running，禁伪造 succeeded |
| Notion 投影失败 | console.warn，不阻断，不回写 run 状态 | 是（notion_synced_at 未推进，下轮重试） | DB 为真相源 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| N/A — 本 sprint 为 Brain 内部执行留痕，非对外暴露 agent；execution-callback 为内网既有通道，不在本 sprint 扩大信任面 | 内部 | N/A | N/A |

---

## E2E 验收（final-e2e，target_environment=local_api — curl localhost:5221 + psql）

> 说明：本地 Brain 5221 + 隔离 DB_URL（Fleet 注入）。E2E 以 seed 一个真实 tasks 行 → 经真实 execution-callback 通道触发 run 原语 upsert → psql 真验 task_runs 落库/幂等/终态 → 真验裸跑检测 + 投影记账列。全程真 PG、真 HTTP，无 mock、无 dry-run。

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
BASE_URL="${BASE_URL:-http://localhost:5221}"
export PGCONNECT_TIMEOUT=10

# 0. 前置：migration 已应用（task_runs 记账列存在）
psql "$DB_URL" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='task_runs' AND column_name IN ('notion_id','notion_synced_at','notion_digest')" | grep -qx 3 \
  || { echo "FAIL: migration 466 记账列缺失"; exit 1; }

# 1. seed 两个真实 tasks 行（一个走完整 run，一个制造裸跑）
TASK_ID=$(psql "$DB_URL" -tAc "INSERT INTO tasks (task_type,status,payload) VALUES ('harness_initiative','in_progress','{}'::jsonb) RETURNING id" | tr -d ' ')
BARE_TASK_ID=$(psql "$DB_URL" -tAc "INSERT INTO tasks (task_type,status,payload) VALUES ('harness_initiative','in_progress','{}'::jsonb) RETURNING id" | tr -d ' ')
RUN_ID="e2e-run-$(date +%s)-$$"
trap 'psql "$DB_URL" -c "DELETE FROM dispatch_events WHERE task_id IN ('"'"'$TASK_ID'"'"','"'"'$BARE_TASK_ID'"'"'); DELETE FROM task_runs WHERE task_id IN ('"'"'$TASK_ID'"'"','"'"'$BARE_TASK_ID'"'"'); DELETE FROM tasks WHERE id IN ('"'"'$TASK_ID'"'"','"'"'$BARE_TASK_ID'"'"');" >/dev/null 2>&1 || true' EXIT

# 2. 经真实回执通道报「开始」（status=running）→ startRun 落一行 running
curl -sf -X POST "$BASE_URL/api/brain/execution-callback" -H 'Content-Type: application/json' \
  -d "{\"task_id\":\"$TASK_ID\",\"run_id\":\"$RUN_ID\",\"status\":\"running\"}" | jq -e '.success==true' \
  || { echo "FAIL: running 回执未接受"; exit 1; }
sleep 1
psql "$DB_URL" -tAc "SELECT status,context->>'source' FROM task_runs WHERE run_id='$RUN_ID'" | grep -q "running" \
  || { echo "FAIL: startRun 未落 running 行"; exit 1; }

# 3. 幂等：重复报「开始」仍 1 行
curl -sf -X POST "$BASE_URL/api/brain/execution-callback" -H 'Content-Type: application/json' \
  -d "{\"task_id\":\"$TASK_ID\",\"run_id\":\"$RUN_ID\",\"status\":\"running\"}" >/dev/null
CNT=$(psql "$DB_URL" -tAc "SELECT count(*) FROM task_runs WHERE run_id='$RUN_ID'" | tr -d ' ')
[ "$CNT" = "1" ] || { echo "FAIL: 幂等破坏 count=$CNT"; exit 1; }

# 4. 报「结束」（终态 + exit + 产物）→ finishRun 补齐同一行
curl -sf -X POST "$BASE_URL/api/brain/execution-callback" -H 'Content-Type: application/json' \
  -d "{\"task_id\":\"$TASK_ID\",\"run_id\":\"$RUN_ID\",\"status\":\"completed\",\"exit_code\":0,\"result\":{\"artifacts\":[\"pr:1\"]}}" | jq -e '.success==true' \
  || { echo "FAIL: 终态回执未接受"; exit 1; }
sleep 1
psql "$DB_URL" -tAc "SELECT status, ended_at IS NOT NULL, result->>'exit_code', jsonb_array_length(COALESCE(result->'artifacts','[]'::jsonb)) FROM task_runs WHERE run_id='$RUN_ID'" \
  | grep -qx "success|t|0|1" || { echo "FAIL: finishRun 终态/exit/产物未补齐"; exit 1; }

# 5. 单一写口：源码里除 lib/task-run.js 外零 INSERT INTO task_runs
BAD=$(grep -rlE "INSERT[[:space:]]+INTO[[:space:]]+task_runs" packages/brain/src --include=*.js | grep -v "src/lib/task-run.js" | grep -v "__tests__" || true)
[ -z "$BAD" ] || { echo "FAIL: 绕过唯一写口: $BAD"; exit 1; }

# 6. 裸跑检测：BARE_TASK_ID 有 dispatched 无 task_runs → findBareRuns 命中
psql "$DB_URL" -c "INSERT INTO dispatch_events (task_id,event_type,reason) VALUES ('$BARE_TASK_ID','dispatched','e2e-bare')" >/dev/null
BARE_TASK_ID="$BARE_TASK_ID" TASK_ID="$TASK_ID" node --input-type=module -e "
import pool from './packages/brain/src/db.js';
import { findBareRuns } from './packages/brain/src/lib/task-run.js';
const bare = await findBareRuns(pool, { windowMinutes: 60 });
const ids = bare.map(b=>b.task_id);
if (!ids.includes(process.env.BARE_TASK_ID)) { console.error('FAIL: 未检出裸跑'); await pool.end(); process.exit(1); }
if (ids.includes(process.env.TASK_ID)) { console.error('FAIL: 有 run 的 task 被误报裸跑'); await pool.end(); process.exit(1); }
console.log('OK: 裸跑检出且无误报'); await pool.end();
"

# 7. 投影接线：runNotionPushSync 调用了 pushTaskRuns
node -e "const c=require('fs').readFileSync('packages/brain/src/notion-push-sync.js','utf8'); if(!/pushTaskRuns\s*\(/.test(c)) { console.error('FAIL: runNotionPushSync 未接 pushTaskRuns'); process.exit(1);} console.log('OK: 投影已接线')"

echo "✅ Golden Path 验证通过（run 原语落库/幂等/终态/单一写口/裸跑/投影）"
```

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `POST /api/brain/execution-callback` 传 `run_id` 缺失但 `status=completed`（无幂等键的终态）→ 观察是否产生无 run_id 的孤儿行或崩溃。
- 重复提交: 同 run_id 先 completed 再 running（乱序回执）→ finishRun 后不得被 startRun 复活成 running。
- 中途中断: startRun 落 running 后不发终态回执（模拟崩溃）→ 该行应保持 running（不得自动翻 success），并被 findBareRuns 之外的悬挂检测/晨报可见。
- 边界值: exit_code 为负/超大整数、artifacts 为超长数组或非数组类型 → buildRunResult 归一（非数组包成数组，非法 exit_code 记 null），不写坏 jsonb。
发现分级: P0/P1（伪造终态 / 丢失留痕 / 崩溃）→ 阻塞 merge；P2/P3（展示措辞/日志噪音）→ 记 findings 不阻塞。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| run 原语纯逻辑（冻结测试，仓库根 vitest 跑） | `sprints/09251224-kernel-66db3dfb/tests/task-run-primitive.test.js` | 未知状态抛错、缺 source 抛错、单个产物引用被包装为数组、返回被派发但无 run 记录的 task_id | Failed to load ../../../packages/brain/src/lib/task-run.js（模块未建）→ 全红 |
| run 原语落库 + 裸跑（真 PG，补充行，brain-integration 跑） | `packages/brain/src/__tests__/integration/task-run-primitive.pg.integration.test.js` | 写入恰好一行 running、同一 run_id 重复 startRun 幂等、补齐 ended_at、已结束的 run 再次 finishRun 不覆盖、检出被派发但无 run 记录的 task | 同因 import 失败 → 全红 |
