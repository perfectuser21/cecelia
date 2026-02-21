# Cecelia Core 任务路由与能力匹配机制研究报告

**研究日期**: 2026-02-18  
**代码库**: /home/xx/perfect21/cecelia/core  
**重点关注**: 任务路由、能力定义、任务匹配、调度机制

---

## 目录

1. [任务路由机制](#1-任务路由机制)
2. [能力/技能定义系统](#2-能力技能定义系统)
3. [任务匹配与调度流程](#3-任务匹配与调度流程)
4. [意图识别系统](#4-意图识别系统)
5. [当前架构的优化点](#5-当前架构的优化点)

---

## 1. 任务路由机制

### 1.1 路由入口文件

**文件**: `/home/xx/perfect21/cecelia/core/brain/src/task-router.js`

#### 核心功能

任务路由负责两个维度的决策：
1. **位置路由** (Location): US 还是 HK (MiniMax)
2. **工作类型识别** (Work Type): 单个任务还是功能/特性

#### 关键数据结构

```javascript
// 第1行-24行: 单个任务识别模式 (SINGLE_TASK_PATTERNS)
const SINGLE_TASK_PATTERNS = [
  /修复/i,        // 修复
  /fix/i,
  /改一下/i,      // 改一下
  /加个/i,        // 加个
  /删掉/i,        // 删掉
  /更新/i,        // 更新
  /调整/i,        // 调整
  /修改/i,        // 修改
  /bugfix/i,
  /hotfix/i,
  /patch/i,
  /typo/i,
  /refactor\s+small/i  // 小规模重构
];

// 第26-40行: 功能/特性识别模式 (FEATURE_PATTERNS)
const FEATURE_PATTERNS = [
  /实现/i,        // 实现
  /做一个/i,      // 做一个
  /新功能/i,      // 新功能
  /系统/i,        // 系统
  /模块/i,        // 模块
  /重构/i,        // 重构
  /implement/i,
  /feature/i,
  /build/i,
  /create\s+(a|an|new)/i,
  /develop/i,
  /设计/i,        // 设计
  /架构/i         // 架构
];

// 第42-53行: 位置映射表 (LOCATION_MAP)
const LOCATION_MAP = {
  'dev': 'us',           // 写代码 → US (Nobel + Opus + /dev)
  'review': 'us',        // 代码审查 → US (Sonnet + /review)
  'qa': 'us',            // QA → US (Sonnet)
  'audit': 'us',         // 审计 → US (Sonnet)
  'exploratory': 'us',   // 探索性验证 → US (Opus + /exploratory)
  'talk': 'hk',          // 对话 → HK (MiniMax)
  'research': 'hk',      // 调研 → HK (MiniMax)
  'data': 'hk',          // 数据处理 → HK (N8N)
};

const DEFAULT_LOCATION = 'us';
```

#### 核心导出函数

| 函数名 | 行号 | 用途 |
|--------|------|------|
| `identifyWorkType(input)` | 63-86 | 识别工作类型（single/feature/ask_autumnrice） |
| `getTaskLocation(taskType)` | 93-100 | 根据任务类型返回位置（us/hk） |
| `determineExecutionMode(options)` | 110-128 | 确定执行模式（single/feature_task/recurring） |
| `routeTaskCreate(taskData)` | 135-156 | 完整的任务路由决策 |
| `isValidTaskType(taskType)` | 163-166 | 验证任务类型有效性 |
| `getValidTaskTypes()` | 181-183 | 返回所有有效的任务类型 |
| `getLocationsForTaskTypes(taskTypes)` | 190-196 | 批量查询任务类型的位置 |

#### 路由规则

```
输入: taskData
  ├─ title (任务标题)
  ├─ task_type (dev/review/qa/audit/exploratory/talk/research/data)
  ├─ feature_id (特性ID，可选)
  └─ is_recurring (是否循环)
        ↓
决策过程:
  1. 获取 task_type 对应的 location (LOCATION_MAP)
  2. 识别工作类型 (identifyWorkType)
  3. 确定执行模式 (determineExecutionMode)
        ↓
输出: 
  {
    location: 'us' | 'hk',
    execution_mode: 'single' | 'feature_task' | 'recurring',
    task_type: string,
    routing_reason: string
  }
```

---

### 1.2 Tick 循环中的任务路由

**文件**: `/home/xx/perfect21/cecelia/core/brain/src/tick.js` (第42-65行)

#### 任务类型与Agent映射 (TASK_TYPE_AGENT_MAP)

```javascript
const TASK_TYPE_AGENT_MAP = {
  'dev': '/dev',           // Caramel - 编程 (Opus)
  'talk': '/talk',         // 对话任务 → HK MiniMax
  'qa': '/qa',             // 小检 - QA (Sonnet)
  'audit': '/audit',       // 小审 - 审计 (Sonnet)
  'research': null         // 需要人工/Opus 处理
};
```

#### routeTask 函数 (第55-65行)

```javascript
function routeTask(task) {
  const taskType = task.task_type || 'dev';
  const agent = TASK_TYPE_AGENT_MAP[taskType];

  if (agent === undefined) {
    console.warn(`[routeTask] Unknown task_type: ${taskType}, defaulting to /dev`);
    return '/dev';
  }

  return agent;
}
```

**逻辑**:
- 未知 task_type 默认路由到 `/dev`
- research 类型返回 null (需要特殊处理)
- 其他类型直接映射到对应的 skill

---

## 2. 能力/技能定义系统

### 2.1 丘脑 (Thalamus) 中的 Action 白名单

**文件**: `/home/xx/perfect21/cecelia/core/brain/src/thalamus.js` (第138-187行)

#### ACTION_WHITELIST 定义

```javascript
const ACTION_WHITELIST = {
  // 任务操作
  'dispatch_task': { dangerous: false, description: '派发任务' },
  'create_task': { dangerous: false, description: '创建任务' },
  'cancel_task': { dangerous: false, description: '取消任务' },
  'retry_task': { dangerous: false, description: '重试任务' },
  'reprioritize_task': { dangerous: false, description: '调整优先级' },
  'pause_task': { dangerous: false, description: '暂停任务' },
  'resume_task': { dangerous: false, description: '恢复任务' },
  'mark_task_blocked': { dangerous: false, description: '标记任务为阻塞' },
  'quarantine_task': { dangerous: true, description: '隔离任务（移入隔离区）' },

  // OKR 操作
  'create_okr': { dangerous: false, description: '创建 OKR' },
  'update_okr_progress': { dangerous: false, description: '更新 OKR 进度' },
  'assign_to_autumnrice': { dangerous: false, description: '交给秋米拆解' },

  // 通知操作
  'notify_user': { dangerous: false, description: '通知用户' },
  'log_event': { dangerous: false, description: '记录事件' },

  // 升级操作
  'escalate_to_brain': { dangerous: false, description: '升级到 Brain LLM (Opus)' },
  'request_human_review': { dangerous: true, description: '请求人工确认' },

  // 分析操作
  'analyze_failure': { dangerous: false, description: '分析失败原因' },
  'predict_progress': { dangerous: false, description: '预测进度' },

  // 规划操作
  'create_proposal': { dangerous: false, description: '创建计划提案' },

  // 知识/学习操作
  'create_learning': { dangerous: false, description: '保存经验教训到 learnings 表' },
  'update_learning': { dangerous: false, description: '更新已有 learning 记录' },
  'trigger_rca': { dangerous: false, description: '触发根因分析 (RCA) 流程' },

  // 任务生命周期操作
  'update_task_prd': { dangerous: false, description: '更新任务 PRD 内容' },
  'archive_task': { dangerous: false, description: '归档完成/超期任务' },
  'defer_task': { dangerous: false, description: '延迟任务到指定时间' },

  // 系统操作
  'no_action': { dangerous: false, description: '不需要操作' },
  'fallback_to_tick': { dangerous: false, description: '降级到纯代码 Tick' },
};
```

**特点**:
- 30+ 个白名单操作
- 每个操作标记 danger level
- LLM 只能下达白名单内的指令

### 2.2 执行器中的 Actions

**文件**: `/home/xx/perfect21/cecelia/core/brain/src/actions.js`

#### 核心 Actions 导出

| Action | 行号 | 签名 |
|--------|------|------|
| `createTask` | 39-89 | 创建新任务 |
| `createInitiative` | 102-124 | 创建 Initiative (子项目) |
| `createProject` | 136-175 | 创建 Project |
| `updateTask` | 180-228 | 更新任务状态/优先级 |
| `createGoal` | 233-272 | 创建 OKR 目标 |
| `updateGoal` | 277-309 | 更新目标状态/进度 |
| `triggerN8n` | 314-342 | 触发 N8N webhook |
| `setMemory` | 347-356 | 更新工作记忆 |
| `batchUpdateTasks` | 361-403 | 批量更新任务 |

#### 系统任务定义 (第14-22行)

```javascript
function isSystemTask(task_type, trigger_source) {
  // System task types that don't need goal association
  const systemTypes = ['exploratory', 'research'];

  // System trigger sources that don't need goal association
  const systemSources = ['manual', 'test', 'watchdog', 'circuit_breaker'];

  return systemTypes.includes(task_type) || systemSources.includes(trigger_source);
}
```

---

## 3. 任务匹配与调度流程

### 3.1 规划器 (Planner) 的任务选择

**文件**: `/home/xx/perfect21/cecelia/core/brain/src/planner.js`

#### 调度流程

```
规划 (planNextTask)
    ├─ 获取全局状态 (getGlobalState)
    │  ├─ 所有 OKR/KR (goals 表)
    │  ├─ 活跃项目 (projects 表)
    │  ├─ 活跃任务 (tasks 表)
    │  └─ 最近完成任务 (tasks 表)
    │
    ├─ 三层拆解优先 (skipPrPlans = false)
    │  ├─ 查询所有 PR Plans (pr_plans 表)
    │  ├─ 按 sequence 排序
    │  ├─ 检查依赖关系 (depends_on)
    │  └─ 返回第一个可执行的 PR Plan
    │
    └─ 传统 KR 调度 (无可用 PR Plan 时)
       ├─ scoreKRs: 给 KR 评分
       │  ├─ 焦点权重 (+100 分)
       │  ├─ 优先级权重 (P0:30, P1:20, P2:10)
       │  ├─ 进度权重 ((100-progress)*0.2)
       │  ├─ 截止日期权重 (临期:+20-40)
       │  └─ 队列中任务数量权重 (+15)
       │
       ├─ selectTargetKR: 选择得分最高的 KR
       │
       ├─ selectTargetProject: 选择与 KR 关联的项目
       │  ├─ 查询 project_kr_links 表
       │  ├─ 查询该 KR 的队列中任务对应的项目
       │  └─ 选择有队列任务最多的项目
       │
       └─ generateNextTask: 获取下一个待执行任务
          ├─ 查询 tasks 表 (queued/in_progress)
          ├─ 按阶段排序 (exploratory → dev)
          ├─ 按优先级排序 (P0 → P1 → P2)
          └─ 返回第一个任务
```

#### KR 评分函数 (第45-78行)

```javascript
function scoreKRs(state) {
  const { keyResults, activeTasks, focus } = state;
  const focusKRIds = new Set(focus?.focus?.key_results?.map(kr => kr.id) || []);

  const scored = keyResults.map(kr => {
    let score = 0;
    if (focusKRIds.has(kr.id)) score += 100;        // 焦点 KR
    if (kr.priority === 'P0') score += 30;           // P0 优先级
    else if (kr.priority === 'P1') score += 20;
    else if (kr.priority === 'P2') score += 10;
    score += (100 - (kr.progress || 0)) * 0.2;       // 进度
    
    // 截止日期
    if (kr.target_date) {
      const daysLeft = (new Date(kr.target_date) - Date.now()) / (1000*60*60*24);
      if (daysLeft > 0 && daysLeft < 14) score += 20;
      if (daysLeft > 0 && daysLeft < 7) score += 20;
    }
    
    if (queuedByGoal[kr.id]) score += 15;            // 队列中的任务数
    return { kr, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored;
}
```

#### PR Plan 调度 (第249-271行)

```javascript
async function getNextPrPlan(initiativeId) {
  const allPrPlans = await getPrPlansByInitiative(initiativeId);
  const pendingPlans = allPrPlans.filter(p => p.status === 'planning');

  // 按 sequence 顺序检查，返回第一个满足依赖的 pending 计划
  for (const prPlan of pendingPlans) {
    if (canExecutePrPlan(prPlan, allPrPlans)) {
      return prPlan;
    }
  }
  return null;
}
```

---

### 3.2 执行器 (Executor) 的任务派发

**文件**: `/home/xx/perfect21/cecelia/core/brain/src/executor.js`

#### 资源管理

```javascript
// 第127-143行: 资源阈值计算

const CPU_CORES = os.cpus().length;
const TOTAL_MEM_MB = Math.round(os.totalmem() / 1024 / 1024);
const MEM_PER_TASK_MB = 500;                    // ~500MB per claude process
const CPU_PER_TASK = 0.5;                       // ~0.5 core per claude process
const INTERACTIVE_RESERVE = 2;                  // 为用户留 2 个席位
const USABLE_MEM_MB = TOTAL_MEM_MB * 0.8;      // 80% 可用
const USABLE_CPU = CPU_CORES * 0.8;            // 80% 可用

// 自动派发阈值 = 总容量 - 交互式预留
const RESERVE_CPU = INTERACTIVE_RESERVE * CPU_PER_TASK;       // 1.0 core
const RESERVE_MEM_MB = INTERACTIVE_RESERVE * MEM_PER_TASK_MB; // 1000MB
const LOAD_THRESHOLD = CPU_CORES * 0.85 - RESERVE_CPU;        // e.g. 5.8
const MEM_AVAILABLE_MIN_MB = TOTAL_MEM_MB * 0.15 + RESERVE_MEM_MB; // e.g. 3398MB
const SWAP_USED_MAX_PCT = 70;                   // Hard stop: swap > 70%
```

#### 位置路由执行 (第28-29行 导入)

```javascript
import { getTaskLocation } from './task-router.js';

// 在派发时检查位置:
// - 'us' → 本地 Claude Code (cecelia-run)
// - 'hk' → HK MiniMax (通过 Tailscale)
```

---

## 4. 意图识别系统

**文件**: `/home/xx/perfect21/cecelia/core/brain/src/intent.js`

### 4.1 意图类型定义 (第19-30行)

```javascript
const INTENT_TYPES = {
  CREATE_PROJECT: 'create_project',      // "我想做一个 GMV Dashboard"
  CREATE_FEATURE: 'create_feature',      // "给登录页面加一个忘记密码功能"
  CREATE_GOAL: 'create_goal',            // "创建一个 P0 目标：提升系统稳定性"
  CREATE_TASK: 'create_task',            // "添加一个任务：修复登录超时"
  QUERY_STATUS: 'query_status',          // "当前有哪些任务？"
  FIX_BUG: 'fix_bug',                    // "修复购物车页面的价格显示问题"
  REFACTOR: 'refactor',                  // "重构用户模块的代码结构"
  EXPLORE: 'explore',                    // "帮我看看这个 API 怎么用"
  QUESTION: 'question',                  // "为什么这里会报错？"
  UNKNOWN: 'unknown'
};
```

### 4.2 意图到行为的映射 (第200-211行)

```javascript
const INTENT_ACTION_MAP = {
  [INTENT_TYPES.CREATE_GOAL]: { action: 'create-goal', requiredParams: ['title'] },
  [INTENT_TYPES.CREATE_PROJECT]: { action: null, handler: 'parseAndCreate' },
  [INTENT_TYPES.CREATE_FEATURE]: { action: null, handler: 'parseAndCreate' },
  [INTENT_TYPES.CREATE_TASK]: { action: 'create-task', requiredParams: ['title'] },
  [INTENT_TYPES.FIX_BUG]: { action: 'create-task', requiredParams: ['title'] },
  [INTENT_TYPES.REFACTOR]: { action: 'create-task', requiredParams: ['title'] },
  [INTENT_TYPES.QUERY_STATUS]: { action: null, handler: 'queryStatus' },
  [INTENT_TYPES.EXPLORE]: { action: null, handler: 'parseAndCreate' },
  [INTENT_TYPES.QUESTION]: { action: null, handler: null },
  [INTENT_TYPES.UNKNOWN]: { action: null, handler: null }
};
```

---

## 5. 当前架构的优化点

### 5.1 任务路由机制的优化潜力

#### 目前的限制

1. **单一维度路由**
   - 目前只有 8 种 task_type (dev/review/qa/audit/exploratory/talk/research/data)
   - 每个 task_type 硬映射到单一 skill
   - 无法根据任务属性动态选择 agent

2. **缺乏多维度匹配**
   - 没有考虑任务的复杂度、技术栈、领域等维度
   - 没有能力标签 (capability tags)
   - 无法匹配"最适合"的 agent，只能匹配"默认" agent

3. **意图识别与路由脱离**
   - intent.js 识别意图类型
   - task-router.js 根据 task_type 路由
   - 两者没有关联，意图信息未被用于路由决策

#### 优化方向

**建议1: 建立能力索引系统**

```
Capabilities Table
├─ id
├─ name (e.g., "TypeScript Frontend Development")
├─ related_skills (e.g., ['/dev', '/review', '/qa'])
├─ keywords (e.g., ["React", "TypeScript", "CSS"])
├─ complexity_level (beginner/intermediate/expert)
├─ owner_agent (Caramel, 小检, etc.)
├─ embedding (向量表示，用于语义搜索)
└─ metadata (相关仓库、技术栈、证据)
```

**建议2: 多维度任务属性**

```
Task 表扩展
├─ complexity (low/medium/high/critical)
├─ tech_stack (["React", "TypeScript", "Node.js"])
├─ domain (frontend/backend/devops/data)
├─ required_capabilities ([capability_id, ...])
├─ estimated_duration_hours
└─ required_knowledge_level (junior/mid/senior)
```

**建议3: 动态 Agent 选择**

```
当派发任务时:
1. 提取任务的 complexity, tech_stack, domain
2. 查询 Capabilities 表 (精确 + 向量搜索)
3. 评分可匹配的 agents
4. 选择得分最高的 agent

得分公式:
  base_score = skill_relevance × 0.4
             + experience_match × 0.3
             + resource_availability × 0.2
             + recent_success_rate × 0.1
```

### 5.2 调度机制的优化潜力

#### 目前的限制

1. **KR 评分单一**
   - 只考虑优先级、进度、截止日期、焦点、队列大小
   - 未考虑：依赖关系、风险、团队能力、资源成本

2. **缺乏依赖管理**
   - 只有 PR Plans 支持 depends_on 依赖
   - 传统 KR→Task 流程无依赖管理
   - 可能派发互相阻塞的任务

3. **缺乏容量规划**
   - 无法预测当前队列需要多少时间完成
   - 无法提前预留资源给高优先级任务

#### 优化方向

**建议1: 任务级别的依赖管理**

```
tasks 表扩展
├─ depends_on (UUID[]) - 依赖的任务 ID
├─ blocking_tasks (UUID[]) - 阻塞的任务 ID
└─ can_execute() {
     return dependencies.every(t => t.status === 'completed')
   }
```

**建议2: 容量感知调度**

```
calculateQueueDepth() {
  for each (queued_task) {
    estimated_hours += queued_task.estimated_duration_hours
  }
  return estimated_hours
}

shouldPauseNewDispatch() {
  return queue_depth_hours > 24  // 只保持 24h 的队列
}
```

**建议3: 风险感知评分**

```
KR 评分增强:
  risk_score = (task_failure_rate × 0.3
              + blocker_count × 0.5
              + resource_contention × 0.2)
  
  final_score = base_score × (1 - risk_score)
```

### 5.3 丘脑 (Thalamus) 的优化潜力

#### 目前的限制

1. **Action 白名单静态**
   - 30+ 个 action 硬编码在 thalamus.js
   - 无法动态添加新 action
   - 新增 action 需要修改 action.js + thalamus.js + decision-executor.js

2. **缺乏上下文感知**
   - 决策只看事件本身
   - 未考虑历史决策、学习经验
   - 无法调整策略

#### 优化方向

**建议1: 动态 Action Registry**

```
action_registry 表
├─ id
├─ action_type (string, 白名单)
├─ description
├─ required_params
├─ dangerous (boolean)
├─ handler_function (reference)
├─ version
└─ enabled (boolean)
```

**建议2: 决策记忆集成**

```
thalamus.js 增强:
  - 查询历史相似决策 (similarity.js)
  - 查询相关学习记录 (learning.js)
  - 动态调整 confidence 和 level
```

---

## 总结

### 当前的强项

✅ **清晰的分层架构**
- L0 脑干 (纯代码) → L1 丘脑 (Haiku) → L2 皮层 (Sonnet)
- 职责边界明确

✅ **灵活的任务类型系统**
- 8 种 task_type 覆盖大部分场景
- 动态路由到不同 region (US/HK)

✅ **多重保护机制**
- 白名单 + 验证 (thalamus.js)
- 资源管理 (executor.js)
- 隔离系统 (quarantine.js)

✅ **PR Plans 的依赖管理**
- 支持 depends_on 字段
- 按 sequence 顺序调度

### 主要优化方向

🔄 **建立能力匹配系统**
- 从"固定任务类型→固定 skill"升级到"任务属性→最佳 agent"

🔄 **增强调度的依赖感知**
- 任务级别的依赖管理
- 容量规划和预留

🔄 **动态化 Action 注册**
- 从硬编码的白名单到数据库驱动的 registry

🔄 **融合历史决策与学习**
- 利用 learning.js 和 similarity.js
- 优化 thalamus 的决策质量

---

**研究完成**  
所有路径均为绝对路径，代码片段包含行号，便于进一步分析和改进。
