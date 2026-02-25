# Cecelia OKR 分析与 Project 规划

**分析日期**: 2026-02-01
**版本**: 1.0.0
**状态**: Draft

---

## 1. 当前 OKR 状态总览

### Objective (O1)
**Cecelia 自驱进化 - 从被动执行器到自驱数字生命体**

| 状态 | 进度 | 优先级 |
|------|------|--------|
| in_progress | 11% (1/9 KR 完成) | P0 |

---

## 2. Key Results 完成度分析

| KR | 标题 | 优先级 | 状态 | 进度 | 差距分析 |
|----|------|--------|------|------|---------|
| **KR1** | 意图识别 - 自然语言→OKR/Project/Task | P0 | pending | 0% | **阻塞器**：这是整个系统的入口，必须优先完成 |
| **KR2** | PRD/TRD 自动生成（标准化） | P0 | ✅ completed | 100% | ✅ 已完成 |
| **KR3** | 项目系统 + 生命周期管理 | P1 | pending | 0% | 需要：Project CRUD、状态机、生命周期钩子 |
| **KR4** | 自驱 Planning Engine（主动规划） | P1 | pending | 0% | 需要：Planner 模块、Opus 集成、规划算法 |
| **KR5** | 自修复 / 自愈能力 | P1 | pending | 0% | 需要：Circuit Breaker、Health Manager、自诊断 |
| **KR6** | 对话接口增强（Cecelia 前台） | P2 | pending | 0% | 需要：/cecelia skill、意图路由、上下文管理 |
| **KR7** | Cecelia 可执行一次完整 /dev 流程 | P1 | pending | 0% | 需要：Dispatch、Resource Manager、命令生成 |
| **KR8** | N8N 调度可自动触发 3 个任务 | P1 | pending | 0% | 需要：N8N 集成、Webhook、任务队列 |
| **KR9** | Core 前端可实时显示执行状态 | P1 | pending | 0% | 需要：WebSocket、状态推送、前端组件 |

---

## 3. 优先级分层与依赖分析

### 3.1 P0 层（阻塞器 - 必须立即完成）

#### KR1: 意图识别 - 自然语言→OKR/Project/Task

**为什么是 P0？**
- 这是 Cecelia 的"嘴巴"，没有意图识别就无法理解用户输入
- 阻塞所有后续功能（Planning、Dispatch、自修复等）

**当前差距**：
- ❌ 没有 Cognitive Plane 的意图结构化模块（Planner）
- ❌ 没有 Interface/Perception Layer 的粗分类（Mouth）
- ❌ 没有 OKR/Project/Task 的自动映射逻辑

**技术债务**：
- 需要实现 `brain/src/cognitive/planner.js`（Opus LLM 集成）
- 需要实现 `brain/src/interface/mouth.js`（Haiku 分类）
- 需要设计意图 schema（参考 DEFINITION.md 2.2 决策责任矩阵）

---

### 3.2 P1 层（基础设施 - 顺序依赖）

#### 阶段 A：控制平面基础（KR7 依赖）

**KR7: Cecelia 可执行一次完整 /dev 流程**

**为什么先做？**
- 这是 Control Plane 的核心能力验证
- 依赖：Dispatch、Resource Manager、Queue Manager

**当前差距**：
- ❌ 没有 Dispatch Executor（`brain/src/control/executor.js`）
- ❌ 没有 Resource Manager（`brain/src/control/resource-manager.js`）
- ❌ 没有 Advice API（`brain/src/cognitive/advice-api.js`）
- ❌ 没有执行节点配置（`execution_nodes` 表为空？）

**依赖链**：
```
KR1 (意图识别)
  → KR4 (Planning Engine)
    → KR7 (执行 /dev 流程)
      → KR8 (N8N 调度)
```

#### 阶段 B：认知平面增强（KR4 依赖）

**KR4: 自驱 Planning Engine（主动规划）**

**为什么重要？**
- 这是 Cecelia 从"被动执行器"到"自驱生命体"的关键
- 依赖：Internal Planner（Opus）、任务拆解算法

**当前差距**：
- ❌ 没有 `brain/src/cognitive/planner.js`（Internal Planner）
- ❌ 没有任务拆解逻辑（decomposeFeature）
- ❌ 没有优先级推理（recommendPriority）
- ❌ 没有 agent 推荐（recommendAgent）

#### 阶段 C：生命体能力（KR3, KR5 并行）

**KR3: 项目系统 + 生命周期管理**

**当前差距**：
- ❌ 没有 Project CRUD API（除了基础查询）
- ❌ 没有状态机（DRAFT → ACTIVE → COMPLETED）
- ❌ 没有生命周期钩子（onCreate、onComplete）

**KR5: 自修复 / 自愈能力**

**当前差距**：
- ❌ 没有 Circuit Breaker（`brain/src/control/circuit-breaker.js`）
- ❌ 没有 Health Manager（心跳检测、故障诊断）
- ❌ 没有自诊断 Planner（Immune Diagnoser）

#### 阶段 D：用户界面（KR6, KR8, KR9 并行）

**KR6: 对话接口增强（Cecelia 前台）**

**当前差距**：
- ❌ /cecelia skill 功能有限（只能简单对话）
- ❌ 没有上下文管理（多轮对话）
- ❌ 没有意图历史追踪

**KR8: N8N 调度可自动触发 3 个任务**

**当前差距**：
- ❌ N8N workflow 未配置 Cecelia 调度
- ❌ 没有 Webhook 触发器
- ❌ 没有任务队列监控

**KR9: Core 前端可实时显示执行状态**

**当前差距**：
- ❌ 前端没有 WebSocket 连接
- ❌ 没有实时状态推送
- ❌ 没有任务执行时间线组件

---

## 4. Project 优先级排期（Critical Path）

### 阶段 0：基础设施修复（1-2 天）

**P0.1: 完善 PostgreSQL Schema**

- [ ] 确认 `execution_nodes` 表有数据
- [ ] 确认 `execution_runs` 表结构
- [ ] 添加 `circuit_breaker_state` 表
- [ ] 添加 `health_status` 表

**P0.2: Brain 基础模块搭建**

- [ ] 创建 `brain/src/cognitive/` 目录结构
- [ ] 创建 `brain/src/control/` 目录结构
- [ ] 创建 `brain/src/interface/` 目录结构
- [ ] 配置 Opus LLM API（Anthropic SDK）

---

### 阶段 1：P0 突破（3-5 天）

**Project 1.1: KR1 - 意图识别系统（二段式）**

**Feature 1.1.1: Interface/Perception Layer（Mouth）**
- Task 1: 实现 `mouth.js` - Haiku 粗分类
- Task 2: 设计意图枚举（automation / coding / planning / query）
- Task 3: 集成到 /cecelia skill

**Feature 1.1.2: Cognitive Plane（Planner - 意图结构化）**
- Task 1: 实现 `planner.js` - Opus 最终结构化
- Task 2: 定义 Canonical JSON schema
- Task 3: OKR/Project/Task 自动映射逻辑

**验收标准**：
- [ ] 用户说"帮我爬数据" → Mouth 返回 `automation` → Planner 返回 `{type: "automation", target: "...", ...}`
- [ ] 用户说"新建项目 XXX" → 自动创建 Project 并关联到合适的 Goal
- [ ] 支持中英文混合输入

---

### 阶段 2：P1A - 控制平面核心（5-7 天）

**Project 2.1: KR7 - Dispatch Executor + Resource Manager**

**Feature 2.1.1: Advice API（防渗透接口）**
- Task 1: 实现 `advice-api.js`
- Task 2: Schema 校验 + Fallback
- Task 3: 单元测试（mock Opus）

**Feature 2.1.2: Dispatch Executor**
- Task 1: 实现 `executor.js` - 命令生成
- Task 2: 实现 modelMap（planner=opus, caramel=sonnet）
- Task 3: SSH 远程执行逻辑

**Feature 2.1.3: Resource Manager**
- Task 1: 节点注册与发现
- Task 2: Seat 分配（CAS 原子操作）
- Task 3: 负载均衡算法

**验收标准**：
- [ ] 手动创建一个 Task → Cecelia 自动派发到 Caramel → 执行 /dev 流程 → 回写结果
- [ ] 支持多节点调度（VPS + Mac mini）
- [ ] 资源不足时进入 WAITING 状态

---

### 阶段 3：P1B - 认知平面增强（3-5 天）

**Project 3.1: KR4 - Planning Engine**

**Feature 3.1.1: Internal Planner（任务拆解）**
- Task 1: 实现 `decomposeFeature(description)` - Opus 拆解
- Task 2: 依赖分析（哪些任务必须先完成）
- Task 3: 估算工作量（S/M/L）

**Feature 3.1.2: 优先级推理**
- Task 1: 实现 `recommendPriority(task, context)` - Opus 推理
- Task 2: 多因素权衡（紧急度、依赖、资源）

**Feature 3.1.3: Agent 推荐**
- Task 1: 实现 `recommendAgent(task)` - Opus 推荐
- Task 2: Whitelist 验证（caramel/nobel/planner/qa/audit）

**验收标准**：
- [ ] 创建一个 Feature "实现用户登录" → Planner 自动拆解为 3-5 个 Tasks
- [ ] 自动推荐优先级（P0/P1/P2）
- [ ] 自动推荐 agent（caramel 负责写代码）

---

### 阶段 4：P1C - 生命体能力（并行，5-7 天）

**Project 4.1: KR3 - 项目生命周期管理**

**Feature 4.1.1: Project CRUD API**
- Task 1: POST /api/tasks/projects - 创建项目
- Task 2: PATCH /api/tasks/projects/:id - 更新状态
- Task 3: DELETE /api/tasks/projects/:id - 归档项目

**Feature 4.1.2: 状态机**
- Task 1: 定义状态转换规则（DRAFT → ACTIVE → COMPLETED）
- Task 2: 状态验证（不允许跳跃）
- Task 3: 触发器（onStatusChange）

**Project 4.2: KR5 - 自修复能力**

**Feature 4.2.1: Circuit Breaker**
- Task 1: 实现 `circuit-breaker.js`
- Task 2: 失败计数 + 熔断规则（3 次失败 → 30 分钟暂停）
- Task 3: 熔断状态持久化（PostgreSQL）

**Feature 4.2.2: Health Manager**
- Task 1: 心跳检测（每 2 分钟 ping 节点）
- Task 2: 故障诊断（超时/无响应/进程挂掉）
- Task 3: 自动恢复（重启 agent）

**Feature 4.2.3: Immune Diagnoser（Cognitive）**
- Task 1: 失败模式分析（Opus 诊断）
- Task 2: 根因报告生成
- Task 3: 修复建议

---

### 阶段 5：P1D - 用户界面（并行，3-5 天）

**Project 5.1: KR6 - 对话接口增强**

**Feature 5.1.1: 上下文管理**
- Task 1: 多轮对话历史存储
- Task 2: 上下文注入到 LLM prompt
- Task 3: 会话超时清理

**Project 5.2: KR8 - N8N 调度集成**

**Feature 5.2.1: Webhook 触发器**
- Task 1: 配置 N8N workflow
- Task 2: Webhook 接收任务创建请求
- Task 3: 自动触发 Tick Loop

**Project 5.3: KR9 - 前端实时状态**

**Feature 5.3.1: WebSocket 集成**
- Task 1: Brain 添加 WebSocket 服务（Socket.io）
- Task 2: 前端建立 WebSocket 连接
- Task 3: 状态推送（Task 状态变更 → 前端更新）

---

## 5. 关键里程碑与时间线

| 里程碑 | 目标 | 预计完成 | 验收标准 |
|--------|------|---------|---------|
| **M0** | 基础设施就绪 | Day 2 | PostgreSQL schema 完整、Brain 目录结构搭建 |
| **M1** | 意图识别可用 | Day 7 | 用户输入 → OKR/Project/Task 自动创建 |
| **M2** | 执行 /dev 流程 | Day 14 | 手动创建 Task → Cecelia 自动派发 → 执行完成 |
| **M3** | 自驱规划可用 | Day 19 | Feature → 自动拆解 Tasks + 优先级 + Agent |
| **M4** | 自修复上线 | Day 26 | Circuit Breaker + Health Manager + 自诊断 |
| **M5** | 用户界面完善 | Day 31 | 对话接口 + N8N 调度 + 实时状态 |

---

## 6. 风险与依赖

### 6.1 技术风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| Opus API 超时/不稳定 | Planning Engine 不可用 | 实现 Fallback + Cache + 重试 |
| 多节点资源竞争 | 任务派发失败 | CAS 原子操作 + 事务锁 |
| N8N Webhook 不可靠 | 任务丢失 | 添加 Polling 备用机制 |

### 6.2 外部依赖

| 依赖 | 提供方 | 风险等级 |
|------|--------|---------|
| Anthropic API (Opus/Haiku) | Anthropic | 中 |
| PostgreSQL | 本地 VPS | 低 |
| N8N | 本地 Docker | 低 |
| Claude Code CLI | Anthropic | 中 |

---

## 7. 下一步行动

### 立即开始（今天）

**行动 1: 验证当前 Brain 代码结构**
```bash
cd /home/xx/dev/cecelia-core/brain
tree src/
```

**行动 2: 检查 PostgreSQL Schema**
```bash
psql -U n8n_user -d cecelia_tasks -c "\dt"
psql -U n8n_user -d cecelia_tasks -c "SELECT * FROM execution_nodes LIMIT 5;"
```

**行动 3: 创建 Project 1.1（意图识别系统）**
```bash
curl -X POST http://localhost:5212/api/tasks/projects \
  -H "Content-Type: application/json" \
  -d '{
    "name": "KR1: 意图识别系统（二段式）",
    "description": "实现 Mouth (Haiku 粗分类) + Planner (Opus 最终结构化)",
    "status": "active",
    "priority": "P0",
    "repo_path": "/home/xx/dev/cecelia-core"
  }'
```

---

## 8. 成功指标

### 8.1 短期指标（1 个月）

- [ ] 9 个 KR 中至少完成 5 个（当前 1/9）
- [ ] Cecelia 可自主执行 3 个完整的 /dev 任务
- [ ] 意图识别准确率 > 85%
- [ ] 平均任务派发延迟 < 5 秒

### 8.2 长期指标（3 个月）

- [ ] Cecelia 可自驱规划并完成一个中型项目（10+ Tasks）
- [ ] 自修复成功率 > 90%（熔断后自动恢复）
- [ ] 用户无需手动创建任务（全自动化）

---

**文档结束**

**版本**: 1.0.0
**创建时间**: 2026-02-01
**维护者**: Cecelia Team
