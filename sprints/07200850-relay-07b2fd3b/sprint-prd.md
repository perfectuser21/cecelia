# Sprint PRD — Inbox P1主干
## 元信息
- **task_id**: 07b2fd3b-724b-4da3-bdf3-827821b66ba5
- **sprint_dir**: sprints/07200850-relay-07b2fd3b
- **journey_type**: harness_initiative
- **target_environment**: mac_web
- **base_repo**: https://github.com/perfectuser21/cecelia.git
- **生成时间**: 2026-07-20
- **spec**: docs/superpowers/specs/2026-07-19-inbox-unified-capture-design.md §4-§7 P1行

---

## 前置确认（P0已完成）

PR#4126 已合入 main，已完成：
- `conversation-digest.js` + `capture-digestion.js` 已删除
- migration 353 已执行：`conversation_captures` / `conversation_log_cursors` 两表已 DROP
- tick 日志无两 job 残影

**本 sprint 只交付 P1，不碰 P0 已退役内容。**

---

## Invariants（铁律约束）

以下铁律来自三源（DEFINITION.md / decisions 表 invariant / learnings），**写代码前必须满足**：

| # | 来源 | 铁律 |
|---|---|---|
| I-1 | decisions a823206d | captures 表是 L0 唯一入口；轨道 A/C 退役，captures 升格为新主干 |
| I-2 | decisions 1bd4e034 | 新增后台 job 必须同时声明消费方——无下游消费方的落库 job 不允许上线 |
| I-3 | decisions 1676385f | 建新表/复用表前先 grep 全部写入方，跨模块共享表必须 schema 对齐评审 |
| I-4 | decisions 42a4d7c3 | catch 吞错的后台 job 必须带失败计数指标（账龄哨兵覆盖此条） |
| I-5 | decisions ea7d9c3e | 退役判断依据数据不靠记忆：必须查生产库实锤 |
| I-6 | DEFINITION.md §骨干 | 派生回链强制写 routed_to_table/routed_to_id；事务内原子提交，失败 ROLLBACK |
| I-7 | capture-triage.js 现有实现 | invariant 路必须过 invariant-gate 四查才写 decisions；事务内 atom+decision 同步 |
| I-8 | 决策 a823206d + spec §5 | 每条路由必须有真实消费者，禁止只标 confirmed 无任何下游动作（当前 urgent/okr 死胡同封死） |
| I-9 | spec §3 | Dropped 是合法终态；parked 是人工队列入口（不是黑洞） |
| I-10 | DEFINITION.md §保护系统 | 生产环境护栏（PRODUCTION_SENSITIVE_PATTERN）保留不动 |

**invariant 数: 10**

---

## 功能需求（FR）

### FR-1：DB Migration — captures 信封字段扩展
**文件**: `packages/brain/migrations/354_captures_envelope_fields.sql`

captures 表新增字段：
```sql
ALTER TABLE captures ADD COLUMN IF NOT EXISTS nature VARCHAR(50);       -- learning/issue/handoff 或 NULL(自由输入)
ALTER TABLE captures ADD COLUMN IF NOT EXISTS repo VARCHAR(100);
ALTER TABLE captures ADD COLUMN IF NOT EXISTS lane VARCHAR(100);
ALTER TABLE captures ADD COLUMN IF NOT EXISTS ref_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL;
ALTER TABLE captures ADD COLUMN IF NOT EXISTS ref_journey_id UUID REFERENCES journeys(id) ON DELETE SET NULL;
ALTER TABLE captures ADD COLUMN IF NOT EXISTS ref_pr_url TEXT;
ALTER TABLE captures ADD COLUMN IF NOT EXISTS dedupe_key VARCHAR(255) UNIQUE;  -- 幂等锚
```

status 语义迁移：
```sql
-- 新状态集：captured → clarified → done/dropped
-- 旧状态（inbox/processing/done/archived）映射：
--   inbox → captured，processing → clarified，archived → dropped，done 保持
ALTER TABLE captures ALTER COLUMN status SET DEFAULT 'captured';
UPDATE captures SET status = 'captured' WHERE status = 'inbox';
UPDATE captures SET status = 'clarified' WHERE status = 'processing';
UPDATE captures SET status = 'dropped' WHERE status = 'archived';
-- 加 check 约束
ALTER TABLE captures ADD CONSTRAINT captures_status_check
  CHECK (status IN ('captured','clarified','done','dropped'));
```

**验收断言**: `\d captures` 能看到以上字段；`SELECT DISTINCT status FROM captures` 只含新四态。

---

### FR-2：DB Migration — capture_atoms 扩展字段
**文件**: `packages/brain/migrations/355_capture_atoms_envelope_fields.sql`

```sql
ALTER TABLE capture_atoms ADD COLUMN IF NOT EXISTS nature VARCHAR(50);
ALTER TABLE capture_atoms ADD COLUMN IF NOT EXISTS repo VARCHAR(100);
ALTER TABLE capture_atoms ADD COLUMN IF NOT EXISTS lane VARCHAR(100);
ALTER TABLE capture_atoms ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;
-- status 扩展：新增 parked（现 pending_review 的语义拆分：有 [triage:] 前缀的条目 → parked）
-- pending → enriched → routed / dropped / parked
-- 现有 pending_review → 保留作为向后兼容别名，最终收敛到 parked/pending
-- 迁移：ai_reason LIKE '[triage:%' 且 status='pending_review' → parked
UPDATE capture_atoms
  SET status = 'parked'
  WHERE status = 'pending_review' AND ai_reason LIKE '[triage:%';
ALTER TABLE capture_atoms ADD CONSTRAINT capture_atoms_status_extended_check
  CHECK (status IN ('pending_review','pending','confirmed','dismissed','dropped','parked','routed','enriched'));
```

**注意**: `pending_review` 保留兼容（capture-triage.js 现有查询条件），新逻辑用 `pending`/`parked`/`routed`。

**验收断言**: `SELECT count(*) FROM capture_atoms WHERE status='parked'` ≥ 之前 `[triage:%` 条目数。

---

### FR-3：统一进箱端点 POST /api/brain/captures
**文件**: `packages/brain/src/routes/captures.js`（新建）
**注册**: `packages/brain/src/routes.js` 挂载

端点规格：
```
POST /api/brain/captures
Body: {
  content: string (必填, max 2000),
  source: string (必填: 'harness'|'dashboard'|'feishu'|'api'),
  nature?: 'learning'|'issue'|'handoff'|null,
  repo?: string,
  lane?: string,
  ref_task_id?: UUID,
  ref_journey_id?: UUID,
  ref_pr_url?: string,
  dedupe_key?: string
}
响应: 201 { id, status, dedupe_key }
幂等: dedupe_key 冲突 → 200 { id: existing_id, status, dedupe_hit: true }
出身已知 (nature 有值) → status='clarified' 直接写入
出身未知 → status='captured'
```

信封校验（进箱一刻焊死）：
- content 不为空
- source 在白名单内
- nature 若有值必须在 `['learning','issue','handoff']`
- dedupe_key 唯一冲突 → 返回已有记录（不报错）

**验收断言**: `POST /api/brain/captures {content:"test", source:"harness", nature:"learning", dedupe_key:"test-001"}` → 201；重复 POST → 200 + `dedupe_hit: true`。

---

### FR-4：capture-inbox.js 改道——pushCapture 取代 pushCaptureAtom
**文件**: `packages/brain/src/capture-inbox.js`

新增 `pushCapture(pool, {...})` 函数：
- 调用 `POST /api/brain/captures`（或直接 pool.query）写 captures 表
- 出身已知（handoff/learning/issue）带 nature + ref_task_id/ref_journey_id
- 同时在 captures 写入后，仍生成 capture_atom（capture_id 指向新 capture，target_type 沿用现有逻辑）
- 保留原 `pushCaptureAtom` 签名但内部改为先写 capture 再写 atom

**调用方修改**（grep 到的所有 `pushCaptureAtom` 调用点改为 `pushCapture`）：
- `packages/brain/src/routes/handoffs.js`（如有）
- `packages/brain/src/routes/learnings.js`（如有）
- `packages/brain/src/routes/issues.js`（如有）
- 其他 grep 到的调用方

**封死直写 atoms 旁路**: 任何 handoff/learning/issue 产出不得绕过 captures 直接写 capture_atoms。

**验收断言**: 写一条 learning → `SELECT count(*) FROM captures WHERE nature='learning' AND created_at > now()-interval '1 min'` 返回 1。

---

### FR-5：封死 urgent 死胡同——产生真实 task + Bark 告警
**文件**: `packages/brain/src/capture-triage.js`（修改 `routeAtom` 的 urgent 分支）

当前 urgent 路只标 confirmed，无任何下游。修改为：
```js
if (route === 'urgent') {
  // 1. 建真实 task（P1 优先级）
  const result = await createTask({
    title: `[紧急] ${atom.content.slice(0, 80)}`,
    description: `来源: capture_atoms urgent路由, atom_id=${atom.id}\n\n${atom.content}`,
    task_type: 'harness_initiative',
    priority: 'P1',
    trigger_source: 'cortex',
    dedupe_key: `capture-triage-urgent-${atom.id}`,
    payload: { orchestrator: 'skill-relay', executor: 'claude', mode: 'headed' },
  });
  // 2. Bark 告警（复用现有 Bark 工具，如 sendBark 函数）
  await sendBark(`[Cecelia] 紧急进箱: ${atom.content.slice(0, 60)}`).catch(() => {});
  const taskId = result?.task?.id;
  return updateAtom(pool, atom.id, {
    status: 'confirmed',
    routedToTable: 'tasks',
    routedToId: taskId,
    confidence,
    aiReason: `[triage:urgent] task=${taskId} bark_sent. ${reason}`
  });
}
```

**注意**: 生产护栏 `isProductionSensitive` 在 urgent 分支也必须检查（命中 → 仅 Bark，不自动建 task）。

**验收断言**: 插入一条 target_type='issue', target_subtype='P0' 的 atom → 触发 triage → `SELECT count(*) FROM tasks WHERE title LIKE '[紧急]%'` 增加 1；Bark 已发出。

---

### FR-6：封死 okr 死胡同——写 notes 表
**文件**: `packages/brain/src/capture-triage.js`（修改 `routeAtom` 的 okr 分支）

当前 okr 路只标 confirmed，无任何下游。修改为：
```js
if (route === 'okr') {
  const { rows } = await pool.query(
    `INSERT INTO notes (content, category, source, ai_reason)
     VALUES ($1, 'strategic_input', 'capture_triage', $2) RETURNING id`,
    [atom.content, reason]
  );
  const noteId = rows[0].id;
  return updateAtom(pool, atom.id, {
    status: 'confirmed',
    routedToTable: 'notes',
    routedToId: noteId,
    confidence,
    aiReason: `[triage:okr] note=${noteId}. ${reason}`
  });
}
```

**验收断言**: 手动触发一条 okr 路由 atom → `SELECT count(*) FROM notes WHERE category='strategic_input' AND created_at > now()-interval '5 min'` 返回 1。

---

### FR-7：新 job capture-aging.js — 账龄哨兵
**文件**: `packages/brain/src/capture-aging.js`（新建）
**注册**: `packages/brain/src/scheduler-jobs.js`

功能：
1. **超期告警**：任何非终态 capture（status NOT IN ('done','dropped')）或 capture_atom（status NOT IN ('confirmed','dismissed','dropped','routed')）创建超 7 天 → 飞书 Webhook 告警 + 日志记录
2. **llm_failed 自动重试**：`ai_reason LIKE '[triage:llm_failed]%' AND retry_count < 3` → 清除 ai_reason（让其重回分诊队列）+ `retry_count + 1`
3. **超限转 parked**：`retry_count >= 3 AND ai_reason LIKE '[triage:llm_failed]%'` → status='parked'，ai_reason='[aging:max_retry_parked]'
4. **计数指标暴露**：返回 `{ overdue_captures, overdue_atoms, retried, parked_by_aging }`

scheduler-jobs 注册：
```js
{ name: 'capture-aging', needsPool: true, timeoutMs: 30_000, handler: runCaptureAging,
  description: '账龄哨兵：超7天告警+llm_failed重试(≤3次)+超限转parked' }
```

**内置间隔 gate**: 默认每小时跑一次（`CECELIA_CAPTURE_AGING_INTERVAL_MS` 可覆盖）。

**验收断言**: 
- 存在 retry_count=0, ai_reason='[triage:llm_failed] xxx' 的 atom → 运行 aging → retry_count=1, ai_reason=NULL
- 存在 retry_count=3 的 llm_failed atom → 运行 aging → status='parked', ai_reason='[aging:max_retry_parked]'

---

### FR-8：Brain 侧支撑 API — captures CRUD
**文件**: `packages/brain/src/routes/captures.js`（扩展 FR-3 的文件）

```
GET  /api/brain/captures                    — 列表+计数
  query: stage, nature, lane, aging(days), source, limit, offset
  响应: { items: [...], total, counts_by_stage: { captured:N, clarified:N, done:N, dropped:N } }

GET  /api/brain/captures/:id                — 详情（含 atoms + 回链）
  响应: { ...capture, atoms: [...], backlinks: [{table, id, summary}] }

PATCH /api/brain/capture-atoms/:id/confirm  — 扩展：支持 nature 改判 + 手动路由 + drop
  Body: { action: 'confirm'|'dismiss'|'reroute'|'drop', nature?, target_type?, target_subtype?, route_to? }
  新增 reroute: 更新 nature + 清 ai_reason（重新进分诊队列）
  新增 drop: status='dropped'

POST /api/brain/capture-atoms/:id/retry    — 手动重试（清 ai_reason + retry_count+1）
  响应: { id, status: 'pending_review', retry_count }
```

**验收断言**:
- `GET /api/brain/captures?stage=captured` 返回 `counts_by_stage` 对象
- `GET /api/brain/captures/:id` 返回 `atoms` 数组
- `PATCH /api/brain/capture-atoms/:id/confirm` body `{action:"reroute", nature:"learning"}` → ai_reason 清空

---

### FR-9：Dashboard 新路由 /inbox — 漏斗+列表+详情+改判
**目录**: `apps/dashboard/src/pages/` 新建 `InboxPage.tsx`
**路由注册**: `apps/dashboard/src/App.tsx` 挂载 `/inbox`

#### 9.1 管道视图（漏斗计数条）
```tsx
// 5 个阶段磁贴：captured / clarified / parked / done / dropped
// 数据源: GET /api/brain/captures → counts_by_stage
// 点击任一段 → 列表视图过滤该 stage
```

#### 9.2 列表视图
```tsx
// 筛选栏：stage / nature / source / aging（超期: >7天标红）
// 每行：content preview / nature badge / source / age / status chip
// 超期（created_at > 7天 + 非终态）→ 行背景标红 / 橙色警示图标
// 点击行 → 详情抽屉
```

#### 9.3 详情抽屉
```tsx
// 信封元数据：nature / repo / lane / ref_task_id / ref_pr_url
// capture 状态 + 时间线
// Atoms 列表：每条 atom 的 target_type / status / ai_reason / routed_to 回链
// 回链跳转：routed_to_table='tasks' → 点击跳 /tasks/:id
// parked 条目：显示"卡住原因"（ai_reason）+ 改判交互（见 9.4）
```

#### 9.4 改判交互（parked 专用）
```tsx
// 改 nature 下拉 → PATCH /api/brain/capture-atoms/:id/confirm {action:"reroute", nature:...}
// 手动选路由目的地（urgent/line_backlog/invariant/okr/drop）→ PATCH confirm {action:"reroute", route_to:...}
// drop 按钮 → PATCH confirm {action:"drop"}
// 重试按钮（llm_failed 条目）→ POST /api/brain/capture-atoms/:id/retry
```

**UI 约束**:
- 顶部不加快捷输入框（P2 功能，本 sprint 不做）
- 颜色：超期标红 `#ef4444`，parked 标橙 `#f59e0b`
- 无需 i18n，简体中文标签

**验收断言**: Dashboard mac_web Playwright 截图能看到 `/inbox` 页漏斗计数条（含 `counts_by_stage`），列表展示条目，详情抽屉能打开（见 Final E2E §E2E-4）。

---

### FR-10：消化 32 条 pending_review 积压
**文件**: `packages/brain/src/scripts/backfill-pending-review.js`（一次性脚本）或 migration

逻辑：
1. 查出所有 `status='pending_review'` 且 `target_type IN ('handoff','learning','issue')` 的 atoms
2. `ai_reason LIKE '[triage:%'`（已有分诊标记）→ 转 `parked`（进人工队列）
3. `ai_reason IS NULL` 或 `ai_reason NOT LIKE '[triage:%'` → 重置为 `pending_review` 让下次 triage 处理（不动，等 triage 自然跑）
4. `no_journey` / `low_confidence` 标记的 → 转 `parked`（进人工队列）
5. 运行一次 `runCaptureTriage` 确保能路由的自动路由

**目标**: 运行后 `SELECT count(*) FROM capture_atoms WHERE status='pending_review'` = 0（全部转为 parked 或 routed/confirmed）。

**验收断言**: 积压 32 条全部离开 pending_review（status IN ('parked','confirmed','dismissed','routed')）。

---

## 非功能需求（NFR）

| # | 类别 | 要求 |
|---|---|---|
| NFR-1 | 向后兼容 | capture_atoms.status='pending_review' 继续兼容（现有 capture-triage.js 查询不改） |
| NFR-2 | 幂等性 | dedupe_key 唯一冲突不报错，返回已有记录 |
| NFR-3 | 非阻塞 | pushCapture 写入失败不抛（try/catch 吞错，同 pushCaptureAtom 原则） |
| NFR-4 | 保护系统不动 | PRODUCTION_SENSITIVE_PATTERN / 生产护栏 / invariant-gate 全部保留 |
| NFR-5 | 事务完整性 | urgent 建 task + atom update 在同一事务；okr 写 notes + atom update 在同一事务 |
| NFR-6 | 账龄哨兵间隔 | 默认 1 小时，env 可覆盖，自带间隔 gate |
| NFR-7 | Dashboard 性能 | `/inbox` 列表默认 limit=50，分页支持 |

---

## Final E2E 验收标准

所有 E2E 走 `mac_web`（本机 Playwright，localhost:5174）。

### E2E-1：新 learning 全链路可见（5 分钟内）
```
1. POST /api/brain/captures { source:"harness", nature:"learning", content:"测试新capture学习条目", ref_task_id: <任意task_id>, dedupe_key:"e2e-learning-001" }
2. 等待 ≤ 5 分钟（capture-triage tick 运行）
3. 断言 GET /api/brain/captures?nature=learning → items 包含 dedupe_key="e2e-learning-001" 的条目
4. 断言该条目 status IN ('clarified','done') 且 atoms 非空
5. Playwright 截图 /inbox → 能在列表中找到该条目（文字匹配"测试新capture学习条目"）
```

### E2E-2：urgent 路由产生真实 task + Bark
```
1. INSERT INTO capture_atoms (content, target_type, target_subtype) VALUES ('E2E紧急测试', 'issue', 'P0')
2. 手动调用 runCaptureTriage（或等 tick）
3. 断言 SELECT count(*) FROM tasks WHERE title LIKE '[紧急]%' AND created_at > now()-interval '5 min' ≥ 1
4. 断言 atom.status = 'confirmed' AND atom.routed_to_table = 'tasks'
5. Bark 告警日志可见（终端 console.log 或 bark response 成功）
```

### E2E-3：积压 32 条清零
```
1. 运行 backfill-pending-review.js 脚本（或等效 migration）
2. 断言 SELECT count(*) FROM capture_atoms WHERE status='pending_review' = 0
3. 断言 SELECT count(*) FROM capture_atoms WHERE status='parked' ≥ N（原 no_journey/low_confidence 数量）
```

### E2E-4：Dashboard /inbox 页漏斗渲染（mac_web Playwright）
```
1. Playwright 打开 http://localhost:5174/inbox
2. 截图保存到 sprints/07200850-relay-07b2fd3b/screenshots/inbox-funnel.png
3. 断言页面包含文字 "captured" 或 "clarified"（漏斗计数标签）
4. 断言至少一个计数值 > 0（DOM 可见非零数字）
5. 点击第一行条目 → 详情抽屉出现（断言含 "nature" 或 "atoms" 文字）
```

---

## 交付物清单

| 文件 | 类型 | 关联 FR |
|---|---|---|
| `packages/brain/migrations/354_captures_envelope_fields.sql` | 新建 migration | FR-1 |
| `packages/brain/migrations/355_capture_atoms_envelope_fields.sql` | 新建 migration | FR-2 |
| `packages/brain/src/routes/captures.js` | 新建 Brain route | FR-3, FR-8 |
| `packages/brain/src/routes.js` | 修改：挂载 captures 路由 | FR-3 |
| `packages/brain/src/capture-inbox.js` | 修改：新增 pushCapture | FR-4 |
| `packages/brain/src/capture-triage.js` | 修改：urgent/okr 两路 | FR-5, FR-6 |
| `packages/brain/src/capture-aging.js` | 新建 job | FR-7 |
| `packages/brain/src/scheduler-jobs.js` | 修改：注册 aging job | FR-7 |
| `packages/brain/src/routes/capture-atoms.js` | 修改：扩展 confirm + retry | FR-8 |
| `apps/dashboard/src/pages/InboxPage.tsx` | 新建 Dashboard 页 | FR-9 |
| `apps/dashboard/src/App.tsx` | 修改：注册 /inbox 路由 | FR-9 |
| `packages/brain/src/scripts/backfill-pending-review.js` | 一次性脚本 | FR-10 |
| Tests（覆盖所有 FR） | 测试文件 | All |

---

## 保留不动

- `capture-triage.js` 的 cheap rule 层 / invariant-gate 路 / PRODUCTION_SENSITIVE_PATTERN 护栏
- `capture-triage.js` 的 line_backlog 路（已工作正常）
- `capture-atoms.js` 现有 GET / PATCH 基础能力（只扩展，不重写）
- 决策 `57d296a1`、`b2eeb1b5` 的护栏逻辑

---

## 执行顺序建议

```
Step 1: FR-1 + FR-2（migrations，先跑，后续代码依赖字段）
Step 2: FR-3（POST /api/brain/captures 端点）
Step 3: FR-4（capture-inbox.js 改道）
Step 4: FR-5 + FR-6（封 urgent/okr 死胡同）
Step 5: FR-7（capture-aging.js + scheduler 注册）
Step 6: FR-8（扩展 capture-atoms.js confirm/retry）
Step 7: FR-10（积压清零脚本）
Step 8: FR-9（Dashboard /inbox 页）
Step 9: E2E 验收
```
