---
id: cecelia-architecture
version: 2.0.0
created: 2026-01-29
updated: 2026-02-01
changelog:
  - 2.0.0: 重构为统一的器官架构，移除 Autumnrice/Caramel/Nobel 概念
  - 1.0.0: 初始版本
---

# Cecelia 系统架构

## 核心定位

**Cecelia = 统一的 AI 管家系统**

所有功能统一在 "Cecelia" 品牌下，按照器官功能划分职责：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                              Cecelia (塞西莉亚)                              │
│                              ═══════════════════                            │
│                          统一的 AI 管家系统                                  │
│                                                                             │
│   ┌──────────────────────────────────────────────────────────────────┐     │
│   │                        Mouth (嘴巴)                               │     │
│   │                        ──────────────                             │     │
│   │  语音 / 文本 / CLI 输入层                                          │     │
│   │  Realtime API, WebSocket, REST                                   │     │
│   └──────────────────────────┬───────────────────────────────────────┘     │
│                              │                                             │
│                              ▼                                             │
│   ┌──────────────────────────────────────────────────────────────────┐     │
│   │                        Brain (脑)                                 │     │
│   │                        ──────────                                 │     │
│   │  决策与编排中心 - Node.js Brain (Port 5221)                        │     │
│   │  - Intent Recognition (意图识别)                                  │     │
│   │  - Planning (任务规划)                                            │     │
│   │  - Decision Making (决策引擎)                                     │     │
│   │  - Orchestration (任务编排)                                       │     │
│   │  - Tick Loop (2分钟自主循环)                                       │     │
│   │  - Circuit Breaker (熔断保护)                                     │     │
│   └──────────────────┬───────────────────────┬───────────────────────┘     │
│                      │                       │                             │
│         ┌────────────┴────────┐             │                             │
│         ▼                     ▼             ▼                             │
│   ┌──────────┐          ┌──────────┐  ┌──────────────┐                    │
│   │ Memory   │          │  Intel   │  │    Hands     │                    │
│   │ (记忆)   │          │ (情报)   │  │    (手)      │                     │
│   │──────────│          │──────────│  │──────────────│                    │
│   │Vector DB │          │Parser    │  │Claude Code   │                    │
│   │Semantic  │          │Scheduler │  │/dev workflow │                    │
│   │Search    │          │Detector  │  │Write/Test/PR │                    │
│   │(5220)    │          │Monitor   │  │CI/Merge      │                    │
│   └──────────┘          │(5220)    │  └──────────────┘                    │
│                         └──────────┘                                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 器官分层架构

### 第一层：LLM 决策层

**需要大模型推理的模块**

| 器官 | 职责 | 实现 | Port |
|------|------|------|------|
| **Brain** | 意图识别、任务规划、决策编排 | Node.js Brain | 5221 |
| **Hands** | 代码生成、测试编写、PR 提交 | Claude Code + /dev | - |

### 第二层：非 LLM 执行层

**不需要大模型，程序化执行的模块**

| 器官 | 职责 | 实现 | Port |
|------|------|------|------|
| **Memory** | 语义搜索、向量存储 | Chroma + Embeddings | 5220 |
| **Intelligence** | 代码监控、CI 监控、任务调度 | Python Intelligence Service | 5220 |
| **Mouth** | 语音/文本输入、Realtime API | WebSocket Proxy | 5220 |
| **Monitor** | Agent 监控、Patrol 监控 | Python API | 5220 |
| **Communication** | 事件总线、状态同步、通知 | N8N + Event Bus | 5679 |

## 数据流

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│  ┌─────────┐   ┌─────────┐   ┌─────────┐                                     │
│  │  语音   │   │  文本   │   │   CLI   │     ← 输入形式                       │
│  └────┬────┘   └────┬────┘   └────┬────┘                                     │
│       │             │             │                                          │
│       └─────────────┼─────────────┘                                          │
│                     │                                                        │
│                     ▼                                                        │
│              ┌──────────────┐                                                │
│              │    Mouth     │  接收输入                                       │
│              │   (Realtime) │  WebSocket                                     │
│              └──────┬───────┘                                                │
│                     │                                                        │
│                     ▼                                                        │
│              ┌──────────────┐                                                │
│              │    Brain     │  识别意图                                       │
│              │  (Node 5221) │  规划任务                                       │
│              └──────┬───────┘                                                │
│                     │                                                        │
│                     ▼                                                        │
│              ┌──────────────┐                                                │
│              │   Core DB    │  存储状态                                       │
│              │   (SQLite)   │  TRD/Task/Run                                  │
│              └──────┬───────┘                                                │
│                     │                                                        │
│        ┌────────────┼────────────┐                                           │
│        │            │            │                                           │
│        ▼            ▼            ▼                                           │
│   ┌─────────┐  ┌─────────┐  ┌─────────┐                                      │
│   │ 主动线  │  │ 被动线  │  │ Webhook │   ← 触发方式                          │
│   │ (你说话)│  │ (tick)  │  │ (事件)  │                                       │
│   └────┬────┘  └────┬────┘  └────┬────┘                                      │
│        │            │            │                                           │
│        └────────────┼────────────┘                                           │
│                     │                                                        │
│                     ▼                                                        │
│              ┌──────────────┐                                                │
│              │    Brain     │  决策编排                                       │
│              │  Orchestrate │  派发任务                                       │
│              └──────┬───────┘                                                │
│                     │                                                        │
│                     ▼                                                        │
│              ┌──────────────┐                                                │
│              │    Hands     │  执行代码                                       │
│              │ Claude Code  │  /dev workflow                                 │
│              │    + /dev    │  PRD→Code→Test→PR                              │
│              └──────┬───────┘                                                │
│                     │                                                        │
│                     ▼                                                        │
│              ┌──────────────┐                                                │
│              │      PR      │  产出                                          │
│              │   CI PASS    │  合并                                          │
│              └──────────────┘                                                │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

## 主动线 vs 被动线

### 主动线（用户触发）

```
用户输入 (语音/文本/CLI)
        │
        ▼
   Mouth 接收
        │
        ▼
   Brain 识别意图
        │
        ▼
   Brain 规划任务
        │
        ▼
   写 TRD/Task 到 DB
        │
        ▼
   Hands 执行 (/dev workflow)
        │
        ▼
   PR → CI → Merge
```

**特点**: 用户主动触发，秒级响应

### 被动线（自主运行）

```
Tick Loop (每 2 分钟)
        │
        ▼
   Brain 自检
        │
        ├── 检查依赖解锁
        ├── 派发 ready 任务
        ├── 重试 failed 任务
        ├── 检查 PR/CI 状态
        ├── 生成 blocker card
        └── 自我诊断 (Circuit Breaker)
        │
        ▼
   更新状态
        │
        ▼
   推送通知 (如有需要)
```

**特点**: 无需用户干预，后台自动推进

## 状态机

### TRD (技术需求文档)

```
         ┌─────────────────────────────────┐
         │                                 │
         ▼                                 │
┌───────────────┐    ┌───────────────┐    │
│     DRAFT     │───▶│    PLANNED    │    │
│    (草稿)     │    │   (已规划)    │    │
└───────────────┘    └───────┬───────┘    │
                             │            │
                             ▼            │
                     ┌───────────────┐    │
                     │  IN_PROGRESS  │────┘
                     │   (执行中)    │
                     └───────┬───────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
      ┌───────────┐  ┌───────────┐  ┌───────────┐
      │   DONE    │  │  BLOCKED  │  │ CANCELLED │
      │  (完成)   │  │  (阻塞)   │  │  (取消)   │
      └───────────┘  └───────────┘  └───────────┘
```

### Task (任务)

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  QUEUED  │───▶│ ASSIGNED │───▶│ RUNNING  │───▶│   DONE   │
│ (排队中) │    │ (已分配) │    │ (执行中) │    │  (完成)  │
└──────────┘    └──────────┘    └────┬─────┘    └──────────┘
     ▲                               │
     │                               ▼
     │                         ┌──────────┐
     │         retry           │  FAILED  │
     └─────────────────────────│  (失败)  │
       (retry_count < max)     └──────────┘
```

### Run (执行记录)

```
┌──────────┐
│ RUNNING  │
│ (执行中) │
└────┬─────┘
     │
     ├───────────────┬───────────────┬───────────────┐
     ▼               ▼               ▼               ▼
┌─────────┐   ┌─────────┐   ┌─────────┐   ┌───────────┐
│ SUCCESS │   │ FAILED  │   │ TIMEOUT │   │ CANCELLED │
│ (成功)  │   │ (失败)  │   │ (超时)  │   │  (取消)   │
└─────────┘   └─────────┘   └─────────┘   └───────────┘

注意: Run 只写不回退，Task 可以重试产生新 Run
```

## 器官职责

### Brain (脑) - Node.js Brain (5221)

**职责**：
- ✅ 意图识别 (Intent Recognition)
- ✅ 任务规划 (Planning)
- ✅ 决策引擎 (Decision Making)
- ✅ 任务编排 (Orchestration)
- ✅ Tick Loop (2分钟自主循环)
- ✅ Circuit Breaker (熔断保护)
- ✅ Self-Diagnosis (自我诊断)
- ✅ PRD/TRD 生成
- ❌ 不直接写代码

**自主运行**：
- 每 2 分钟自动检查任务队列
- 自动派发可执行任务
- 自动重试失败任务
- 自动检查 PR/CI 状态
- 熔断保护：3 次失败 → 30 分钟冷却

### Hands (手) - Claude Code + /dev

**职责**：
- ✅ 接收任务
- ✅ 执行 /dev workflow
- ✅ 写代码、跑测试
- ✅ 提 PR、修 CI
- ✅ 回报结果 (Run complete)
- ❌ 不做调度
- ❌ 不做规划

### Memory (记忆) - Intelligence Service (5220)

**职责**：
- ✅ 语义搜索 (Semantic Search)
- ✅ 向量存储 (Vector Store - Chroma)
- ✅ 代码索引
- ✅ 历史上下文检索

### Intelligence (情报) - Intelligence Service (5220)

**职责**：
- ✅ 代码监控 (Code Monitor)
- ✅ CI 监控 (CI Monitor)
- ✅ 安全监控 (Security Monitor)
- ✅ Parser Service (意图解析)
- ✅ Scheduler Service (任务调度)
- ✅ Detector Service (事件检测)

### Mouth (嘴巴) - Intelligence Service (5220)

**职责**：
- ✅ 语音输入 (Realtime API)
- ✅ 文本输入 (REST API)
- ✅ CLI 输入
- ✅ WebSocket Proxy

### Monitor (监控) - Intelligence Service (5220)

**职责**：
- ✅ Agent 监控
- ✅ Patrol 监控
- ✅ 状态追踪

### Communication (通讯) - N8N + Event Bus

**职责**：
- ✅ 事件总线
- ✅ 状态同步
- ✅ Webhook 触发
- ✅ 通知推送

## API 端点

### Brain API (Node.js - 5221)

```
/api/brain/
├── POST /intent                    识别意图
├── POST /plan                      规划任务
├── POST /decision                  决策建议
├── POST /trd                       创建 TRD
├── POST /task                      创建任务
├── GET  /queue                     任务队列
├── POST /execute/:taskId           执行任务
├── POST /pause/:taskId             暂停任务
├── GET  /tick                      触发 tick
├── GET  /circuit-breaker/status    熔断器状态
└── POST /circuit-breaker/reset     重置熔断器
```

### Intelligence Service API (Python - 5220)

```
Semantic Search
├── POST /v1/semantic/search        语义搜索
└── GET  /v1/semantic/stats         索引统计

Code Patrol & Monitoring
├── GET  /api/patrol/status         Patrol 状态
└── POST /api/patrol/scan           触发扫描

Agent Monitoring
├── GET  /api/agent/status          Agent 状态
└── GET  /api/agent/sessions        Session 列表

Task Orchestration & Realtime
├── POST /api/orchestrator/queue    队列管理
├── POST /api/orchestrator/execute-now  立即执行
├── POST /api/orchestrator/pause    暂停任务
└── GET  /api/orchestrator/realtime Realtime WebSocket
```

## 关键原则

1. **统一品牌**: 所有功能统一在 "Cecelia" 品牌下
2. **器官分工**: 按照功能职责划分器官，清晰边界
3. **LLM 分层**: LLM 决策层 vs 非 LLM 执行层
4. **状态外置**: 所有状态存 DB，不依赖长期记忆
5. **自主运行**: Tick Loop 自动推进，无需人工干预
6. **容错设计**: Circuit Breaker + Retry + Self-Diagnosis
7. **单一大脑**: Node Brain (5221) 是唯一决策中心
8. **分布式执行**: Hands (Claude Code) 接收任务并行执行

## 服务架构

```
┌────────────────────────────────────────────────────────────┐
│                     Cecelia 系统                            │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  ┌──────────────────────────────────────────────────┐     │
│  │  Brain (Node.js - Port 5221)                     │     │
│  │  ─────────────────────────────                   │     │
│  │  - Intent Recognition                            │     │
│  │  - Planning & Decision                           │     │
│  │  - Orchestration                                 │     │
│  │  - Tick Loop (2min)                              │     │
│  │  - Circuit Breaker                               │     │
│  └──────────────────────────────────────────────────┘     │
│                                                            │
│  ┌──────────────────────────────────────────────────┐     │
│  │  Intelligence Service (Python - Port 5220)       │     │
│  │  ────────────────────────────────────────────    │     │
│  │  - Semantic Search (Memory)                      │     │
│  │  - Code Monitoring (Intelligence)                │     │
│  │  - Realtime API (Mouth)                          │     │
│  │  - Agent Monitor (Monitor)                       │     │
│  └──────────────────────────────────────────────────┘     │
│                                                            │
│  ┌──────────────────────────────────────────────────┐     │
│  │  Core Database (SQLite)                          │     │
│  │  ─────────────────────────                       │     │
│  │  - TRD / Task / Run                              │     │
│  │  - State Machine                                 │     │
│  │  - Execution Logs                                │     │
│  └──────────────────────────────────────────────────┘     │
│                                                            │
│  ┌──────────────────────────────────────────────────┐     │
│  │  Execution Layer (Hands)                         │     │
│  │  ──────────────────────────                      │     │
│  │  - Claude Code (无头模式)                         │     │
│  │  - /dev Workflow                                 │     │
│  │  - cecelia-run (并发控制: max 3)                  │     │
│  └──────────────────────────────────────────────────┘     │
│                                                            │
│  ┌──────────────────────────────────────────────────┐     │
│  │  Communication Layer                             │     │
│  │  ──────────────────────────                      │     │
│  │  - N8N Workflows (Port 5679)                     │     │
│  │  - Event Bus                                     │     │
│  │  - Webhooks                                      │     │
│  └──────────────────────────────────────────────────┘     │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

## 一句话总结

> **Cecelia = 统一的器官系统 + Brain 自主决策 + Hands 并行执行 + 24/7 自动运行**
