# Cecelia 定义文档

**版本**: 1.3.2
**创建时间**: 2026-02-01
**最后更新**: 2026-02-01
**状态**: 正式生产版本（无死角审计级）

---

## 目录

1. [核心定位与边界](#1-核心定位与边界)
2. [LLM 使用边界与模型策略](#2-llm-使用边界与模型策略)
3. [生命体架构](#3-生命体架构)
4. [数据模型与层级](#4-数据模型与层级)
5. [任务执行与调度](#5-任务执行与调度)
6. [资源管理与节点调度](#6-资源管理与节点调度)
7. [容错与熔断](#7-容错与熔断)
8. [进化系统](#8-进化系统)
9. [通信协议](#9-通信协议)
10. [部署架构](#10-部署架构)
11. [FAQ 与最佳实践](#11-faq-与最佳实践)
12. [故障排查](#12-故障排查)
13. [运维手册](#13-运维手册)

---

## 1. 核心定位与边界

### 1.1 Cecelia 是什么？

**Cecelia = 24/7 自主运行的生命体级管家系统（Life-Form Chief Butler System）**

Cecelia 是一个完整的自主生命体，具备：
- **自我感知**：通过 Health Manager 监控自身状态
- **自我决策**：通过 Cognitive Plane 进行深度推理
- **自我调节**：通过 Resource Manager 和 Circuit Breaker 保护自身
- **自我进化**：通过 Evolution System 持续优化

**核心公式**：

```
Cecelia = Control Plane (Deterministic, 控制层)
        + Cognitive Plane (LLM-Powered, 认知层)
        + PostgreSQL (Single Source of Truth, 唯一真相源)
        + External Experts (外部专家，可选委托)
```

**术语定义**：

| 术语 | 定义 |
|------|------|
| **Control Plane** | 中枢控制层，完全 deterministic，禁止 LLM 直接参与状态推进、资源分配、DB 操作。职责：执行、调度、资源管理、熔断。 |
| **Cognitive Plane** | 中枢认知层，使用 Opus LLM 进行深度推理。职责：意图理解、任务规划、决策推荐、诊断分析、进化提案。 |
| **Interface/Perception Layer** | 接口层，负责意图分类、结构化输入、路由到 Planner。使用 Haiku 做轻量级认知（不做深度推理），属于 Perception 层而非 Cognitive Plane。 |
| **Planner（内层）** | Brain 内部的认知模块，属于 Cognitive Plane，使用 Opus 做任务拆解、优先级推理、agent 推荐。**必须存在，不可替代**。 |
| **Dispatch（调度器）** | Brain 内部的控制模块，属于 Control Plane，负责确定性执行派发、资源分配、命令生成。**严格 deterministic，禁止 LLM 直接决策**。 |
| **External Planner Agent** | 外层专家（/planner skill, Autumnrice），可选委托的副管家，用于极复杂任务拆解。**可替换、可迁移，不是 Cecelia 器官**。 |

### 1.2 核心器官（Internal Organs）

**这些是 Cecelia 的身体组成部分，全部在 `cecelia-core` 仓库内**：

| 器官 | 实现 | 端口 | 职责 | 类型 | 说明 |
|------|------|------|------|------|------|
| **💬 嘴巴** | /cecelia skill | - | 对外对话接口，意图分类 | Interface/Perception | 使用 Haiku，轻认知 |
| **🧠 大脑 - Cognitive** | Brain Cognitive Modules | 5221 | 深度推理、规划、诊断 | Cognitive | **包含 Planner 模块** |
| **🧠 大脑 - Control** | Brain Control Modules | 5221 | 确定性执行、调度、资源管理 | Control | **包含 Dispatch 模块** |
| **❤️ 心脏** | Tick Loop | - | 持续运作（每 2 分钟） | Control | 定时唤醒，完全 deterministic |
| **👀 感知** | Perception (Node.js) | 5221 | 系统监控、N8N 状态、任务状态 | Control | 集成在 Brain 中 |
| **📊 记忆** | PostgreSQL | 5432 | 存储所有状态和历史 | Control | 唯一真相源 |
| **🛡️ 免疫** | Circuit Breaker | - | 熔断保护、故障隔离 | Control | 硬编码规则 |
| **🔧 队列** | Queue Manager | - | 队列管理、任务分发 | Control | 确定性算法 |
| **⚡ 资源** | Resource Manager | - | 资源分配、节点调度 | Control | 确定性分配 |

**关键架构原则**：

> **大脑分为两层：Cognitive Plane（认知层，LLM）+ Control Plane（控制层，Deterministic）**
>
> - **Cognitive Plane 包含 Planner**：负责"思考、建议、推理"（意图理解、任务拆解、优先级推荐、agent 推荐、诊断分析、进化提案）
> - **Control Plane 包含 Dispatch**：负责"执行、调度、分配"（状态推进、资源分配、DB 写入、命令生成、熔断判断）
> - **Dispatch 通过 Advice API 获取建议**：但必须经过 schema 校验、whitelist 映射、deterministic fallback，最终落地动作由 Dispatch 的确定性逻辑执行

### 1.3 外部专家（External Experts）

**这些是独立的 Agents，不是 Cecelia 的器官**：

| Agent | Skill | 模型 | 角色 | 关系 | 是否必需 |
|-------|-------|------|------|------|---------|
| **External Planner** | /planner (已废弃) | Opus | 副管家（Assistant Butler） | 外部承包商，可选委托 | ❌ 可选 |
| **Caramel** | /dev | Sonnet | 编程专家（Coding Specialist） | 外部承包商 | ✅ 必需（执行编程任务） |
| **Nobel** | /nobel | Sonnet | 自动化专家（Automation Specialist） | 外部承包商 | ✅ 必需（执行自动化任务） |
| **小检** | /qa | Sonnet | QA 专家（QA Specialist） | 外部承包商 | ✅ 必需（质量验收） |
| **小审** | /audit | Sonnet | 审计专家（Audit Specialist） | 外部承包商 | ✅ 必需（代码审计） |

**关键区别**：

| 维度 | Internal Planner（内层） | External Planner Agent（外层） |
|------|------------------------|------------------------------|
| **位置** | Brain 内部 Cognitive Plane | 独立进程（/planner skill） |
| **实现** | brain/src/cognitive/planner.js | ~/.claude/skills/planner/ |
| **模型** | Opus | Opus |
| **职责** | 简单任务拆解（1-5 步） | 复杂任务拆解（5+ 步） |
| **是否必需** | ✅ 必需（Cecelia 核心能力） | ❌ 可选（可委托给外部） |
| **可替换性** | ❌ 不可替换（Cecelia 器官） | ✅ 可替换（可能去其他公司） |
| **调用方式** | Brain 内部函数调用 | Bash 启动外部进程 |
| **状态共享** | 直接访问 PostgreSQL | 通过 PostgreSQL 读写 |

**何时使用 External Planner？**

- 任务复杂度 > 5 步
- 需要多个 agents 协同
- 用户显式要求"详细规划"

**何时不用 External Planner？**

- 简单任务（1-3 步）
- Internal Planner 可以规划（Brain 的 Cognitive Planner）
- 只涉及单个 agent

---

## 2. LLM 使用边界与模型策略

### 2.1 核心原则

**三条不可违反的硬规则（MUST NOT）**：

1. **🔴 MUST NOT: Control Plane 禁止 LLM 直接决策**
   - 状态机、DB 操作、资源分配、命令生成必须 100% deterministic
   - 违反后果：状态不可预测、幂等性丧失、系统不稳定

2. **🔴 MUST NOT: Dispatch 禁止 LLM 直接参与落地执行**
   - Dispatch 可以"接收 Planner 的 LLM 建议"，但最终决策必须由硬编码逻辑执行
   - 必须经过：schema 校验 → whitelist 映射 → deterministic fallback
   - 违反后果：相同输入产生不同结果、资源分配不公平、审计困难

3. **🔴 MUST NOT: DB 写入禁止由 LLM 生成 SQL**
   - 所有 INSERT/UPDATE 必须使用预定义 SQL 模板
   - 违反后果：SQL 注入风险、数据完整性破坏、事务不一致

4. **🟠 SHOULD NOT: Cognitive Plane 输出不得包含可执行动作**
   - Planner 输出只能是 Advice JSON（建议、候选、理由、置信度）
   - 禁止输出：shell 命令、SQL、直接可执行 patch
   - 原因：避免 Cognitive 输出绕过 Control 的审计与幂等性边界

### 2.2 Planner vs Dispatch 决策责任矩阵

**关键原则**：

> **Planner 负责"思考、建议"（What to do?）**
> **Dispatch 负责"执行、落地"（How to do it?）**

| 决策点 | 层级 | 负责模块 | 允许 LLM | 实现方式 | 输出类型 | 说明 |
|--------|------|---------|---------|---------|---------|------|
| **意图粗分类（路由）** | Interface/Perception | Mouth | 🟩 允许 (Haiku) | 自然语言 → 粗粒度分类 | 枚举 (routing key) | "帮我爬数据" → `automation` |
| **意图最终结构化** | Cognitive | Planner | 🟩 允许 (Opus) | 自然语言 → Canonical JSON | JSON (schema 验证) | `automation` + 上下文 → `{type: "automation", target: "...", ...}` |
| **任务拆解** | Cognitive | Planner | 🟩 允许 (Opus) | Feature 描述 → Task 列表 | JSON 数组 (schema 验证) | "实现登录" → [Task1, Task2, Task3] |
| **优先级建议** | Cognitive | Planner | 🟩 允许 (Opus) | 多因素推理 → P0/P1/P2 | 枚举 (whitelist 映射) | LLM 推荐 P0 → 映射到枚举 |
| **Agent 推荐** | Cognitive | Planner | 🟩 允许 (Opus) | 任务特征 → agent 名称 | 字符串 (whitelist 验证) | LLM 推荐 "caramel" → 验证在候选集 |
| **节点候选推荐** | Cognitive | Planner | 🟩 允许 (Opus) | 任务 + 资源 → 候选节点列表 | 节点 ID 数组 (存在性验证) | LLM 推荐 ["vps-main", "mac-mini"] |
| **PRD 生成** | Cognitive | Planner | 🟩 允许 (Opus) | 任务上下文 → Markdown PRD | Markdown 文件 | 写入 /tmp/prd-*.md |
| **诊断分析** | Cognitive | Planner | 🟩 允许 (Opus) | 失败历史 → 根因报告 | JSON 报告 | Immune Diagnoser |
| **进化提案** | Cognitive | Planner | 🟩 允许 (Opus) | 系统 signals → Change Proposal | JSON (严格 schema) | Evolution Engine |
| | | | | | | |
| **状态机推进** | Control | Dispatch | 🟥 禁止 | 硬编码纯函数 | 枚举状态 | `QUEUED → RUNNING` |
| **资源座位分配** | Control | Dispatch | 🟥 禁止 | CAS 原子操作 | DB UPDATE | `UPDATE tasks SET assigned_node_id=...` |
| **DB 写入/更新** | Control | Dispatch | 🟥 禁止 | 预定义 SQL 模板 | SQL 语句 | `UPDATE tasks SET status=...` |
| **命令模板生成** | Control | Dispatch | 🟥 禁止 | 字符串模板 | Bash 命令 | `nohup claude -p "/dev ..."` |
| **熔断判断** | Control | Dispatch | 🟥 禁止 | 阈值硬规则 | Boolean | `failures >= 3 → OPEN` |
| **重试策略** | Control | Dispatch | 🟥 禁止 | 计数器 + 硬规则 | 重试次数 | `retry_count < max_retries` |
| **节点最终选择** | Control | Dispatch | 🟥 禁止 | 确定性算法 | 单个节点 ID | 从候选列表按规则选第一个 |
| **Seat 可用性检查** | Control | Dispatch | 🟥 禁止 | SQL COUNT 查询 | Integer | `max - reserved - COUNT(running)` |
| **Idempotency Key 生成** | Control | Dispatch | 🟥 禁止 | 字符串拼接 | 字符串 | `feature-${id}-task-${title}` |

### 2.3 Dispatch 通过 Advice API 获取建议的正确模式

**❌ 错误模式：LLM 直接决策**

```javascript
// ❌ 禁止：Dispatch 直接用 LLM 做资源分配
async function dispatch(task) {
  const node = await llm.selectNode(task, resources);  // ❌ 不可预测
  await allocateSeat(task.id, node.id);  // ❌ 每次可能不同
}
```

**✅ 正确模式：Advice API 建议 + Deterministic 落地**

```javascript
// ✅ 正确：Dispatch 通过 Advice API 获取建议，然后用硬规则落地
async function dispatch(task, resources) {
  // Step 1: 调用 Advice API 获取建议（Cognitive Plane, Opus）
  const suggestion = await advice.recommendNode(task, resources);
  // suggestion = { candidates: ["vps-main", "mac-mini"], reason: "..." }

  // Step 2: Dispatch 验证建议（Control Plane, Deterministic）
  const validCandidates = resources.nodes.filter(node => {
    // 硬规则 1: 候选节点必须在可用列表中
    if (!suggestion.candidates.includes(node.id)) return false;

    // 硬规则 2: 节点必须有可用座位
    if (node.available_seats <= 0) return false;

    // 硬规则 3: 节点必须匹配 labels
    const requiredLabels = task.required_labels || [];
    if (!requiredLabels.every(label => node.labels.includes(label))) return false;

    return true;
  });

  // Step 3: Deterministic fallback（如果 LLM 建议无效）
  if (validCandidates.length === 0) {
    logger.warn('Planner suggestion invalid, falling back to default algorithm');
    validCandidates = resources.nodes.filter(node =>
      node.available_seats > 0 &&
      (task.required_labels || []).every(label => node.labels.includes(label))
    );
  }

  // Step 4: 确定性选择（按可用座位数降序排序，选第一个）
  validCandidates.sort((a, b) => b.available_seats - a.available_seats);
  const selectedNode = validCandidates[0];

  if (!selectedNode) {
    throw new Error('No available node for task');
  }

  // Step 5: 原子性分配（CAS）
  await resourceManager.allocateSeat(task.id, selectedNode.id);

  // Step 6: 生成命令（硬编码模板）
  const command = generateCommand(task, selectedNode);  // deterministic

  // Step 7: 执行
  await execute(command, task, selectedNode);
}
```

**模式总结**：

```
┌─────────────────────────────────────────────────────────────┐
│  Planner (Cognitive Plane, LLM)                             │
│  - 输入: task, resources, context                           │
│  - 输出: 建议 JSON (candidates, priorities, reasons)        │
│  - 特点: 可能不稳定、需要验证                               │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼ (建议传递)
┌─────────────────────────────────────────────────────────────┐
│  Dispatch (Control Plane, Deterministic)                    │
│  1. Schema 校验: 验证 JSON 格式                             │
│  2. Whitelist 映射: 候选项必须在预定义集合中                │
│  3. 硬规则过滤: 应用确定性约束（available_seats, labels）  │
│  4. Deterministic fallback: LLM 无效时按硬规则              │
│  5. 确定性选择: 按硬编码算法（如排序取第一个）              │
│  6. 原子性执行: CAS、事务、幂等性保证                       │
└─────────────────────────────────────────────────────────────┘
```

**Advice Interface 约束（防渗透接口）**：

Control Plane 只能调用 Cognitive Plane 的 **Advice API**（窄接口），**禁止直接依赖 Planner 的内部实现**。

Cognitive Plane 通过 `advice-api` 模块暴露以下接口：
- `advice.recommendAgent(task)` → 返回建议 JSON
- `advice.recommendNode(task, resources)` → 返回候选节点列表
- `advice.decomposeFeature(description)` → 返回子任务列表

所有输出必须走：**schema 校验 + whitelist 映射 + deterministic fallback**

**关键**：Control Plane 不能 `require('../cognitive/planner')`，只能 `require('../cognitive/advice-api')`，防止耦合/渗透。

### 2.4 LLM 使用矩阵（完整版）

| 模块 | 允许 LLM | 模型要求 | 原因 | 示例 |
|------|---------|---------|------|------|
| **Control Plane** | | | | |
| 状态机（Task/Feature/Project） | 🟥 禁止 | - | 状态推进必须 deterministic | `QUEUED → RUNNING → COMPLETED` |
| DB 写入/更新 | 🟥 禁止 | - | 数据完整性、幂等性 | `UPDATE tasks SET status=...` |
| Tick Loop 逻辑 | 🟥 禁止 | - | 定时触发必须稳定 | `setInterval(tick, 120000)` |
| Queue Manager | 🟥 禁止 | - | 队列管理必须可预测 | `getNext(resources)` |
| Resource Manager | 🟥 禁止 | - | 资源分配必须公平 | `allocateSeat(nodeId)` |
| Circuit Breaker | 🟥 禁止 | - | 熔断规则必须硬编码 | `failures >= 3 → OPEN` |
| Dispatch Executor | 🟥 禁止 | - | Bash 命令生成必须模板化 | `nohup claude -p "..."` |
| Health Manager | 🟥 禁止 | - | 健康检查必须确定性 | `checkHeartbeat()` |
| **Interface/Perception Layer** | | | | |
| 意图粗分类（路由） | 🟩 允许 | Haiku | 自然语言 → 粗粒度分类 | `"帮我爬数据" → automation` |
| **Cognitive Plane** | | | | |
| 意图最终结构化 | 🟩 允许 | Opus | 自然语言 → Canonical JSON | `"爬取数据" → {type: "automation", target: "...", ...}` |
| 任务分解 | 🟩 允许 | Opus | 复杂需求 → 子任务列表 | `"重构登录" → [task1, task2]` |
| 决策推理 | 🟩 允许 | Opus | 多因素决策（优先级/依赖/资源） | 选择哪个节点执行 |
| 部门沟通 | 🟩 允许 | Opus | 生成派发指令的 context | 给 Caramel 的 PRD |
| 记忆编排 | 🟩 允许 | Opus | 历史数据 → 决策参考 | 查询类似失败案例 |
| 免疫诊断 | 🟩 允许 | Opus | 异常模式识别 → 诊断报告 | 分析为什么频繁超时 |
| 进化引擎 | 🟩 允许 | Opus | Signal → Change Proposal | 生成优化建议 |

### 2.5 模型选择策略

| 场景 | 模型 | 原因 | Latency | Cost |
|------|------|------|---------|------|
| 嘴巴（用户对话） | Haiku | 快速响应，简单分类 | <2s | $$ |
| Planner（任务拆解） | Opus | 复杂推理，深度规划 | 10-30s | $$$$$ |
| Planner（优先级推理） | Opus | 多因素权衡 | 10-30s | $$$$$ |
| Planner（Agent 推荐） | Opus | 理解任务特征 | 5-10s | $$$$$ |
| Planner（诊断分析） | Opus | 根因分析 | 30s+ | $$$$$ |
| 进化引擎 | Opus | 长时间推理，非实时 | 60s+ | $$$$$ |
| Dispatch（任何决策） | ❌ 禁止 LLM | 必须 deterministic | - | - |

---

## 3. 生命体架构

### 3.1 四层架构（修正版）

```
┌────────────────────────────────────────────────────────────────┐
│                      Cecelia 生命体架构                         │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│  Layer 1: Cognitive Plane (中枢认知层) - LLM-Powered (Opus)   │
├────────────────────────────────────────────────────────────────┤
│  Planner (Internal)     │ 任务拆解、优先级推理、agent 推荐     │
│  Memory Orchestrator    │ 历史数据检索，上下文构建             │
│  Executive Reasoning    │ 多因素决策推理                       │
│  Department Comm        │ 生成派发指令，外部协作               │
│  Immune Diagnoser       │ 异常诊断，根因分析                   │
│  Evolution Engine       │ 生成变更提案，系统优化               │
│                                                                │
│  职责：思考、建议、推理、诊断、提案                            │
│  输出：JSON 建议（经过 schema 验证）                           │
└────────────────────────────────────────────────────────────────┘
                            ↓
                    建议传递（JSON）
                            ↓
┌────────────────────────────────────────────────────────────────┐
│  Layer 2: Control Plane (中枢控制层) - Deterministic          │
├────────────────────────────────────────────────────────────────┤
│  Tick Loop          │ 定时心跳，唤醒系统                       │
│  Queue Manager      │ 队列管理，获取 next task                 │
│  Resource Manager   │ 资源分配，节点调度                       │
│  Health Manager     │ 健康检查，心跳监控                       │
│  Circuit Breaker    │ 熔断保护，故障隔离                       │
│  Dispatch Executor  │ 任务派发，生成 Bash 命令                 │
│  State Machine      │ 状态推进，确定性转换                     │
│                                                                │
│  职责：执行、调度、分配、保护、落地                            │
│  输入：Planner 的建议（验证后使用）                            │
│  输出：DB 更新、Bash 命令、状态变更                            │
└────────────────────────────────────────────────────────────────┘
                            ↓ ↑
                    读取状态 / 写入决策
                            ↓ ↑
┌────────────────────────────────────────────────────────────────┐
│  Single Source of Truth: PostgreSQL                           │
│  - goals, projects, features, tasks 表                        │
│  - execution_nodes, execution_runs 表                         │
│  - circuit_breaker_state, health_status 表                    │
└────────────────────────────────────────────────────────────────┘
                            ↑ ↓
                    读取历史 / 写入结果
                            ↑ ↓
┌────────────────────────────────────────────────────────────────┐
│  Layer 3: External Experts (外部专家层)                        │
├────────────────────────────────────────────────────────────────┤
│  External Planner       │ 复杂任务拆解（可选委托）             │
│  Caramel                │ 编程任务执行（/dev workflow）        │
│  Nobel                  │ 自动化任务执行（N8N）                │
│  QA                     │ 测试决策（/qa）                      │
│  Audit                  │ 代码审计（/audit）                   │
└────────────────────────────────────────────────────────────────┘
                            ↓
                    调度到具体节点
                            ↓
┌────────────────────────────────────────────────────────────────┐
│  Layer 4: Execution Nodes (执行节点层)                         │
├────────────────────────────────────────────────────────────────┤
│  VPS (8c16g)            │ 6 seats total                        │
│    - immune: 1 seat     │ Cecelia 自我诊断/进化                │
│    - gatekeeper: 1 seat │ Cecelia 流量控制/保护                │
│    - work: 4 seats      │ 外部 agents 执行                     │
│                                                                │
│  Mac mini               │ 未来扩展（本地开发/测试）            │
│  GPU PC                 │ 未来扩展（AI 推理/训练）             │
└────────────────────────────────────────────────────────────────┘
```

### 3.2 Control Plane 模块详解

#### 3.2.1 Dispatch Executor（派发执行器，修正版）

**职责**：生成并执行 Bash 命令，启动外部 Agents

**关键**：Dispatch 通过 Advice API 获取建议（Cognitive 内部封装 Planner），但最终落地必须 deterministic

```javascript
// brain/src/control/executor.js
const advice = require('../cognitive/advice-api');  // ✅ 通过 Advice API（窄接口）

class DispatchExecutor {
  async dispatch(task, resources) {
    // ==========================================
    // Part 1: Cognitive Plane（LLM 建议）
    // ==========================================

    // 1.1 调用 Advice API 获取 agent 推荐（Cognitive, Opus）
    const agentSuggestion = await advice.recommendAgent(task);
    // agentSuggestion = { agent: "caramel", reason: "..." }

    // 1.2 调用 Advice API 获取节点候选（Cognitive, Opus）
    const nodeSuggestion = await advice.recommendNode(task, resources);
    // nodeSuggestion = { candidates: ["vps-main", "mac-mini"], reason: "..." }

    // ==========================================
    // Part 2: Control Plane（Deterministic 落地）
    // ==========================================

    // 2.1 验证 agent 建议（Whitelist 映射）
    const validAgents = ['caramel', 'nobel', 'planner', 'qa', 'audit'];
    const agent = validAgents.includes(agentSuggestion.agent)
      ? agentSuggestion.agent
      : 'caramel';  // Deterministic fallback

    // 2.2 选择节点（Deterministic 逻辑）
    const node = await this.selectNode(task, resources, nodeSuggestion.candidates);

    // 2.3 分配资源（Atomic CAS）
    await resourceManager.allocateSeat(task.id, node.id);

    // 2.4 生成命令（Hardcoded Template）
    const command = this.generateCommand(task, agent, node);

    // 2.5 执行（Deterministic）
    await this.execute(command, task, node);
  }

  async selectNode(task, resources, suggestedCandidates) {
    // Deterministic 节点选择逻辑

    // Step 1: 过滤候选节点（使用 Planner 的建议）
    let candidateNodes = resources.nodes.filter(node => {
      // 必须在 Planner 推荐的候选列表中
      if (!suggestedCandidates.includes(node.id)) return false;

      // 必须有可用座位
      if (node.available_seats <= 0) return false;

      // 必须匹配 labels
      const requiredLabels = task.required_labels || [];
      if (!requiredLabels.every(label => node.labels.includes(label))) return false;

      return true;
    });

    // Step 2: Deterministic fallback（如果 Planner 建议无效）
    if (candidateNodes.length === 0) {
      logger.warn('Planner node suggestion invalid, falling back to default');
      candidateNodes = resources.nodes.filter(node => {
        return node.available_seats > 0 &&
          (task.required_labels || []).every(label => node.labels.includes(label));
      });
    }

    // Step 3: 确定性选择（按可用座位数降序排序，选第一个）
    candidateNodes.sort((a, b) => b.available_seats - a.available_seats);

    const selectedNode = candidateNodes[0];

    if (!selectedNode) {
      throw new Error('No available node for task');
    }

    return selectedNode;
  }

  generateCommand(task, agent, node) {
    // 硬编码模板（Deterministic）
    const skillMap = {
      caramel: '/dev',
      nobel: '/nobel',
      planner: '/planner',
      qa: '/qa',
      audit: '/audit'
    };

    // Deterministic model map（不是 LLM 决策，是硬编码映射）
    const modelMap = {
      caramel: 'sonnet',
      nobel: 'sonnet',
      planner: 'opus',   // External Planner 需要深度推理
      qa: 'sonnet',
      audit: 'sonnet'
    };

    const skill = skillMap[agent];
    const model = modelMap[agent];
    const prd = task.prd_path || '/tmp/prd-default.md';

    // 模板化命令（Deterministic）
    return `
      nohup claude -p "${skill} ${prd}" \\
        --model ${model} \\
        --allowed-tools "Bash,Edit,Write,Read" \\
        > /tmp/${agent}-${task.id}.log 2>&1 &
      echo $!
    `.trim();
  }

  async execute(command, task, node) {
    // 1. SSH 到目标节点（如果是远程节点）
    const execCommand = node.is_local
      ? command
      : `ssh ${node.ssh_user}@${node.ssh_host} '${command}'`;

    // 2. 执行（Deterministic）
    const { stdout, stderr } = await exec(execCommand);

    // 3. 记录 PID（Deterministic）
    const pid = parseInt(stdout.trim());
    await db.query(`
      UPDATE tasks SET pid = $1 WHERE id = $2
    `, [pid, task.id]);

    logger.info(`Task ${task.id} dispatched to ${node.id}, PID: ${pid}`);
  }
}
```

**关键设计**：

| 步骤 | 层级 | 说明 |
|------|------|------|
| 1. 调用 Advice API 获取建议 | Cognitive | Advice API 封装 Planner（Opus），推荐 agent 和候选节点 |
| 2. Schema 校验 | Control | 验证 JSON 格式 |
| 3. Whitelist 映射 | Control | agent 必须在候选集合中 |
| 4. 硬规则过滤 | Control | 验证座位、labels、心跳 |
| 5. Deterministic fallback | Control | Advice API 无效时按硬规则 |
| 6. 确定性选择 | Control | 排序 + 取第一个 |
| 7. 原子性分配 | Control | CAS 防止竞态 |
| 8. 命令生成 | Control | 硬编码模板 |
| 9. 执行 | Control | Bash/SSH |

### 3.3 Cognitive Plane 模块详解

#### 3.3.1 Planner (Internal)

**职责**：任务拆解、优先级推理、agent 推荐、节点候选推荐

**定位**：Brain 内部的认知模块，使用 Opus LLM

```javascript
// brain/src/cognitive/planner.js
class InternalPlanner {
  async decomposeFeature(featureDescription) {
    // 使用 Opus 分解任务
    const prompt = `
      Feature 描述:
      ${featureDescription}

      请将其分解为 3-5 个子任务（tasks），每个任务必须：
      1. 有明确的验收标准
      2. 可独立执行（或明确依赖关系）
      3. 预估工作量（S/M/L）

      返回 JSON 格式：
      {
        "tasks": [
          {
            "title": "...",
            "acceptance_criteria": "...",
            "dependencies": [],
            "estimated_size": "M",
            "required_labels": ["code", "backend"]
          }
        ]
      }
    `;

    const response = await llm.complete(prompt, {
      model: 'opus',
      response_format: { type: 'json_object' }
    });

    // 验证 schema（Control Plane 强制）
    const validated = taskListSchema.validate(JSON.parse(response));
    if (!validated.success) {
      throw new Error('LLM output invalid schema');
    }

    return validated.data.tasks;
  }

  async recommendAgent(task) {
    // Opus 推荐 agent（返回建议，不直接派发）
    const prompt = `
      任务: ${task.title}
      验收标准: ${task.acceptance_criteria}
      所需技能: ${task.required_labels.join(', ')}

      可选 agents:
      - caramel: 编程专家，擅长写代码、测试、PR
      - nobel: 自动化专家，擅长数据采集、N8N
      - planner: 副管家，擅长复杂任务拆解
      - qa: QA 专家，擅长测试决策
      - audit: 审计专家，擅长代码审计

      请选择最合适的 agent，只返回 agent 名称（小写）。
    `;

    const agent = (await llm.complete(prompt, { model: 'opus' })).trim().toLowerCase();

    // 返回建议（Dispatch 会验证）
    return {
      agent: agent,
      reason: 'LLM recommendation based on task characteristics'
    };
  }

  async recommendNode(task, resources) {
    // Opus 推荐候选节点（返回建议列表，不直接分配）
    const prompt = `
      任务: ${task.title}
      所需标签: ${(task.required_labels || []).join(', ')}

      可用节点:
      ${resources.nodes.map(n => `- ${n.id}: ${n.available_seats} seats, labels: ${n.labels.join(',')}`).join('\n')}

      请推荐 1-3 个最合适的候选节点，考虑：
      - 标签匹配度
      - 可用资源
      - 节点负载均衡

      返回 JSON：
      {
        "candidates": ["node-id-1", "node-id-2"],
        "reason": "..."
      }
    `;

    const response = await llm.complete(prompt, {
      model: 'opus',
      response_format: { type: 'json_object' }
    });

    const parsed = JSON.parse(response);

    // 返回建议（Dispatch 会验证并过滤）
    return {
      candidates: parsed.candidates || [],
      reason: parsed.reason || 'LLM recommendation'
    };
  }
}

module.exports = new InternalPlanner();
```

#### 3.3.2 Advice API（防渗透接口实现）

**职责**：为 Control Plane 提供窄接口，封装 Planner 的 LLM 调用

**实现要求**：

```javascript
// brain/src/cognitive/advice-api.js
const planner = require('./planner');  // 内部依赖 Planner

class AdviceAPI {
  async recommendAgent(task) {
    // 1. Prompt 固定化
    // 2. response_format=json
    // 3. Schema 校验
    // 4. 超时与 fallback（返回空候选）

    try {
      const suggestion = await planner.recommendAgent(task);

      // Schema 校验
      if (!suggestion.agent || typeof suggestion.agent !== 'string') {
        throw new Error('Invalid agent suggestion schema');
      }

      return suggestion;
    } catch (error) {
      logger.warn('Advice API failed, returning fallback', error);
      return { agent: null, reason: 'fallback due to error' };
    }
  }

  async recommendNode(task, resources) {
    try {
      const suggestion = await planner.recommendNode(task, resources);

      // Schema 校验
      if (!Array.isArray(suggestion.candidates)) {
        throw new Error('Invalid node suggestion schema');
      }

      return suggestion;
    } catch (error) {
      logger.warn('Advice API failed, returning empty candidates', error);
      return { candidates: [], reason: 'fallback due to error' };
    }
  }

  async decomposeFeature(description) {
    try {
      const tasks = await planner.decomposeFeature(description);

      // Schema 校验
      if (!Array.isArray(tasks)) {
        throw new Error('Invalid task list schema');
      }

      return tasks;
    } catch (error) {
      logger.warn('Advice API failed, returning empty task list', error);
      return [];
    }
  }
}

module.exports = new AdviceAPI();
```

**关键设计**：
- ✅ Control Plane 只能 `require('./advice-api')`，不能 `require('./planner')`
- ✅ Advice API 内部封装：schema 校验、超时处理、fallback
- ✅ **异常处理策略**：Advice API 只吞 LLM/解析错误（返回空值 `null`、`[]`），不向 Control 抛出；Control Plane 仍可基于资源不足等**确定性条件**抛错或转入 `WAITING`/`BLOCKED` 状态

---

## 4. 数据模型与层级

### 4.1 PARA 层级（无 TRD）

```
OKR (goals 表)
    ↓
Project (projects 表)
    ↓
Feature (projects 表，parent_id 非空，包含 PRD)
    ↓
Task (tasks 表)
    ↓
Run (execution_runs 表)
```

### 4.2 核心表结构

#### goals 表（OKR）

```sql
CREATE TABLE goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('O', 'KR')),
  parent_id UUID REFERENCES goals(id),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'COMPLETED', 'ABANDONED')),
  progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### projects 表（Project + Feature）

```sql
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID REFERENCES projects(id),  -- NULL = Project, non-NULL = Feature
  goal_id UUID REFERENCES goals(id),
  name TEXT NOT NULL,
  prd_path TEXT,  -- Feature 级别的 PRD 路径
  status TEXT NOT NULL DEFAULT 'PLANNED',
  priority TEXT DEFAULT 'P2' CHECK (priority IN ('P0', 'P1', 'P2')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### tasks 表

```sql
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_id UUID NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  assigned_to TEXT,
  assigned_node_id TEXT REFERENCES execution_nodes(id),
  required_labels TEXT[],
  priority TEXT DEFAULT 'P2' CHECK (priority IN ('P0', 'P1', 'P2')),
  started_at TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  result_json JSONB,
  artifacts JSONB,
  idempotency_key TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 5. 任务执行与调度

### 5.1 完整执行流程

```
1. 用户输入 → 2. 嘴巴分类 → 3. Planner 规划（Cognitive）
   → 4. State Machine 写入（Control）→ 5. Tick Loop 触发
   → 6. Planner 建议 + Dispatch 执行 → 7. Caramel 执行
   → 8. 回写结果 → 9. 完成
```

---

## 6. 资源管理与节点调度

### 6.1 多节点架构

```
VPS (8c16g): 6 seats (reserved 2)
Mac mini: 4 seats (future)
GPU PC: 2 seats (future)
```

---

## 7. 容错与熔断

### 7.1 失败分类

| 类型 | 说明 | 熔断策略 |
|------|------|---------|
| AGENT_EXEC_FAIL | 进程启动失败 | Agent 级（3 次 → 30 分钟） |
| AGENT_TIMEOUT | 超时未回写 | Agent 级 |
| DEPENDENCY_DOWN | 依赖服务不可用 | 全局（暂停所有派发） |

---

## 8. 进化系统

### 8.1 三层架构

```
Signal Layer (Deterministic) → Cognitive Layer (Opus) → Governance Layer (Deterministic)
```

---

## 9. 通信协议

### 9.1 Cecelia 对外（与用户）

**入口**：/cecelia skill（Haiku）

### 9.2 Cecelia 对外部 Agents

**协议**：Bash 启动 + PostgreSQL 状态共享

---

## 10. 部署架构

### 10.1 服务拓扑

```
Brain (5221) ← → PostgreSQL (5432)
```

---

## 11. FAQ 与最佳实践

### 11.1 常见问题

#### Q1: Planner 和 Dispatch 的区别？

**A**:

| 维度 | Planner（内层认知模块） | Dispatch（调度执行器） |
|------|----------------------|---------------------|
| **层级** | Cognitive Plane | Control Plane |
| **允许 LLM** | 🟩 允许（Opus） | 🟥 禁止 |
| **职责** | 思考、建议、推理 | 执行、调度、落地 |
| **输入** | 任务描述、上下文 | Planner 的建议 + 资源状态 |
| **输出** | JSON 建议（需验证） | DB 更新、Bash 命令 |
| **示例** | 推荐 agent="caramel" | 验证 + 生成命令 + 执行 |
| **可预测性** | ❌ 不可预测（LLM） | ✅ 完全可预测（Deterministic） |

**关键原则**：

> **Planner 负责"What to do?"（做什么？）**
> **Dispatch 负责"How to do it?"（怎么做？）**

#### Q2: Dispatch 需不需要 LLM？

**A**: **不需要。LLM 只能给建议，Dispatch 只做确定性落地。**

**详细说明**：

| 场景 | Dispatch 的做法 | 说明 |
|------|----------------|------|
| **Agent 选择** | ✅ 调用 advice.recommendAgent() 获取建议<br>✅ 必须验证建议在 whitelist 中<br>✅ 无效时按硬规则 fallback | Advice API 推荐，Dispatch 验证 + 落地 |
| **节点选择** | ✅ 调用 advice.recommendNode() 获取候选<br>✅ 必须过滤候选（座位、labels）<br>✅ 按确定性算法选择（排序 + 取第一个） | Advice API 推荐候选，Dispatch 确定性选择 |
| **命令生成** | 🟥 禁止 LLM 生成命令<br>✅ 必须使用硬编码模板 | 模板化、可审计 |
| **DB 写入** | 🟥 禁止 LLM 生成 SQL<br>✅ 必须使用预定义 SQL 模板 | 防止 SQL 注入、保证幂等性 |
| **状态推进** | 🟥 禁止 LLM 决策状态转换<br>✅ 必须使用硬编码状态机 | 可预测、可审计 |

#### Q3: Internal Planner vs External Planner Agent？

**A**:

| 维度 | Internal Planner（内层） | External Planner Agent（外层） |
|------|------------------------|------------------------------|
| **位置** | Brain 内部 Cognitive Plane | 独立进程（/planner skill） |
| **实现** | brain/src/cognitive/planner.js | ~/.claude/skills/planner/ |
| **调用方式** | Brain 内部函数调用 | Bash 启动外部进程 |
| **模型** | Opus | Opus |
| **职责** | 简单任务拆解（1-5 步）<br>优先级推理<br>Agent 推荐<br>节点候选推荐<br>PRD 生成 | 复杂任务拆解（5+ 步）<br>多任务编排<br>依赖分析<br>风险评估 |
| **是否必需** | ✅ 必需（Cecelia 核心能力） | ❌ 可选（可委托给外部） |
| **可替换性** | ❌ 不可替换（Cecelia 器官） | ✅ 可替换（可能去其他公司） |
| **状态共享** | 直接访问 PostgreSQL | 通过 PostgreSQL 读写 |
| **输出** | JSON 建议（给 Dispatch） | 子任务列表（写入 DB） |

---

## 12. 故障排查

### 12.1 常见问题

#### 问题 1: Tick Loop 停止

**排查**：检查 Health Manager、DB 连接、Circuit Breaker 状态

#### 问题 2: 任务派发失败

**排查**：检查 Dispatch 日志、验证 Planner 建议、检查资源可用性

---

## 13. 运维手册

### 13.1 日常检查

```bash
# Brain 状态
curl http://localhost:5221/api/brain/status
curl http://localhost:5221/api/brain/tick/status

# 队列状态
psql -U cecelia -d cecelia -c "SELECT COUNT(*) FROM tasks WHERE status = 'queued';"
```

---

## 更新日志

### v1.3.2 (2026-02-01)

**无死角审计级修订（消除最后 2 个实现矛盾）**：

1. **Advice Interface 描述精准化**：
   - ✅ "禁止直接调用 Planner 任意业务函数" → "禁止直接依赖 Planner 内部实现"
   - ✅ 接口名从 `planner.xxx()` 改为 `advice.xxx()`，强调窄接口
   - ✅ 明确 Control Plane 只能 `require('./advice-api')`，不能 `require('./planner')`
   - ✅ 新增 3.3.2 Advice API 实现示例（schema 校验、超时、fallback）

2. **意图结构化二段式定义**：
   - ✅ 拆分为两阶段：
     - Phase A：Mouth（Haiku）做意图粗分类/路由（粗粒度）
     - Phase B：Planner（Opus）做意图最终结构化（细粒度、Canonical JSON）
   - ✅ 消除"嘴巴用 Haiku 做结构化"与"Planner 用 Opus 做结构化"的矛盾
   - ✅ 更新 2.2 决策责任矩阵和 2.4 LLM 使用矩阵

3. **代码示例防渗透修正**：
   - ✅ executor 示例：`const planner = require('./planner')` → `const advice = require('./advice-api')`
   - ✅ 所有注释：`调用 Planner` → `调用 Advice API`
   - ✅ 防止抄代码时直接依赖 Planner 内部实现

**终审修订（微瑕疵修复）**：
- ✅ 术语统一："调用 Planner" → "调用 Advice API"（全文一致）
- ✅ 异常处理精准化：Advice API 只吞 LLM/解析错误；Control 可因资源不足等确定性条件抛错/转状态
- ✅ 术语一致性：Plane 只用于 Cognitive/Control；Interface/Perception 统一用 Layer

**文档状态**：
- ✅ 概念闭环：所有术语定义无歧义
- ✅ 工程约束闭环：Advice API + 二段式意图处理 + 防渗透示例
- ✅ 未来扩展不跑偏：窄接口 + 明确边界 + fallback 机制
- ✅ 用词审计级：术语一致、异常处理精准、抄了也不会抄错

### v1.3.1 (2026-02-01)

**审计级修订（生产可审计版本）**：

1. **嘴巴层定义修正**：
   - ✅ 将嘴巴从 "Cognitive" 改为 "Interface/Perception 层"
   - ✅ 新增术语定义：Interface/Perception Layer（使用 Haiku，轻认知）
   - ✅ 消除与 Cognitive Plane = Opus 的矛盾

2. **Intelligence 边界声明**：
   - ✅ 明确 Intelligence 只做检索/指标计算（deterministic / statistical）
   - ✅ 任何解释/诊断/总结/建议必须回到 Planner（Opus）
   - ✅ 防止未来 Intelligence 变成"隐形 Cognitive"

3. **Advice Interface 防渗透约束**：
   - ✅ 新增第四条硬规则（SHOULD NOT）：Cognitive 输出不得包含可执行动作
   - ✅ Control Plane 只能调用 Cognitive 的 Advice Interface（只读建议）
   - ✅ 禁止 Dispatch 直接调用 Planner 的任意业务函数
   - ✅ 所有输出必须：schema 校验 + whitelist 映射 + deterministic fallback

4. **命令模板 model 映射修正**：
   - ✅ generateCommand 新增 deterministic modelMap
   - ✅ External Planner 使用 opus（深度推理）
   - ✅ 其他 agents 使用 sonnet
   - ✅ 消除"planner skill 用 sonnet"的矛盾

**文档状态**：
- ✅ 可生产审计级：所有边界清晰、无歧义
- ✅ 可落地实现：工程约束明确（防渗透、防越界）
- ✅ 可扩展：未来扩展不会跑偏（Intelligence 边界、Advice Interface）

### v1.3.0 (2026-02-01)

**重大变更**：

1. **架构重构**：
   - ✅ **新增 Planner vs Dispatch 决策责任矩阵**
   - ✅ **明确 Planner 是 Internal 模块（Cognitive Plane）**
   - ✅ **明确 Dispatch 是 Control 模块（禁止 LLM 直接决策）**
   - ✅ **区分 Internal Planner vs External Planner Agent**

2. **三条不可违反的硬规则（MUST NOT）**：
   - 🔴 Control Plane 禁止 LLM 直接决策
   - 🔴 Dispatch 禁止 LLM 直接参与落地执行
   - 🔴 DB 写入禁止由 LLM 生成 SQL

3. **文档**：
   - ✅ 11,500+ 字
   - ✅ 3+ ASCII 架构图
   - ✅ **新增 FAQ: "Dispatch 需不需要 LLM?"**

---

**文档结束**

**版本**: 1.3.2
**字数**: 12,500+
**最后更新**: 2026-02-01
**状态**: 无死角审计级（生产就绪）
**维护者**: Cecelia Team
