# 设计：多刀必挂根 + 依赖单一写口 + 决策分档机械守卫

Brain 任务 `3fad28e0`（链 bf5088a3 第 5 棒，硬依赖前棒 94465721）· 决策 `105a5868`（决策分档）· 秋米路由基建债 · Journey F1（开发闭环既有断言）
需求真身：任务描述 + 三条治理守卫（主理人已拍板手工做链，本文即已确认需求）。分两个 PR，同一 Brain 任务，第二个合并后回写 completed。

## 0. 病根

「有表不填」的根因是没有闸：多刀工作没人强制挂 project 根、依赖散在三处（`payload.depends_on` / `task_dependencies` 表 / 旧串行 `depends_on_prev`），Notion 看板看不见依赖。今天接通第一条链又踩出两个静默坑，一并上闸：

| 坑 | 现象 | 根因 |
|---|---|---|
| goal_id 挂 Objective | 任务永远 queued、无任何日志 | tick 派发白名单是 `key_results WHERE status IN (active,in_progress,decomposing)` 的 id，Objective id 被静默过滤 |
| blocked=owner_decision 无协议 | 09-23 五把刀 blocked 却没写等什么，真因是机器故障 | 代码里没有任何入口校验；写入靠 psql / 手工 |

## 1. PR A：守卫 1 + 守卫 2 + 依赖单一写口

### 1.1 守卫 1：goal_id 必须是 KR 级 `lib/goal-guard.js`
`assertGoalIsKeyResult(db, goalId)`：`goalId == null` 直通（不给 goal_id 行为不变）；存在于 `key_results.id` 通过；否则抛 `goal_id_not_key_result`，`details` 带 `is_objective`（命中 `objectives.id`）与该 Objective 名下 KR 清单，提示用 KR id。KR 存在但状态不在派发白名单 → 不拒绝，返回 `warning`（建单响应 `warnings` 带出）。
接入：`POST /api/brain/tasks`（400）与 `createRoutedTask`（INSERT 前、幂等命中之后，覆盖 inbox/feishu/notion 等所有内部建单）。

### 1.2 守卫 2：owner_decision 协议 `lib/owner-decision.js`
`validateOwnerDecisionDetail(detail)`：必带 `question`（非空串）、`options`（数组≥2）、`default`（非空）、`deadline`（可解析时间）、`reversible`（布尔）、`waiting_on`（`human|machine`），缺任一项列出全部违规。`assertOwnerDecisionProtocol({reason, detail})` 仅对 `reason==='owner_decision'` 生效。
`waiting_on='human'` → 同事务/同路径生成 `pending_actions`（`action_type='owner_decision'`，signature `owner-decision:<task_id>` 去重，`expires_at=deadline`，options 带选项）；`machine` → 不生成（不进主理人待办）。`unblockTask` 成功后把对应 pending_action 关闭。
四道入口（缺一处等于没闸）：
| 入口 | 拦法 |
|---|---|
| `blockTask`（POST /tasks/:id/block） | 校验失败返回 `{success:false, code:'owner_decision_protocol_violation', violations}`，路由映射 400（原先一律 404） |
| `POST /tasks` 建单 status=blocked | 新增 `blocked_reason`/`blocked_detail` 入参，同一校验 400；status≠blocked 却带 blocked_reason → 400 |
| `createRoutedTask` | INSERT 前断言，兜内部调用方 |
| **迁移 469 触发器**（psql/任意 SQL 直写） | `BEFORE INSERT OR UPDATE ... WHEN (NEW.blocked_reason='owner_decision')`；只拦「新写入」：INSERT，或 blocked_reason/blocked_detail 相对旧值有变；存量 blocked 行不回填、不报错、对它们改别的列不触发。违规抛 `23514` |
`blocked_detail` 现有语义（`{message}`、`{type}` 索引）不变，只对 `owner_decision` 这一个 reason 收紧。

### 1.3 依赖单一写口 `lib/task-dependencies.js`
`task_dependencies`（hard|soft 边）为真列，`payload.depends_on` 保留为派发/级联的读侧兼容（dispatch-helpers、dep-cascade 仍读它），但**只由本模块同步写**。
- `addTaskDependency / addTaskDependencies / removeTaskDependency / listTaskDependencies`；校验自环、任务存在、成环（递归 CTE）；hard 边同步 `payload.depends_on`。
- 接线：建单入口 `depends_on` → 建单后写边；`proposal.js` add/remove_dependency 走本模块；`harness-dag.js` 的边 INSERT 走 `insertEdgeRow`（虚拟 uuid，不校验任务、不同步 payload）。
- API：`POST/GET /api/brain/tasks/:id/dependencies`、`DELETE /api/brain/tasks/:id/dependencies/:depId`。
- 守卫测试 `task-dependencies-single-writer.test.js`：grep `src` 内 `INSERT INTO task_dependencies` / `payload ... depends_on` 写法，白名单仅本模块与 gap-dependencies（gap 账本边，带 gap_id/status，语义独立）；变异：把 harness-dag 改回直写必红。
- 旧串行 `depends_on_prev`（按 `tasks.project_id`+`sequence_order`）是第三套，语义独立、已在生产用，本棒不动，写进 handoff。

## 2. PR B：登记闸 + Notion 投影

### 2.1 多刀必挂根 `lib/project-root-gate.js`
「多刀」= 登记时 `depends_on` 非空，或 `payload.multi_task===true`（/dev 在决策/spec 声明多刀时带）。多刀任务必须挂 `task_type='project'` 根：`parent_task_id` 沿祖先链（含自身，≤12 层）能找到 project 根，否则 400 `project_root_required`。声明 `multi_task` 且父下已有兄弟、却没写 `depends_on` 键 → 400 `depends_on_required`（显式 `depends_on: []` = 声明刻意无依赖）。`depends_on` 各 id 必须存在（400 `depends_on_not_found`）。project 根自身豁免。
依赖 API 加同一道闸：`POST /tasks/:id/dependencies` 要求 from 任务有 project 根。
不放 engine：闸在 Brain 建单入口，/dev Phase 0 走 `POST /tasks` 天然被闸，无需改 engine（不触发 engine 版本五件套）。

### 2.2 pushTasks 投影 Project / Blocked-by
- Notion Tasks 库（d5bc40c2）实测已有 `Project`（dual→Projects 库）与 `Blocked by`（dual 自关联）两列。`ops-notion-schema.js` 新增 `buildTasksDbProps(tasksDbId)`（`Blocked by`），复用 `ensureOpsDbProps` 缺列即补，每进程 10 分钟一次；补列失败或推送含 `Blocked by` 报错 → 本进程停投影该列 10 分钟（flag-off 安全跳过），**且不清 notion_id**（400 会被 isWrongDatabaseError 误判成错库而重建页面=重复页，血训）。
- `PUSH_TASKS_QUERY` 加两个指纹：`pushed_project`（project 根 notion_id）与 `pushed_blockers`（hard 依赖里已投影任务的 notion_id 排序串）。指纹变化即重推，解决「根后建页 / 依赖后加」不重推。blocker 必须 `notion_props ? 'pushed_status'`（旧时代 13483 条遗产 notion_id 指向别处，不能当 relation 目标）。
- 纯函数 `buildTaskNotionProperties` 导出；一致性 smoke：推送用到的每个 Notion 列都在 ensure 清单或库既有列白名单内（Notion 缺列 400 的血训）。
- 无 Notion token / 库无该列且补不上 → 只推原有三列，行为与今天一致。

## 3. 测试策略
| 档 | 内容 |
|---|---|
| unit | goal-guard / owner-decision 纯逻辑：违规输入被拒（每条守卫至少一个红测试）；project-root-gate；buildTaskNotionProperties |
| route | POST /tasks：Objective id → 400；owner_decision 缺项 → 400；depends_on 无根 → 400；/block 映射 400 |
| PG 集成 | 建库跑全量 migrate：469 触发器 psql 直写违规被拒（proven-to-fire）、存量行改别的列不触发、waiting_on 分流 pending_action；依赖写口双写一致 + 成环拒绝 |
| 守卫 | 依赖单一写口 grep 守卫（含变异） |
| smoke | `project-root-gate-smoke.sh` 登记 allowlist |

## 4. 不做
存量 blocked 行回填；`depends_on_prev` 迁移；pending_action 的「批准」处理器（decision-executor 由另一棒收口终态写入时占用，本棒用 unblock 关闭待办，处理器写进 handoff next_steps）。
