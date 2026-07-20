# Inbox P0 清场实现计划（退役 conversation-digest 与 capture-digestion）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除两条从未产生价值的死链路（conversation-digest 四个月零成功写入、capture-digestion 形同虚设），DROP 两张废表，为 inbox 统一捕获系统主干腾地。

**Architecture:** 纯删除性改动：解除调度接线（scheduler-jobs/tick-runner/consciousness-guard）→ 删模块文件与路由 → migration 353 DROP 两表 → 版本 bump。保留 captures/capture_atoms 表与 capture-inbox/capture-triage 模块（未来主干）。

**Tech Stack:** Node.js ESM / vitest / PostgreSQL migration / DevGate（facts-check + check-version-sync + check-dod-mapping）

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-19-inbox-unified-capture-design.md` §7 P0 行；PrepPRD: `sprints/07192355-inbox-p0-cleanup/prep-prd.md`
- **明确不动**：`captures` 表、`capture_atoms` 表、`capture-inbox.js`、`capture-triage.js`、`conversation-consolidator.js`（Stop Hook 写 memory_stream 的活模块）、`pending-conversations.js`
- 本地 migrate 验证一律 `DB_NAME=cecelia_scratch`（死规矩，禁碰生产 cecelia 库）
- TDD commit 顺序：commit-1 改测试（红）→ commit-2 改实现（绿）
- 全部工作在 worktree `cp-07192355-inbox-p0-cleanup` 分支内

---

### Task 1: 解除调度接线（测试先行）

**Files:**
- Modify: `packages/brain/src/scheduler-jobs.js:13-14,45-46`
- Modify: `packages/brain/src/tick-runner.js:64-65,1573-1581`
- Modify: `packages/brain/src/consciousness-guard.js:7-8`
- Test: `packages/brain/src/__tests__/scheduler-jobs.test.js:10-13,85-86,108`
- Test: `packages/brain/src/__tests__/consciousness-guard.test.js:51-52`
- Test: `packages/brain/src/__tests__/integration/consciousness-tick-runtime.integration.test.js:27-28`
- Test: `packages/brain/src/__tests__/integration/tick-runner-full-tick.integration.test.js:189-190`
- Test: `packages/brain/src/__tests__/tick-consciousness-guard.test.js`（如有两 job 名引用则同步删）

**Interfaces:**
- Produces: scheduler-jobs KNOWN job 列表不再含 `conversation-digest`/`capture-digestion`；consciousness-guard 白名单同步缩减。后续 Task 2 依赖本 task 已解除全部 import。

- [ ] **Step 1: 改测试断言（失败测试先行）**

`scheduler-jobs.test.js`：
- 删除第 10-13 行两个 `vi.mock('../conversation-digest.js',...)` 与 `vi.mock('../capture-digestion.js',...)` 块
- 删除第 85-86 行两个 import
- 第 108 行 job 名单数组中删去 `'conversation-digest', 'capture-digestion'` 两项

`consciousness-guard.test.js` 第 51-52 行白名单数组中删去 `'conversation-digest'`、`'capture-digestion'`（保留 `'conversation-consolidator'` 等其余项）。

两个 integration test 删去对应 `vi.mock('../../conversation-digest.js',...)` 和 `vi.mock('../../capture-digestion.js',...)` 行。

`tick-consciousness-guard.test.js` 中 grep 两 job 名，有则删对应数组项。

- [ ] **Step 2: 跑测试确认红**

Run: `cd packages/brain && npx vitest run src/__tests__/scheduler-jobs.test.js src/__tests__/consciousness-guard.test.js 2>&1 | tail -20`
Expected: FAIL（实现里 job 列表仍含两名，与断言不符）

- [ ] **Step 3: commit-1（红测试）**

```bash
git add packages/brain/src/__tests__/
git commit -m "test(brain): 断言调度表不再含conversation-digest与capture-digestion [red]"
```

- [ ] **Step 4: 改实现**

`scheduler-jobs.js`：删第 13-14 行 import；删第 45-46 行两个 job 条目。
`tick-runner.js`：删第 64-65 行 import；删 1573-1581 附近两段 `Promise.resolve().then(() => runConversationDigest())...` 与 `Promise.resolve().then(() => runCaptureDigestion())...`（连同各自的注释块，含 DEPRECATED 注释）。
`consciousness-guard.js`：第 7-8 行白名单删去 `'conversation-digest'`、`'capture-digestion'` 两项（保留 `'conversation-consolidator'`）。

- [ ] **Step 5: 跑测试确认绿**

Run: `cd packages/brain && npx vitest run src/__tests__/scheduler-jobs.test.js src/__tests__/consciousness-guard.test.js src/__tests__/tick-consciousness-guard.test.js src/__tests__/integration/ 2>&1 | tail -10`
Expected: PASS 全绿

- [ ] **Step 6: commit-2（绿实现）**

```bash
git add packages/brain/src/scheduler-jobs.js packages/brain/src/tick-runner.js packages/brain/src/consciousness-guard.js
git commit -m "fix(brain): 解除conversation-digest与capture-digestion调度接线"
```

### Task 2: 删除模块文件与路由

**Files:**
- Delete: `packages/brain/src/conversation-digest.js`
- Delete: `packages/brain/src/capture-digestion.js`
- Delete: `packages/brain/src/routes/conversation-captures.js`
- Delete: `packages/brain/src/__tests__/conversation-digest.test.js`
- Modify: `packages/brain/server.js:58,336`

**Interfaces:**
- Consumes: Task 1 已解除全部调度 import（否则删文件即断链）
- Produces: repo 内两模块零残留引用；Task 3 的 migration 才能安全 DROP 表

- [ ] **Step 1: 删文件与挂载**

```bash
git rm packages/brain/src/conversation-digest.js packages/brain/src/capture-digestion.js packages/brain/src/routes/conversation-captures.js packages/brain/src/__tests__/conversation-digest.test.js
```

`server.js`：删第 58 行 `import conversationCapturesRoutes from './src/routes/conversation-captures.js';` 与第 336 行 `app.use('/api/brain/conversation-captures', conversationCapturesRoutes);`

- [ ] **Step 2: 零残留验证**

Run: `grep -rn "conversation-digest\|runConversationDigest\|capture-digestion\|runCaptureDigestion\|conversation-captures" packages/ apps/ scripts/ --include="*.js" --include="*.cjs" | grep -v node_modules | grep -v "conversation-consolidator"`
Expected: 空输出（migration SQL 文件中的表名引用除外——历史 migration 194/196 不改）

Run: `node --check packages/brain/server.js && cd packages/brain && npx vitest run 2>&1 | tail -5`
Expected: 语法通过 + 全量测试绿

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "fix(brain): 删除conversation-digest/capture-digestion模块与conversation-captures路由"
```

### Task 3: Migration 353 DROP 两表 + selfcheck 同步

**Files:**
- Create: `packages/brain/migrations/353_drop_conversation_capture_tables.sql`
- Modify: `packages/brain/src/selfcheck.js:28`

**Interfaces:**
- Consumes: Task 2 已确认代码零引用
- Produces: schema_version=353；部署后 Brain 启动 selfcheck 以 `EXPECTED_SCHEMA_VERSION='353'` 校验（环境接缝守卫，已有机制）

- [ ] **Step 1: 写 migration（FK 顺序：先 cursors 后 captures）**

```sql
-- Migration 353: DROP conversation_captures + conversation_log_cursors
-- 决策锚点 decisions a823206d（2026-07-19 Alex 拍板，spec: docs/superpowers/specs/2026-07-19-inbox-unified-capture-design.md P0）
-- conversation-digest 链路 4 个月零成功写入：conversation_captures 全库 0 行（无任何写入方/消费方），
-- conversation_log_cursors 118,294 行全是过期文件路径指针（59,325 pending / 58,969 error），无留存价值。
-- cursors 有 FK 引用 captures，先删 cursors。

DROP TABLE IF EXISTS conversation_log_cursors;
DROP TABLE IF EXISTS conversation_captures;
```

- [ ] **Step 2: selfcheck bump**

`selfcheck.js` 第 28 行：`export const EXPECTED_SCHEMA_VERSION = '352';` → `'353'`

- [ ] **Step 3: scratch 库验证 migration**

Run: `cd packages/brain && DB_NAME=cecelia_scratch node scripts/migrate.js 2>&1 | tail -5`（migrate 入口以 package.json scripts 实际命令为准，先 `cat package.json | grep -A2 migrate` 确认）
Expected: 353 执行成功；`psql -h localhost -U postgres -d cecelia_scratch -c "\dt conversation*"` 返回 0 张表

- [ ] **Step 4: Commit**

```bash
git add packages/brain/migrations/353_drop_conversation_capture_tables.sql packages/brain/src/selfcheck.js
git commit -m "fix(brain): migration 353 DROP conversation_captures/conversation_log_cursors + selfcheck bump"
```

### Task 4: 版本 bump + DevGate 三闸 + 全量验证

**Files:**
- Modify: `packages/brain/package.json:47`（1.267.17 → 1.267.18）
- Modify: `packages/brain/package-lock.json`（两处 version 字段：顶层 `version` + `packages[""].version`）

**Interfaces:**
- Consumes: Task 1-3 全部完成
- Produces: 可 push 的完整分支；CI（brain-ci.yml）预期全绿

- [ ] **Step 1: 版本 bump**

`package.json` `"version": "1.267.18"`；`package-lock.json` 顶层与 `packages[""]` 两处同步 1.267.18。

- [ ] **Step 2: DevGate 三闸（Brain 改动强制门禁）**

Run（repo 根）:
```bash
node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs
```
Expected: 三条全 PASS

- [ ] **Step 3: 全量测试**

Run: `cd packages/brain && npx vitest run 2>&1 | tail -5`
Expected: 全绿

- [ ] **Step 4: Commit**

```bash
git add packages/brain/package.json packages/brain/package-lock.json
git commit -m "chore(brain): bump 1.267.18"
```

## DoD（push 前必须全 [x]）

- [ ] [BEHAVIOR] Test `packages/brain/src/__tests__/scheduler-jobs.test.js` — job 名单断言不含两退役 job（proven-to-fire：Task 1 Step 2 亲眼见红）
- [ ] [BEHAVIOR] manual: `node -e "const s=require('fs').readFileSync('packages/brain/src/scheduler-jobs.js','utf8'); if(/conversation-digest|capture-digestion/.test(s)) process.exit(1)"` — 调度表零残留
- [ ] [BEHAVIOR] manual: `node -e "const s=require('fs').readFileSync('packages/brain/src/selfcheck.js','utf8'); if(!s.includes(\"'353'\")) process.exit(1)"` — schema 版本已 bump
- [ ] migration 在 cecelia_scratch 验证通过
- [ ] DevGate 三闸 PASS；CI 全绿
