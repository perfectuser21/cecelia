# OpenClaw 运行记录入库 + Notion「最近执行」库 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OpenClaw 每次 cron 运行写进 Brain `runs` 表一行，并投影到 Notion「最近执行」库，替代飞书群推送。

**Architecture:** Brain 定时任务 `openclaw-run-ingest`（300s）经宿主 `ssh mmv` 只读查 OpenClaw SQLite 的 `task_runs`，映射后 upsert 进 `runs`，并对连续失败 ≥3 次的任务发一次 Bark。另一个定时任务 `runs-notion-push`（120s）用现有 `pushRegisteredRows` 把窗口内的 runs 推到 Notion，移出窗口的页归档。

**Tech Stack:** Node.js ESM、pg、vitest（unit + `*.pg.integration.test.js`）、Notion API 2022-06-28。

**Spec:** `docs/superpowers/specs/2026-10-07-openclaw-runs-ingest-design.md`

## Global Constraints

- 所有路径相对仓库根；Brain 代码在 `packages/brain/`。
- 外部命令一律 `defaultExecAsync`（`src/host-exec.js`），禁 `execSync`；容器逃逸用 `buildHostCmd(cmd, inContainer)`。
- `run_id` 前缀固定 `openclaw:`；`trigger_kind` 固定 `'schedule'`；`header_source` 固定 `'owner'`。
- 截断：`error` 2000 字；`detail.summary` 4000 字；Notion rich_text 1900 字。
- 窗口：OpenClaw 7 天全量、fail/timeout 30 天；其他 runs 只 fail/timeout 30 天。
- 批量：ingest 每轮 ≤2000 行；Notion 每轮推 ≤100、归档 ≤100。
- Bark：dedupeKey `openclaw-run-streak:<任务名>:<连败段首条 run_id>`，TTL `7*86400`；首轮（游标为空）不发。
- TDD：每个 task 先 commit 失败测试，再 commit 实现。commit 用 Conventional Commits，结尾带 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 不改版本五件套（brain package.json / package-lock / 根 lock / .brain-versions / DEFINITION.md 版本行），改加 `changes/` 碎片。
- 集成测试只连 `cecelia_scratch`（本地）或 CI 的 `cecelia_test`，照 `migration-531-runs-table.pg.integration.test.js` 的守卫与 BEGIN/ROLLBACK 写法。

## Review Focus

1. 同一个 OpenClaw 运行先以 running 入库、下一轮变 succeeded：必须更新同一行而非新增，且 ended_at/outcome 正确（Task 3 测）。
2. 一次性 at 任务的 job 已被删除（cron_jobs join 不上）：任务名回退 `openclaw-job:<前8位>`，不报错（Task 2 测）。
3. MMV 断线后游标停住：恢复后从「游标 − 1h」拉，补齐且不重复（Task 3 测游标 SQL 与幂等）。
4. 首轮回填 30 天历史里有大量连败：不得一次性发出几十条 Bark（Task 4 测 firstRound）。
5. Notion 库尚未建（projection_map 仍 pending）：投影任务安静跳过，不报错、不刷日志（Task 6 测）。

---

### Task 1: 迁移 532——runs 加 Notion 记账列 + 投影注册占位

**Files:**
- Create: `packages/brain/migrations/532_runs_notion_projection.sql`
- Test: `packages/brain/src/__tests__/integration/migration-532-runs-notion.pg.integration.test.js`

**Interfaces:**
- Produces: `runs.notion_id text`、`runs.notion_synced_at timestamptz`、`runs.notion_digest text`；`notion_projection_map` 行 `brain_table='runs'`, `notion_db_id='unmapped:runs'`, `direction='none'`, `status='pending_vessel'`, `title='（无 Notion 库）最近执行'`；`schema_version` 行 `'532'`。

- [ ] **Step 1: 写失败测试**：断言 `information_schema.columns` 里 runs 有上述三列；`notion_projection_map WHERE brain_table='runs'` 恰 1 行且 status=`pending_vessel`；`schema_version` 有 `'532'`。
- [ ] **Step 2: 跑测试确认失败**：`cd packages/brain && DB_NAME=cecelia_scratch npx vitest run src/__tests__/integration/migration-532-runs-notion.pg.integration.test.js`，预期 FAIL（列不存在）。
- [ ] **Step 3: 写迁移**：照 `migrations/468_task_runs_notion_projection.sql` 原样结构（`ADD COLUMN IF NOT EXISTS` ×3 + `INSERT ... ON CONFLICT DO NOTHING` 占位行 + schema_version），vessel 写 `(runs-notion-projection 待建库；库注册前跳过)`。
- [ ] **Step 4: 在 scratch 库执行迁移并跑测试**：按仓库现有迁移命令（`DB_NAME=cecelia_scratch node packages/brain/src/migrate.js` 或同目录 package.json 的 migrate 脚本）执行后重跑 Step 2，预期 PASS。
- [ ] **Step 5: Commit**（测试与迁移分两个 commit）。

### Task 2: 采集——纯函数（SQL / 命令 / 行映射）

**Files:**
- Create: `packages/brain/src/openclaw-run-ingest.js`
- Test: `packages/brain/src/__tests__/openclaw-run-ingest.test.js`

**Interfaces:**
- Produces:
  - `buildIngestSql({ sinceMs: number|null, nowMs: number, limit = 2000 }) => string`：`sinceMs` 为 null 时取 `nowMs - 30*86400_000`；条件 `t.runtime='cron' AND (coalesce(t.last_event_at,t.ended_at,t.created_at) >= <since> OR t.status IN ('running','queued'))`，`LEFT JOIN cron_jobs j ON j.job_id=t.source_id`，选 `t.task_id,t.source_id,t.agent_id,t.status,t.created_at,t.started_at,t.ended_at,t.terminal_summary,t.error,j.name,j.payload_kind`，`ORDER BY t.created_at LIMIT <limit>`。数字直接内插（只接受有限整数，否则抛错）。
  - `buildMmvCmd(sql: string) => string`：`ssh -o BatchMode=yes -o ConnectTimeout=20 mmv 'echo <base64(sql)> | base64 -d | sqlite3 -readonly -json ~/.openclaw/state/openclaw.sqlite'`。
  - `parseSqliteJson(stdout: string) => object[]`：空串/纯空白 → `[]`；非数组 JSON 或非法 JSON → 抛 `Error('parse_error: ...')`。
  - `mapOpenclawRow(row) => RunRow | null`，`RunRow = { run_id, trigger_ref, executor_kind, executor_id, started_at: Date, ended_at: Date|null, outcome, error, detail }`；`task_id` 缺失或 started/created 都不是有限数字 → 返回 null。
  - `OUTCOME_BY_STATUS = { succeeded:'pass', failed:'fail', timed_out:'timeout', running:'running', queued:'running' }`，其余 → `'unknown'`。

- [ ] **Step 1: 写失败测试**，至少这些用例：
  - `buildIngestSql({sinceMs:null, nowMs:N})` 含 `>= ${N-2592000000}`；`sinceMs:S` 含 `>= ${S}`；含 `status IN ('running','queued')` 与 `LIMIT 2000`；`sinceMs:'1;drop'` 抛错。
  - `buildMmvCmd('select 1')` 不含 `select`、含 `base64 -d | sqlite3 -readonly -json`，且把其中 base64 段解码回来等于 `'select 1'`。
  - `parseSqliteJson('')` → `[]`；`parseSqliteJson('{}')` 与 `'oops'` 抛 `parse_error`。
  - `mapOpenclawRow` 五种 status 映射；`name:null, source_id:'a9654769-fedb-…'` → `trigger_ref:'openclaw-job:a9654769'`；`payload_kind:'command'` → `executor_kind:'code'`，否则 `'agent'`；`agent_id:'media'` → `executor_id:'openclaw:media'`，空 → `'openclaw'`；`ended_at < started_at` → ended_at 等于 started_at；running 行 `ended_at` 为 null；`error` 截到 2000、`detail.summary` 截到 4000；`detail` 等于 `{source:'openclaw', job_id, task_id, summary, status}`；`started_at` 缺失时用 `created_at`；两者都非法 → null。
- [ ] **Step 2: 跑测试确认失败**：`cd packages/brain && npx vitest run src/__tests__/openclaw-run-ingest.test.js`，预期 FAIL（模块不存在）。
- [ ] **Step 3: 实现上述五个导出**（文件头注释写清决策 c7ff6e02/9ec7a010 与判定点 b7be0e26/6d4b7ed5）。
- [ ] **Step 4: 跑测试确认通过**。
- [ ] **Step 5: Commit**（两个 commit）。

### Task 3: 采集——游标与 upsert（真 Postgres）

**Files:**
- Modify: `packages/brain/src/openclaw-run-ingest.js`
- Test: `packages/brain/src/__tests__/integration/openclaw-run-ingest.pg.integration.test.js`

**Interfaces:**
- Consumes: Task 2 的 `RunRow`。
- Produces:
  - `readCursorMs(db) => Promise<number|null>`：`SELECT max(started_at) FROM runs WHERE run_id LIKE 'openclaw:%'`，返回 `ms - 3600_000`，无行 null。
  - `upsertRuns(db, rows: RunRow[]) => Promise<{ written: number }>`：逐行 `INSERT INTO runs (run_id, workflow_id, trigger_kind, trigger_ref, schedule_entry_id, executor_kind, executor_id, started_at, ended_at, outcome, error, detail, header_source) SELECT ..., e.workflow_id, 'schedule', ..., e.id, ... 'owner' FROM (SELECT 1) one LEFT JOIN LATERAL (SELECT id, workflow_id FROM ops_schedule_entries WHERE source='openclaw' AND label=$trigger_ref ORDER BY active DESC, id LIMIT 1) e ON true ON CONFLICT (run_id) DO UPDATE SET ended_at=EXCLUDED.ended_at, outcome=EXCLUDED.outcome, error=EXCLUDED.error, detail=EXCLUDED.detail, updated_at=now() WHERE runs.outcome IS DISTINCT FROM EXCLUDED.outcome OR runs.ended_at IS DISTINCT FROM EXCLUDED.ended_at OR runs.detail IS DISTINCT FROM EXCLUDED.detail`；`written` = 受影响行数之和。

- [ ] **Step 1: 写失败测试**（BEGIN/ROLLBACK，用 `client` 作 db）：
  - 空表 `readCursorMs` → null；写入 started 为 T 的一行后 → `T-3600000`。
  - 同一批 2 行写两次：表中仍 2 行，第二次 `written===0`。
  - 先写 running（ended null），再写同 run_id 的 pass：同一行 outcome=pass、ended_at 有值、`written===1`。
  - 预置 `ops_schedule_entries(source='openclaw', label='OPC 午前班会（11:50）', kind='openclaw_cron', active=true, workflow_id=<测试流程>)`，写该任务名的行 → schedule_entry_id 与 workflow_id 对上；任务名无对应 → 两列为 null。
- [ ] **Step 2: 跑测试确认失败**：`DB_NAME=cecelia_scratch npx vitest run src/__tests__/integration/openclaw-run-ingest.pg.integration.test.js`。
- [ ] **Step 3: 实现** `readCursorMs`、`upsertRuns`。
- [ ] **Step 4: 跑测试确认通过**。
- [ ] **Step 5: Commit**（两个 commit）。

### Task 4: 连败升级 Bark

**Files:**
- Modify: `packages/brain/src/openclaw-run-ingest.js`
- Test: 追加到 `packages/brain/src/__tests__/openclaw-run-ingest.test.js`（纯函数）与 Task 3 的集成测试文件（查询）

**Interfaces:**
- Produces:
  - `findStreakStart(recent: {run_id, outcome}[]) => {firstRunId, count} | null`：`recent` 按 started_at 降序；从头连续 fail/timeout 的条数 ≥3 才返回，`firstRunId` = 这段连败里最早一条（即遇到第一条非失败前的最后一条），`count` = 连败条数。
  - `notifyFailureStreaks(db, triggerRefs: string[], { sendBark, firstRound }) => Promise<{ notified: number }>`：`firstRound` 为 true 直接返回 `{notified:0}`；否则对每个任务名查 `SELECT run_id, outcome, error, detail->>'summary' AS summary FROM runs WHERE run_id LIKE 'openclaw:%' AND trigger_ref=$1 AND outcome <> 'running' ORDER BY started_at DESC LIMIT 50`，用 `findStreakStart` 判定，命中则 `sendBark('OpenClaw 任务连续失败', \`${name} 连续 ${count} 次失败：${(最近一条 error || summary || '').slice(0,120)}\`, { dedupeKey: \`openclaw-run-streak:${name}:${firstRunId}\`, dedupeTtlSec: 604800 })`。

- [ ] **Step 1: 写失败测试**：
  - `findStreakStart`：`[fail,fail,pass]` → null；`[fail,timeout,fail]` → `{firstRunId:第3条, count:3}`；`[fail,fail,fail,fail,pass,fail]` → `{firstRunId:第4条, count:4}`。
  - `notifyFailureStreaks`（注入 `db.query` 假实现与 `sendBark` spy）：firstRound=true 不调用 sendBark；连败 3 次调用一次且 dedupeKey 与正文符合上式；连败 2 次不调用。
  - 集成：在库里写 3 条同任务名 fail 行后调用（真 db、spy sendBark）→ 调用 1 次。
- [ ] **Step 2: 跑测试确认失败**。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 跑测试确认通过**。
- [ ] **Step 5: Commit**（两个 commit）。

### Task 5: 采集任务编排 + 注册定时任务

**Files:**
- Modify: `packages/brain/src/openclaw-run-ingest.js`
- Modify: `packages/brain/src/scheduler-jobs.js`（`JOBS` 数组加一行，位置挨着 `ops-collector`）
- Test: `packages/brain/src/__tests__/openclaw-run-ingest.test.js`、`packages/brain/src/__tests__/scheduler-jobs.test.js`

**Interfaces:**
- Consumes: Task 2–4 全部导出；`defaultExecAsync`、`buildHostCmd`（`src/host-exec.js`）；`sendBark`（`src/notifier.js`）。
- Produces: `runOpenclawRunIngest(pool, deps = {}) => Promise<{ fetched, written, skipped_rows, notified, backlog: boolean }>`；`deps` 可注入 `{ exec, inContainer, sendBark, now }`，默认分别为 `defaultExecAsync`（timeoutMs 60_000）、`existsSync('/.dockerenv')`、真 `sendBark`、`Date.now`。流程：`readCursorMs` → `buildIngestSql` → `buildMmvCmd` → `buildHostCmd` → exec → `parseSqliteJson` → `mapOpenclawRow`（null 计入 `skipped_rows`）→ `upsertRuns` → 对本批 fail/timeout 行的任务名去重后 `notifyFailureStreaks`（`firstRound = cursor === null`）；`backlog = fetched === 2000`。
- JOBS 行：`{ name: 'openclaw-run-ingest', cadence: { everySec: 300 }, needsPool: true, timeoutMs: 120_000, handler: (pool) => runOpenclawRunIngest(pool), description: 'OpenClaw cron 运行记录入 runs 表（决策 c7ff6e02/9ec7a010）：ssh mmv 只读查 task_runs 增量 upsert，连败≥3 发一次 Bark' }`。

- [ ] **Step 1: 写失败测试**：
  - 注入 exec 返回两行 JSON（一行合法 fail、一行 task_id 缺失）与假 db：返回 `fetched:2, skipped_rows:1`；exec 收到的命令含 `mmv` 与 `base64 -d`；`inContainer:true` 时命令以 `ssh -i` 开头。
  - exec 抛错 → `runOpenclawRunIngest` 抛错（让调度器记 fail），且未调用 upsert。
  - 游标为 null 时 sendBark 不被调用。
  - `scheduler-jobs.test.js`：照 :309/:317 写法断言 `JOBS` 含 `openclaw-run-ingest`，`cadence.everySec===300`、`needsPool===true`。
- [ ] **Step 2: 跑测试确认失败**。
- [ ] **Step 3: 实现并注册**。
- [ ] **Step 4: 跑两个测试文件确认通过**。
- [ ] **Step 5: Commit**（两个 commit）。

### Task 6: Notion「最近执行」投影

**Files:**
- Create: `packages/brain/src/runs-notion-projection.js`
- Modify: `packages/brain/src/scheduler-jobs.js`（再加一行 JOBS）
- Test: `packages/brain/src/__tests__/runs-notion-projection.test.js`、`packages/brain/src/__tests__/integration/runs-notion-projection.pg.integration.test.js`、`scheduler-jobs.test.js`

**Interfaces:**
- Consumes: `resolveDbId`、`pushRegisteredRows`（`src/lib/notion-projection-engine.js`）；`notionReq`、`getToken`（`src/recurring-notion-sync.js`）；迁移 532 的三列。
- Produces:
  - `IN_WINDOW_SQL`（字符串常量）：`(run_id LIKE 'openclaw:%' AND (started_at >= now()-interval '7 days' OR (outcome IN ('fail','timeout') AND started_at >= now()-interval '30 days'))) OR (run_id NOT LIKE 'openclaw:%' AND outcome IN ('fail','timeout') AND started_at >= now()-interval '30 days')`。
  - `selectRowsToPush(db, limit = 100)`：窗口内且 `notion_synced_at IS NULL OR updated_at > notion_synced_at`，`ORDER BY started_at DESC LIMIT $1`，选 `id, run_id, trigger_kind, trigger_ref, executor_id, started_at, duration_ms, outcome, error, detail, notion_id, notion_digest`。
  - `selectRowsToArchive(db, limit = 100)`：`notion_id IS NOT NULL AND NOT (<窗口>)`。
  - `buildRunProps(row) => object`：列与类型按 spec「列」表：`任务`(title, trigger_ref)、`开始时间`(date, ISO)、`结果`(select：pass→成功/fail→失败/timeout→超时/running→运行中/skipped→跳过/其他→未知)、`耗时（秒）`(number, duration_ms/1000 保留 1 位，null 保持 null)、`执行者`(rich_text)、`来源`(select：`openclaw:` 前缀→OpenClaw，trigger_kind='external'→外部上报，其余→Brain)、`摘要`(rich_text, detail.summary ≤1900)、`错误`(rich_text ≤1900)、`Brain ID`(rich_text, run_id)。
  - `RUNS_DB_PROPS`：上述 9 列的 Notion 库 schema 定义（select 选项写全），供 Task 7 建库用。
  - `runRunsNotionPush(pool, deps = {}) => Promise<{ skipped?: 'db_not_registered', pushed?, archived? }>`：`resolveDbId(pool,'runs')` 为空 → 返回 `{skipped:'db_not_registered'}`，不调用 Notion；否则 `pushRegisteredRows(pool, token, { table:'runs', dbId, rows, buildProps: buildRunProps, notionReq, label:'runs' })`，再对归档行 `notionReq(token, \`/pages/${notion_id}\`, 'PATCH', { archived: true })` 后 `UPDATE runs SET notion_id=NULL, notion_digest=NULL, notion_synced_at=NULL WHERE id=$1`；404 视为已归档照样清列；其他错误停止本轮归档。
- JOBS 行：`{ name: 'runs-notion-push', cadence: { everySec: 120 }, needsPool: true, timeoutMs: 110_000, handler: (pool) => runRunsNotionPush(pool), description: '运行记录投影 Notion「最近执行」库（决策 9ec7a010）：OpenClaw 7天全量+失败30天，Brain 内部只放失败' }`。

- [ ] **Step 1: 写失败测试**：
  - unit `buildRunProps`：一个 OpenClaw fail 行与一个 Brain 内部 pass 行的完整属性对象断言（结果/来源/耗时换算/截断 1900）。
  - unit `runRunsNotionPush`：`resolveDbId` 返回 null（注入假 pool：projection_map 查询无行）→ `{skipped:'db_not_registered'}` 且 notionReq 未被调用。
  - integration：插入 6 行（OpenClaw 2 天前 pass、OpenClaw 10 天前 pass、OpenClaw 10 天前 fail、Brain 内部 1 天前 pass、Brain 内部 1 天前 fail、Brain 内部 40 天前 fail），`selectRowsToPush` 恰好返回第 1、3、5 行；给第 2 行设 notion_id 后 `selectRowsToArchive` 返回它。
  - integration：归档流程（假 notionReq 记录调用）后该行三列为 null。
  - `scheduler-jobs.test.js` 断言含 `runs-notion-push`、everySec 120。
- [ ] **Step 2: 跑测试确认失败**。
- [ ] **Step 3: 实现并注册**。
- [ ] **Step 4: 跑测试确认通过**。
- [ ] **Step 5: Commit**（两个 commit）。

### Task 7: 建库脚本 + smoke + 版本碎片

**Files:**
- Create: `packages/brain/scripts/ops/create-runs-notion-db.mjs`
- Create: `packages/brain/scripts/smoke/openclaw-run-ingest-smoke.sh`
- Modify: `packages/quality/smoke-allowlist.txt`
- Create: `changes/cp-1007231057-openclaw-runs-ingest.md`
- Test: `packages/brain/src/__tests__/create-runs-notion-db.test.js`

**Interfaces:**
- Consumes: `RUNS_DB_PROPS`（Task 6）；父页 = `projection_targets` 中目录投影配置的 `config.parent_page_id`（参照 `src/projection/directory-config.js`）。
- Produces:
  - 脚本导出 `buildCreateDbBody(parentPageId) => object`（`{ parent:{page_id}, title:[{text:{content:'最近执行'}}], properties: RUNS_DB_PROPS }`），`main()` 仅在直接执行时运行：默认 dry-run 打印将建的库；`--apply` 时 POST `/databases`，再 `UPDATE notion_projection_map SET notion_db_id=$1, direction='push', status='active', title='最近执行' WHERE brain_table='runs'`。已存在 active 行则拒绝重复建库并退出码 1。
  - smoke：只读。照 `scripts/smoke/alarm-ledger-smoke.sh` 头部的 production guard 写法；`psql` 查 `SELECT count(*) FROM runs WHERE run_id LIKE 'openclaw:%' AND trigger_ref IS NOT NULL AND started_at IS NOT NULL`，在生产/真环境期望 >0；CI 空库下以「表与列存在」为通过条件（查 information_schema）。
  - 碎片：`## Brain {VERSION} — OpenClaw 运行记录入 runs 表 + Notion 最近执行库` 加 3-4 条要点（格式照 `changes/README.md`）。

- [ ] **Step 1: 写失败测试**：`buildCreateDbBody('abc')` 的 parent、标题「最近执行」、properties 等于 `RUNS_DB_PROPS`。
- [ ] **Step 2: 跑测试确认失败**。
- [ ] **Step 3: 实现脚本、smoke、allowlist 登记、碎片**；`bash -n` 检查 smoke 语法。
- [ ] **Step 4: 跑测试与 `bash packages/quality/scripts/run-smoke-ratchet.sh`（若本地可跑）确认通过**。
- [ ] **Step 5: Commit**（两个 commit）。
