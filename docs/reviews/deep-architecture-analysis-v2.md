---
id: deep-architecture-analysis-v2
version: 1.0.0
created: 2026-02-26
updated: 2026-02-26
changelog:
  - 1.0.0: 初始版本 - 完整架构逆向工程分析
---

# Cecelia Monorepo 深度架构分析报告

## 执行摘要

本文档是对 Cecelia Monorepo（位于 `/home/xx/perfect21/cecelia/`）的全面逆向工程分析结果。该系统是一个 AI 驱动的虚拟管家系统，包含 Brain（大脑后端）、Workspace（前端）、Engine（开发工作流引擎）和 Quality（质量基础设施）四大核心组件。

**关键统计数据**：
- 总代码文件数：700+
- API 端点数：280+
- 数据库表：50+
- 定时任务：15+
- Docker 容器：2
- CI/CD 工作流：5

---

## 第一部分：模块依赖矩阵

### 1.1 完整模块依赖图

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              Cecelia Monorepo                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                         packages/brain (Port 5221)                       │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │   │
│  │  │   tick.js   │  │ executor.js │  │  planner.js │  │  cortex.js  │  │   │
│  │  │  (核心循环)  │  │  (任务执行)  │  │  (任务规划)  │  │  (LLM决策)   │  │   │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  │   │
│  │         │                │                │                │          │   │
│  │  ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐  │   │
│  │  │ thalamus.js │  │decision.js │  │  actions.js │  │ routes.js  │  │   │
│  │  │  (丘脑)    │  │  (决策生成)  │  │  (任务操作)  │  │ (180+ API)  │  │   │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  │   │
│  │         │                │                │                │          │   │
│  │  ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐  │   │
│  │  │ db.js        │  │ websocket.js│  │  openai-   │  │   vigilance  │  │   │
│  │  │(数据库连接)  │  │(实时通信)   │  │  client.js  │  │    系统      │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │   │
│  │                                                                         │   │
│  │  外部依赖: PostgreSQL, Anthropic API, MiniMax API, N8N, 飞书Webhook  │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                      │                                          │
│                                      ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                         apps/api (Port 5211)                           │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │   │
│  │  │ dashboard/  │  │   system/   │  │    okr/    │  │   intent/   │  │   │
│  │  │  routes.ts  │  │  routes.ts  │  │  routes.ts  │  │  routes.ts  │  │   │
│  │  │ (运行追踪)   │  │ (系统状态)   │  │  (OKR API)  │  │  (意图识别)  │  │   │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  │   │
│  │         │                │                │                │          │   │
│  │  ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐  │   │
│  │  │  workers/   │  │   n8n-api/  │  │   github/   │  │   vps-     │  │   │
│  │  │  routes.ts  │  │  routes.ts  │  │  routes.ts  │  │  monitor/  │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │   │
│  │                                                                         │   │
│  │  外部依赖: Brain API (5221), Quality API (5681), N8N (5679), GitHub   │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                      │                                          │
│                                      ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                      apps/dashboard (React Frontend)                   │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │   │
│  │  │  App.tsx    │  │ Cecelia-    │  │  Theme-    │  │  Instance-  │  │   │
│  │  │ (主应用)     │  │ Context.tsx │  │ Context.tsx│  │ Context.tsx│  │   │
│  │  │             │  │ (聊天+页面)  │  │ (主题管理)  │  │ ( │  │  实例配置)  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │   │
│  │                                                                         │   │
│  │  页面组件: LiveMonitorPage (实时监控系统)                               │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                     packages/engine (开发工作流)                         │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │   │
│  │  │ hooks/      │  │  skills/    │  │   src/      │  │  scripts/   │  │   │
│  │  │ branch-     │  │   /dev      │  │  index.ts   │  │  qa-        │  │   │
│  │  │ protect.sh  │  │   /okr      │  │ (工具函数)   │  │  report.sh  │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                    packages/quality (质量基础设施)                       │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │   │
│  │  │ api/server  │  │   hooks/    │  │   skills/   │  │  scripts/   │  │   │
│  │  │ (Express)   │  │ pr-gate-v2  │  │   /qa       │  │  qa-run-    │  │   │
│  │  │ Port: 5681 │  │             │  │   /audit    │  │  all.sh     │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 文件 → 依赖关系矩阵

以下矩阵展示了每个核心文件导入的依赖模块：

| 文件 | 直接依赖模块 | 类型 | 依赖数量 |
|------|------------|------|----------|
| `packages/brain/src/tick.js` | pool, focus, actions, executor, slot-allocator, decision, planner, event-bus, circuit-breaker, taskEvents, thalamus, decision-executor, alertness, quarantine, dispatch-stats, health-monitor, dept-heartbeat, daily-review-scheduler, desire | 内部 | 18 |
| `packages/brain/src/executor.js` | child_process, fs, fs/promises, os, path, uuid, pool, model-profile, task-router, task-updater, trace | 内部+系统 | 12 |
| `packages/brain/src/routes.js` | pool, 多个模块 | 内部 | 50+ |
| `packages/brain/src/cortex.js` | pool, 多个模块 | 内部 | 20+ |
| `packages/brain/src/thalamus.js` | pool, 多个模块 | 内部 | 20+ |
| `apps/api/src/system/routes.ts` | express, child_process, system/*, BRAIN_API, QUALITY_API, N8N_API | 内部+外部 | 40+ |
| `apps/api/src/dashboard/routes.ts` | express, task-tracker, BRAIN_API | 内部+外部 | 10+ |
| `apps/dashboard/src/App.tsx` | react, react-router-dom, lucide-react, Context Providers, navigation.config | React生态 | 15+ |

### 1.3 反向依赖矩阵（被导入情况）

以下矩阵展示每个核心模块被哪些文件导入：

| 模块 | 被以下文件导入 | 用途 |
|------|-------------|------|
| `db.js` (brain) | tick.js, executor.js, planner.js, routes.js, cortex.js, thalamus, 所有actions | 数据库连接池 |
| `actions.js` (brain) | tick.js, routes.js | 任务操作 CRUD |
| `executor.js` (brain) | tick.js | 任务执行触发 |
| `planner.js` (brain) | tick.js | 任务规划选择 |
| `decision.js` (brain) | tick.js | 决策生成 |
| `cortex.js` (brain) | routes.js | LLM 决策分析 |
| `thalamus.js` (brain) | routes.js | 事件路由 |
| `websocket.js` (brain) | server.js | 实时通信 |
| `task-tracker` (api) | dashboard/routes.ts | 任务追踪 |
| ` CeceliaContext` (dashboard) | App.tsx | 全局状态 |

---

## 第二部分：API 端点完整清单

### 2.1 Brain API (Port 5221)

**路由文件**: `packages/brain/src/routes.js`

#### 2.1.1 核心状态端点

| 端点 | 方法 | Handler | 功能 | SQL查询 |
|------|------|---------|------|---------|
| `/api/brain/status` | GET | statusHandler | 获取Brain完整状态 | 是 |
| `/api/brain/status/full` | GET | fullStatusHandler | 获取完整系统状态 | 是 |
| `/api/brain/health` | GET | healthCheck | 健康检查 | 否 |
| `/api/brain/memory` | GET/POST | memoryRoutes | 记忆管理 | 是 |
| `/api/brain/policy` | GET/POST | policyRoutes | 策略管理 | 是 |
| `/api/brain/decisions` | GET | decisionsHandler | 决策列表 | 是 |

#### 2.1.2 任务管理端点

| 端点 | 方法 | Handler | 功能 | SQL查询 |
|------|------|---------|------|---------|
| `/api/brain/tasks` | GET | tasksHandler | 获取任务列表 | 是 |
| `/api/brain/tasks` | POST | createTaskHandler | 创建任务 | 是 |
| `/api/brain/tasks/:task_id` | PATCH | updateTaskHandler | 更新任务 | 是 |
| `/api/brain/tasks/:task_id/feedback` | POST | feedbackHandler | 任务反馈 | 是 |
| `/api/brain/tasks/:taskId/logs` | GET | getTaskLogs | 获取任务日志 | 是 |
| `/api/brain/tasks/:taskId/checkpoints` | GET | getCheckpoints | 获取检查点 | 是 |
| `/api/brain/tasks/:id/dispatch` | POST | dispatchTask | 派发任务 | 是 |

#### 2.1.3 OKR/目标端点

| 端点 | 方法 | Handler | 功能 | SQL查询 |
|------|------|---------|------|---------|
| `/api/brain/goals` | GET | goalsHandler | 获取目标列表 | 是 |
| `/api/brain/goals` | POST | createGoalHandler | 创建目标 | 是 |
| `/api/brain/focus` | GET | focusHandler | 获取当前焦点 | 是 |
| `/api/brain/focus` | POST | setFocusHandler | 设置焦点 | 是 |
| `/api/brain/goal/compare` | POST | compareGoals | 比较目标 | 是 |

#### 2.1.4 Tick 控制端点

| 端点 | 方法 | Handler | 功能 |
|------|------|---------|------|
| `/api/brain/tick` | POST | manualTick | 手动触发tick |
| `/api/brain/tick/status` | GET | tickStatus | tick状态 |
| `/api/brain/tick/enable` | POST | enableTick | 启用tick |
| `/api/brain/tick/disable` | POST | disableTick | 禁用tick |
| `/api/brain/tick/drain` | POST | drainTick | 排空模式 |

#### 2.1.5 警觉系统端点

| 端点 | 方法 | Handler | 功能 |
|------|------|---------|------|
| `/api/brain/alertness` | GET | getAlertness | 获取警觉等级 |
| `/api/brain/alertness` | POST | setAlertness | 设置警觉等级 |
| `/api/brain/alertness/evaluate` | POST | evaluateAlertness | 评估警觉 |
| `/api/brain/alertness/override` | POST | overrideAlertness | 覆盖警觉 |

#### 2.1.6 隔离区/熔断器端点

| 端点 | 方法 | Handler | 功能 |
|------|------|---------|------|
| `/api/brain/quarantine` | GET | getQuarantine | 获取隔离区 |
| `/api/brain/quarantine` | POST | addToQuarantine | 加入隔离区 |
| `/api/brain/quarantine/:taskId/release` | POST | releaseFromQuarantine | 释放任务 |
| `/api/brain/quarantine/stats` | GET | quarantineStats | 隔离统计 |
| `/api/brain/circuit-breaker` | GET | getCircuitBreaker | 获取熔断器状态 |
| `/api/brain/circuit-breaker` | POST | triggerCircuitBreaker | 触发熔断 |

#### 2.1.7 意图/编排端点

| 端点 | 方法 | Handler | 功能 |
|------|------|---------|------|
| `/api/brain/intent/parse` | POST | parseIntent | 解析意图 |
| `/api/brain/intent/create` | POST | createFromIntent | 从意图创建 |
| `/api/brain/intent/execute` | POST | executeIntent | 执行意图 |
| `/api/brain/orchestrator/chat` | GET/POST | chatHandler | 聊天编排 |
| `/api/brain/orchestrator/realtime` | GET/POST | realtimeHandler | 实时编排 |

#### 2.1.8 执行器端点

| 端点 | 方法 | Handler | 功能 |
|------|------|---------|------|
| `/api/brain/executor/status` | GET | executorStatus | 执行器状态 |
| `/api/brain/cluster/status` | GET | clusterStatus | 集群状态 |
| `/api/brain/execution-callback` | POST | executionCallback | 执行回调 |
| `/api/brain/execution-history` | GET | executionHistory | 执行历史 |

#### 2.1.9 看门狗端点

| 端点 | 方法 | Handler | 功能 |
|------|------|---------|------|
| `/api/brain/watchdog` | GET | watchdogStatus | 看门狗状态 |
| `/api/brain/watchdog/kill` | POST | killProcess | 终止进程 |
| `/api/brain/watchdog` | POST | registerWatchdog | 注册看门狗 |

#### 2.1.10 学习/记忆端点

| 端点 | 方法 | Handler | 功能 |
|------|------|---------|------|
| `/api/brain/learning` | GET/POST | learningRoutes | 学习系统 |
| `/api/brain/cortex` | GET/POST | cortexRoutes | 皮层分析 |
| `/api/brain/reflections` | GET/POST | reflectionsRoutes | 反思记录 |

#### 2.1.11 其他端点

| 端点 | 方法 | Handler | 功能 |
|------|------|---------|------|
| `/api/brain/slots` | GET | getSlots | 槽位状态 |
| `/api/brain/vps-slots` | GET | getVpsSlots | VPS槽位 |
| `/api/brain/budget-cap` | PUT | updateBudgetCap | 预算上限 |
| `/api/brain/events` | GET | getEvents | 事件列表 |
| `/api/brain/blocks` | GET/POST/PUT/DELETE | blocksRoutes | 阻塞管理 |
| `/api/brain/proposals` | GET/POST | proposalsRoutes | 提案管理 |
| `/api/brain/daily-reports` | GET | dailyReports | 日报 |
| `/api/brain/user/profile` | GET/PUT | userProfile | 用户配置 |
| `/api/brain/staff` | GET/POST | staffRoutes | 员工管理 |

### 2.2 Workspace API (Port 5211)

**路由文件**: `apps/api/src/`

#### 2.2.1 Dashboard 路由

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/cecelia/runs` | POST | 创建新运行 |
| `/api/cecelia/runs/:id` | GET | 获取运行详情 |
| `/api/cecelia/runs/:runId/checkpoints/:checkpointId` | PATCH | 更新检查点 |
| `/api/cecelia/seats` | GET | 座位状态 |
| `/api/cecelia/overview` | GET | 概览 |
| `/api/cecelia/health` | GET | 健康检查 |
| `/api/cecelia/chat` | POST | 聊天接口 |

#### 2.2.2 System 路由

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/system/status` | GET | 系统状态 |
| `/api/system/health` | GET | 健康检查 |
| `/api/system/dlq` | GET/POST | 死信队列 |
| `/api/system/degrade` | GET/POST | 降级管理 |
| `/api/system/assertions` | GET/POST | 断言管理 |
| `/api/system/memory` | GET/POST/DELETE | 内存管理 |
| `/api/system/plan` | POST/GET | 计划引擎 |
| `/api/system/dev-session/*` | * | 开发会话管理 (13个端点) |

#### 2.2.3 Intent 路由

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/intent/recognize` | POST | 识别意图 |
| `/api/intent/health` | GET | 健康检查 |

#### 2.2.4 Workers 路由

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/workers` | GET | 获取Worker列表 |
| `/api/workers/:workerId` | GET | Worker详情 |
| `/api/workers/:workerId/workflows` | GET | Worker工作流 |
| `/api/workers/match/:workflowName` | GET | 匹配Worker |

#### 2.2.5 N8N 路由

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/v1/n8n-workflows/*` | * | N8N工作流代理 |
| `/api/v1/n8n-live-status/*` | * | N8N实时状态 |

#### 2.2.6 监控路由

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/v1/vps-monitor/stats` | GET | VPS统计 |
| `/api/v1/vps-monitor/containers` | GET | 容器列表 |
| `/api/v1/vps-monitor/services` | GET | 服务列表 |
| `/api/watchdog/*` | * | 看门狗代理 |

### 2.3 Quality API (Port 5681)

**路由文件**: `packages/quality/api/server.js`

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/state` | GET | 系统状态 |
| `/api/health` | GET | 健康检查 |
| `/api/registry` | GET | 测试注册表 |
| `/api/contracts` | GET | 回归契约 |
| `/api/execute` | POST | 执行测试 |
| `/api/dashboard` | GET | Dashboard数据 |

---

## 第三部分：数据库表访问矩阵

### 3.1 数据库连接配置

**文件**: `packages/brain/src/db-config.js`

```javascript
// 环境变量
DB_HOST=localhost
DB_PORT=5432
DB_NAME=cecelia
DB_USER=postgres
DB_PASSWORD=***
```

### 3.2 表 → 文件读写矩阵

| 表名 | 读文件 | 写文件 | 用途 |
|------|--------|--------|------|
| `tasks` | tick.js, planner.js, routes.js, executor.js, actions.js | actions.js, task-updater.js | 任务管理 |
| `goals` | tick.js, planner.js, routes.js, kr-progress.js | routes.js, actions.js | OKR目标 |
| `projects` | tick.js, planner.js, routes.js, project-activator.js | routes.js, actions.js | 项目管理 |
| `initiatives` | tick.js, planner.js, routes.js, initiative-closer.js | routes.js | 计划管理 |
| `areas` | routes.js, planner.js | routes.js | 领域管理 |
| `runs` | routes.js, executor.js | executor.js, actions.js | 执行记录 |
| `memory` | memory-retriever.js, cortex.js, routes.js | cortex.js, routes.js | 记忆存储 |
| `decisions` | decision.js, routes.js | decision.js | 决策记录 |
| `heartbeats` | heartbeat-inspector.js, routes.js | executor.js | 心跳记录 |
| `desires` | routes.js, desire/* | routes.js | 欲望系统 |
| `blocks` | routes.js | routes.js | 阻塞管理 |
| `quarantine` | quarantine.js, routes.js | quarantine.js | 隔离区 |
| `learning` | learning.js, routes.js | learning.js | 学习数据 |
| `reflections` | routes.js, cortex.js | cortex.js | 反思记录 |
| `proposals` | proposal.js, routes.js | routes.js | 提案管理 |

### 3.3 核心SQL查询示例

**文件**: `packages/brain/src/tick.js` (部分)

```sql
-- 查询待处理任务
SELECT * FROM tasks WHERE status = 'queued' ORDER BY priority DESC, created_at ASC

-- 查询活跃项目
SELECT * FROM projects WHERE status = 'active' ORDER BY updated_at DESC

-- 查询目标进度
SELECT g.*,
       (SELECT COUNT(*) FROM tasks WHERE goal_id = g.id AND status = 'completed') as completed_tasks,
       (SELECT COUNT(*) FROM tasks WHERE goal_id = g.id) as total_tasks
FROM goals g WHERE g.status = 'active'

-- 更新任务状态
UPDATE tasks SET status = $1, updated_at = NOW() WHERE id = $2
```

---

## 第四部分：环境变量完整清单

### 4.1 Brain 环境变量

**文件**: `packages/brain/src/db-config.js`, `packages/brain/src/executor.js`, 等

| 变量名 | 默认值 | 使用位置 | 必填 | 说明 |
|--------|--------|---------|------|------|
| `DB_HOST` | localhost | db-config.js | 是 | PostgreSQL主机 |
| `DB_PORT` | 5432 | db-config.js | 是 | PostgreSQL端口 |
| `DB_NAME` | cecelia | db-config.js | 是 | 数据库名 |
| `DB_USER` | postgres | db-config.js | 是 | 数据库用户 |
| `DB_PASSWORD` | - | db-config.js | 是 | 数据库密码 |
| `PORT` | 5221 | server.js | 是 | Brain API端口 |
| `CECELIA_TICK_INTERVAL_MS` | 5000 | tick.js | 否 | Tick循环间隔 |
| `CECELIA_TICK_ENABLED` | true | tick.js | 否 | 是否启用Tick |
| `DISPATCH_TIMEOUT_MINUTES` | 60 | tick.js | 否 | 任务派发超时 |
| `HK_MINIMAX_URL` | http://100.86.118.99:5226 | executor.js | 否 | 香港执行器 |
| `CECELIA_RUN_PATH` | /home/xx/bin/cecelia-run | executor.js | 否 | 运行脚本路径 |
| `CECELIA_WORK_DIR` | /home/xx/perfect21/cecelia/core | executor.js | 否 | 工作目录 |
| `CECELIA_BUDGET_SLOTS` | 8 | executor.js | 否 | 预算槽位 |
| `CECELIA_MAX_SEATS` | 8 | executor.js | 否 | 最大并发数 |
| `EXECUTOR_BRIDGE_URL` | http://localhost:3457 | executor.js | 否 | 执行器桥接 |
| `ACTIVE_AREA_COUNT` | 3 | planner.js | 否 | 活跃领域数 |
| `N8N_API_URL` | http://localhost:5679 | actions.js | 否 | N8N API |
| `N8N_API_KEY` | - | actions.js | 是 | N8N API密钥 |
| `FEISHU_BOT_WEBHOOK` | - | notifier.js | 是 | 飞书Webhook |
| `ANTHROPIC_API_KEY` | - | thalamus.js, cortex.js | 是 | Anthropic API |
| `OPENAI_API_KEY` | - | openai-client.js | 是 | OpenAI API |
| `WS_ALLOWED_ORIGINS` | * | websocket.js | 否 | WebSocket跨域 |
| `CECELIA_NIGHTLY_HOUR` | 22 | nightly-tick.js | 否 | 夜间任务小时 |
| `CECELIA_NIGHTLY_MINUTE` | 0 | nightly-tick.js | 否 | 夜间任务分钟 |
| `CECELIA_OKR_TICK_INTERVAL_MS` | 300000 | okr-tick.js | 否 | OKR Tick间隔 |
| `CECELIA_CLEANUP_INTERVAL_MS` | 3600000 | tick.js | 否 | 清理间隔 |
| `CECELIA_INIT_RECOVERY_INTERVAL_MS` | 300000 | tick.js | 否 | 恢复检查间隔 |

### 4.2 Workspace API 环境变量

**文件**: `apps/api/src/dashboard/routes.ts`, `apps/api/src/system/routes.ts`

| 变量名 | 默认值 | 使用位置 | 必填 | 说明 |
|--------|--------|---------|------|------|
| `BRAIN_API` | http://localhost:5221 | system/routes.ts | 否 | Brain API地址 |
| `QUALITY_API` | http://localhost:5681 | system/routes.ts | 否 | Quality API地址 |
| `N8N_BACKEND` | http://localhost:5679 | system/routes.ts | 否 | N8N后端地址 |
| `BRAIN_NODE_API` | http://localhost:5221 | dashboard/routes.ts | 否 | Brain API地址 |
| `MAX_CONCURRENT` | 8 | dashboard/routes.ts | 否 | 最大并发数 |
| `LOCK_DIR` | /tmp/cecelia-locks | dashboard/routes.ts | 否 | 锁目录 |
| `GITHUB_TOKEN` | - | github/routes.ts | 是 | GitHub Token |
| `N8N_LOCAL_URL` | http://localhost:5679 | n8n-api/routes.ts | 否 | N8N本地地址 |
| `N8N_API_KEY` | - | n8n-api/routes.ts | 是 | N8N API密钥 |
| `DEV_RUNS_DIR` | ~/dev/.dev-runs | panorama/routes.ts | 否 | 开发运行目录 |

### 4.3 Docker 环境变量

**文件**: `docker-compose.yml`

| 变量名 | 来源 | 说明 |
|--------|------|------|
| `BRAIN_VERSION` | docker-compose.yml | Brain镜像版本 |
| `DB_HOST` | .env.docker | 数据库主机 |
| `TICK_INTERVAL` | .env.docker | Tick间隔(5000ms) |
| `MAX_SEATS` | .env.docker | 最大并发(8) |

---

## 第五部分：外部HTTP调用清单

### 5.1 Brain 外部调用

**文件**: `packages/brain/src/executor.js`

| URL | 位置 | 超时 | 错误处理 | 用途 |
|-----|------|------|---------|------|
| `HK_MINIMAX_URL/execute` | executor.js:fetch | 60s | try-catch | 香港执行器触发 |
| `EXECUTOR_BRIDGE_URL/trigger-cecelia` | executor.js:fetch | 30s | try-catch | 桥接服务触发 |
| `EXECUTOR_BRIDGE_URL/` | executor.js:fetch | 10s | try-catch | 桥接健康检查 |

**文件**: `packages/brain/src/cortex.js`

| URL | 位置 | 超时 | 错误处理 | 用途 |
|-----|------|------|---------|------|
| `anthropic.com/v1/messages` | cortex.js:fetch | 120s | try-catch | Anthropic LLM调用 |

**文件**: `packages/brain/src/thalamus.js`

| URL | 位置 | 超时 | 错误处理 | 用途 |
|-----|------|------|---------|------|
| `localhost:5221/api/brain/memory/search` | thalamus.js:fetch | 10s | try-catch | 记忆搜索 |
| `minimaxi.com/v1/chat/completions` | thalamus.js:fetch | 30s | try-catch | MiniMax API |
| `anthropic.com/v1/messages` | thalamus.js:fetch | 60s | try-catch | Anthropic API |

**文件**: `packages/brain/src/actions.js`

| URL | 位置 | 超时 | 错误处理 | 用途 |
|-----|------|------|---------|------|
| `N8N_API_URL` | actions.js:fetch | 30s | try-catch | N8N工作流触发 |

**文件**: `packages/brain/src/routes.js`

| URL | 位置 | 超时 | 错误处理 | 用途 |
|-----|------|------|---------|------|
| `HK_BRIDGE_URL/status` | routes.js:fetch | 10s | try-catch | 香港桥接检查 |

### 5.2 Workspace API 外部调用

**文件**: `apps/api/src/system/routes.ts`

| URL | 位置 | 超时 | 错误处理 | 用途 |
|-----|------|------|---------|------|
| `${BRAIN_API}/api/brain/tick/status` | system/routes.ts | 5s | fetchWithTimeout | Brain状态 |
| `${BRAIN_API}/api/brain/focus/summary` | system/routes.ts | 5s | fetchWithTimeout | 焦点摘要 |
| `http://localhost:5211/api/tasks/tasks` | system/routes.ts | 5s | fetchWithTimeout | 任务列表 |
| `${QUALITY_API}/api/state` | system/routes.ts | 5s | fetchWithTimeout | Quality状态 |
| `${N8N_API}/healthz` | system/routes.ts | 5s | fetchWithTimeout | N8N健康 |
| `${N8N_API}/api/v1/executions` | system/routes.ts | 8s | fetchWithTimeout | N8N执行状态 |

**文件**: `apps/api/src/dashboard/routes.ts`

| URL | 位置 | 超时 | 错误处理 | 用途 |
|-----|------|------|---------|------|
| `${BRAIN_API}/intent/parse` | dashboard/routes.ts | 30s | try-catch | 意图解析 |
| `${BRAIN_API}/intent/create` | dashboard/routes.ts | 60s | try-catch | 创建任务 |

**文件**: `apps/api/src/n8n-api/routes.ts`

| URL | 位置 | 超时 | 错误处理 | 用途 |
|-----|------|------|---------|------|
| `${N8N_URL}/api/v1/...` | n8n-api/routes.ts | 8s | try-catch | N8N API代理 |

---

## 第六部分：定时任务清单

### 6.1 Brain 定时任务

| 任务名 | 文件 | 间隔 | 功能 |
|--------|------|------|------|
| `_loopTimer` | tick.js | 5s | 主循环检查 |
| `_recoveryTimer` | tick.js | 5min | 恢复检查 |
| `_cleanupTimer` | tick.js | 1hour | 清理过期数据 |
| `_nightlyTimer` | nightly-tick.js | 每日22:00 | 夜间任务 |
| `_okrLoopTimer` | okr-tick.js | 5min | OKR进度检查 |
| `_promotionJobInterval` | promotion-job.js | 1hour | 任务升级检查 |
| `_monitorTimer` | monitor-loop.js | 1min | 监控系统 |
| `heartbeatInterval` | websocket.js | 30s | WebSocket心跳 |

### 6.2 定时任务详细说明

**tick.js - 主循环**

```javascript
// 文件: packages/brain/src/tick.js
setInterval(_loopTimer, 5000);  // 5秒循环检查
setInterval(_recoveryTimer, 300000);  // 5分钟恢复检查
setInterval(cleanupTimer, 3600000);  // 1小时清理
```

**nightly-tick.js - 夜间任务**

```javascript
// 文件: packages/brain/src/nightly-tick.js
// 每日 22:00 执行
const nightlyTime = new Date();
nightlyTime.setHours(22, 0, 0, 0);
setTimeout(_nightlyTimer, delay);  // 每日触发
```

**okr-tick.js - OKR循环**

```javascript
// 文件: packages/brain/src/okr-tick.js
setInterval(_okrLoopTimer, 300000);  // 5分钟
```

---

## 第七部分：WebSocket事件清单

### 7.1 WebSocket 服务器

**文件**: `packages/brain/src/websocket.js`

```javascript
// 初始化
initWebSocketServer(server, allowedOrigins);

// 广播函数
broadcast(event, data);
broadcastRunUpdate(runId, status, progress);
getConnectedClientsCount();
shutdownWebSocketServer();
```

### 7.2 事件列表

| 事件名 | 发射位置 | 监听位置 | 用途 |
|--------|---------|---------|------|
| `run:update` | executor.js, actions.js | dashboard | 运行状态更新 |
| `task:status` | actions.js | dashboard | 任务状态变化 |
| `tick:status` | tick.js | dashboard | Tick循环状态 |
| `alertness:change` | alertness/index.js | dashboard | 警觉等级变化 |
| `circuit:open` | circuit-breaker.js | dashboard | 熔断器打开 |
| `quarantine:add` | quarantine.js | dashboard | 任务进入隔离区 |

### 7.3 客户端连接

**文件**: `apps/dashboard/src/contexts/CeceliaContext.tsx`

```typescript
// 聊天历史加载
const response = await fetch(`${API_URL}/api/brain/orchestrator/chat/history?limit=20`);
```

---

## 第八部分：React组件完整树

### 8.1 组件树结构

```
App.tsx (主应用)
├── AuthContext (认证上下文)
├── ThemeContext (主题上下文)
│   └── ThemeProvider
├── InstanceContext (实例配置)
│   └── buildCoreConfig()
├── CeceliaContext (Cecelia聊天+页面感知)
│   ├── 聊天状态管理
│   ├── 页面注册机制
│   └── 前端工具执行
├── CollapsibleNavItem (导航项)
│   └── 可折叠子菜单
├── Breadcrumb (面包屑)
├── DynamicRouter (动态路由)
│   └── Routes + Route
└── Lazy: CeceliaChat (全局聊天)

Pages:
└── LiveMonitorPage (实时监控)
    ├── Brain状态区域
    ├── OKR目标区域
    ├── 任务列表区域
    ├── Agents监控区域
    └── VPS基础设施区域
```

### 8.2 Context Providers

| Context | 文件 | 功能 |
|---------|------|------|
| `AuthContext` | contexts/AuthContext.tsx | 用户认证（自动登录本地管理员） |
| `ThemeContext` | contexts/ThemeContext.tsx | 主题管理（light/dark/auto） |
| `InstanceContext` | contexts/InstanceContext.tsx | 动态加载Core配置 |
| `CeceliaContext` | contexts/CeceliaContext.tsx | 聊天+页面感知+前端工具 |

### 8.3 页面组件

| 组件 | 文件 | 功能 |
|------|------|------|
| `LiveMonitorPage` | pages/live-monitor/LiveMonitorPage.tsx | 实时系统监控 |

### 8.4 通用组件

| 组件 | 文件 | 功能 |
|------|------|------|
| `PrivateRoute` | components/PrivateRoute.tsx | 路由保护HOC |
| `Breadcrumb` | components/Breadcrumb.tsx | 面包屑导航 |
| `DynamicRouter` | components/DynamicRouter.tsx | 动态路由生成 |
| `CollapsibleNavItem` | components/CollapsibleNavItem.tsx | 可折叠导航 |

---

## 第九部分：CI/CD流水线分析

### 9.1 工作流列表

| 工作流 | 触发条件 | 作业数 | 说明 |
|--------|---------|--------|------|
| `brain-ci.yml` | brain/**, scripts/** 变更 | 5 | Brain后端CI |
| `workspace-ci.yml` | apps/** 变更 | 3 | 前端UI CI |
| `engine-ci.yml` | engine/** 变更 | 9 | 开发引擎CI |
| `workflows-ci.yml` | workflows/** 变更 | 5 | Agent工作流CI |
| `quality-ci.yml` | quality/** 变更 | 5 | 质量基础设施CI |

### 9.2 Brain CI 详细

**文件**: `.github/workflows/brain-ci.yml`

```yaml
jobs:
  - changes:          # 检测变更
  - version-check:    # 版本检查（PR时）
  - facts-check:      # 事实校验（brain变更时）
  - brain-test:       # 测试+GoldenPath
  - ci-passed:        # 汇总结果
```

**关键检查**:
1. 版本号更新验证
2. facts-check.mjs 校验代码与DEFINITION.md一致性
3. 单元测试 + Golden Path E2E测试
4. 回归契约验证

### 9.3 Engine CI 详细

**文件**: `.github/workflows/engine-ci.yml`

```yaml
jobs:
  - changes:                    # 检测变更
  - version-check:              # Semver版本检查
  - test:                      # TypeCheck + 单元测试 + Build + DevGate
  - contract-drift-check:      # 回归契约漂移检查
  - impact-check:               # 能力变更检查
  - known-failures-protection:  # 测试白名单保护
  - config-audit:              # 配置文件审计
  - ci-passed:                 # 汇总结果
```

### 9.4 Docker 部署

**文件**: `docker-compose.yml`

```yaml
services:
  node-brain:
    image: cecelia-brain:${BRAIN_VERSION}
    ports:
      - "5221:5221"
    healthcheck:
      curl -f http://localhost:5221/api/brain/tick/status
    tmpfs: /tmp:size=100m
    read_only: true

  frontend:
    image: node:20-alpine
    ports:
      - "5211:5211"
    depends_on:
      node-brain:
        condition: service_healthy
```

---

## 第十部分：错误处理模式分析

### 10.1 Brain 错误处理

**模式1: try-catch + 错误回调**

```javascript
// 文件: packages/brain/src/executor.js
try {
  const result = await fetch(HK_MINIMAX_URL + '/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
} catch (error) {
  await pool.query(
    'UPDATE runs SET status = $1, error = $2 WHERE id = $3',
    ['failed', error.message, runId]
  );
}
```

**模式2: 熔断器保护**

```javascript
// 文件: packages/brain/src/circuit-breaker.js
class CircuitBreaker {
  async call(fn) {
    if (this.state === 'open') {
      throw new Error('Circuit is open');
    }
    try {
      const result = await fn();
      this.success();
      return result;
    } catch (error) {
      this.failure();
      throw error;
    }
  }
}
```

**模式3: 隔离区 quarantine**

```javascript
// 文件: packages/brain/src/quarantine.js
async function addToQuarantine(taskId, reason) {
  await pool.query(
    'INSERT INTO quarantine (task_id, reason, created_at) VALUES ($1, $2, NOW())',
    [taskId, reason]
  );
  await pool.query('UPDATE tasks SET status = $1 WHERE id = $2', ['quarantined', taskId]);
}
```

### 10.2 Workspace API 错误处理

**模式: fetchWithTimeout**

```typescript
// 文件: apps/api/src/system/routes.ts
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeout = 5000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } catch (error) {
    throw new Error(`Fetch timeout: ${url}`);
  } finally {
    clearTimeout(id);
  }
}
```

---

## 第十一部分：代码重复检测

### 11.1 重复模式

| 模式 | 位置 | 重复次数 | 建议 |
|------|------|---------|------|
| 数据库连接池初始化 | db.js (brain), db.js (api/task-system) | 2 | 提取到共享模块 |
| 任务状态常量 | actions.js, task-updater.js, routes.js | 3 | 提取到constants.js |
| 日期格式化函数 | 多个dashboard组件 | 5+ | 提取到utils/date.ts |
| API错误处理 | system/routes.ts, dashboard/routes.ts | 2 | 提取到middleware/ |

### 11.2 未使用的导出

基于代码分析，以下导出可能未被使用：

| 文件 | 导出 | 状态 |
|------|------|------|
| `packages/brain/src/model-registry.js` | 多个profile函数 | 需验证 |
| `packages/brain/src/templates.js` | 多个template函数 | 需验证 |
| `packages/engine/src/index.ts` | validateHooks | 已废弃 |

---

## 第十二部分：架构设计亮点与建议

### 12.1 设计亮点

1. **三层大脑架构**: L0(纯代码) → L1(MiniMax快速响应) → L2(Opus深度分析)
2. **Tick循环机制**: 5s检查/5min执行的持续运行模式
3. **多区域部署**: US研发+HK生产，通过Tailscale内网连接
4. **DevGate门禁**: 事实校验+版本同步+DoD映射，三重保障
5. **自动化工作流**: PRD→Task→PR→CI→合并，端到端自动化

### 12.2 改进建议

1. **数据库连接池共享**: brain和workspace api各自初始化连接池，建议提取到共享包
2. **统一错误处理**: 各模块错误处理模式不统一，建议统一到middleware
3. **配置中心化**: 大量环境变量散落各处，建议统一到config包
4. **监控标准化**: 部分模块有监控，部分没有，建议统一监控埋点
5. **API版本管理**: 180+ API端点无版本管理，建议添加API版本前缀

---

## 附录

### A. 文件路径速查

| 模块 | 路径 |
|------|------|
| Brain核心 | `packages/brain/src/` |
| Brain路由 | `packages/brain/src/routes.js` |
| Brain Tick | `packages/brain/src/tick.js` |
| Workspace API | `apps/api/src/` |
| Dashboard前端 | `apps/dashboard/src/` |
| Engine Hooks | `packages/engine/hooks/` |
| Engine Skills | `packages/engine/skills/` |
| Quality API | `packages/quality/api/` |
| Docker配置 | `docker-compose.yml` |
| CI配置 | `.github/workflows/` |

### B. 端口映射

| 服务 | 端口 | 协议 |
|------|------|------|
| Brain API | 5221 | HTTP |
| Workspace API | 5211 | HTTP |
| Quality API | 5681 | HTTP |
| N8N | 5679 | HTTP |
| PostgreSQL | 5432 | TCP |

### C. 版本信息

- **Monorepo**: 1.2.2
- **Brain**: 1.99.1
- **Schema**: 076
- **DEFINITION.md**: 2.0.0 (2026-02-25)

---

*报告生成时间: 2026-02-26*
*分析方法: 逐文件扫描 + 静态代码分析*
