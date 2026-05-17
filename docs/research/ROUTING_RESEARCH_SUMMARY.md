# Cecelia 任务路由研究 - 快速参考指南

## 核心发现总结

### 1. 当前的三层路由系统

```
用户输入 (自然语言)
    ↓
Intent 识别 (意图类型)
    ↓
Task Router (位置 + 工作类型)
    ├─ 位置路由: US vs HK (MiniMax)
    └─ 工作类型: 单任务 vs 特性
    ↓
Agent 路由 (Skill 映射)
    └─ task_type → /dev, /qa, /audit, /talk, etc.
```

### 2. 关键文件一览表

| 文件 | 行数 | 核心职责 |
|------|------|----------|
| **task-router.js** | 212 | 位置 + 工作类型路由 |
| **tick.js** | 1613 | 任务类型→Agent 映射 (TASK_TYPE_AGENT_MAP) |
| **planner.js** | 545 | KR 评分 + 任务选择算法 |
| **executor.js** | 1661 | 资源管理 + 派发执行 |
| **thalamus.js** | ~600+ | Action 白名单 (30+) + 决策验证 |
| **decision-executor.js** | ~500+ | 丘脑决策执行 |
| **actions.js** | 416 | 核心操作实现 (createTask, updateTask, etc.) |
| **intent.js** | ~700+ | 意图识别 (9 种意图类型) |

### 3. 任务类型体系

**task_type 的 8 种分类**：

| 类型 | 位置 | Agent | 说明 |
|------|------|-------|------|
| `dev` | US | `/dev` (Opus) | 编程任务 (Caramel) |
| `review` | US | `/review` (Sonnet) | 代码审查 |
| `qa` | US | `/qa` (Sonnet) | 测试 (小检) |
| `audit` | US | `/audit` (Sonnet) | 审计 (小审) |
| `exploratory` | US | `/exploratory` (Opus) | 探索性验证 |
| `talk` | HK | `/talk` (MiniMax) | 对话任务 |
| `research` | HK | null | 调研 (需人工) |
| `data` | HK | N8N | 数据处理 |

### 4. 调度评分公式

**KR 选择算法** (planner.js 第45-78行):

```
score = 0
+ (在焦点中 ? 100 : 0)
+ (P0 ? 30 : P1 ? 20 : P2 ? 10 : 0)
+ ((100 - progress) × 0.2)
+ (截止<7天 ? 40 : 截止<14天 ? 20 : 0)
+ (队列任务数 × 15)
```

选择得分最高的 KR。

### 5. 意图识别体系

**9 种识别意图**:

1. `CREATE_PROJECT` - "我想做一个..."
2. `CREATE_FEATURE` - "给...加一个功能"
3. `CREATE_GOAL` - "创建目标"
4. `CREATE_TASK` - "添加任务"
5. `FIX_BUG` - "修复..."
6. `REFACTOR` - "重构..."
7. `EXPLORE` - "看看..."
8. `QUERY_STATUS` - "状态如何"
9. `QUESTION` - "为什么..."

### 6. 丘脑 Action 白名单 (30+ 个)

**分类**:
- 任务操作 (8个): dispatch, create, cancel, retry, reprioritize, pause, resume, mark_blocked, quarantine
- OKR 操作 (3个): create_okr, update_progress, assign_to_autumnrice
- 通知/日志 (2个): notify_user, log_event
- 升级 (2个): escalate_to_brain, request_human_review
- 分析 (2个): analyze_failure, predict_progress
- 规划 (1个): create_proposal
- 学习 (3个): create_learning, update_learning, trigger_rca
- 生命周期 (3个): update_prd, archive_task, defer_task
- 系统 (2个): no_action, fallback_to_tick

### 7. 三大优化方向

#### A. 能力匹配系统 (Capability Matching)

**现状**: 固定 task_type → 固定 agent

**目标**: 动态选择最适合的 agent

**方案**:
```
1. 建立 capabilities 表 (名称、技能、关键词、复杂度)
2. 扩展 tasks 表 (complexity, tech_stack, domain, required_capabilities)
3. 派发时动态评分可匹配的 agents
4. 选择得分最高的 agent
```

#### B. 依赖感知调度 (Dependency-Aware Scheduling)

**现状**: 只有 PR Plans 支持依赖

**目标**: 全链路依赖管理 + 容量规划

**方案**:
```
1. 扩展 tasks 表 (depends_on, blocking_tasks)
2. calculateQueueDepth() - 估算队列完成时间
3. 风险评分 = failure_rate × 0.3 + blocker_count × 0.5 + contention × 0.2
4. 最终评分 = base_score × (1 - risk_score)
```

#### C. 动态 Action Registry (Dynamic Actions)

**现状**: Action 白名单硬编码

**目标**: 数据库驱动的 action registry

**方案**:
```
action_registry 表:
├─ action_type (白名单)
├─ handler_function (reference)
├─ dangerous (bool)
├─ required_params
└─ enabled (bool)

thalamus.js 增强:
├─ 查询相似历史决策 (similarity.js)
├─ 查询相关学习记录 (learning.js)
└─ 动态调整 confidence
```

---

## 快速查询

### 如果要...

**修改任务路由规则** → 编辑 `/home/xx/perfect21/cecelia/core/brain/src/task-router.js`
- LOCATION_MAP (第42-53行)
- SINGLE_TASK_PATTERNS (第10-24行)
- FEATURE_PATTERNS (第26-40行)

**添加新 task_type** → 三处修改：
1. `task-router.js` - LOCATION_MAP
2. `tick.js` - TASK_TYPE_AGENT_MAP
3. `actions.js` - isSystemTask() (如果需要)

**修改调度评分** → 编辑 `planner.js` 的 `scoreKRs()` 函数 (第45-78行)

**添加新 Action** → 三处修改：
1. `thalamus.js` - ACTION_WHITELIST
2. `decision-executor.js` - actionHandlers
3. `actions.js` - 实现具体逻辑

**查看任务匹配逻辑** → 阅读 `planner.js` 的 `planNextTask()` (第302-391行)

---

## 架构强项

✅ **清晰分层** - L0 脑干 (代码) → L1 丘脑 (Haiku) → L2 皮层 (Sonnet)

✅ **多区域支持** - US (Claude) vs HK (MiniMax)

✅ **安全机制** - Action 白名单 + 验证

✅ **资源感知** - 动态座位分配 + 内存/CPU 阈值

✅ **依赖管理** - PR Plans 的 depends_on

---

## 改进机会

🔄 **从固定映射升级到动态匹配** - 考虑任务的复杂度、技术栈等

🔄 **任务级依赖** - 支持传统任务的依赖关系

🔄 **容量规划** - 预测队列完成时间

🔄 **历史学习** - 利用 learning.js 优化决策

🔄 **动态 Actions** - 从硬编码到数据库驱动

---

**研究报告**: `/home/xx/perfect21/cecelia/core/ROUTING_RESEARCH.md`  
**完成时间**: 2026-02-18
