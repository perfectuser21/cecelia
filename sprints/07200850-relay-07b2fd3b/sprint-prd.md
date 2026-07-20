# Sprint PRD — Inbox P1主干：统一进箱+状态机+Dashboard收件箱页+账龄哨兵+积压清零

- **TASK_ID**: 07b2fd3b-724b-4da3-bdf3-827821b66ba5
- **SPRINT_DIR**: sprints/07200850-relay-07b2fd3b
- **日期**: 2026-07-20
- **Spec**: docs/superpowers/specs/2026-07-19-inbox-unified-capture-design.md §4-§7
- **决策锚点**: decisions a823206d（轨道C退役、轨道A升格）

---

## Invariant 约束

1. **进箱永不抛异常**：`pushCapture` 写入失败必须 catch + console.warn，绝不影响 handoff/learning/issue 主流程。
2. **dedupe_key 幂等**：相同 dedupe_key 的 capture INSERT 走 ON CONFLICT DO NOTHING，不产生重复行。
3. **信封一进箱就焊死**：nature/repo/lane/ref_task_id/ref_journey_id/dedupe_key 在 INSERT 时写入，之后只允许通过 confirm 接口（人工改判）修改，不允许 triage job 覆写。
4. **状态机单向流转**：captures 只允许 `captured→clarified→done/dropped`，capture_atoms 只允许 `pending→enriched→routed/dropped/parked`，禁止逆转（DB check constraint 保证）。
5. **保留 capture-triage 骨架与 invariant 路**：四路分诊骨架（urgent/line_backlog/invariant/okr）+ invariant 路事务模式（BEGIN/COMMIT + reason 内嵌 atom:id）不得破坏；本 PR 只替换 urgent 和 okr 两路的终态动作。
6. **parked 不是黑洞**：parked 条目必须在 Dashboard /inbox 漏斗中可见、可改判；parked 设置之日起 7 天未被处理触发飞书告警（account_aging job 负责）。
7. **retry_count 上限**：llm_failed 状态 atom 自动重试 ≤3 次（retry_count 计数），第4次起转 parked，不再自动重试。
8. **积压清零不删数据**：32 条 pending_review 积压必须路由到 routed 或 parked，不允许直接 DELETE 或 TRUNCATE。
9. **直写 atoms 旁路封死**：capture-inbox.js 改造后，外部调用者（handoff.js/learning.js/ledger-hygiene.js/postdeploy-verifier.js/routes/tasks.js）必须全部改为调用 pushCapture 走 captures 表，旧 pushCaptureAtom 函数标记 @deprecated 或删除。
10. **E2E 走 mac_web**：Dashboard /inbox 页验收必须用 mac_web（本机 Playwright，localhost:5174），不走 windows_cloud runner。

---

## 累积 FR（功能需求）

### FR-1：Migration — captures 信封字段 + 状态机 + capture_atoms 扩展

**文件**：`packages/brain/migrations/354_inbox_p1_schema.sql`

- `ALTER TABLE captures ADD COLUMN IF NOT EXISTS nature VARCHAR(50)`（learning/issue/handoff/manual，NULL=自由输入待定性）
- `ALTER TABLE captures ADD COLUMN IF NOT EXISTS repo VARCHAR(100)`
- `ALTER TABLE captures ADD COLUMN IF NOT EXISTS lane VARCHAR(100)`
- `ALTER TABLE captures ADD COLUMN IF NOT EXISTS ref_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL`
- `ALTER TABLE captures ADD COLUMN IF NOT EXISTS ref_journey_id UUID`
- `ALTER TABLE captures ADD COLUMN IF NOT EXISTS ref_pr_url TEXT`
- `ALTER TABLE captures ADD COLUMN IF NOT EXISTS dedupe_key VARCHAR(255) UNIQUE`
- `ALTER TABLE captures ADD CONSTRAINT captures_status_check CHECK (status IN ('captured','clarified','done','dropped'))`
- 存量数据迁移：`UPDATE captures SET status='captured' WHERE status IN ('inbox','processing')`，`UPDATE captures SET status='done' WHERE status='archived'`（archived 历史数据映射到 done）
- `ALTER TABLE capture_atoms ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0`
- `ALTER TABLE capture_atoms ADD CONSTRAINT capture_atoms_status_check CHECK (status IN ('pending','enriched','routed','dropped','parked','pending_review','confirmed','dismissed','llm_failed'))`
- 存量 pending_review 保留：状态约束新增 pending_review 兼容值（不破坏现有积压）
- 必要索引：`idx_captures_nature`、`idx_captures_dedupe_key`、`idx_capture_atoms_retry_count`

### FR-2：统一进箱端点 POST /api/brain/captures

**文件**：`packages/brain/src/routes/captures.js`（新建）

- 路由注册到 `packages/brain/src/routes.js`
- 请求体：`{ content, source, nature?, repo?, lane?, ref_task_id?, ref_journey_id?, ref_pr_url?, dedupe_key? }`
- 信封校验：content 必填（非空字符串），source 必填（枚举：handoff/learning/issue/dashboard/api/feishu），其余可选
- dedupe_key 幂等：`INSERT ... ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`；若命中去重返回已有记录的 id（HTTP 200，不是 409）
- 出身已知（nature 非空）→ status=clarified 直接写入；nature 为空 → status=captured
- 成功返回 `{ id, status, dedupe_hit: bool }`
- `GET /api/brain/captures`：列表+计数，支持 `?stage=&nature=&lane=&aging=&limit=&offset=` 查询参数；返回 `{ items: [...], total, counts: {captured,clarified,routed,parked,dropped} }`
- `GET /api/brain/captures/:id`：详情，含 atoms 数组（LEFT JOIN）+ 路由回链（routed_to_table/routed_to_id）

### FR-3：capture-inbox.js 改造 — pushCaptureAtom 改道

**文件**：`packages/brain/src/capture-inbox.js`

- 新增 `pushCapture(pool, { content, source, nature, repo, lane, ref_task_id, ref_journey_id, ref_pr_url, dedupe_key })`：写 captures 表，出身已知直接 clarified，失败 catch+warn 不抛
- 旧 `pushCaptureAtom` 改为调用 pushCapture 的薄包装（保留签名兼容性，内部改道），加 `@deprecated` JSDoc
- 调用方全部改用 pushCapture（需修改文件）：
  - `packages/brain/src/handoff.js`：pushCaptureAtom → pushCapture，补 nature='handoff'、ref_task_id
  - `packages/brain/src/learning.js`：pushCaptureAtom → pushCapture，补 nature='learning'、ref_task_id
  - `packages/brain/src/ledger-hygiene.js`：pushCaptureAtom → pushCapture，补 nature='issue'
  - `packages/brain/src/postdeploy-verifier.js`：pushCaptureAtom → pushCapture，补 nature='issue'
  - `packages/brain/src/routes/tasks.js`：pushCaptureAtom → pushCapture，补 nature 推断逻辑

### FR-4：封死 urgent 死胡同 — 创建真实 task + Bark 告警

**文件**：`packages/brain/src/capture-triage.js`（修改）

- urgent 路由（原 capture-triage.js:147-148）改为：
  1. `INSERT INTO tasks (title, priority, status, source, description) VALUES (..., 'P1', 'pending', 'capture-triage', ...)` 创建真实任务
  2. 调用 `notifier.js` 中的 `sendBark` 推送告警（标题："紧急捕获已建任务"，内含 atom content 前80字符）
  3. `UPDATE capture_atoms SET status='routed', routed_to_table='tasks', routed_to_id=<new_task_id>`
- urgent 路由执行在事务内（BEGIN/COMMIT）

### FR-5：封死 okr 死胡同 — 写 notes 表

**文件**：`packages/brain/src/capture-triage.js`（修改）

- okr 路由（原 capture-triage.js:223-224）改为：
  1. `INSERT INTO notes (content, type, source_ref) VALUES (..., 'strategic_input', 'capture_atom:<atom_id>')` 
  2. `UPDATE capture_atoms SET status='routed', routed_to_table='notes', routed_to_id=<new_note_id>`
- 执行在事务内

### FR-6：新 job capture-aging.js + 注册 scheduler-jobs

**文件**：`packages/brain/src/capture-aging.js`（新建）

- 自带 10min interval gate（sentinel key: `capture_aging_last_run`）
- **账龄巡检**：查询 captures 表 `status NOT IN ('done','dropped')` 且 `created_at < now() - interval '7 days'`，计数暴露（console.log `[capture-aging] overdue_captures=N`）+ 飞书告警（sendFeishu）
- **同理巡检** capture_atoms：`status NOT IN ('routed','dropped')` 且 `created_at < now() - interval '7 days'`，飞书告警
- **llm_failed 重试**：查 capture_atoms `status='llm_failed' AND retry_count < 3`，对每条调用 capture-triage 的单 atom 重跑逻辑，成功后清 llm_failed 状态；失败则 `UPDATE ... SET retry_count = retry_count + 1, status = CASE WHEN retry_count + 1 >= 3 THEN 'parked' ELSE 'llm_failed' END`
- **注册**：`packages/brain/src/scheduler-jobs.js` 新增 `{ name: 'capture-aging', needsPool: true, handler: runCaptureAging, description: '账龄哨兵+llm_failed重试（10min gate，超7天告警，重试≤3次超限转parked）' }`

### FR-7：Dashboard /inbox 页（新路由）

**文件**：`apps/dashboard/src/pages/inbox/`（新建目录）

- `index.tsx`：收件箱主页，路由 `/inbox`，注册到 `apps/dashboard/src/App.tsx`
- **漏斗计数条**：横向展示 captured / clarified / routed / parked / dropped 各状态数量；点击任意状态段 → 列表筛选下钻
- **列表视图**：展示 captures 列表，列：内容摘要（前60字）、nature、source、状态、账龄（天数）；账龄超7天行标红；支持筛选（状态/nature/lane/账龄是否超期）；分页（每页20条）
- **详情抽屉**：点击列表行展开右侧抽屉；展示信封元数据（nature/source/repo/lane/refs）、拆出的 atoms 列表（各含 status/target_type/ai_reason/置信度）、路由回链（routed_to_table/routed_to_id，可点击跳转）
- **parked 改判交互**：parked 状态 atom 显示操作按钮：改 nature（下拉选 learning/issue/handoff/decision/reference）/ 手动路由（下拉选目标表）/ drop；调用 `PATCH /api/brain/capture-atoms/:id/confirm` 接口

### FR-8：PATCH capture-atoms/:id/confirm 接口扩展

**文件**：`packages/brain/src/routes/capture-atoms.js`（修改）

- 现有 confirm 接口扩展：接受 `{ action: 'reroute'|'drop', nature?, target_table?, target_id? }`
- `action='reroute'`：更新 nature（若提供）、设 status='routed'、写 routed_to_table/routed_to_id、INSERT INTO capture_corrections (atom_id, original_nature, corrected_nature, corrected_route, actor='human')
- `action='drop'`：设 status='dropped'，写 capture_corrections
- capture_corrections 表（若不存在则 migration 创建）：记录每次人工纠正，字段：id/atom_id/original_nature/corrected_nature/corrected_route/actor/created_at

### FR-9：POST /api/brain/capture-atoms/:id/retry 接口

**文件**：`packages/brain/src/routes/capture-atoms.js`（修改）

- 检查 atom status 为 llm_failed 或 parked（parked 也可手动触发重试）
- 调用 capture-triage 单条重跑逻辑（需从 capture-triage.js 中提取 `triageAtom(pool, atom)` 函数供复用）
- 更新 retry_count + 1，返回新状态

### FR-10：积压 32 条 pending_review 清零

**文件**：`packages/brain/migrations/355_backlog_pending_review_migrate.sql` 或 `packages/brain/src/migrations/` 下的一次性迁移脚本

- 执行逻辑（在迁移中 DO $$ ... $$ 块内）：
  1. 查 capture_atoms WHERE status='pending_review'
  2. target_type='line_backlog' 或 confidence>0.6 → UPDATE status='routed'（已有足够信息，视为已路由，保留 routed_to_table/routed_to_id 原值）
  3. ai_reason LIKE '%no_journey%' OR ai_reason LIKE '%low_confidence%' OR confidence<0.5 → UPDATE status='parked'（转人工队列）
  4. 其余 → UPDATE status='parked'（兜底，宁可进人工队列也不乱路由）
  5. migration 末尾 SELECT count(*) WHERE status='pending_review' 验证结果为 0

---

## NFR（非功能需求）

- **延迟**：POST /api/brain/captures 响应 ≤200ms（仅 DB INSERT，无 LLM 调用）
- **幂等**：相同 dedupe_key 的重复 POST 不产生重复数据，返回原 id
- **非阻塞**：pushCapture 失败不影响 handoff/learning/issue 主流程（fail-open）
- **向后兼容**：旧 pushCaptureAtom 调用方改造后，capture_atoms 表仍可查询到原有数据（atoms 通过 captures 表关联生成）
- **CI**：改动触发 brain-ci.yml（packages/brain 改动）+ workspace-ci.yml（apps/dashboard 改动）
- **测试**：
  - `packages/brain/src/routes/capture-atoms.test.js`：新增 confirm reroute + retry 接口单测
  - `packages/brain/src/__tests__/capture-aging.test.js`：新建 job 单测（mock DB，验证 overdue 告警 + retry 上限逻辑）
  - Dashboard E2E（mac_web Playwright）：截图验证 /inbox 漏斗渲染、列表显示、parked 改判交互

---

## Final E2E 验收标准

1. **新 learning 链路可见**：触发一条 learning 写入后，5 分钟内：
   - `GET /api/brain/captures` 中出现该条记录（status=clarified，nature=learning）
   - Dashboard `/inbox` 页漏斗 clarified 计数 +1
   - mac_web Playwright 截图验证 /inbox 页正常渲染（漏斗条 + 列表至少1条）
2. **urgent 产生真实 task**：capture_atoms 中 target_type='urgent' 路由后，`SELECT * FROM tasks WHERE source='capture-triage' ORDER BY created_at DESC LIMIT 1` 有新记录；Bark 推送日志出现（console.log 或回执表）
3. **积压清零**：`SELECT count(*) FROM capture_atoms WHERE status='pending_review'` 结果为 0
4. **账龄告警可触发**：capture-aging job 对手动插入的超7天测试记录产生飞书告警日志（integration test 用 mock feishu webhook）

---

## 实现顺序建议

1. FR-1（migration）→ FR-2（routes/captures.js）→ FR-3（capture-inbox 改道）→ FR-4/FR-5（封死胡同）→ FR-6（aging job）→ FR-8/FR-9（confirm/retry 扩展）→ FR-10（积压清零）→ FR-7（Dashboard）→ E2E

---

journey_type: vibe_coding
target_environment: mac_web
