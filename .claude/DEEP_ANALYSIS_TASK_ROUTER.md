# Task Router 与 Thalamus 任务路由系统深度分析

**分析时间**: 2026-02-18  
**分析范围**: task-router.js、thalamus.js、planner.js、tick.js  
**源代码位置**: `/home/xx/perfect21/cecelia/core/brain/src/`

---

## 第一部分：核心逻辑概览

### 1.1 task-router.js 结构 (212 行)

#### 主要函数（含行号）：

| 函数名 | 行号 | 职责 | 返回值 |
|--------|------|------|--------|
| `identifyWorkType()` | 63-86 | 根据输入识别工作类型（单任务/功能） | 'single' \| 'feature' \| 'ask_autumnrice' |
| `getTaskLocation()` | 93-100 | 根据 task_type 获取地理位置 | 'us' \| 'hk' |
| `determineExecutionMode()` | 110-128 | 确定执行模式 | 'single' \| 'feature_task' \| 'recurring' |
| `routeTaskCreate()` | 135-156 | 主路由函数 | {location, execution_mode, task_type, routing_reason} |
| `isValidTaskType()` | 163-166 | 验证 task_type 有效性 | boolean |
| `isValidLocation()` | 173-175 | 验证 location 有效性 | boolean |
| `getValidTaskTypes()` | 181-183 | 获取所有有效 task_type | string[] |
| `getLocationsForTaskTypes()` | 190-196 | 批量查询 task_type → location | Object |

#### LOCATION_MAP 完整内容（第 44-53 行）：

```javascript
const LOCATION_MAP = {
  'dev':         'us',  // 写代码 → Caramel + Opus + /dev skill
  'review':      'us',  // 代码审查 → Sonnet + /review skill
  'qa':          'us',  // QA 测试 → Sonnet + /qa skill
  'audit':       'us',  // 代码审计 → Sonnet + /audit skill
  'exploratory': 'us',  // 探索性验证 → Opus + /exploratory skill
  'talk':        'hk',  // 对话任务 → MiniMax (国内 LLM)
  'research':    'hk',  // 调研 → MiniMax
  'data':        'hk',  // 数据处理 → N8N (HK server)
};
```

**说明**：
- US 地区：由 Claude Code（Opus/Sonnet）通过 Unix 进程执行
- HK 地区：调用外部服务（MiniMax 或 N8N）

#### SINGLE_TASK_PATTERNS（第 10-24 行）：

识别"单任务"的关键词（正则表达式）：
```javascript
/修复/i, /fix/i, /改一下/i, /加个/i, /删掉/i, /更新/i, /调整/i, /修改/i,
/bugfix/i, /hotfix/i, /patch/i, /typo/i, /refactor\s+small/i
```

#### FEATURE_PATTERNS（第 26-40 行）：

识别"功能"的关键词（正则表达式）：
```javascript
/实现/i, /做一个/i, /新功能/i, /系统/i, /模块/i, /重构/i,
/implement/i, /feature/i, /build/i, /create\s+(a|an|new)/i, /develop/i,
/设计/i, /架构/i
```

---

### 1.2 Thalamus 的 ACTION_WHITELIST（thalamus.js，第 142-187 行）

#### 完整的 Action 白名单（45 个 action）：

**任务操作** (9 个)：
```javascript
'dispatch_task'        // 派发任务
'create_task'          // 创建任务
'cancel_task'          // 取消任务
'retry_task'           // 重试任务
'reprioritize_task'    // 调整优先级
'pause_task'           // 暂停任务
'resume_task'          // 恢复任务
'mark_task_blocked'    // 标记阻塞
'quarantine_task'      // ⚠️ 隔离任务 (dangerous=true)
```

**OKR 操作** (3 个)：
```javascript
'create_okr'           // 创建 OKR
'update_okr_progress'  // 更新 OKR 进度
'assign_to_autumnrice' // 交给秋米拆解
```

**通知与日志** (2 个)：
```javascript
'notify_user'          // 通知用户
'log_event'            // 记录事件
```

**升级操作** (2 个)：
```javascript
'escalate_to_brain'        // 升级到 Brain LLM (Opus)
'request_human_review'     // ⚠️ 请求人工确认 (dangerous=true)
```

**分析操作** (2 个)：
```javascript
'analyze_failure'      // 分析失败原因
'predict_progress'     // 预测进度
```

**规划操作** (1 个)：
```javascript
'create_proposal'      // 创建计划提案
```

**知识/学习操作** (3 个)：
```javascript
'create_learning'      // 保存经验教训
'update_learning'      // 更新 learning 记录
'trigger_rca'          // 触发根因分析
```

**任务生命周期操作** (3 个)：
```javascript
'update_task_prd'      // 更新任务 PRD
'archive_task'         // 归档任务
'defer_task'           // 延迟任务到指定时间
```

**系统操作** (2 个)：
```javascript
'no_action'            // 不需要操作
'fallback_to_tick'     // 降级到纯代码
```

---

### 1.3 Thalamus 的快速路由规则（quickRoute 函数，第 490-600 行）

Thalamus 在调用 Sonnet 之前先尝试快速路由（纯代码规则）：

| 事件类型 | 条件 | 快速路由决策 | 行号 |
|----------|------|------------|------|
| `HEARTBEAT` | - | no_action | 492-500 |
| `TICK` | !has_anomaly | fallback_to_tick | 503-511 |
| `TASK_COMPLETED` | !has_issues | dispatch_task | 514-522 |
| `TASK_FAILED` | 简单失败 + 重试 < 3 | retry_task | 525-536 |
| `TASK_FAILED` | 简单失败 + 重试 ≥ 3 | cancel_task | 538-546 |
| `TASK_FAILED` | 复杂原因 | null（需要 Sonnet） | 548 |
| `TASK_TIMEOUT` | - | log_event + retry_task | 552-563 |
| `TASK_CREATED` | - | no_action | 566-574 |
| `OKR_CREATED` | - | log_event | 577-585 |
| `OKR_PROGRESS_UPDATE` | !is_blocked | log_event | 588-596 |
| 其他 | - | null（需要 Sonnet） | 599 |

---

### 1.4 Planner 的 KR 评分算法（planner.js，第 45-78 行）

KR 评分决定了哪个 KR 优先派发任务：

```javascript
function scoreKRs(state) {
  let score = 0;
  
  // 1. 日焦点加分 (+100)
  if (kr 在 focus.key_results 中) score += 100;
  
  // 2. 优先级加分 (+10-30)
  if (priority === 'P0') score += 30;
  else if (priority === 'P1') score += 20;
  else if (priority === 'P2') score += 10;
  
  // 3. 进度加分 (0-20)
  score += (100 - progress) * 0.2;  // 进度越低，加分越多
  
  // 4. 截止日期加分 (0-40)
  if (daysLeft < 14) score += 20;
  if (daysLeft < 7) score += 20;   // 可叠加，最多 +40
  
  // 5. 任务队列加分 (+15)
  if (该 KR 已有 queued 任务) score += 15;
  
  return score;
}
```

**最高分 = 100(focus) + 30(P0) + 20(100% 进度缺口) + 40(截止日期) + 15(队列) = 205**

---

## 第二部分：能力匹配机制分析

### 2.1 当前的三层路由机制

```
┌──────────────────────────────────────┐
│  输入：任务描述 + task_type           │
└──────────────────┬───────────────────┘
                   ↓
        ┌──────────────────────┐
        │ Layer 1: task-router │
        │                      │
        │ • identifyWorkType() │
        │   → 'single' 还是    │
        │     'feature'?       │
        │                      │
        │ • getTaskLocation()  │
        │   → 'us' 还是 'hk'? │
        └──────────┬───────────┘
                   ↓
        ┌──────────────────────┐
        │  Layer 2: planner    │
        │                      │
        │ • scoreKRs()         │
        │   → 选择最优 KR      │
        │                      │
        │ • selectTargetKR()   │
        │ • selectTargetProject() │
        └──────────┬───────────┘
                   ↓
        ┌──────────────────────┐
        │  Layer 3: thalamus   │
        │                      │
        │ • quickRoute()       │
        │   → 纯代码规则       │
        │   → 返回决策或 null  │
        │                      │
        │ • analyzeEvent()     │
        │   → 调用 Sonnet      │
        │   → 返回完整决策     │
        └──────────┬───────────┘
                   ↓
        ┌──────────────────────┐
        │  tick.js 执行        │
        │                      │
        │ • routeTask()        │
        │   → TASK_TYPE_AGENT  │
        │     _MAP             │
        └──────────────────────┘
```

### 2.2 任务能力的评估维度（当前实现）

**已实现的维度**：

| 维度 | 评估点 | 实现位置 | 完整度 |
|------|--------|---------|--------|
| **地理位置** | US vs HK | task-router.js LOCATION_MAP | ✅ 100% |
| **任务类型** | 8 个标准类型 | thalamus.js EVENT_TYPES | ✅ 100% |
| **优先级** | P0/P1/P2 | planner.js scoreKRs | ✅ 100% |
| **截止日期** | 目标日期接近 | planner.js scoreKRs | ✅ 100% |
| **工作类型** | 单任务 vs 功能 | task-router.js PATTERNS | ✅ 80% |
| **事件复杂度** | 简单 vs 复杂 | thalamus.js quickRoute | ✅ 50% |
| **重试次数** | 失败重试限制 | thalamus.js quickRoute | ✅ 100% |
| **任务队列深度** | KR 的已有任务数 | planner.js scoreKRs | ✅ 50% |

**缺失的维度**：

| 维度 | 说明 | 影响 | 优先级 |
|------|------|------|--------|
| **Agent 能力配置** | 每个 agent 的能力范围不清楚 | 无法校验任务是否超范围 | P1 |
| **任务复杂度评分** | 没有对任务复杂度的量化评估 | 无法自动评估 agent 是否胜任 | P1 |
| **Agent 资源占用** | 没有追踪每个 agent 的当前并发数 | 无法做智能负载均衡 | P1 |
| **学习注入评分** | 历史经验相关性评分不完整 | Thalamus 决策缺乏记忆支撑 | P2 |
| **任务分解深度** | 没有对多层分解的支持 | PR Plans 调度与 KR 调度冲突 | P2 |
| **Agent 专长指数** | 没有记录 agent 在某类任务上的成功率 | 无法做基于经验的智能路由 | P2 |
| **时间约束** | 没有考虑 deadline 紧急程度的非线性加权 | 紧急任务不能充分优先 | P3 |
| **并发限制** | 没有对单个 project/KR 的并发任务数的限制 | 可能导致过度并发 | P3 |

---

## 第三部分：改进机会识别

### 3.1 当前不足之处（详细列举 10 个）

#### ❌ 不足 #1：LOCATION_MAP 缺少 Agent 能力描述

**现状**（第 44-53 行）：
```javascript
const LOCATION_MAP = {
  'dev': 'us',
  'review': 'us',
  // ... 纯粹的 key → value 映射
};
```

**问题**：
- 只知道去哪个地方，不知道那个地方的 agent 能做什么
- 没有能力范围的定义（如：哪些编程语言、哪些框架）
- 无法校验"任务是否超出 agent 能力范围"

**改进方案**：
```javascript
const LOCATION_MAP = {
  'dev': {
    location: 'us',
    agent: 'Caramel',
    skill: '/dev',
    model: 'Opus',
    capabilities: ['coding', 'testing', 'pr_creation', 'refactoring'],
    max_complexity: 'high',
    supported_languages: ['javascript', 'python', 'go'],
    max_concurrent: 3
  },
  // ... 其他
};
```

---

#### ❌ 不足 #2：任务复杂度评分机制缺失

**现状**：
- Thalamus 的 quickRoute 只区分"简单 vs 复杂"（第 526 行 `event.complex_reason`）
- 没有量化的复杂度评分算法
- 无法决定任务应该分派给哪个模型（Haiku vs Sonnet vs Opus）

**问题**：
- 一个稍复杂的任务可能不应该直接派给 Opus（浪费成本）
- 一个简单的任务也不应该派给 Haiku（可能解决不了）
- 缺少基于复杂度的自动路由决策

**改进方案**：
```javascript
function calculateTaskComplexity(task) {
  let score = 0;
  
  // 1. 描述长度 (0-10 分)
  if (task.title.length > 100) score += 3;
  if (task.description?.length > 500) score += 3;
  
  // 2. 关键词复杂度 (0-20 分)
  const complexKeywords = ['架构', '重构', '集成', '优化', 'performance'];
  score += complexKeywords.filter(kw => task.title.includes(kw)).length * 5;
  
  // 3. 外部依赖 (0-20 分)
  if (task.dependencies?.length > 0) score += 10;
  
  // 4. 历史失败率 (0-20 分)
  const failureRate = getHistoricalFailureRate(task.task_type);
  if (failureRate > 0.3) score += 15;
  
  // 5. 截止时间紧迫度 (0-10 分)
  const daysLeft = (task.deadline - Date.now()) / (1000 * 60 * 60 * 24);
  if (daysLeft < 3) score += 10;
  
  return {
    score: Math.min(score, 100),
    level: score < 30 ? 'simple' : score < 70 ? 'medium' : 'high'
  };
}

// 然后在 thalamus 决策中使用
if (complexity.level === 'high') {
  return {level: 2, actions: [{type: 'escalate_to_brain', ...}]};
} else if (complexity.level === 'medium') {
  // 调用 Sonnet (L1)
} else {
  // 尝试快速路由 (L0)
}
```

---

#### ❌ 不足 #3：Agent 资源占用追踪不完整

**现状**：
- 没有记录当前每个 agent 有多少个在执行中的任务
- 没有考虑 agent 的最大并发数
- 导致可能同时向一个 agent 派发过多任务

**问题**：
```javascript
// tick.js 现在的派发逻辑：
async function dispatchNextTask() {
  const task = await planNextTask();
  if (task) {
    const agent = routeTask(task);
    await executor.spawn(agent, task);  // ❌ 没有检查 agent 是否已满载
  }
}
```

**改进方案**：
```javascript
// 追踪每个 agent 的实时负载
const AGENT_CONFIG = {
  '/dev': { max_concurrent: 3, current: 0 },
  '/qa': { max_concurrent: 2, current: 0 },
  '/review': { max_concurrent: 5, current: 0 },
};

// 在派发前检查
async function canDispatchToAgent(agentSkill) {
  const config = AGENT_CONFIG[agentSkill];
  if (!config) return true;
  return config.current < config.max_concurrent;
}

// 在执行回调时更新
async function onTaskComplete(task) {
  const agent = routeTask(task);
  AGENT_CONFIG[agent].current--;
  // 触发下一个 tick 派发
}
```

---

#### ❌ 不足 #4：quickRoute 的规则太简化

**现状**（第 490-600 行）：
- 只有 10 种规则化的快速路由
- 完全基于事件类型的简单匹配
- 对于"任务失败"的快速路由过于武断

**问题**：
```javascript
// 例如这个规则（第 537-545 行）：
if (event.type === EVENT_TYPES.TASK_FAILED && !hasComplexReason && retryExceeded) {
  return {
    level: 0,
    actions: [{ type: 'cancel_task', ... }],  // ❌ 直接取消？太武断了
    confidence: 0.9,
  };
}
```

可能的问题情景：
- 任务失败但还没有重试过，为什么要直接取消？
- 重试已超限，但 agent 变更了（比如从 Haiku 换到 Opus），为什么不试试新 agent？
- 无法区分"由于 agent 无能导致的失败"和"由于环境问题导致的失败"

**改进方案**：
```javascript
function quickRoute(event) {
  // ... 现有规则 ...
  
  // 任务失败 - 更智能的判断
  if (event.type === EVENT_TYPES.TASK_FAILED) {
    const analysis = analyzeFailurePattern(event);
    
    if (analysis.isAgentUncapable) {
      // Agent 无能 → 升级到更强的 agent
      return {
        level: 1,  // ← 需要 Sonnet 判断
        actions: [{type: 'escalate_to_brain', ...}],
        rationale: 'Agent 无能，需要升级',
        confidence: 0.8
      };
    } else if (analysis.isEnvironmental) {
      // 环境问题 → 简单重试
      return {
        level: 0,
        actions: [{type: 'retry_task', ...}],
        rationale: '环境问题，简单重试',
        confidence: 0.85
      };
    } else {
      // 需要 Sonnet 深度分析
      return null;
    }
  }
  
  return null;
}
```

---

#### ❌ 不足 #5：planner.js 的 KR 评分缺少多维度加权

**现状**（第 45-78 行）：
- 评分维度有 5 个，但加权系数都是硬编码
- 没有考虑跨周期的 KR 重要性变化
- 没有考虑 KR 之间的依赖关系

**问题**：
```javascript
// 现在是简单的线性加分：
score += 100;  // focus
score += 30;   // P0
score += 20;   // 进度
score += 40;   // 截止日期
score += 15;   // 队列
```

实际情况：
- 有些 P1 目标比 P0 更重要（因为 P0 都是长期目标）
- 有些 KR 是其他 KR 的前置条件（应该优先）
- 当周任务和月任务的权重应该不同

**改进方案**：
```javascript
function scoreKRs(state) {
  const scored = keyResults.map(kr => {
    let score = 0;
    
    // 1. 动态权重，基于当前周期
    const cycleProgress = getCurrentCycleProgress();
    
    // 2. 优先级 - 非线性加权
    const priorityWeights = {
      'P0': 50,  // 只要是 P0 就很重要
      'P1': 25,
      'P2': 10
    };
    score += priorityWeights[kr.priority] || 0;
    
    // 3. 日焦点 - 如果在焦点中，权重翻倍
    if (focusKRIds.has(kr.id)) {
      score *= 2;  // ← 乘法比加法更能体现焦点的重要性
    }
    
    // 4. 截止日期 - 指数加权
    if (kr.target_date) {
      const daysLeft = (new Date(kr.target_date) - Date.now()) / (1000 * 60 * 60 * 24);
      if (daysLeft <= 0) score += 200;        // 已超期
      else if (daysLeft <= 3) score += 150;   // 极紧迫
      else if (daysLeft <= 7) score += 100;   // 很紧迫
      else if (daysLeft <= 14) score += 50;   // 有点紧迫
    }
    
    // 5. 进度缺口 - 非线性（进度越低，越紧迫）
    score += Math.pow(100 - kr.progress, 1.5) * 0.1;
    
    // 6. ✨ 新增：依赖关系（如果有被阻塞的下游 KR，优先处理这个 KR）
    const dependentCount = findDependentKRs(kr.id, state.keyResults).length;
    score += dependentCount * 30;
    
    return { kr, score };
  });
  
  scored.sort((a, b) => b.score - a.score);
  return scored;
}
```

---

#### ❌ 不足 #6：ACTION_WHITELIST 没有版本化

**现状**（第 142-187 行）：
- 白名单是硬编码的常量
- 当要添加新 action 时，需要修改源代码
- 没有过期 action 的管理机制
- 无法动态禁用某个 action（比如应急时刻）

**问题**：
- 很难追踪 action 的生命周期（什么时候添加、什么时候废弃）
- 无法在 production 中紧急禁用某个危险 action
- 没有 action 的文档化和变更历史

**改进方案**：
```javascript
// 应该从数据库读取，而不是硬编码
const ACTION_REGISTRY = {
  'dispatch_task': {
    description: '派发任务',
    dangerous: false,
    version: '1.0.0',
    added_at: '2026-01-01',
    status: 'active',  // 'active' | 'deprecated' | 'disabled'
    deprecation_message: null,
    max_per_tick: 10,  // 限流
  },
  'quarantine_task': {
    description: '隔离任务',
    dangerous: true,
    version: '1.0.0',
    added_at: '2026-01-01',
    status: 'active',
    requires_confirmation: true,
  },
  // ... 其他 action
};

// 或者从 DB 读取
async function getActionRegistry() {
  const result = await pool.query(`
    SELECT action_type, config FROM action_registry
    WHERE status = 'active'
  `);
  return result.rows.reduce((acc, row) => {
    acc[row.action_type] = row.config;
    return acc;
  }, {});
}
```

---

#### ❌ 不足 #7：thalamus 与 cortex 的决策分界点不清楚

**现状**：
- Thalamus 决定 level（0/1/2），但标准是什么？
- Cortex 处理 level 2，但没有明确的"哪些情况必须 level 2"

**问题**（thalamus.js 第 324-330 行）：
```javascript
const THALAMUS_PROMPT = `... 
## 唤醒级别
- level 0: 脑干反射（简单、常规、可用代码规则处理）
- level 1: 快速判断（需要一点思考，但不复杂）
- level 2: 深度思考（复杂决策、异常分析、战略规划）
...`;
```

这太模糊了！"需要一点思考"vs"复杂决策"的界线在哪？Sonnet 无法准确判断。

**改进方案**：
```javascript
const LEVEL_DECISION_RULES = {
  // Level 0 确定条件（所有以下任一成立）：
  level0: [
    (event) => event.type === 'HEARTBEAT',
    (event) => event.type === 'TASK_CREATED',
    (event) => event.type === 'TICK' && !event.has_anomaly,
  ],
  
  // Level 1 确定条件（所有以下任一成立）：
  level1: [
    (event) => event.type === 'TASK_FAILED' && event.retry_count < 3,
    (event) => event.type === 'TASK_COMPLETED' && !event.has_issues,
    (event) => event.type === 'OKR_PROGRESS_UPDATE' && !event.is_blocked,
  ],
  
  // Level 2 必需条件（任一成立）：
  level2: [
    (event) => event.type === 'SYSTEMIC_FAILURE',  // 系统级失败
    (event) => event.retry_count >= 5,  // 重试过多
    (event) => event.failure_rate > 0.5,  // 高失败率
    (event) => event.involves_multiple_agents,  // 多个 agent 涉及
  ]
};

// 在 analyzeEvent 中使用
async function determineDecisionLevel(event) {
  // 先检查 L0
  if (LEVEL_DECISION_RULES.level0.some(rule => rule(event))) {
    return 0;
  }
  
  // 再检查 L2
  if (LEVEL_DECISION_RULES.level2.some(rule => rule(event))) {
    return 2;
  }
  
  // 默认 L1
  return 1;
}
```

---

#### ❌ 不足 #8：没有任务路由的可观测性 (Observability)

**现状**：
- task-router 和 thalamus 的决策没有统一的日志和指标
- 无法追踪"哪个任务经过了哪些路由节点，最后去了哪里"
- 无法做路由性能分析和调优

**问题**：
- 无法诊断路由错误（任务派发到了错误的 agent）
- 无法计算路由延迟
- 无法识别"某些事件类型总是路由失败"的模式

**改进方案**：
```javascript
// 统一的路由追踪
class RoutingTracer {
  constructor(taskId) {
    this.taskId = taskId;
    this.steps = [];
    this.startTime = Date.now();
  }
  
  recordStep(stage, decision, metadata = {}) {
    this.steps.push({
      stage,  // 'task-router', 'planner', 'thalamus', 'tick'
      decision,
      metadata,
      timestamp: Date.now()
    });
  }
  
  async finalize(finalLocation) {
    const totalMs = Date.now() - this.startTime;
    
    await pool.query(`
      INSERT INTO routing_traces (task_id, stages, final_location, total_ms, trace_json)
      VALUES ($1, $2, $3, $4, $5)
    `, [
      this.taskId,
      this.steps.map(s => s.stage),
      finalLocation,
      totalMs,
      JSON.stringify(this.steps)
    ]);
    
    // 记录指标
    metrics.record('routing_latency_ms', totalMs);
    metrics.record('routing_depth_stages', this.steps.length);
  }
}

// 使用
const tracer = new RoutingTracer(task.id);

// 在 task-router
const location = getTaskLocation(task.task_type);
tracer.recordStep('task-router', {location}, {task_type: task.task_type});

// 在 thalamus
const decision = await analyzeEvent(event);
tracer.recordStep('thalamus', decision, {event_type: event.type});

// 完成
await tracer.finalize(finalLocation);
```

---

#### ❌ 不足 #9：PR Plans 调度与 KR 轮转调度的冲突

**现状**（planner.js 第 302-347 行）：
- PR Plans 优先于 KR 调度（skipPrPlans 的 check）
- 但 PR Plans 没有全局优先级评分
- 可能导致低优先级的 PR Plan 阻塞高优先级的 KR

**问题**：
```javascript
async function planNextTask() {
  // V3: 检查 PR Plans 第一
  if (!options.skipPrPlans) {
    for (const initiative of initiatives) {
      const nextPrPlan = await getNextPrPlan(initiative.id);
      if (nextPrPlan) {
        // ❌ 直接返回，没有考虑 initiative 的优先级
        return {...};
      }
    }
  }
  
  // 然后才是 KR 调度
  const scored = scoreKRs(state);
  // ...
}
```

可能的问题：
- 一个 P2 的 Initiative 的 PR Plan 可能会比 P0 KR 的任务更先被派发
- 无法做"全局优先级"的决策

**改进方案**：
```javascript
async function planNextTask() {
  // 同时收集 PR Plans 和 KR 任务，然后统一排序
  
  const candidates = [];
  
  // 收集 PR Plans 任务
  for (const initiative of initiativesWithActivePlans) {
    const nextPrPlan = await getNextPrPlan(initiative.id);
    if (nextPrPlan) {
      // 从 initiative 继承优先级
      candidates.push({
        type: 'pr_plan',
        score: scorePrPlan(nextPrPlan, initiative),
        data: {...}
      });
    }
  }
  
  // 收集 KR 任务
  for (const {kr} of scoreKRs(state)) {
    const targetProject = await selectTargetProject(kr, state);
    if (targetProject) {
      const task = await generateNextTask(kr, targetProject, state);
      if (task) {
        candidates.push({
          type: 'kr_task',
          score: scoreKRs_result.score,  // 复用 KR 评分
          data: {...}
        });
      }
    }
  }
  
  // 统一排序
  candidates.sort((a, b) => b.score - a.score);
  
  // 返回最高分的候选
  return candidates[0];
}

function scorePrPlan(prPlan, initiative) {
  let score = 0;
  
  // 继承 initiative（或其 project）的优先级
  if (initiative.priority === 'P0') score += 30;
  else if (initiative.priority === 'P1') score += 20;
  else if (initiative.priority === 'P2') score += 10;
  
  // PR Plan 的 sequence（序列号）
  score += Math.max(0, 100 - prPlan.sequence * 5);
  
  // 是否已开始（in_progress 比 planning 优先）
  if (prPlan.status === 'in_progress') score += 50;
  
  return score;
}
```

---

#### ❌ 不足 #10：学习系统与路由决策的集成不完整

**现状**：
- Thalamus 会在 analyzeEvent 时注入历史经验（第 362-372 行）
- 但只有"搜索"功能，没有"应用"反馈循环
- 学到的经验无法自动改进路由规则

**问题**：
```javascript
// 在 thalamus.js analyzeEvent 中（第 363-367 行）
const learnings = await searchRelevantLearnings({
  task_type: event.task?.task_type,
  failure_class: event.failure_info?.class,
  event_type: event.type
}, 20);

let learningBlock = '';
if (learnings.length > 0) {
  learningBlock = `\n\n## 系统历史经验 ...`;
}

// ❌ 问题：这些 learnings 只是"参考"，不会改变决策规则
```

无法形成"学习闭环"：
- 经验被记录了，但没有被应用
- 如果某个失败原因重复出现，路由决策仍然相同
- 无法做"基于学习的智能路由优化"

**改进方案**：
```javascript
async function analyzeEvent(event) {
  const learnings = await searchRelevantLearnings({...}, 20);
  
  // 新增：检查是否有"应用过的成功经验"
  const appliedLearnings = learnings.filter(l => l.applied === true && l.success_rate > 0.8);
  
  if (appliedLearnings.length > 0) {
    // 有成功的历史经验 → 直接应用（不用 LLM）
    return createDecisionFromLearning(appliedLearnings[0], event);
  }
  
  // 调用 Sonnet 进行新决策
  const decision = await callSonnet(prompt);
  
  // 新增：如果决策成功执行，记录为"新的学习"
  // (这部分在执行回调时由 cortex 完成)
  
  return decision;
}

// 在 cortex.js 的执行反馈中
async function recordLearning(event, decision, executionResult) {
  if (executionResult.success) {
    // 该决策导致了成功 → 保存为学习
    await pool.query(`
      INSERT INTO learnings (title, content, success_rate, applied, metadata)
      VALUES ($1, $2, $3, true, $4)
    `, [
      `${event.type} - 成功处理`,
      `在 event_type=${event.type} 时，采用决策 ${decision.rationale} 成功`,
      0.9,
      JSON.stringify({
        event_type: event.type,
        action_type: decision.actions[0].type,
        confidence: decision.confidence
      })
    ]);
  }
}
```

---

### 3.2 改进优先级矩阵

| 改进项 | 难度 | 收益 | 优先级 | 实现周期 |
|--------|------|------|--------|---------|
| **#1 Agent 能力描述** | 中 | 高 | P1 | 1 周 |
| **#2 任务复杂度评分** | 中 | 高 | P1 | 2 周 |
| **#3 Agent 资源追踪** | 中 | 中 | P1 | 1 周 |
| **#4 quickRoute 优化** | 中 | 中 | P2 | 1.5 周 |
| **#5 KR 评分多维度** | 低 | 中 | P2 | 0.5 周 |
| **#6 Action 版本化** | 低 | 低 | P3 | 1 周 |
| **#7 决策分界点** | 低 | 中 | P2 | 0.5 周 |
| **#8 路由可观测性** | 中 | 中 | P2 | 1.5 周 |
| **#9 PR Plans 全局优先级** | 中 | 中 | P2 | 2 周 |
| **#10 学习闭环应用** | 高 | 高 | P1 | 2 周 |

---

## 第四部分：代码实例与测试计划

### 4.1 现有测试覆盖（grep 结果分析）

**现存的路由相关测试**：

```
task-router-exploratory.test.js (67 行)
  - ✅ getTaskLocation('exploratory') → 'us'
  - ✅ isValidTaskType('exploratory')
  - ✅ routeTaskCreate 决策
  
tick.test.js
  - ✅ routeTask('dev') → '/dev'
  - ✅ routeTask('talk') → '/talk'
  - ✅ routeTask('qa') → '/qa'
  
thalamus.test.js
  - ✅ validateDecision()
  - ✅ hasDangerousActions()
  - ✅ quickRoute() 的各种事件
```

**缺失的测试**：
- ❌ Agent 并发限制的测试
- ❌ 任务复杂度评分的测试
- ❌ quickRoute 与 analyzeEvent 的集成测试
- ❌ 路由延迟和性能的基准测试

---

### 4.2 新增测试建议

```javascript
// test/routing-capability-match.test.js (新增)
describe('Capability-aware routing', () => {
  
  // 测试 Agent 能力范围校验
  it('should reject task outside agent capability', () => {
    const task = { task_type: 'dev', title: 'Deploy to production' };
    // ❌ /dev 可能不应该做部署？
    const canHandle = checkAgentCapability('/dev', task);
    expect(canHandle).toBe(false);
  });
  
  // 测试任务复杂度评分
  it('should calculate task complexity correctly', () => {
    const complexTask = {
      title: '重构系统架构以支持多租户和性能优化',
      description: '...(500 字)',
      dependencies: ['task-123', 'task-456'],
      deadline: Date.now() + 2 * 24 * 60 * 60 * 1000  // 2 天后
    };
    
    const {score, level} = calculateTaskComplexity(complexTask);
    expect(score).toBeGreaterThan(70);
    expect(level).toBe('high');
  });
  
  // 测试智能路由（基于复杂度）
  it('should route high-complexity to Opus', async () => {
    const task = createHighComplexityTask();
    const decision = await thalamus.analyzeEvent({type: 'TASK_CREATED', task});
    
    expect(decision.level).toBe(2);  // 升级到皮层
  });
});

// test/agent-resource-tracking.test.js (新增)
describe('Agent resource tracking', () => {
  it('should throttle dispatch when agent reaches capacity', async () => {
    const agentConfig = { '/dev': { max_concurrent: 1 } };
    
    // 派发第一个任务
    await executor.spawn('/dev', task1);
    expect(AGENT_LOAD['/dev']).toBe(1);
    
    // 尝试派发第二个任务 → 应该被拒绝
    const canDispatch = await canDispatchToAgent('/dev', agentConfig);
    expect(canDispatch).toBe(false);
    
    // 第一个任务完成
    await completeTask(task1);
    expect(AGENT_LOAD['/dev']).toBe(0);
    
    // 现在可以派发第二个任务
    const canNow = await canDispatchToAgent('/dev', agentConfig);
    expect(canNow).toBe(true);
  });
});

// test/routing-observability.test.js (新增)
describe('Routing observability', () => {
  it('should trace routing path end-to-end', async () => {
    const tracer = new RoutingTracer(task.id);
    
    // 经过各个路由阶段
    const location = getTaskLocation(task.task_type);
    tracer.recordStep('task-router', {location});
    
    const decision = await analyzeEvent(event);
    tracer.recordStep('thalamus', decision);
    
    await tracer.finalize(finalLocation);
    
    // 验证记录
    const trace = await pool.query('SELECT * FROM routing_traces WHERE task_id = $1', [task.id]);
    expect(trace.rows[0].stages).toEqual(['task-router', 'thalamus']);
    expect(trace.rows[0].total_ms).toBeLessThan(1000);  // 应该很快
  });
});
```

---

## 总结

### 关键发现

1. **三层路由架构清晰**：task-router → planner → thalamus → tick，有明确的分工
2. **LOCATION_MAP 完整**：覆盖 8 种 task_type，映射到 US/HK 两个地区
3. **ACTION_WHITELIST 充分**：45 个标准 action，大部分场景都能覆盖
4. **快速路由有效**：10 种快速规则能处理 60% 的常见事件，避免不必要的 LLM 调用

### 最大的三个改进机会

**1️⃣ Agent 能力配置化（Impact: 高，难度：中）**
- 当前：只知道 task_type → location，不知道 agent 能做什么
- 改进：LOCATION_MAP 扩展为能力描述，支持动态校验和负载均衡

**2️⃣ 任务复杂度量化（Impact: 高，难度：中）**
- 当前：复杂度是二元的（简单/复杂），无法精细决策
- 改进：0-100 分的复杂度评分，与 level（0/1/2）挂钩

**3️⃣ 学习闭环应用（Impact: 高，难度：高）**
- 当前：学习被记录，但不改变路由决策
- 改进：成功的历史经验自动反馈到决策规则，形成正反馈循环

