# Cecelia 定义文档

**版本**: 2.0.0
**创建时间**: 2026-02-01
**最后更新**: 2026-03-05



**Brain 版本**: 1.217.0

**状态**: 生产运行中

---

## 目录

1. [核心定位](#1-核心定位)
2. [架构总览](#2-架构总览)
3. [三层大脑](#3-三层大脑)
4. [数据模型](#4-数据模型)
5. [任务生命周期](#5-任务生命周期)
6. [保护系统](#6-保护系统)
7. [并发与资源管理](#7-并发与资源管理)
8. [部署架构](#8-部署架构)
9. [API 接口](#9-api-接口)
10. [文件地图](#10-文件地图)
11. [运维手册](#11-运维手册)

---

## 1. 核心定位

### 1.1 Cecelia 是什么

**Cecelia = 24/7 自主运行的管家系统**

```
Cecelia Core = Brain (Node.js, port 5221)
             + Tick Loop (每 5s 循环检查，每 2min 执行一次 tick)
             + 三层大脑（L0 脑干/L1 丘脑/L2 皮层）
             + 保护系统（alertness, circuit-breaker, quarantine, watchdog）
```

**关键理解**：Cecelia **自己不干活**，只负责决策和调度。

- **不写代码**：召唤 Caramel（外部程序员 Agent）
- **不做 QA**：召唤小检（外部测试员 Agent）
- **不做审计**：召唤小审（外部审计师 Agent）
- **不处理数据任务**：路由到 N8N（外部自动化工具）

Cecelia 是一个自主运行的任务调度与决策系统。她接收 OKR 目标，自动拆解为可执行任务，派发给外部员工执行，监控执行状态，处理失败和异常，并从经验中学习。

**核心职责（扩展）**：
- **主动汇报**：定期通过 Dashboard 推送运行状态、进度快照和洞察，不等用户主动查看。
- **正向感知**：在系统正常运行时也持续产生认知活动，不只在出现异常时才发出声音。

### 1.2 核心器官（Core 内部组件）

**Core 只包含 Cecelia 的生命体内部器官**：

| 器官 | 实现 | 职责 | 说明 |
|------|------|------|------|
| ❤️ **心脏** | tick.js | Tick Loop 驱动 | 每 5s 循环，每 2min 执行 |
| 🧠 **大脑 L2** | cortex.js | 皮层（深度分析） | Opus，RCA/战略调整/记录经验 |
| 🧠 **大脑 L1** | thalamus.js | 丘脑（事件路由） | MiniMax M2.1，快速判断/异常检测 |
| 🧠 **大脑 L0** | planner.js, executor.js, tick.js | 脑干（纯代码） | 调度、派发、保护系统 |
| 🛡️ **保护系统** | alertness/, circuit-breaker, quarantine, watchdog | 自我保护 | 四重防护 |
| 📋 **规划器** | planner.js | KR 轮转、任务生成 | 基于评分选择下一个任务 |
| 🔌 **对外接口** | executor.js | 召唤外部员工 | 不自己干活，只召唤 |
| 🌐 **神经系统** | routes.js | HTTP API | Express 路由 |
| 📊 **记忆读写** | 读写 working_memory 等表 | 记忆逻辑 | 数据在外部（PostgreSQL） |

**明确**：PostgreSQL 不是"记忆器官"，它是外部存储设备（见 Section 1.3）。

### 1.3 外部依赖（Infrastructure）

**Cecelia 依赖以下外部服务，但它们不是 Core 的一部分**：

| 服务 | 位置 | 职责 | 类比 |
|------|------|------|------|
| **PostgreSQL** | 独立容器 (port 5432) | 数据存储 | 外部硬盘 |
| **N8N** | HK server (port 5678) | 处理 `data` 类型任务 | 外包数据公司 |

**说明**：
- PostgreSQL：存储所有状态和历史，但它不是 Core 的"器官"，而是外部存储设备
- N8N：只处理 HK region 的 `data` 类型任务（task-router.js 路由规则），US region 的 data 任务不走 N8N

### 1.4 外部员工（Agent Workers）

**Cecelia 自己不干活**，通过 `executor.js` 召唤外部员工执行任务：

| 员工 | Skill | 模型 (Anthropic / MiniMax) | 职责 | 类比 |
|------|-------|------|------|------|
| **Caramel** | /dev | Sonnet / M2.5-highspeed | 编程（写代码、PR、CI） | 外包程序员 |
| **小检** | /qa | Sonnet / M2.5-highspeed | QA 总控 | 外包测试员 |
| **小审** | /audit | Sonnet / M2.5-highspeed | 代码审计 | 外包审计师 |
| **秋米** | /okr | Sonnet / M2.5-highspeed | OKR 拆解（边做边拆） | 外部顾问 |
| **审查员** | /review | Sonnet / M2.5-highspeed | 代码审查（只读模式） | 外部审查员 |
| **Vivian** | - | MiniMax Ultra | 拆解质量审查 (HK) | 外部审查员 |

**关键理解**：
- 这些是**外部无头进程**，不属于 Core
- Cecelia 通过 `executor.js` 召唤它们
- `executor.js` 是 Core 的"对外接口器官"，不是"执行器官"

**调用链**：
```
tick.js (决策派发)
  ↓
executor.js (召唤接口，检查资源)
  ↓ spawn
cecelia-bridge → cecelia-run → claude -p "/skill ..."
  ↓ (独立进程，干活)
Agent Workers (Caramel/小检/小审/...)
  ↓ 完成后
回调 Core API (POST /api/brain/execution-callback)
```

---

## 2. 架构总览

### 2.1 四层完整架构

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1: Cecelia Core (cecelia/core repo)              │
│  ┌───────────────────────────────────────────────────┐ │
│  │  ❤️ 心脏 (tick.js)                                │ │
│  │  🧠 大脑 L2 (cortex.js) - Opus                    │ │
│  │  🧠 大脑 L1 (thalamus.js) - MiniMax M2.1         │ │
│  │  🧠 大脑 L0 (planner.js, executor.js) - 纯代码   │ │
│  │  🛡️ 保护系统 (alertness, watchdog, ...)          │ │
│  │  📋 规划器 (planner.js)                           │ │
│  │  🔌 对外接口 (executor.js) - 召唤外部员工        │ │
│  │  🌐 神经系统 (routes.js) - HTTP API              │ │
│  │  📊 记忆读写逻辑 (读写 working_memory 等表)      │ │
│  └───────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
          ↓ 依赖
┌─────────────────────────────────────────────────────────┐
│  Layer 2: Infrastructure (外部存储)                      │
│  ┌───────────────────────────────────────────────────┐ │
│  │  PostgreSQL (独立容器, port 5432)                 │ │
│  │  - cecelia 数据库                                 │ │
│  │  - 核心表 + 系统表                                 │ │
│  │  - 唯一真相源                                     │ │
│  ├───────────────────────────────────────────────────┤ │
│  │  N8N (HK server, port 5678)                       │ │
│  │  - 只处理 HK region 的 data 任务                  │ │
│  └───────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
          ↓ 召唤
┌─────────────────────────────────────────────────────────┐
│  Layer 3: Agent Workers (外部员工)                       │
│  ┌───────────────────────────────────────────────────┐ │
│  │  Caramel (/dev, Sonnet/M2.5-hs) - 外包程序员     │ │
│  │  小检 (/qa, Sonnet/M2.5-hs) - 外包测试员        │ │
│  │  小审 (/audit, Sonnet/M2.5-hs) - 外包审计师     │ │
│  │  秋米 (/okr, Sonnet/M2.5-hs) - 外部顾问        │ │
│  │  审查员 (/review, Sonnet/M2.5-hs) - 外部审查员  │ │
│  │  Vivian (decomp_review, MiniMax Ultra) - HK     │ │
│  └───────────────────────────────────────────────────┘ │
│  独立无头进程，通过 cecelia-bridge 召唤                  │
└─────────────────────────────────────────────────────────┘
          ↓ 展示
┌─────────────────────────────────────────────────────────┐
│  Layer 4: Workspace (对外窗口)                           │
│  ┌───────────────────────────────────────────────────┐ │
│  │  cecelia/workspace (port 5211)                    │ │
│  │  - React/Vue 前端界面                             │ │
│  │  - Dashboard 面板                                 │ │
│  │  - 数据可视化                                     │ │
│  └───────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

**架构层级说明**：
- **Layer 1 (Core)**：Cecelia 的生命体，只包含内部器官
- **Layer 2 (Infrastructure)**：外部存储设备，Core 依赖但不包含
- **Layer 3 (Agent Workers)**：外部员工，Core 通过 executor.js 召唤
- **Layer 4 (Workspace)**：对外展示窗口，调用 Core API

### 2.2 LLM 使用边界

**硬规则**：L0（代码层）禁止 LLM 直接决策。所有状态推进、DB 写入、资源分配必须由确定性代码执行。

| 层 | 允许 LLM | 职责 |
|----|---------|------|
| L0 脑干 | 禁止 | 调度、执行、保护（纯代码） |
| L1 丘脑 | MiniMax M2.1 | 事件分类、快速判断（<1s） |
| L2 皮层 | Opus | 深度分析、战略调整（>5s） |

**LLM 只提建议，代码做执行**：
- L1/L2 输出 Decision JSON（actions + rationale + confidence）
- decision-executor.js 验证 action 在白名单内，然后在事务中执行
- 危险 action（如 adjust_strategy）进入 pending_actions 表等人工审批

---

## 3. 三层大脑

### 3.1 L0 脑干 — 纯代码

循环每 5 秒检查一次，正式 tick 每 2 分钟执行一次 `executeTick()`：

```
executeTick() 流程：
  0.1. 评估警觉等级 → 调整行为
  0.2. 定期清理（每小时，cecelia_events/decision_log 等）
  0.3. PR Plans 完成检查（纯 SQL）
  0.4. 反串清理（清理孤儿任务引用）
  0.5. Pre-flight 检查（资源/熔断）
  0.6. Codex 免疫检查（每 20h 一次，确保 codex_qa 任务存在）
  0.7. 统一拆解检查（七层架构，decomposition-checker.js）
  0.7. Layer 2 运行健康监控（每小时一次，health-monitor.js）
  0.8. Initiative 闭环检查（initiative-closer.js，每次 tick）
       如果 initiative 下所有 task 都 completed → 关闭 initiative
  0.9. Project 闭环检查（initiative-closer.js，每次 tick）
       如果 project 下所有 initiative 都 completed → 关闭 project
  1. L1 丘脑事件处理（如有事件）
     └─ level=2 → 升级到 L2 皮层
  2. 决策引擎（对比目标进度 → 生成决策 → 执行决策）
  3. 焦点选择（selectDailyFocus）
  4. 自动超时（in_progress > 60min → failed）
  5. 存活探针（验证 in_progress 任务进程还活着）
  6. 看门狗（/proc 采样，三级响应）
  7. 规划（queued=0 且有 KR → planNextTask）
  8. OKR 自动拆解（Global OKR 有 0 个 KR → 创建拆解任务）
  9. 派发循环（填满所有可用 slot）
  10. 每日代码审查触发
  10.5. 反刍回路（空闲时消化 learnings → 洞察写入 memory_stream）
  11. 欲望系统（六层主动意识，自然消费反刍洞察）
  12. WebSocket 广播 tick:executed
```

**关键模块**：

| 文件 | 职责 |
|------|------|
| `tick.js` | 心跳循环、派发调度、焦点选择 |
| `executor.js` | 进程管理、资源检测、命令生成 |
| `planner.js` | KR 轮转、任务自动生成、PRD 生成 |
| `initiative-closer.js` | Initiative/Project 闭环检查（纯 SQL，每次 tick） |
| `health-monitor.js` | Layer 2 运行健康监控（每小时，4 项 SQL 检查） |
| `watchdog.js` | /proc 采样、动态阈值、两段式 kill |
| `alertness/index.js` | 5 级警觉、指标收集、诊断、自愈 |
| `circuit-breaker.js` | 三态熔断（CLOSED/OPEN/HALF_OPEN） |
| `quarantine.js` | 失败隔离、可疑输入检测 |
| `decision-executor.js` | 决策执行（事务化、白名单、危险审批） |

### 3.2 L1 丘脑 — MiniMax M2.1 快速判断

`thalamus.js` 处理系统事件，快速路由：

```
事件 → quickRoute()（L0 硬编码规则）
  ├─ HEARTBEAT → no_action
  ├─ TICK(无异常) → fallback_to_tick
  ├─ TICK(有异常) → null → callThalamLLM()
  ├─ TASK_COMPLETED(无问题) → dispatch_task
  ├─ TASK_COMPLETED(有问题) → null → callThalamLLM()
  ├─ TASK_FAILED(简单/重试未超限) → retry_task
  ├─ TASK_FAILED(简单/重试超限) → cancel_task
  ├─ TASK_FAILED(复杂原因) → null → callThalamLLM()
  ├─ TASK_TIMEOUT → log_event + retry_task(降级)
  ├─ TASK_CREATED → no_action
  ├─ OKR_CREATED → log_event
  ├─ OKR_PROGRESS_UPDATE(非阻塞) → log_event
  ├─ OKR_BLOCKED(普通) → notify_user + mark_task_blocked
  ├─ OKR_BLOCKED(严重/持续) → null → callThalamLLM()
  ├─ DEPARTMENT_REPORT(非严重) → log_event
  ├─ DEPARTMENT_REPORT(严重) → null → callThalamLLM()
  ├─ EXCEPTION_REPORT(低严重度) → log_event
  ├─ EXCEPTION_REPORT(中/高严重度) → null → callThalamLLM()
  ├─ RESOURCE_LOW(非严重) → notify_user
  ├─ RESOURCE_LOW(严重) → null → callThalamLLM()
  ├─ USER_COMMAND(简单) → log_event
  ├─ USER_COMMAND(复杂) → null → callThalamLLM()
  ├─ USER_MESSAGE(非紧急) → log_event
  ├─ USER_MESSAGE(紧急) → null → callThalamLLM()
  └─ 其他 → callThalamLLM()（L1 判断）
               ├─ level=0/1 → 返回决策
               └─ level=2 → 升级到皮层
```

**49 个白名单 action**：
- 任务：dispatch_task, create_task, cancel_task, retry_task, reprioritize_task, pause_task, resume_task, mark_task_blocked, quarantine_task
- OKR：create_okr, update_okr_progress, assign_to_autumnrice
- 系统：notify_user, log_event, escalate_to_brain, request_human_review
- 分析：analyze_failure, predict_progress
- 规划：create_proposal
- 知识/学习：create_learning, update_learning, trigger_rca
- 任务生命周期：update_task_prd, archive_task, defer_task
- 控制：no_action, fallback_to_tick
- 类型建议：suggest_task_type
- 对话：handle_chat
- 认知闭环：kr_replan, write_self_model, escalate_to_cortex
- 提案（Inbox）：propose_decomposition, propose_weekly_plan, propose_priority_change, propose_anomaly_action, propose_milestone_review, heartbeat_finding
- 扩展（v1.121.0）：reschedule_task, aggregate_tasks, merge_tasks, split_task, notify_oncall, adjust_resource_allocation, trigger_backup, rotate_credentials

### 3.3 L2 皮层 — Opus 深度分析

`cortex.js` 在 L1 判断 level=2 时介入：

- **根因分析 (RCA)**：分析反复失败的任务
- **战略调整**：adjust_strategy（修改 brain_config，需审批）
- **经验记录**：record_learning（存入 reflections 表）
- **RCA 报告**：create_rca_report（存入 decision_log 表）
- **创建任务**：create_task（皮层建议自动转 Brain 任务）

**皮层额外 4 个 action**：adjust_strategy、record_learning、create_rca_report、create_task

### 3.4 内容类型注册表（content-types/）

`brain/src/content-types/` 目录实现 YAML 驱动的内容类型配置层，将内容类型定义与 Pipeline 代码解耦。

**核心组件**：

| 文件 | 职责 |
|------|------|
| `content-type-registry.js` | 加载/列出/验证 YAML 配置（`getContentType()`、`listContentTypes()`、`loadAllContentTypes()`） |
| `content-type-validator.js` | 轻量格式校验器，启动时检查所有 YAML 文件（不阻断启动，WARN 级别） |
| `<type-name>.yaml` | 内容类型定义文件（如 `solo-company-case.yaml`） |

**与 Pipeline 的关系**：
- `content-pipeline-orchestrator.js` 通过 `getContentType(content_type)` 读取类型配置
- 类型配置驱动 Pipeline 各阶段的 prompt、图片参数、审查规则
- 新增内容类型只需添加 YAML 文件，无需改 Pipeline 代码

**YAML Schema 结构**：
```yaml
content_type: <类型标识符>    # 必填，须与文件名一致
images: { count, format, size }  # 必填，图片配置
template: { research_prompt, generate_prompt, review_prompt }  # 必填
review_rules: [{ id, description, severity }]  # 必填，AI 审查规则
copy_rules: { platform_tone, hashtags, min_word_count }  # 必填，文案规则
outputs: [{ type, count?, format?, platforms? }]  # 产出物定义
```

**添加新内容类型**：在 `content-types/` 目录下创建 `<type-name>.yaml`，填写上述必填字段即可。

---

## 4. 数据模型

### 4.1 六层结构

```
goals (OKR 目标，3 种 type)
├── Global OKR (type='global_okr', parent_id=NULL, 季度目标)
│   └── Area OKR (type='area_okr', parent_id=Global OKR.id, 月度目标)
│       └── KR (type='kr', parent_id=Area OKR.id, Key Result)
│
projects (项目/Initiative，2 种 type)
├── Project (type='project', 1-2 周, 可跨多个 Repo)
│   └── Initiative (type='initiative', parent_id=Project.id, 1-2 小时)
│
pr_plans (工程规划)
└── PR Plan (project_id→Initiative, dod, sequence, depends_on)
│
tasks (具体任务)
└── Task (project_id→Initiative, goal_id→KR.id, pr_plan_id→PR Plan, 20 分钟)
```

**完整拆解链**（6 层）：
```
Global OKR → Area OKR → KR → Project → Initiative → Task
```

**时间维度**：

| 层级 | 时间跨度 |
|------|----------|
| Global OKR | 3 个月（季度） |
| Area OKR | 1 个月（月度） |
| Project | 1-2 周 |
| Initiative | 1-2 小时 |
| Task | 20 分钟 |

**关键关系**：
- Task.project_id → **Initiative** ID（不是 Project）
- Task.goal_id → **KR** ID（不是 Global/Area OKR）
- Task.pr_plan_id → **PR Plan** ID（可选，通过 PR Plan 创建时必填）
- Initiative→Project 通过 parent_id 找到 repo_path（`resolveRepoPath()` 向上遍历）
- project_repos 表：Project ↔ Repository 多对多关联
- project_kr_links 表：Project ↔ KR 多对多关联
- Repository = 独立概念，Project 可跨多个 Repo

### 4.2 核心表

| 表 | 用途 | 关键字段 |
|----|------|---------|
| **tasks** | 任务队列 | status, task_type, priority, payload, prd_content, pr_plan_id, phase(exploratory/dev) |
| **goals** | OKR 目标 | type(global_okr/area_okr/kr), parent_id, progress |
| **projects** | 项目/Initiative | type(project/initiative), repo_path, parent_id, kr_id, plan_content |
| **pr_plans** | 工程规划（PR 拆解层） | project_id→Initiative, dod, files, sequence, depends_on, complexity |
| **project_repos** | 项目↔仓库关联 | project_id, repo_path, role |
| **areas** | PARA 领域 | name, group_name |
| **project_kr_links** | 项目↔KR 关联 | project_id, kr_id |

> **注意**：`features` 表已在 Migration 027 中删除。Initiative 功能由 `projects` 表的 `parent_id` + `type='initiative'` 实现。

### 4.3 系统表

| 表 | 用途 |
|----|------|
| **cecelia_events** | 全局事件日志（token 使用、状态变更、学习等） |
| **decision_log** | LLM 决策记录（L1/L2 输出、执行结果） |
| **working_memory** | 短期记忆（key-value，如 last_dispatch） |
| **brain_config** | 配置（region、fingerprint） |
| **pending_actions** | 通用提案系统（含审批/提案/通知，签名去重，24-72h 过期） |
| **reflections** | 经验/问题/改进（issue/learning/improvement） |
| **daily_logs** | 每日汇总（summary、highlights、challenges） |
| **recurring_tasks** | 定时任务模板（cron 表达式, goal_id, project_id, worker_type, recurrence_type） |
| **schema_version** | 迁移版本追踪 | Schema 版本: 183 |
| **distilled_docs** | 蒸馏文档层 Layer 2（SOUL/SELF_MODEL/USER_PROFILE/WORLD_STATE） |
| **kr_verifiers** | KR 指标自动验证（SQL 查询, threshold, current_value, 定时采集） |
| **blocks** | 通用 block 存储 |

### 4.4 任务状态

```
queued → in_progress → completed
                    → failed → (retry) → queued
                    → quarantined → (release) → queued
                                 → (cancel) → cancelled
```

### 4.6 任务类型与路由

| 类型 | 位置 | Agent | 模型 (Anthropic / MiniMax) | Provider |
|------|------|-------|------|----------|
| dev | US | Caramel (/dev) | Sonnet / M2.5-highspeed | 默认 minimax |
| review | US | 审查员 (/review) | Sonnet / M2.5-highspeed | 默认 minimax |
| qa | US | 小检 (/qa) | Sonnet / M2.5-highspeed | 默认 minimax |
| audit | US | 小审 (/audit) | Sonnet / M2.5-highspeed | 默认 minimax |
| explore | HK | 快速调研 (/explore) | - / M2.1 | 固定 minimax |
| knowledge | US | 知识记录 (/knowledge) | Sonnet / - | 默认 anthropic |
| codex_qa | 西安 | Codex 免疫检查 | Codex | 固定 openai |
| codex_dev | 西安 | Codex /dev（runner.sh + devloop-check.sh） | Codex | 固定 openai |
| codex_playwright | 西安 | Playwright 自动化（playwright-runner.sh + CDP → PC） | Codex | 固定 openai |
| codex_test_gen | 西安 | 自动生成测试（扫描覆盖率低模块 + 生成测试） | Codex | 固定 openai |
| decomp_review | HK | Vivian (拆解审查) | - / M2.5-highspeed | 固定 minimax |
| initiative_plan | US | Initiative 规划 | Opus / - | 默认 anthropic |
| initiative_verify | US | Initiative 验收 (/arch-review verify) | Sonnet / - | 默认 anthropic |
| scope_plan | US | Scope 内规划下一个 Initiative (/decomp Phase 3) | Opus / - | 默认 anthropic |
| project_plan | US | Project 内规划下一个 Scope (/decomp Phase 4) | Opus / - | 默认 anthropic |
| pipeline_rescue | US | Pipeline 救援 — 卡住的 pipeline 接管修复 (/dev) | Opus / - | 默认 anthropic |
| suggestion_plan | US | Suggestion 层级识别 | Sonnet / - | 默认 anthropic |
| talk | HK | MiniMax | - / M2.5-highspeed | 固定 minimax |
| research | HK | MiniMax | - / M2.5-highspeed | 固定 minimax |
| data | HK | N8N | - | - |
| dept_heartbeat | US | 部门主管 (repo-lead) | - / M2.5-highspeed | 固定 minimax |
| pr_review | 西安 | 异步 PR 审查（独立 MiniMax 审查） | Codex / MiniMax | 固定 minimax |
| intent_expand | US | 意图扩展 Expander（沿 project→KR→OKR→Vision 链补全 PRD） | Sonnet / - | 默认 anthropic |
| initiative_execute | US | Initiative 执行 (/dev 全流程) | Sonnet / - | 默认 anthropic |
| code_review | US | 代码审查 (/code-review) | Sonnet / - | 默认 anthropic |
| architecture_design | US | 架构设计 (/architect design) | Opus / - | 默认 anthropic |
| architecture_scan | US | 系统扫描 (/architect scan) | Opus / - | 默认 anthropic |
| arch_review | US | 架构巡检 (/arch-review review) | Sonnet / - | 默认 anthropic |
| strategy_session | US | 战略会议 (/strategy-session) | Opus / - | 默认 anthropic |
| prd_review | US | PRD 审查 (/prd-review) | 本机 Codex | 固定 openai |
| spec_review | US | Spec 审查 (/spec-review) | 本机 Codex | 固定 openai |
| code_review_gate | US | 代码质量门禁 (/code-review-gate) | 本机 Codex | 固定 openai |
| initiative_review | US | Initiative 整体审查 (/initiative-review) | 本机 Codex | 固定 openai |
| okr_initiative_plan | 西安 | OKR Scope 下规划下一个 Initiative (/decomp) | - | general |
| okr_scope_plan | 西安 | OKR Project 下规划下一个 Scope (/decomp) | - | general |
| okr_project_plan | 西安 | OKR Project 层完成后规划下一步 (/decomp) | - | general |

---

## 5. 任务生命周期

### 5.1 从 OKR 到任务（四层拆解）

```
Global OKR (目标)
  │
  ├─ 有 0 个 KR？ → 自动创建拆解任务 → 秋米 /okr → 生成 KR
  │
  └─ KR (关键结果)
       │
       ├─ selectDailyFocus() → 选择今日焦点 Global OKR
       │
       ├─ 秋米 /okr 拆解:
       │   └─ KR → Sub-Project (projects.parent_id) → PR Plans → Tasks
       │
       ├─ planNextTask(krIds) → KR 轮转评分
       │   ├─ 焦点 KR +100
       │   ├─ 优先级 P0/P1/P2 → +30/+20/+10
       │   ├─ 进度差距 → +0~20
       │   └─ 截止日期紧迫 → +20~40
       │
       └─ autoGenerateTask() → 生成任务
           ├─ 重试失败任务（retry_count < 2）
           ├─ 匹配 KR_STRATEGIES（7 种策略模式）
           └─ Fallback：research → implement → test
```

**PR Plans 层的作用**：
- 将 Sub-Project 拆解为具体的 PR，每个 PR Plan 对应 1 个 Task
- 支持依赖关系（depends_on）和执行顺序（sequence）
- 包含 DoD（完成定义）和预计修改文件列表，帮助 Agent 估算范围

### 5.2 派发流程

```
dispatchNextTask():
  1. checkServerResources() → CPU/内存/SWAP 压力
  2. 检查并发（active < AUTO_DISPATCH_MAX）
  3. 检查熔断（circuit-breaker isAllowed）
  4. selectNextDispatchableTask() → 选下一个任务
     └─ WHERE status='queued'
        AND (next_run_at IS NULL OR next_run_at <= NOW())
  5. UPDATE status='in_progress'
  6. triggerCeceliaRun(task)
     ├─ preparePrompt() → 生成 skill + 参数
     ├─ getModelForTask() → 选模型
     ├─ resolveRepoPath() → Sub-Project→Project→repo_path
     └─ HTTP → cecelia-bridge → cecelia-run → claude
  7. WebSocket 广播事件
  8. 记录到 working_memory
```

### 5.3 执行回调

```
任务完成 → POST /api/brain/execution-callback
  ├─ status=completed → 更新任务状态、清理进程
  ├─ status=failed → handleTaskFailure()
  │   ├─ failure_count < 3 → 标记失败
  │   ├─ failure_count >= 3 → 自动隔离
  │   └─ 检测系统性故障 → alertness +25
  └─ payload.exploratory=true？
      └─ 创建"继续拆解"任务 → 秋米继续
```

### 5.4 探索式拆解闭环

```
KR → 首次拆解 (decomposition='true', /okr, Opus)
  └─ 秋米分析 → 创建 Sub-Project + PR Plans + 第一个 Task
       └─ Task 完成 → 回调触发"继续拆解"
            └─ (decomposition='continue', /okr, Opus)
                 └─ 秋米分析上次结果 → 创建下一个 Task
                      └─ 循环直到 KR 目标达成
```

---

## 6. 保护系统

### 6.1 警觉等级（alertness/index.js）

5 级自我保护，基于实时指标自动诊断和响应：

| 级别 | 名称 | 派发率 | 行为 |
|------|------|--------|------|
| 0 | SLEEPING | 0% | 休眠，无任务 |
| 1 | CALM | 100% | 正常运行 |
| 2 | AWARE | 70% | 轻微异常，加强监控 |
| 3 | ALERT | 30% | 明显异常，停止规划 |
| 4 | PANIC | 0% | 严重异常，只保留心跳 |

**功能模块**：
- `metrics.js`：实时指标收集（内存、CPU、队列深度等）
- `diagnosis.js`：异常模式诊断（内存泄漏、队列阻塞等）
- `escalation.js`：分级响应和升级
- `healing.js`：自愈恢复策略

**状态转换规则**：
- 降级冷却 60 秒（防震荡）
- PANIC 锁定 30 分钟
- 渐进式恢复（只能逐级降低）
- 紧急升级可直接跳到 PANIC

### 6.2 熔断器（circuit-breaker.js）

Per-service 三态熔断：

```
CLOSED ──(3次失败)──► OPEN ──(30分钟)──► HALF_OPEN
   ▲                                        │
   └────────(成功)──────────────────────────┘
                     (失败) → 回到 OPEN
```

### 6.3 隔离区（quarantine.js）

| 隔离原因 | 条件 |
|---------|------|
| repeated_failure | 连续失败 ≥3 次 |
| suspicious_input | 检测到危险模式（rm -rf、DROP TABLE 等） |
| resource_hog | 看门狗连续 kill ≥2 次 |
| timeout_pattern | 连续超时 ≥2 次 |
| manual | 人工隔离 |

**审查操作**：release（释放）、retry_once（试一次）、cancel（取消）、modify（修改后释放）

**故障分类**：classifyFailure() 区分 SYSTEMIC（系统性，23 种模式）vs TASK_SPECIFIC（任务自身），系统性故障触发 alertness 信号。

### 6.4 看门狗（watchdog.js）

每 5s 通过 /proc 采样，动态阈值保护：

**阈值（动态计算）**：

| 参数 | 公式 | 16GB 机器 |
|------|------|-----------|
| RSS 硬杀线 | min(总内存×35%, 2400MB) | 2400MB |
| RSS 警告线 | 硬杀线×75% | 1800MB |
| CPU 持续阈值 | 95%（单核=100%） | 95% |
| CPU 持续时长 | 6 个 tick（30s） | 30s |
| 启动宽限期 | 60s | 60s |

**三级响应**：

| 系统压力 | 行为 |
|---------|------|
| < 0.7（正常） | RSS 超警告线 → 仅警告 |
| 0.7~1.0（紧张） | RSS 超警告 + CPU 持续高 → kill |
| ≥ 1.0（崩溃） | 只杀 RSS 最大的 1 个，下个 tick 再评估 |
| 任何时候 | RSS 超硬杀线 → 无条件 kill（即使宽限期） |

**两段式 kill**：SIGTERM → 等 10s → SIGKILL → 等 2s 确认死透

**自动重排**：kill 后 requeue + 指数退避（2min, 4min），2 次 kill → 隔离

---

## 7. 并发与资源管理

### 7.1 自动计算

```javascript
CPU_CORES = os.cpus().length
TOTAL_MEM_MB = os.totalmem() / 1024 / 1024
MEM_PER_TASK = 500MB
CPU_PER_TASK = 0.5 core
INTERACTIVE_RESERVE = 2 seats  // 留给有头会话

// Layer 1: 物理上限（MAX_PHYSICAL_CAP=10 兜底）
PHYSICAL_CAPACITY = min(floor(min(USABLE_MEM / 500, USABLE_CPU / 0.5)), MAX_PHYSICAL_CAP=10)

// Layer 2: 硬上限（CECELIA_MAX_SEATS env var，防止物理上限失控飙升）
EFFECTIVE_MAX_SEATS = min(CECELIA_MAX_SEATS, PHYSICAL_CAPACITY)  // 当前 10

// Layer 3: 运营上限（CECELIA_BUDGET_SLOTS env var，日常派发上限）
// 优先级：CECELIA_BUDGET_SLOTS > CECELIA_MAX_SEATS（作为 fallback）
OPERATIONAL_CAP = CECELIA_BUDGET_SLOTS  // 当前 7，控制日常并发
AUTO_DISPATCH_MAX = OPERATIONAL_CAP - INTERACTIVE_RESERVE  // 当前 5
```

**10 核 16GB（美国 Mac mini M4）**：PHYSICAL_CAPACITY=10, CECELIA_MAX_SEATS=10（硬上限）, CECELIA_BUDGET_SLOTS=7（运营上限）, AUTO_DISPATCH=5

**环境变量配置**（`packages/brain/.env` + `docker-compose.yml` 双写）：
```
CECELIA_MAX_SEATS=10    # 硬天花板，防止动态值飙升
CECELIA_BUDGET_SLOTS=7  # 运营上限，预留 2 个 interactive 席位
```

### 7.2 动态限流

`checkServerResources()` 实时计算压力值（0.0~1.0+）：

| 压力 | 有效 Slots |
|------|-----------|
| < 0.5 | 满额（10） |
| 0.5~0.7 | 2/3（7） |
| 0.7~0.9 | 1/3（3） |
| ≥ 0.9 | 1 |
| ≥ 1.0 | 0（停止派发） |

### 7.3 进程跟踪

- `activeProcesses Map<taskId, {pid, startedAt, runId}>`
- 存活探针：每个 tick 检查 in_progress 任务的进程是否还在
- 桥接任务（pid=null）：通过 `ps aux` 搜索 task_id
- 孤儿清理：启动时同步 DB 状态与实际进程

---

## 8. 部署架构

### 8.1 双服务器

```
┌─────────────────────────────┐     ┌─────────────────────────────┐
│  🇺🇸 美国 VPS (研发+执行)     │     │  🇭🇰 香港 VPS (生产)          │
│  146.190.52.84              │     │  124.156.138.116              │
│                             │     │                             │
│  Docker 容器：              │◄───►│  Docker 容器：              │
│  ├ cecelia-node-brain:5221  │Tail-│  ├ PostgreSQL:5432          │
│  ├ PostgreSQL:5432          │scale│  ├ 生产前端:5211            │
│  ├ 开发前端:5212            │     │  └ MiniMax executor         │
│  └ Claude Code (headed)     │     │                             │
│                             │     │  任务类型：                 │
│  任务类型：                 │     │  talk, research, explore,   │
│  dev, review, qa, audit,    │     │  data                       │
│  code_review, knowledge     │     │                             │
│  ENV_REGION=us              │     │  ENV_REGION=hk              │
└─────────────────────────────┘     └─────────────────────────────┘
```

### 8.2 容器化

**Brain 容器**：
- 镜像：`cecelia-brain:1.52.5`（多阶段构建）
- 基础：node:20-alpine + tini
- 用户：非 root `cecelia` 用户
- 文件系统：read-only rootfs（生产模式）
- 健康检查：`curl -f http://localhost:5221/api/brain/health`

### 8.3 构建与部署

```bash
# 构建
bash scripts/brain-build.sh          # → cecelia-brain:<version>

# 部署（完整流程）
bash scripts/brain-deploy.sh          # build → migrate → selfcheck → test → tag → start
# 自动回滚：健康检查失败 → 回滚到上一版本

# 手动部署（跳过测试）
docker compose up -d cecelia-node-brain
```

### 8.4 启动检查（selfcheck.js）

6 项检查，任一失败 → process.exit(1)：

1. **ENV_REGION** — 必须是 'us' 或 'hk'
2. **DB 连接** — SELECT 1 AS ok
3. **区域匹配** — brain_config.region = ENV_REGION
4. **核心表存在** — tasks, goals, projects, working_memory, cecelia_events, decision_log, daily_logs, pr_plans, cortex_analyses

5. **Schema 版本** — DB 版本 >= '153'（>= 检查，向前兼容）

6. **配置指纹** — SHA-256(host:port:db:region) 一致性

### 8.5 数据库配置

**单一来源**：`brain/src/db-config.js`

```javascript
DB_DEFAULTS = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'cecelia',
  user: process.env.DB_USER || 'cecelia',
  password: process.env.DB_PASSWORD || '',
}
```

所有 DB 连接（db.js、migrate.js、selfcheck.js、测试）统一导入此配置。

---

## 9. API 接口

Brain 服务运行在 `localhost:5221`，所有端点前缀 `/api/brain/`。

### 9.1 状态监控

| 端点 | 方法 | 用途 |
|------|------|------|
| `/status` | GET | 决策数据包（给 LLM 用） |
| `/status/full` | GET | 完整系统状态 |
| `/health` | GET | 健康检查 |
| `/hardening/status` | GET | 硬化状态（CI 用） |
| `/executor/status` | GET | 执行器进程状态 |
| `/watchdog` | GET | 看门狗实时 RSS/CPU |
| `/token-usage` | GET | LLM Token 消耗统计 |
| `/memory` | GET | 工作记忆 |

### 9.2 Tick 循环

| 端点 | 方法 | 用途 |
|------|------|------|
| `/tick/status` | GET | Tick 状态 |
| `/tick` | POST | 手动触发 tick |
| `/tick/enable` | POST | 启用自动 tick |
| `/tick/disable` | POST | 禁用自动 tick |

### 9.3 任务管理

| 端点 | 方法 | 用途 |
|------|------|------|
| `/tasks` | GET | 查询任务（支持 status/type 过滤） |
| `/action/create-task` | POST | 创建任务 |
| `/action/update-task` | POST | 更新任务 |
| `/action/batch-update-tasks` | POST | 批量更新 |
| `/task-types` | GET | 有效任务类型 |
| `/route-task` | POST | 任务路由（US/HK） |
| `/execution-callback` | POST | 执行完成回调 |
| `/heartbeat` | POST | 任务心跳 |

### 9.4 OKR 目标

| 端点 | 方法 | 用途 |
|------|------|------|
| `/action/create-goal` | POST | 创建目标 |
| `/action/update-goal` | POST | 更新目标 |
| `/goal/compare` | POST | 对比目标进度 |
| `/okr/statuses` | GET | OKR 状态枚举 |

### 9.5 PR Plans 管理

| 端点 | 方法 | 用途 |
|------|------|------|
| `/pr-plans` | POST | 创建 PR Plan |
| `/pr-plans` | GET | 查询 PR Plans（支持 project_id/status 过滤） |
| `/pr-plans/:id` | GET | PR Plan 详情 |
| `/pr-plans/:id` | PATCH | 更新 PR Plan |
| `/pr-plans/:id` | DELETE | 删除 PR Plan |

> **注意**：旧的 `/features` 系列端点仍在代码中但已废弃（`features` 表已在 Migration 027 中删除）。

### 9.5a Capabilities 能力管理

| 端点 | 方法 | 用途 |
|------|------|------|
| `/capabilities` | GET | 列出所有能力（支持 current_stage/owner 过滤） |
| `/capabilities/:id` | GET | 单个能力详情 |
| `/capabilities` | POST | 创建新能力（从 capability_proposal 审批后） |
| `/capabilities/:id` | PATCH | 更新能力（stage 推进 + evidence） |

> **说明**：Capability-Driven Development Framework (Migration 030)，能力注册表 + 成熟度追踪（Stage 1-4）。

### 9.6 焦点系统

| 端点 | 方法 | 用途 |
|------|------|------|
| `/focus` | GET | 获取每日焦点 |
| `/focus/set` | POST | 手动设定焦点 |
| `/focus/clear` | POST | 清除手动焦点 |

### 9.7 保护系统

| 端点 | 方法 | 用途 |
|------|------|------|
| `/alertness` | GET | 警觉等级 |
| `/alertness/evaluate` | POST | 重新评估 |
| `/alertness/override` | POST | 手动覆盖 |
| `/alertness/clear-override` | POST | 清除覆盖 |
| `/quarantine` | GET | 隔离区任务 |
| `/quarantine/stats` | GET | 隔离统计 |
| `/quarantine/:taskId` | POST | 手动隔离 |
| `/quarantine/:taskId/release` | POST | 释放任务 |
| `/circuit-breaker` | GET | 熔断器状态 |
| `/circuit-breaker/:key/reset` | POST | 重置熔断器 |
| `/pending-actions` | GET | 提案/审批列表（按优先级+时间排序） |
| `/pending-actions/:id/approve` | POST | 批准 |
| `/pending-actions/:id/reject` | POST | 拒绝 |
| `/pending-actions/:id/comment` | POST | 追加评论（对话） |
| `/pending-actions/:id/select` | POST | 选择选项并执行 |

### 9.8 规划与决策

| 端点 | 方法 | 用途 |
|------|------|------|
| `/plan/next` | POST | 规划下一个任务 |
| `/plan/status` | GET | 规划状态 |
| `/decide` | POST | 生成决策 |
| `/decisions` | GET | 决策历史 |
| `/intent/parse` | POST | 意图识别 |

### 9.9 每日对齐

| 端点 | 方法 | 用途 |
|------|------|------|
| `/nightly/status` | GET | 每晚对齐状态 |
| `/nightly/trigger` | POST | 手动触发 |
| `/nightly/enable` | POST | 启用 |
| `/daily-reports` | GET | 每日报告列表 |
| `/daily-reports/:date` | GET | 指定日期报告 |

---

## 10. 文件地图

### 10.1 Brain 核心

```
brain/
├── server.js                  # 入口：迁移 → 自检 → 启动
├── Dockerfile                 # 多阶段构建, tini, non-root
├── package.json               # 版本号（当前 1.52.1）
│
├── src/
│   ├── db-config.js           # DB 连接配置（唯一来源）
│   ├── db.js                  # PostgreSQL Pool 单例
│   ├── migrate.js             # 迁移运行器
│   ├── selfcheck.js           # 6 项启动检查
│   │
│   ├── tick.js                # ❤️ 心跳循环 + 派发调度
│   ├── executor.js            # 进程管理 + 资源检测
│   ├── planner.js             # KR 轮转 + 任务生成
│   ├── focus.js               # 每日焦点选择
│   │
│   ├── thalamus.js            # L1 丘脑 (MiniMax M2.1)
│   ├── cortex.js              # L2 皮层 (Opus)
│   ├── decision-executor.js   # 决策执行器
│   │
│   ├── rumination.js           # 反刍回路（空闲时消化知识）
│   ├── notebook-adapter.js    # NotebookLM CLI 适配器
│   │
│   ├── watchdog.js            # 资源看门狗 (/proc)
│   ├── alertness/index.js     # 5 级警觉
│   ├── circuit-breaker.js     # 三态熔断
│   ├── quarantine.js          # 隔离区
│   │
│   ├── routes.js              # ~100 个 API 端点
│   ├── task-router.js         # 任务类型 + 区域路由
│   ├── intent.js              # 意图识别
│   ├── templates.js           # PRD/TRD 模板
│   ├── notifier.js            # 通知
│   ├── websocket.js           # WebSocket 推送
│   │
│   ├── content-pipeline-orchestrator.js  # 内容工厂 Pipeline 编排器
│   └── content-types/         # 内容类型注册表（YAML 驱动）
│       ├── content-type-registry.js   # 加载/列出/验证 YAML 配置
│       ├── content-type-validator.js  # 轻量格式校验（启动时 WARN）
│       └── <type-name>.yaml           # 内容类型定义文件（如 solo-company-case.yaml）
│
├── migrations/                # SQL 迁移 (000-035)
│   ├── 000_base_schema.sql
│   ├── ...
│   ├── 027_align_project_feature_model.sql  # 删除 features 表
│   ├── ...
│   ├── 034_cleanup_orphan_tables_and_constraints.sql
│   └── 035_final_cleanup_orphans_and_types.sql
│
└── src/__tests__/             # Vitest 测试
```

### 10.2 基础设施

```
scripts/
├── brain-build.sh             # Docker 构建
├── brain-deploy.sh            # 构建→迁移→自检→测试→部署
└── brain-rollback.sh          # 回滚到上一版本

docker-compose.yml             # 生产模式（不挂载源码）
docker-compose.dev.yml         # 开发模式（挂载 brain/ 热重载）
.env.docker                    # 环境变量
.brain-versions                # 版本历史
```

### 10.3 外部依赖

```
/home/xx/bin/cecelia-run       # 任务执行器（setsid + slot 管理）
/home/xx/bin/cecelia-bridge.js # HTTP→cecelia-run 桥接
```

---

## 11. 运维手册

### 11.1 日常检查

```bash
# 系统状态
curl -s localhost:5221/api/brain/status/full | jq '.tick, .alertness, .circuit_breaker'

# 任务队列
curl -s localhost:5221/api/brain/tasks?status=queued | jq '.[].title'

# 看门狗
curl -s localhost:5221/api/brain/watchdog | jq

# 隔离区
curl -s localhost:5221/api/brain/quarantine | jq '.[].title'

# 容器健康
docker ps --filter name=cecelia-node-brain
```

### 11.2 常见操作

```bash
# 手动触发 tick
curl -X POST localhost:5221/api/brain/tick

# 手动设定焦点
curl -X POST localhost:5221/api/brain/focus/set \
  -H 'Content-Type: application/json' \
  -d '{"goal_id": "<objective-uuid>"}'

# 释放隔离任务
curl -X POST localhost:5221/api/brain/quarantine/<taskId>/release \
  -H 'Content-Type: application/json' \
  -d '{"action": "release"}'

# 重置熔断器
curl -X POST localhost:5221/api/brain/circuit-breaker/cecelia-run/reset

# 手动覆盖警觉等级
curl -X POST localhost:5221/api/brain/alertness/override \
  -H 'Content-Type: application/json' \
  -d '{"level": 0, "duration_minutes": 60}'
```

### 11.3 部署新版本

```bash
# 1. 在 cp-* 分支开发，通过 PR 合并到 develop
# 2. 构建 + 部署
bash scripts/brain-build.sh
bash scripts/brain-deploy.sh

# 3. 如果健康检查失败，自动回滚
# 手动回滚：
bash scripts/brain-rollback.sh
```

### 11.4 故障排查

| 症状 | 检查 | 处理 |
|------|------|------|
| 不派发任务 | alertness/circuit-breaker | 检查是否 PANIC/OPEN |
| 任务卡 in_progress | executor/status | 检查进程是否存活 |
| 内存高 | watchdog | 看门狗自动处理 |
| DB 连接失败 | selfcheck 日志 | 检查 PostgreSQL 状态 |
| LLM 错误多 | token-usage | 检查 API Key / 网络 |

### 11.5 GoldenPath 验证

```bash
# 启动 → 健康 → 状态 → tick → tick 状态
bash brain/scripts/goldenpath-check.sh
```

---

## 附录：Token 成本

| 模型 | 输入 | 输出 | 用途 |
|------|------|------|------|
| Opus | $15/M | $75/M | L2 皮层（RCA 分析） |
| Sonnet | $3/M | $15/M | Claude Code 默认（Anthropic provider） |
| Haiku | $1/M | $5/M | 嘴巴（轻认知，保留） |
| MiniMax M2.5-hs | $0.30/M | $2.40/M | dev/review/qa/audit/talk（MiniMax provider） |
| MiniMax M2.1 | $0.15/M | $1.20/M | L1 丘脑（事件路由）、exploratory |

每次 L1/L2 调用记录 token 使用到 cecelia_events 表。
