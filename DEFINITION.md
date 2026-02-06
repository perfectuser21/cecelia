# Cecelia 定义文档

**版本**: 2.0.0
**创建时间**: 2026-02-01
**最后更新**: 2026-02-07
**Brain 版本**: 1.10.0
**Schema 版本**: 008
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
Cecelia = Brain (Node.js, port 5221)
        + PostgreSQL (cecelia 数据库)
        + Tick Loop (每 5s 循环检查，每 5min 执行一次 tick)
        + 外部 Agent 群（Claude Code 无头进程）
```

Cecelia 是一个自主运行的任务调度与决策系统。她接收 OKR 目标，自动拆解为可执行任务，派发给无头 Claude Code Agent 执行，监控执行状态，处理失败和异常，并从经验中学习。

### 1.2 核心器官

| 器官 | 实现 | 职责 |
|------|------|------|
| 🧠 大脑 | Brain (Node.js) | 决策、调度、监控 |
| ❤️ 心脏 | Tick Loop (5s 循环 / 5min 执行) | 持续运作，驱动一切 |
| 📊 记忆 | PostgreSQL | 存储所有状态和历史 |
| 💬 嘴巴 | /cecelia skill | 对外对话接口 |

### 1.3 外部 Agent（员工）

这些是独立的无头 Claude Code 进程，由 Cecelia 召唤执行任务：

| Agent | Skill | 模型 | 职责 |
|-------|-------|------|------|
| 秋米 | /okr | Opus | OKR 拆解（边做边拆） |
| Caramel | /dev | Opus | 编程（写代码、PR、CI） |
| 审查员 | /review | Sonnet | 代码审查（只读模式） |
| 小检 | /qa | Sonnet | 质量验收 |
| 小审 | /audit | Sonnet | 代码审计 |

**调用链**：Brain → cecelia-bridge → cecelia-run → claude -p "/skill ..."

---

## 2. 架构总览

### 2.1 三层大脑架构

```
┌─────────────────────────────────────────────┐
│  L2 皮层 (Cortex)  — Opus                   │
│  深度分析、RCA、战略调整、记录经验           │
│  cortex.js                                   │
├─────────────────────────────────────────────┤
│  L1 丘脑 (Thalamus)  — Sonnet               │
│  事件路由、快速判断、异常检测                │
│  thalamus.js                                 │
├─────────────────────────────────────────────┤
│  L0 脑干 (Brainstem)  — 纯代码              │
│  tick、dispatch、executor、watchdog           │
│  alertness、circuit-breaker、quarantine       │
│  tick.js, executor.js, planner.js, ...       │
└─────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────┐
│  PostgreSQL — 唯一真相源                     │
│  cecelia 数据库, schema v008                 │
│  19 张核心表                                │
└─────────────────────────────────────────────┘
```

### 2.2 LLM 使用边界

**硬规则**：L0（代码层）禁止 LLM 直接决策。所有状态推进、DB 写入、资源分配必须由确定性代码执行。

| 层 | 允许 LLM | 职责 |
|----|---------|------|
| L0 脑干 | 禁止 | 调度、执行、保护（纯代码） |
| L1 丘脑 | Sonnet | 事件分类、快速判断（<1s） |
| L2 皮层 | Opus | 深度分析、战略调整（>5s） |

**LLM 只提建议，代码做执行**：
- L1/L2 输出 Decision JSON（actions + rationale + confidence）
- decision-executor.js 验证 action 在白名单内，然后在事务中执行
- 危险 action（如 adjust_strategy）进入 pending_actions 表等人工审批

---

## 3. 三层大脑

### 3.1 L0 脑干 — 纯代码

循环每 5 秒检查一次，正式 tick 每 5 分钟执行一次 `executeTick()`：

```
executeTick() 流程：
  0. 评估警觉等级 → 调整行为
  1. L1 丘脑事件处理（如有事件）
     └─ level=2 → 升级到 L2 皮层
  2. 决策引擎（对比目标进度 → 生成决策 → 执行决策）
  3. Feature Tick（处理 Feature 状态机）
  4. 反串清理（清理孤儿任务引用）
  5. 获取每日焦点（selectDailyFocus）
  6. 自动超时（in_progress > 60min → failed）
  7. 存活探针（验证 in_progress 任务进程还活着）
  8. 看门狗（/proc 采样，三级响应）
  9. 规划（queued=0 且有 KR → planNextTask）
  10. OKR 自动拆解（Objective 有 0 个 KR → 创建拆解任务）
  11. 派发循环（填满所有可用 slot）
```

**关键模块**：

| 文件 | 职责 |
|------|------|
| `tick.js` | 心跳循环、派发调度、焦点选择 |
| `executor.js` | 进程管理、资源检测、命令生成 |
| `planner.js` | KR 轮转、任务自动生成、PRD 生成 |
| `watchdog.js` | /proc 采样、动态阈值、两段式 kill |
| `alertness.js` | 4 级警觉、信号收集、衰减恢复 |
| `circuit-breaker.js` | 三态熔断（CLOSED/OPEN/HALF_OPEN） |
| `quarantine.js` | 失败隔离、可疑输入检测 |
| `decision-executor.js` | 决策执行（事务化、白名单、危险审批） |

### 3.2 L1 丘脑 — Sonnet 快速判断

`thalamus.js` 处理系统事件，快速路由：

```
事件 → quickRoute()（L0 硬编码规则）
  ├─ HEARTBEAT → no_action
  ├─ TICK(无异常) → fallback_to_tick
  ├─ TASK_COMPLETED(无问题) → dispatch_task
  └─ 其他 → callSonnet()（L1 判断）
               ├─ level=0/1 → 返回决策
               └─ level=2 → 升级到皮层
```

**16 个白名单 action**：
- 任务：dispatch_task, create_task, cancel_task, retry_task, reprioritize_task
- OKR：create_okr, update_okr_progress, assign_to_autumnrice
- 系统：notify_user, log_event, escalate_to_brain, request_human_review
- 分析：analyze_failure, predict_progress
- 控制：no_action, fallback_to_tick

### 3.3 L2 皮层 — Opus 深度分析

`cortex.js` 在 L1 判断 level=2 时介入：

- **根因分析 (RCA)**：分析反复失败的任务
- **战略调整**：adjust_strategy（修改 brain_config，需审批）
- **经验记录**：record_learning（存入 reflections 表）
- **RCA 报告**：create_rca_report（存入 decision_log 表）

**皮层额外 3 个 action**：adjust_strategy、record_learning、create_rca_report

---

## 4. 数据模型

### 4.1 三层结构

```
goals (OKR 目标)
├── Objective (parent_id=NULL)
│   └── Key Result (parent_id=Objective.id)
│
projects (项目/Feature)
├── Project (repo_path≠NULL, parent_id=NULL)
│   └── Feature (parent_id=Project.id, repo_path=NULL)
│
tasks (具体任务)
└── Task (project_id→Feature.id, goal_id→KR.id)
```

**关键关系**：
- Task.project_id → **Feature** ID（不是 Project）
- Task.goal_id → **KR** ID（不是 Objective）
- Feature→Project 通过 parent_id 找到 repo_path（`resolveRepoPath()` 向上遍历）
- project_kr_links 表：Project ↔ KR 多对多关联

### 4.2 核心表

| 表 | 用途 | 关键字段 |
|----|------|---------|
| **tasks** | 任务队列 | status, task_type, priority, payload, prd_content |
| **goals** | OKR 目标 | type(objective/key_result), parent_id, progress |
| **projects** | 项目/Feature | repo_path, parent_id, decomposition_mode |
| **features** | Feature 状态机 | status, active_task_id, prd |
| **areas** | PARA 领域 | name, group_name |
| **project_kr_links** | 项目↔KR 关联 | project_id, kr_id |

### 4.3 系统表

| 表 | 用途 |
|----|------|
| **cecelia_events** | 全局事件日志（token 使用、状态变更、学习等） |
| **decision_log** | LLM 决策记录（L1/L2 输出、执行结果） |
| **working_memory** | 短期记忆（key-value，如 last_dispatch） |
| **brain_config** | 配置（region、fingerprint） |
| **pending_actions** | 危险操作审批队列（24h 过期） |
| **reflections** | 经验/问题/改进（issue/learning/improvement） |
| **daily_logs** | 每日汇总（summary、highlights、challenges） |
| **recurring_tasks** | 定时任务模板（cron 表达式） |
| **schema_version** | 迁移版本追踪 |
| **blocks** | 通用 block 存储 |

### 4.4 发布系统表（Schema v008）

| 表 | 用途 |
|----|------|
| **publishing_tasks** | 发布任务队列（platform、content、scheduled_at） |
| **publishing_records** | 发布历史（success、error_message、platform_response） |
| **publishing_credentials** | 平台凭据（platform、account_name、credentials） |

### 4.5 任务状态

```
queued → in_progress → completed
                    → failed → (retry) → queued
                    → quarantined → (release) → queued
                                 → (cancel) → cancelled
```

### 4.6 任务类型与路由

| 类型 | 位置 | Agent | 模型 |
|------|------|-------|------|
| dev | US | Caramel (/dev) | Opus |
| review | US | 审查员 (/review) | Sonnet |
| qa | US | 小检 (/qa) | Sonnet |
| audit | US | 小审 (/audit) | Sonnet |
| talk | HK | MiniMax | MiniMax |
| research | HK | MiniMax | MiniMax |
| data | HK | N8N | - |

---

## 5. 任务生命周期

### 5.1 从 OKR 到任务

```
Objective (目标)
  │
  ├─ 有 0 个 KR？ → 自动创建拆解任务 → 秋米 /okr → 生成 KR
  │
  └─ KR (关键结果)
       │
       ├─ selectDailyFocus() → 选择今日焦点 Objective
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
     ├─ resolveRepoPath() → Feature→Project→repo_path
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
  └─ 秋米分析 → 创建 Feature + 第一个 Task
       └─ Task 完成 → 回调触发"继续拆解"
            └─ (decomposition='continue', /okr, Opus)
                 └─ 秋米分析上次结果 → 创建下一个 Task
                      └─ 循环直到 KR 目标达成
```

---

## 6. 保护系统

### 6.1 警觉等级（alertness.js）

4 级自我保护，根据信号自动升降级：

| 级别 | 名称 | 派发率 | 行为 |
|------|------|--------|------|
| 0 | Normal | 100% | 全速运行 |
| 1 | Alert | 50% | 停止自动重试 |
| 2 | Emergency | 25% | 停止规划 |
| 3 | Coma | 0% | 只保留心跳 |

**信号源（9 种）**：

| 信号 | 分值 |
|------|------|
| circuit_breaker_open | +30 |
| db_connection_issues | +25 |
| systemic_failure | +25 |
| high_failure_rate | +20 |
| llm_bad_output | +20 |
| event_backlog | +20 |
| resource_pressure | +15 |
| llm_api_errors | +15 |
| consecutive_failures | +10/次（最高 +40） |

**阈值**：≥80→Coma, ≥50→Emergency, ≥20→Alert, <20→Normal

**衰减**：每 10 分钟 score × 0.8，问题解决后自动恢复

**恢复等待**：Coma→Emergency 30min, Emergency→Alert 15min, Alert→Normal 10min

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

MAX_SEATS = floor(min(USABLE_MEM / 500, USABLE_CPU / 0.5))
AUTO_DISPATCH_MAX = MAX_SEATS - INTERACTIVE_RESERVE
```

**8 核 16GB**：MAX_SEATS=12, AUTO_DISPATCH=10

### 7.2 动态限流

`checkServerResources()` 实时计算压力值（0.0~1.0+）：

| 压力 | 有效 Slots |
|------|-----------|
| < 0.5 | 满额（12） |
| 0.5~0.7 | 2/3（8） |
| 0.7~0.9 | 1/3（4） |
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
│  146.190.52.84              │     │  43.154.85.217              │
│                             │     │                             │
│  Docker 容器：              │◄───►│  Docker 容器：              │
│  ├ cecelia-node-brain:5221  │Tail-│  ├ PostgreSQL:5432          │
│  ├ PostgreSQL:5432          │scale│  ├ 生产前端:5211            │
│  ├ 开发前端:5212            │     │  └ MiniMax executor         │
│  └ Claude Code (headed)     │     │                             │
│                             │     │  任务类型：                 │
│  任务类型：                 │     │  talk, research, data       │
│  dev, review, qa, audit     │     │                             │
│  ENV_REGION=us              │     │  ENV_REGION=hk              │
└─────────────────────────────┘     └─────────────────────────────┘
```

### 8.2 容器化

**Brain 容器**：
- 镜像：`cecelia-brain:1.9.5`（多阶段构建，163MB）
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
4. **核心表存在** — tasks, goals, projects, features, working_memory, cecelia_events, decision_log, daily_logs
5. **Schema 版本** — 必须 = '008'
6. **配置指纹** — SHA-256(host:port:db:region) 一致性

### 8.5 数据库配置

**单一来源**：`brain/src/db-config.js`

```javascript
DB_DEFAULTS = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'cecelia',
  user: process.env.DB_USER || 'cecelia',
  password: process.env.DB_PASSWORD || 'CeceliaUS2026',
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

### 9.5 Feature 管理

| 端点 | 方法 | 用途 |
|------|------|------|
| `/features` | GET | 查询 Feature |
| `/features/:id` | GET | Feature 详情 |
| `/features` | POST | 创建 Feature |
| `/active-features` | GET | 活跃 Feature |
| `/feature-task-complete` | POST | Feature 任务完成处理 |

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
| `/pending-actions` | GET | 待审批危险操作 |
| `/pending-actions/:id/approve` | POST | 批准 |
| `/pending-actions/:id/reject` | POST | 拒绝 |

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
├── package.json               # 版本号（当前 1.9.5）
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
│   ├── thalamus.js            # L1 丘脑 (Sonnet)
│   ├── cortex.js              # L2 皮层 (Opus)
│   ├── decision-executor.js   # 决策执行器
│   │
│   ├── watchdog.js            # 资源看门狗 (/proc)
│   ├── alertness.js           # 4 级警觉
│   ├── circuit-breaker.js     # 三态熔断
│   ├── quarantine.js          # 隔离区
│   │
│   ├── routes.js              # ~100 个 API 端点
│   ├── task-router.js         # 任务类型 + 区域路由
│   ├── intent.js              # 意图识别
│   ├── templates.js           # PRD/TRD 模板
│   ├── notifier.js            # 通知
│   └── websocket.js           # WebSocket 推送
│
├── migrations/                # SQL 迁移 (000-008)
│   ├── 000_base_schema.sql
│   ├── 001_cecelia_architecture_upgrade.sql
│   ├── 002_task_type_review_merge.sql
│   ├── 003_feature_tick_system.sql
│   ├── 004_trigger_source.sql
│   ├── 005_schema_version_and_config.sql
│   ├── 006_exploratory_support.sql
│   ├── 007_pending_actions.sql
│   └── 008_publishing_system.sql
│
└── src/__tests__/             # Vitest 测试 (668/673 pass)
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
| 不派发任务 | alertness/circuit-breaker | 检查是否 Coma/OPEN |
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
| Opus | $15/M | $75/M | L2 皮层、OKR 拆解、dev 任务 |
| Sonnet | $3/M | $15/M | L1 丘脑、review/qa/audit |
| Haiku | $0.8/M | $4/M | 嘴巴（轻认知） |

每次 L1/L2 调用记录 token 使用到 cecelia_events 表。
