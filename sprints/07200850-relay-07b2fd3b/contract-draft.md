# Contract Draft — Inbox P1主干

**TASK_ID**: 07b2fd3b-724b-4da3-bdf3-827821b66ba5
**Sprint**: sprints/07200850-relay-07b2fd3b
**日期**: 2026-07-20
**版本**: v1.0（首轮，无 reviewer feedback）

---

## 范围概述

本合同覆盖 Inbox P1主干的十项功能需求（FR-1 到 FR-10），包括：数据库 schema 扩展、统一进箱端点、capture-inbox 改道、两条死胡同封堵、账龄哨兵 job、Dashboard /inbox 页、confirm/retry 接口扩展、积压清零。

---

## 功能边界（System-Under-Test）

| 模块 | 文件 | 变更类型 |
|------|------|----------|
| DB Migration P1 | `packages/brain/migrations/354_inbox_p1_schema.sql` | 新建 |
| 积压清零 Migration | `packages/brain/migrations/355_backlog_pending_review_migrate.sql` | 新建 |
| 统一进箱端点 | `packages/brain/src/routes/captures.js` | 新建 |
| capture-inbox 改道 | `packages/brain/src/capture-inbox.js` | 修改 |
| handoff.js 改调用 | `packages/brain/src/handoff.js` | 修改 |
| learning.js 改调用 | `packages/brain/src/learning.js` | 修改 |
| ledger-hygiene.js 改调用 | `packages/brain/src/ledger-hygiene.js` | 修改 |
| postdeploy-verifier.js 改调用 | `packages/brain/src/postdeploy-verifier.js` | 修改 |
| tasks.js 改调用 | `packages/brain/src/routes/tasks.js` | 修改 |
| capture-triage urgent 封堵 | `packages/brain/src/capture-triage.js` | 修改 |
| capture-triage okr 封堵 | `packages/brain/src/capture-triage.js` | 修改 |
| 账龄哨兵 job | `packages/brain/src/capture-aging.js` | 新建 |
| scheduler-jobs 注册 | `packages/brain/src/scheduler-jobs.js` | 修改 |
| confirm/retry 接口 | `packages/brain/src/routes/capture-atoms.js` | 修改 |
| Dashboard inbox 页 | `apps/dashboard/src/pages/inbox/index.tsx` | 新建 |
| Dashboard 路由注册 | `apps/dashboard/src/App.tsx` | 修改 |

---

## 不变量（Invariants）

1. **进箱永不抛异常**：`pushCapture` 写入失败必须 catch + console.warn，绝不影响 handoff/learning/issue 主流程。
2. **dedupe_key 幂等**：相同 dedupe_key 的 capture INSERT 走 `ON CONFLICT (dedupe_key) DO NOTHING`，命中时返回原有记录 id（HTTP 200），不产生重复行。
3. **信封字段焊死**：nature/repo/lane/ref_task_id/ref_journey_id/dedupe_key 在 INSERT 写入后，只允许通过 confirm 接口（action='reroute'）修改，禁止 triage job 覆写。
4. **状态机单向流转**：captures 状态链 `captured→clarified→done/dropped` 由 DB CHECK 约束保证不可逆转；capture_atoms 状态链 `pending→enriched→routed/dropped/parked` 同理。
5. **积压清零不删数据**：所有 pending_review 积压必须路由到 routed 或 parked，禁止 DELETE/TRUNCATE。
6. **retry_count 上限**：llm_failed atom 自动重试 ≤3 次（retry_count 计数），第4次起转 parked。
7. **旁路封死**：所有调用方（handoff/learning/ledger-hygiene/postdeploy-verifier/tasks.js）改造后只能走 pushCapture，旧 pushCaptureAtom 标记 @deprecated。
8. **captures 四路骨架不破**：capture-triage.js 的四路分诊骨架（urgent/line_backlog/invariant/okr）和 invariant 路事务模式不得破坏，本 PR 只替换 urgent 和 okr 两路的终态动作。

---

## E2E 验收

### E2E-1：新 learning 链路可见（关键路径）

**前置条件**：Brain 服务运行在 localhost:5221，Dashboard 运行在 localhost:5174。

**步骤**：
1. 调用 `POST /api/brain/captures`，body `{ content: "E2E测试-learning-$(date +%s)", source: "learning", nature: "learning", dedupe_key: "e2e-learning-$(date +%s)" }`。
2. 等待响应，断言 HTTP 200，body 包含 `{ status: "clarified", dedupe_hit: false }`。
3. 调用 `GET /api/brain/captures?nature=learning`，断言返回列表中存在该条目，status=clarified。
4. mac_web Playwright 打开 `http://localhost:5174/inbox`：
   - 断言页面出现漏斗计数条（含 `clarified` 数字标签）。
   - 断言列表区域至少渲染1行数据。
   - 截图保存为 `sprints/07200850-relay-07b2fd3b/e2e-inbox-screenshot.png`。

**验收标准**：HTTP 200 + clarified 状态 + Dashboard 截图漏斗可见 + 列表不为空。

### E2E-2：urgent 路由产生真实 task

**步骤**：
1. 直接 SQL 插入 capture_atoms：`INSERT INTO capture_atoms (content, target_type, target_subtype, status) VALUES ('E2E紧急问题测试', 'issue', 'P0', 'pending_review')`。
2. 等待 capture-triage job 执行（或手动调用 `runCaptureTriage(pool)`）。
3. 查询：`SELECT id, title, source FROM tasks WHERE source='capture-triage' ORDER BY created_at DESC LIMIT 1`。
4. 查询 capture_atoms，断言该条 status='routed'，routed_to_table='tasks'。
5. 检查日志中出现 Bark 告警日志（`console.log` 含 `[bark]` 或 `[capture-triage:urgent]`）。

**验收标准**：tasks 表有新记录（source=capture-triage）+ atom status=routed + Bark 日志存在。

### E2E-3：积压清零

**步骤**：
1. 执行 migration `355_backlog_pending_review_migrate.sql`。
2. 查询：`SELECT count(*) FROM capture_atoms WHERE status='pending_review'`。

**验收标准**：count 结果为 0。

### E2E-4：账龄告警触发

**步骤**：
1. 插入测试记录：`INSERT INTO captures (content, source, status, created_at) VALUES ('测试过期条目', 'api', 'captured', now() - interval '8 days')`。
2. 调用 `runCaptureAging(pool)`（mock feishu webhook，验证 sendFeishu 被调用）。
3. 检查日志：`[capture-aging] overdue_captures=N`（N≥1）。

**验收标准**：sendFeishu mock 被调用1次以上 + 日志中 overdue_captures≥1。

### E2E-5：dedupe_key 幂等

**步骤**：
1. 第一次 POST `/api/brain/captures` with `dedupe_key: "dup-test-fixed"`，得到 id1。
2. 第二次相同 body 再 POST，断言返回 HTTP 200，id 与 id1 相同，`dedupe_hit: true`。
3. 查询 `SELECT count(*) FROM captures WHERE dedupe_key='dup-test-fixed'`，断言 count=1。

**验收标准**：两次 POST 均 200 + 第二次 dedupe_hit=true + DB 无重复行。

---

## 性能验收

- `POST /api/brain/captures` 响应时间 ≤200ms（单条，无 LLM，本地 DB）。
- 验证方法：`time curl -X POST http://localhost:5221/api/brain/captures -H 'Content-Type: application/json' -d '{"content":"perf-test","source":"api"}'`。

---

## 回滚标准

- Migration 354 失败 → 回滚 SQL（DROP/ALTER 撤销），Brain 重启继续使用旧 capture_atoms 链路。
- Migration 355 失败 → 积压数据不受影响，保持 pending_review 状态。
- 新端点 routes/captures.js 失败 → 不影响旧 pushCaptureAtom 链路（两套并存期间）。
