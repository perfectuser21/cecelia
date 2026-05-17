# Cecelia Monorepo 深度架构分析报告

**生成日期**: 2026-02-26
**分析范围**: packages/brain, apps/api, apps/dashboard, apps/api/features, packages/engine, packages/quality
**总代码行数**: ~230,000 行

---

## 1. 模块依赖图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           用户层 (Browser)                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  React Apps (Dashboard)                                             │   │
│  │  ├── App.tsx                                                        │   │
│  │  ├── contexts/                                                       │   │
│  │  │   ├── AuthContext.tsx (认证状态)                                  │   │
│  │  │   ├── ThemeContext.tsx (主题管理)                                  │   │
│  │  │   ├── InstanceContext.tsx (实例配置)                              │   │
│  │  │   └── CeceliaContext.tsx (聊天+页面感知)                          │   │
│  │  ├── components/                                                    │   │
│  │  │   ├── DynamicRouter.tsx (动态路由)                                │   │
│  │  │   ├── CollapsibleNavItem.tsx                                     │   │
│  │  │   └── Breadcrumb.tsx                                             │   │
│  │  └── pages/                                                         │   │
│  │      └── live-monitor/LiveMonitorPage.tsx                           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    ↓ HTTP                                   │
└──────────────────────────────────────┼──────────────────────────────────────┘
                                       ↓
┌──────────────────────────────────────┼──────────────────────────────────────┐
│                        API Gateway 层 (apps/api)                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Express Server                                                     │   │
│  │  ├── /api/task-system/* (任务管理)                                  │   │
│  │  │   ├── routes.js (路由聚合)                                       │   │
│  │  │   ├── tasks.js (任务 CRUD)                                       │   │
│  │  │   ├── projects.js (项目管理)                                     │   │
│  │  │   ├── goals.js (目标管理)                                        │   │
│  │  │   ├── runs.js (运行记录)                                         │   │
│  │  │   ├── links.js (任务链接)                                        │   │
│  │  │   ├── businesses.js (业务线)                                      │   │
│  │  │   ├── departments.js (部门)                                       │   │
│  │  │   ├── areas.js (领域)                                            │   │
│  │  │   └── db-schema.js (自定义字段)                                   │   │
│  │  └── /api/okr/* (OKR 管理)                                          │   │
│  │      └── routes.js                                                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    ↓ pool.query                             │
└──────────────────────────────────────┼──────────────────────────────────────┘
                                       ↓
┌──────────────────────────────────────┼──────────────────────────────────────┐
│                          PostgreSQL 数据库                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  核心表: tasks, goals, projects, runs, events, learnings           │   │
│  │  分析表: cortex_analyses, task_events, rca_cache                   │   │
│  │  配置表: model_profiles, agent_models, policies                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                        Brain 后端 (packages/brain)                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  server.js (Express + WebSocket, port 5221)                       │   │
│  │  ├── routes.js (主路由 - 100+ 端点)                                  │   │
│  │  ├── tick.js (5s 循环 / 5min 执行)                                  │   │
│  │  ├── cortex.js (质量分析, 调用 Anthropic)                           │   │
│  │  ├── executor.js (任务执行, 调用 MiniMax/桥接)                      │   │
│  │  ├── thalamus.js (事件路由, LLM 决策)                               │   │
│  │  ├── decision.js (决策生成与执行)                                    │   │
│  │  ├── learning.js (学习系统)                                          │   │
│  │  ├── intent.js (意图识别)                                           │   │
│  │  ├── memory-retriever.js (记忆检索)                                 │   │
│  │  ├── model-registry.js (模型注册)                                   │   │
│  │  ├── model-profile.js (模型配置)                                   │   │
│  │  ├── heartbeat-inspector.js (心跳检查)                              │   │
│  │  ├── watchdog.js (进程保护)                                        │   │
│  │  ├── circuit-breaker.js (熔断器)                                   │   │
│  │  ├── quarantine.js (任务隔离)                                       │   │
│  │  ├── immune-system.js (免疫系统)                                    │   │
│  │  ├── dept-heartbeat.js (部门心跳)                                   │   │
│  │  ├── okr-tick.js (OKR 定时任务)                                    │   │
│  │  ├── nightly-tick.js (夜间任务)                                     │   │
│  │  ├── monitor-loop.js (监控循环)                                     │   │
│  │  ├── promotion-job.js (晋升任务)                                    │   │
│  │  └── websocket.js (WebSocket 服务)                                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                      质量系统 (packages/quality)                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  api/server.js                                                      │   │
│  │  ├── registry.js (仓库注册)                                          │   │
│  │  ├── contracts.js (回归契约 RCI)                                     │   │
│  │  ├── executor.js (QA 执行)                                           │   │
│  │  └── dashboard.js (仪表板)                                           │   │
│  │  hooks/stop.sh (质量门控)                                           │   │
│  │  gateway/gateway.sh (任务入队)                                       │   │
│  │  worker/worker.sh (任务执行)                                        │   │
│  │  heartbeat/heartbeat.sh (健康检查)                                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                      开发引擎 (packages/engine)                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  hooks/                                                             │   │
│  │  ├── stop.sh (循环控制)                                              │   │
│  │  ├── stop-dev.sh (Dev 流程控制)                                      │   │
│  │  ├── branch-protect.sh (分支保护)                                   │   │
│  │  └── credential-guard.sh (凭据保护)                                 │   │
│  │  lib/hook-utils.sh (工具库)                                          │   │
│  │  skills/dev/scripts/                                                │   │
│  │  ├── track.sh (流程跟踪)                                             │   │
│  │  └── cleanup.sh (清理)                                              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 数据流图

### 2.1 用户请求 → Brain 决策 → 执行 → 回调

```
用户输入
    ↓
┌─────────────────────────┐
│ CeceliaContext.tsx      │  聊天消息发送
│ (Dashboard)             │  POST /api/brain/orchestrator/chat
└───────────┬─────────────┘
            ↓ HTTP POST
┌─────────────────────────┐
│ orchestrator-chat.js    │  意图解析 + 记忆检索
│ (Brain)                 │  parseIntent() + buildMemoryContext()
└───────────┬─────────────┘
            ↓
┌─────────────────────────┐
│ intent.js               │  意图分类
│ (Brain)                 │  路由到具体 handler
└───────────┬─────────────┘
            ↓
┌─────────────────────────┐
│ thalamus.js             │  LLM 决策
│ (Brain)                 │  调用 MiniMax/Anthropic
└───────────┬─────────────┘
            ↓
┌─────────────────────────┐
│ actions.js              │  创建任务
│ (Brain)                 │  INSERT INTO tasks
└───────────┬─────────────┘
            ↓
┌─────────────────────────┐
│ tick.js                 │  任务调度
│ (Brain)                 │  SELECT * FROM tasks WHERE status='queued'
└───────────┬─────────────┘
            ↓
┌─────────────────────────┐
│ executor.js             │  任务执行
│ (Brain)                 │  调用 HK_MINIMAX / EXECUTOR_BRIDGE
└───────────┬─────────────┘
            ↓
┌─────────────────────────┐
│ cecelia-run (外部)      │  Claude Code 执行
│                         │  /skill ...
└───────────┬─────────────┘
            ↓
┌─────────────────────────┐
│ /api/brain/execution-   │  执行回调
│ callback                │  更新任务状态
│ (Brain)                 │  UPDATE tasks SET status='completed'
└─────────────────────────┘
```

### 2.2 Tick 循环数据流

```
┌─────────────────────────────────────────────────────────────┐
│                    tick.js (5s 循环)                        │
│  TICK_LOOP_INTERVAL_MS = 5000                              │
│  TICK_INTERVAL_MINUTES = 5                                  │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ 检查任务队列     │  │ 检查活跃目标    │  │ 清理过期数据    │
│ queued → dispatch│  │ 评估优先级      │  │ 旧事件/缓存     │
└─────────────────┘  └─────────────────┘  └─────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    dispatchNextTask()                       │
│  1. 评分排序 (activation-scorer.js)                         │
│  2. 前置检查 (pre-flight-check.js)                          │
│  3. 资源分配 (capacity.js)                                  │
│  4. 路由分发 (task-router.js)                               │
│  5. 执行 (executor.js)                                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. API 端点清单

### 3.1 Brain 主 API (routes.js) - 100+ 端点

| 路由 | 方法 | 处理函数 | 数据库查询 |
|------|------|----------|------------|
| `/status` | GET | - | - |
| `/status/full` | GET | - | policy, working_memory |
| `/tasks` | GET | - | tasks (with filters) |
| `/tasks/:task_id` | PATCH | - | tasks UPDATE |
| `/tasks/:task_id/feedback` | POST | - | learnings INSERT |
| `/goals` | GET | - | goals |
| `/briefing` | GET | briefing.getBriefing | - |
| `/focus` | GET | focus.* | - |
| `/focus/set` | POST | - | working_memory |
| `/tick` | POST | tick.trigger | - |
| `/tick/status` | GET | tick.getStatus | - |
| `/tick/enable` | POST | tick.enable | - |
| `/tick/disable` | POST | tick.disable | - |
| `/tick/drain` | POST | tick.drain | - |
| `/alertness` | GET | - | - |
| `/alertness/evaluate` | POST | - | - |
| `/alertness/override` | POST | - | - |
| `/quarantine` | GET | - | - |
| `/quarantine/:taskId/release` | POST | - | - |
| `/heartbeat` | GET/POST/PUT | - | heartbeat |
| `/executor/status` | GET | - | - |
| `/cluster/status` | GET | - | - |
| `/intent/parse` | POST | intent.parse | - |
| `/intent/create` | POST | - | tasks INSERT |
| `/intent/execute` | POST | - | - |
| `/decide` | POST | decision.generateDecision | - |
| `/decision/:id/execute` | POST | decision.executeDecision | - |
| `/cortex/analyses` | GET | - | cortex_analyses |
| `/cortex/evaluate-quality` | POST | cortex.evaluate | cortex_analyses |
| `/learning/evaluate-strategy` | POST | learning.evaluateStrategy | learnings |
| `/capabilities` | GET | - | - |
| `/capabilities` | POST | - | - |
| `/proposals` | GET/POST | - | - |
| `/proposals/:id/approve` | POST | - | - |
| `/proposals/:id/reject` | POST | - | - |
| `/okr-tick/status` | GET | - | - |
| `/okr-tick` | POST | okr-tick.run | - |
| `/nightly/trigger` | POST | nightly-tick.trigger | - |
| `/daily-reports` | GET | daily-review-scheduler.getReports | daily_reports |
| `/route-task` | POST | task-router.route | - |
| `/search-similar` | POST | similarity.search | - |
| `/attach-decision` | POST | - | decision_attachments |
| `/events` | GET | event-bus.getEvents | events |
| `/circuit-breaker` | GET | circuit-breaker.getStatus | - |
| `/circuit-breaker/:key/reset` | POST | circuit-breaker.reset | - |
| `/monitor/status` | GET | monitor-loop.getStatus | - |
| `/blocks/:parentType/:parentId` | GET | - | task_blockers |
| `/blocks` | POST | - | task_blockers INSERT |
| `/watchdog` | GET | watchdog.getStatus | - |

### 3.2 Task System API (apps/api)

| 路由 | 方法 | 处理函数 | 数据库表 |
|------|------|----------|----------|
| `/tasks` | GET | - | tasks |
| `/tasks/:id` | GET | - | tasks |
| `/tasks` | POST | - | tasks |
| `/tasks/:id` | PATCH | - | tasks |
| `/tasks/:id` | DELETE | - | tasks |
| `/tasks/:id/backlinks` | GET | - | task_links |
| `/tasks/:id/runs` | GET | - | runs |
| `/projects` | GET | - | projects |
| `/projects/:id` | GET | - | projects |
| `/projects/:id/stats` | GET | - | projects (aggregation) |
| `/projects/:id/health` | GET | - | projects (complex) |
| `/projects/:id/transition` | POST | - | projects |
| `/goals` | GET | - | goals |
| `/goals/:id` | GET | - | goals |
| `/goals/:id/tasks` | GET | - | tasks |
| `/goals/:id/children` | GET | - | goals (KR) |
| `/runs` | GET | - | runs |
| `/runs/:id` | GET | - | runs |
| `/businesses` | GET | - | businesses |
| `/departments` | GET | - | departments |
| `/areas` | GET | - | areas |
| `/db-schema/:stateKey` | GET/POST/PATCH/DELETE | - | db_schemas |

### 3.3 OKR API (apps/api)

| 路由 | 方法 | 处理函数 | 数据库表 |
|------|------|----------|----------|
| `/okr/areas` | GET | - | businesses, goals |
| `/okr/areas/:areaId` | GET | - | businesses, goals, key_results |
| `/okr/objectives/:id` | GET | - | goals, key_results |
| `/okr/key-results/:id` | GET | - | key_results, projects |
| `/okr/objectives` | POST | - | goals |
| `/okr/key-results` | POST | - | key_results |

---

## 4. 数据库交互图

### 4.1 核心业务表

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              任务与目标                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│ tasks                                                                         │
│ ├── id (UUID)                                                                │
│ ├── title, description                                                      │
│ ├── status (queued/in_progress/completed/failed/cancelled/quarantined)     │
│ ├── priority (P0/P1/P2)                                                     │
│ ├── project_id, goal_id                                                     │
│ ├── queued_at, started_at, updated_at, completed_at                        │
│ ├── due_at, error_message                                                   │
│ ├── custom_props (JSONB)                                                    │
│ └── skill, model_id                                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│ goals (OKR Objectives/Key Results)                                           │
│ ├── id, title, description                                                  │
│ ├── type (objective/key_result)                                             │
│ ├── status, progress, weight                                                │
│ ├── project_id, business_id, parent_id                                     │
│ ├── quarter, priority                                                       │
│ └── custom_props                                                            │
├─────────────────────────────────────────────────────────────────────────────┤
│ projects                                                                    │
│ ├── id, name, description                                                   │
│ ├── status, type                                                            │
│ ├── area_id, business_id, parent_id                                         │
│ └── custom_props                                                            │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                           执行与追踪                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│ runs (任务执行记录)                                                           │
│ ├── id, task_id                                                             │
│ ├── status, started_at, ended_at                                            │
│ ├── exit_code, output                                                       │
│ └── executor_host                                                           │
├─────────────────────────────────────────────────────────────────────────────┤
│ events (系统事件流)                                                           │
│ ├── id, type, source                                                        │
│ ├── data (JSONB)                                                            │
│ └── created_at                                                               │
├─────────────────────────────────────────────────────────────────────────────┤
│ task_events (任务状态变更)                                                    │
│ ├── id, task_id, event_type                                                 │
│ ├── old_value, new_value                                                   │
│ └── created_at                                                               │
├─────────────────────────────────────────────────────────────────────────────┤
│ decision_log (决策日志)                                                      │
│ ├── id, ts                                                                  │
│ ├── trigger, input_summary                                                  │
│ ├── llm_output_json, action_result_json                                     │
│ └── status                                                                  │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                            学习与记忆                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│ learnings (学习记录)                                                          │
│ ├── id, type                                                                │
│ ├── content (JSONB)                                                        │
│ ├── effectiveness_score                                                    │
│ └── created_at                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│ cortex_analyses (质量分析)                                                   │
│ ├── id, task_id                                                            │
│ ├── quality_score                                                           │
│ ├── cortex_result                                                           │
│ └── created_at                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│ working_memory (工作记忆)                                                    │
│ ├── key, value_json                                                        │
│ └── updated_at                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│ rca_cache (根因分析缓存)                                                      │
│ ├── error_signature                                                         │
│ ├── rca_result                                                             │
│ └── cached_at                                                               │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                            配置与模型                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│ model_profiles (模型配置)                                                    │
│ ├── id, name                                                                │
│ ├── is_active                                                               │
│ └── config (JSONB)                                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│ agent_models (代理模型映射)                                                   │
│ ├── id, agent_type                                                          │
│ ├── model_id                                                                │
│ └── updated_at                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│ policies (策略)                                                             │
│ ├── id, name, version                                                       │
│ ├── content_json                                                            │
│ ├── active                                                                  │
│ └── created_at                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│ daily_reports (日报)                                                        │
│ ├── id, date                                                                │
│ ├── data (JSONB)                                                            │
│ └── created_at                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 文件 → 表 映射

| 文件 | 访问的表 |
|------|----------|
| actions.js | tasks, task_events, goals |
| tick.js | tasks, objectives, goals |
| cortex.js | cortex_analyses, tasks |
| learning.js | learnings |
| event-bus.js | events |
| routes.js | tasks, goals, projects, decisions |
| model-profile.js | model_profiles, agent_models |
| rca-deduplication.js | rca_cache |
| daily-review-scheduler.js | daily_reports |
| selfcheck.js | tasks, goals (schema validation) |

---

## 5. 外部依赖清单

### 5.1 LLM API 调用

| 文件 | API | 端点 | 用途 |
|------|-----|------|------|
| cortex.js | Anthropic | `https://api.anthropic.com/v1/messages` | 质量分析 |
| thalamus.js | Anthropic | `https://api.anthropic.com/v1/messages` | 决策生成 |
| orchestrator-chat.js | MiniMax | `https://api.minimaxi.com/v1/chat/completions` | 对话处理 |
| thalamus.js | MiniMax | `https://api.minimaxi.com/v1/chat/completions` | 事件路由 |
| user-profile.js | MiniMax | `MINIMAX_API_URL` | 用户画像 |
| embedding-service.js | OpenAI | `https://api.openai.com/v1/embeddings` | 向量嵌入 |
| openai-client.js | OpenAI | `https://api.openai.com/v1/embeddings` | 向量嵌入 |

### 5.2 内部服务调用

| 文件 | 服务 | URL | 用途 |
|------|------|-----|------|
| executor.js | HK MiniMax | `HK_MINIMAX_URL/execute` | 任务执行 |
| executor.js | Executor Bridge | `EXECUTOR_BRIDGE_URL/trigger-cecelia` | 桥接调用 |
| routes.js | HK Bridge | `HK_BRIDGE_URL/status` | 集群状态 |
| actions.js | N8N | `N8N_API_URL/api/webhook` | 工作流触发 |
| thalamus.js | Local Brain | `http://localhost:5221/api/brain/memory/search` | 记忆搜索 |

### 5.3 通知服务

| 文件 | 服务 | 环境变量 |
|------|------|----------|
| notifier.js | 飞书 Webhook | `FEISHU_BOT_WEBHOOK` |

---

## 6. 环境变量完整清单

### 6.1 数据库配置

| 变量 | 文件 | 默认值 | 用途 |
|------|------|--------|------|
| `DB_HOST` | db-config.js, db.js | localhost | 数据库主机 |
| `DB_PORT` | db-config.js, db.js | 5432 | 数据库端口 |
| `DB_NAME` | db-config.js, db.js | cecelia | 数据库名 |
| `DB_USER` | db-config.js, db.js | - | 数据库用户 |
| `DB_PASSWORD` | db-config.js, db.js | - | 数据库密码 |

### 6.2 API 密钥

| 变量 | 文件 | 用途 |
|------|------|------|
| `ANTHROPIC_API_KEY` | cortex.js, thalamus.js | Anthropic Claude |
| `OPENAI_API_KEY` | embedding-service.js, openai-client.js | OpenAI GPT/Embedding |
| `N8N_API_KEY` | actions.js | N8N Webhook |
| `MINIMAX_API_KEY` | user-profile.js | MiniMax |

### 6.3 服务配置

| 变量 | 文件 | 默认值 | 用途 |
|------|------|--------|------|
| `PORT` | server.js | 5221 | Brain 服务端口 |
| `HK_MINIMAX_URL` | executor.js | - | 香港 MiniMax |
| `HK_BRIDGE_URL` | routes.js | - | 香港桥接 |
| `EXECUTOR_BRIDGE_URL` | executor.js | - | 执行器桥接 |
| `N8N_API_URL` | actions.js | - | N8N 服务 |
| `FEISHU_BOT_WEBHOOK` | notifier.js | - | 飞书通知 |
| `WS_ALLOWED_ORIGINS` | websocket.js | * | WebSocket 允许源 |

### 6.4 调度配置

| 变量 | 文件 | 默认值 | 用途 |
|------|------|--------|------|
| `CECELIA_TICK_INTERVAL_MS` | tick.js | 5000 | Tick 循环间隔 |
| `CECELIA_OKR_TICK_INTERVAL_MS` | okr-tick.js | 300000 | OKR Tick 间隔 (5min) |
| `CECELIA_NIGHTLY_HOUR` | nightly-tick.js | 3 | 夜间任务小时 |
| `CECELIA_NIGHTLY_MINUTE` | nightly-tick.js | 0 | 夜间任务分钟 |
| `DISPATCH_TIMEOUT_MINUTES` | tick.js | 30 | 派发超时 |
| `CECELIA_CLEANUP_INTERVAL_MS` | tick.js | 3600000 | 清理间隔 (1h) |
| `CECELIA_INIT_RECOVERY_INTERVAL_MS` | tick.js | 10000 | 初始化恢复间隔 |

### 6.5 执行器配置

| 变量 | 文件 | 用途 |
|------|------|------|
| `CECELIA_RUN_PATH` | executor.js | 运行路径 |
| `CECELIA_WORK_DIR` | executor.js | 工作目录 |
| `CECELIA_BUDGET_SLOTS` | executor.js | 预算槽位 |
| `CECELIA_MAX_SEATS` | executor.js | 最大座位数 |

### 6.6 看门狗配置

| 变量 | 文件 | 默认值 | 用途 |
|------|------|--------|------|
| `LOCK_DIR` | watchdog.js | /tmp/cecelia-locks | 锁目录 |
| `IDLE_KILL_HOURS` | watchdog.js | 8 | 空闲杀进程小时 |
| `IDLE_CPU_PCT_THRESHOLD` | watchdog.js | 5 | CPU 阈值 |

---

## 7. 定时任务清单

### 7.1 核心 Tick 循环

| 文件 | 函数 | 间隔 | 用途 |
|------|------|------|------|
| tick.js | runTick() | 5000ms | 主心跳循环 |
| tick.js | runRecovery() | 10000ms | 初始化恢复 |
| tick.js | periodicCleanup() | 3600000ms | 定期清理 |

### 7.2 业务定时任务

| 文件 | 函数 | 间隔 | 用途 |
|------|------|------|------|
| okr-tick.js | runOkrTick() | 300000ms (5min) | OKR 进度同步 |
| nightly-tick.js | scheduleNightly() | 每日定时 | 夜间批处理 |
| monitor-loop.js | runMonitorCycle() | 可配置 | 监控循环 |
| promotion-job.js | checkPromotions() | 可配置 | 晋升检查 |

### 7.3 心跳与健康检查

| 文件 | 函数 | 间隔 | 用途 |
|------|------|------|------|
| trace.js | heartbeat() | 可配置 | 执行追踪心跳 |
| websocket.js | heartbeat() | 30000ms | WebSocket 心跳 |

---

## 8. 事件系统图

### 8.1 WebSocket 事件

**文件**: websocket.js

```
wss (WebSocket Server)
├── connection (客户端连接)
│   └── ws.on('message') → 处理客户端消息
├── message (收到消息)
│   └── 路由到对应 handler
├── pong (心跳响应)
├── close (连接关闭)
│   └── 清理连接资源
└── error (错误处理)
```

### 8.2 实时通话事件

**文件**: orchestrator-realtime.js

```
OpenAI WebSocket
├── open → 初始化连接
├── message → 处理实时响应
│   └── clientWs.send() → 转发到客户端
├── error → 错误处理
└── close → 清理资源

客户端 WebSocket
├── connection → 建立连接
├── message → 接收用户输入
│   └── openaiWs.send() → 转发到 OpenAI
└── close → 断开连接
```

### 8.3 事件总线

**文件**: event-bus.js

```
事件类型:
- task.created
- task.started
- task.completed
- task.failed
- decision.made
- action.executed

存储: events 表
查询: event-bus.getEvents()
写入: event-bus.emit() → INSERT INTO events
```

---

## 9. React 组件树

### 9.1 根组件结构

```
App.tsx
├── ThemeProvider
│   └── InstanceProvider
│       └── AuthProvider
│           └── CeceliaProvider
│               └── DynamicRouter
│                   └── [Feature Pages]
```

### 9.2 Context 提供者

| Context | 文件 | 状态 |
|---------|------|------|
| ThemeContext | ThemeContext.tsx | theme, setTheme |
| InstanceContext | InstanceContext.tsx | config, isFeatureEnabled |
| AuthContext | AuthContext.tsx | user, token, login, logout |
| CeceliaContext | CeceliaContext.tsx | messages, chatOpen, pageState, navigateTo |

### 9.3 主要页面组件

| 页面 | 路径 | API 依赖 |
|------|------|----------|
| CeceliaConfigPage | /cecelia/config | /api/brain/model-profiles/* |
| CeceliaOverview | /execution/overview | /api/brain/status/full, /api/brain/tick/status |
| BrainStatusDashboard | /execution/brain | /api/brain/* |
| OKRPage | /okr | /api/okr/trees, /api/tasks/projects |
| CommandCenter | /command-center | /api/brain/cluster/status |
| PanoramaV3 | /panorama | /api/panorama/plan |
| LiveMonitorPage | /live-monitor | /api/brain/* |
| Tasks | /tasks | /api/tasks/tasks |
| ProjectsDashboard | /projects | /api/tasks/projects |

### 9.4 共享 UI 组件

| 组件 | 位置 | 用途 |
|------|------|------|
| LoadingState | shared/components | 加载/错误/空状态 |
| ProgressBar | shared/components | 进度条 |
| StatusBadge | shared/components | 状态徽章 |
| PriorityBadge | shared/components | 优先级徽章 |
| StatsCard | shared/components | 统计卡片 |
| CeceliaChat | shared/components | 聊天组件 |
| DatabaseView | shared/components/DatabaseView | 列表/看板/画廊 |

---

## 10. 跨模块通信图

### 10.1 Brain ↔ Dashboard

```
Dashboard                                    Brain
   │                                            │
   ├─ HTTP GET /api/brain/status/full ────────→│
   │←───────────────────────────────────────────┤
   │                                            │
   ├─ HTTP POST /api/brain/tick ───────────────→│
   │←───────────────────────────────────────────┤
   │                                            │
   ├─ WebSocket /ws ──────────────────────────→│ 实时推送
   │←───────────────────────────────────────────┤
```

### 10.2 Brain ↔ 执行器

```
Brain (5221)                                 Executor Bridge
   │                                                │
   ├─ POST /trigger-cecelia ─────────────────────→ │
   │                                                │
   │                                         ┌──────┴──────┐
   │                                         │ cecelia-run │
   │                                         │ Claude Code │
   │                                         └──────┬──────┘
   │                                                │
   │←─ POST /execution-callback ────────────────────┤
   │  (更新任务状态)                                 │
```

### 10.3 API ↔ Brain

```
API Layer (Express)                          Brain (Express)
   │                                                │
   ├─ /api/tasks/* ──────────────────────────────→│ 直接操作 DB
   │                                                │
   ├─ /api/brain/intent/parse ──────────────────→│
   │←──────────────────────────────────────────────┤
   │                                                │
   ├─ /api/brain/focus ──────────────────────────→│
   │←──────────────────────────────────────────────┤
```

### 10.4 Engine Hooks ↔ Claude Code

```
Claude Code Session                          Engine Hooks
   │                                                │
   ├─ Write/Edit ───────────────────────────────→│ branch-protect.sh
   │  (检查分支/PRD/DoD)                            │
   │←──────────────────────────────────────────────┤
   │                                                │
   ├─ Session End ───────────────────────────────→│ stop.sh
   │  (检查完成状态)                                 │
   │←──────────────────────────────────────────────┤ (exit 2 = 继续)
```

---

## 11. 架构要点总结

### 11.1 设计模式

1. **三层架构**: Routes → Business Logic → Database
2. **事件驱动**: WebSocket 实时通信 + 事件总线
3. **定时驱动**: Tick 循环 (5s) + OKR Tick (5min) + 监控循环
4. **配置驱动**: navigation.config.ts 动态路由 + model-profiles 模型配置
5. **上下文隔离**: 多层 Context 提供者实现状态隔离

### 11.2 关键系统

| 系统 | 核心文件 | 职责 |
|------|----------|------|
| 调度 | tick.js | 5s 循环，任务派发 |
| 决策 | thalamus.js, decision.js | LLM 决策，意图路由 |
| 执行 | executor.js | 外部代理调用 |
| 学习 | learning.js | 策略调整，效果评估 |
| 质量 | cortex.js, review-gate.js | 代码质量分析 |
| 保护 | circuit-breaker.js, immune-system.js | 熔断，异常处理 |
| 监控 | watchdog.js, heartbeat-inspector.js | 进程保护，心跳检查 |

### 11.3 外部依赖

- **LLM**: Anthropic Claude, MiniMax, OpenAI
- **数据库**: PostgreSQL
- **实时**: WebSocket
- **工作流**: N8N
- **通知**: 飞书

---

*报告生成时间: 2026-02-26*
*分析代理: Claude Sonnet 4.6*
