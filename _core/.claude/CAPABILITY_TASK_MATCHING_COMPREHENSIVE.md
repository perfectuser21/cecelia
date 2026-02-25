# Cecelia Core - 能力-任务匹配系统完整分析

**分析日期**: 2026-02-18  
**代码版本**: cp-02182200-dispatch-stats  
**Brain 版本**: 1.50.0  
**Schema 版本**: 038  

---

## 第一部分：当前实现概览

### 1.1 核心映射关系

#### Task Type → Location → Skill → Agent

```
┌─────────────────┬──────────┬─────────────────┬──────────┬──────────────────┐
│ Task Type       │ Location │ Skill           │ Model    │ Permissions      │
├─────────────────┼──────────┼─────────────────┼──────────┼──────────────────┤
│ dev             │ US       │ /dev            │ Opus     │ bypassPermissions│
│ review          │ US       │ /review         │ Sonnet   │ plan (readonly)  │
│ qa_init         │ US       │ /review init    │ Sonnet   │ plan             │
│ audit           │ US       │ /review         │ Sonnet   │ plan             │
│ exploratory     │ US       │ /exploratory    │ Opus     │ bypassPermissions│
│ talk            │ HK       │ /talk (MiniMax) │ MiniMax  │ bypassPermissions│
│ research        │ HK       │ /talk (MiniMax) │ MiniMax  │ bypassPermissions│
│ data            │ HK       │ N8N             │ N8N      │ -                │
└─────────────────┴──────────┴─────────────────┴──────────┴──────────────────┘
```

### 1.2 关键代码位置速览

| 功能 | 文件 | 行号 | 函数/配置 |
|------|------|------|----------|
| **位置路由** | task-router.js | 44-53 | LOCATION_MAP |
| **Task Type 验证** | task-router.js | 163-165 | isValidTaskType() |
| **Skill 映射** | executor.js | 656-669 | getSkillForTaskType() |
| **权限模式** | executor.js | 690-704 | getPermissionModeForTaskType() |
| **Prompt 生成** | executor.js | 711-946 | preparePrompt() |
| **KR 评分** | planner.js | 45-78 | scoreKRs() |
| **任务规划** | planner.js | 140-159 | generateNextTask() |
| **快速路由** | thalamus.js | 490-600 | quickRoute() |
| **Action 白名单** | thalamus.js | 142-187 | ACTION_WHITELIST |
| **Skill Override** | executor.js | 711-715 | preparePrompt() 中的覆盖逻辑 |

---

## 第二部分：当前匹配逻辑解析

### 2.1 Task Type 识别流程

```
用户输入 / API 请求
    ↓
task_type 字段 (已定义)
    ↓
task-router.js:
  ├─ identifyWorkType() - 通过文本模式识别 'single' / 'feature' / 'ask_autumnrice'
  ├─ getTaskLocation() - 从 LOCATION_MAP 查询位置 (US/HK)
  └─ routeTaskCreate() - 整合路由决策
    ↓
executor.js:
  ├─ getSkillForTaskType() - task_type → skill 映射
  ├─ getPermissionModeForTaskType() - task_type → 权限模式
  └─ preparePrompt() - 生成完整 prompt (支持 skill_override)
    ↓
Executor Dispatch
  ├─ triggerCeceliaRun() - US region 派发 (cecelia-bridge)
  └─ triggerMiniMaxExecutor() - HK region 派发 (MiniMax)
```

### 2.2 核心配置：LOCATION_MAP (task-router.js 第 44-53 行)

```javascript
const LOCATION_MAP = {
  'dev': 'us',        // 写代码 → US (Nobel + Opus + /dev)
  'review': 'us',     // 代码审查 → US (Sonnet + /review)
  'qa': 'us',         // QA → US (Sonnet)
  'audit': 'us',      // 审计 → US (Sonnet)
  'exploratory': 'us', // 探索性验证 → US (Opus + /exploratory)
  'talk': 'hk',       // 对话 → HK (MiniMax)
  'research': 'hk',   // 调研 → HK (MiniMax)
  'data': 'hk',       // 数据处理 → HK (N8N)
};
```

**核心特性**：
- 硬编码映射，支持 US/HK 双区域
- 用于决定执行环境（executor bridge vs MiniMax）
- 不支持动态更新或优先级调整

### 2.3 Skill 映射 (executor.js 第 656-669 行)

```javascript
function getSkillForTaskType(taskType) {
  const skillMap = {
    'dev': '/dev',           // Caramel - 写代码
    'review': '/review',     // 代码审查 (Sonnet, Plan Mode)
    'qa_init': '/review init', // QA 初始化
    'exploratory': '/exploratory', // Opus 探索
    'talk': '/talk',         // MiniMax 对话
    'research': null,        // 完全只读
    'qa': '/review',         // 兼容性
    'audit': '/review',      // 兼容性
  };
  return skillMap[taskType] || '/dev';
}
```

**核心特性**：
- 1:1 或 1:N 映射（某些 task_type 共享 skill）
- 回退默认值 `/dev`
- 兼容旧类型 (qa/audit → /review)

### 2.4 权限模式 (executor.js 第 690-704 行)

```javascript
function getPermissionModeForTaskType(taskType) {
  const modeMap = {
    'dev': 'bypassPermissions',        // 完全权限
    'review': 'plan',                  // 只读 (Plan Mode)
    'exploratory': 'bypassPermissions', // 完全权限
    'talk': 'bypassPermissions',       // 可调 API
    'research': 'bypassPermissions',   // 可读/调 API
    'qa': 'plan',
    'audit': 'plan',
  };
  return modeMap[taskType] || 'bypassPermissions';
}
```

**核心特性**：
- `bypassPermissions`: 可修改文件、执行 Bash、调 API
- `plan`: 只读代码，不能修改任何文件

### 2.5 Prompt 生成 (executor.js 第 711-946 行)

```javascript
function preparePrompt(task) {
  const taskType = task.task_type || 'dev';
  const skill = task.payload?.skill_override ?? getSkillForTaskType(taskType);
  
  // 特殊处理：OKR 拆解
  const decomposition = task.payload?.decomposition;
  if (decomposition === 'true' || decomposition === 'continue') {
    return `/okr\n\n...`;
  }
  
  // 特殊处理：Talk 任务
  if (taskType === 'talk') {
    return `请完成以下任务，你可以创建/编辑 markdown 文档，但不能修改代码...`;
  }
  
  // 特殊处理：Review 任务
  if (taskType === 'review' || taskType === 'qa' || taskType === 'audit') {
    return `/review\n\n# 代码审查任务...`;
  }
  
  // 特殊处理：Research 任务
  if (taskType === 'research') {
    return `请调研以下内容，只读取和分析，不要修改任何文件...`;
  }
  
  // 通用处理：拼接 skill + PRD
  if (task.prd_content) {
    return `${skill}\n\n${task.prd_content}`;
  }
  
  // 自动生成 PRD
  const prd = `# PRD - ${task.title}\n...`;
  return `${skill}\n\n${prd}`;
}
```

**核心特性**：
- **Skill Override** (第 713 行): `task.payload?.skill_override` 优先于默认映射
- 任务类型特化处理（OKR/Talk/Review 有特殊 template）
- 自动 PRD 生成

### 2.6 派发流程 (executor.js 第 1045-1207 行)

```
triggerCeceliaRun(task)
    ↓
1. 检查位置 (getTaskLocation) → HK 走 MiniMax，US 走 cecelia-bridge
2. 生成 run_id (generateRunId)
3. 检查去重 (activeProcesses) - 防止重复派发
4. 检查资源 (checkServerResources) - CPU/内存/swap
5. 解析 repo_path (resolveRepoPath) - 支持嵌套项目
6. 准备 prompt (preparePrompt) - 包含权限模式和模型选择
7. 调用 executor bridge (HTTP POST /trigger-cecelia)
8. 注册进程 (activeProcesses.set)
9. 记录 trace (记录执行链路)
10. 返回派发结果
```

---

## 第三部分：识别的优化机会 (5 个关键痛点)

### 痛点 1: 硬编码 LOCATION_MAP 缺乏灵活性

**问题描述**:
- 新增 task_type 需要修改 4 处地方 (task-router.js + executor.js 3 处)
- LOCATION_MAP 是硬编码的全局常量，无法动态调整
- 无法支持：
  - 条件路由 (基于优先级、时间、资源)
  - A/B 测试 (如 50% 流量去 MiniMax, 50% 去 Claude)
  - 热更新 (无需重启 Brain)

**当前实现**:
```javascript
// task-router.js 第 44-53 行（硬编码）
const LOCATION_MAP = {
  'dev': 'us',
  'review': 'us',
  // ...
};

// 无法实现的场景：
// 1. PUT /api/brain/config/location-map - 热更新
// 2. 条件路由: if (task.priority === 'P0') return 'us'; else return 'hk';
// 3. 加权路由: 70% US + 30% HK
```

**优化建议**:
- [ ] 将 LOCATION_MAP 迁移到数据库（新表 `task_routing_config`）
- [ ] 提供 API 端点热更新路由规则
- [ ] 支持条件表达式 (e.g., `priority > P0 ? us : hk`)
- [ ] 实现路由策略版本控制（便于回滚）

**影响范围**: task-router.js, executor.js, routes.js

---

### 痛点 2: Task Type 枚举无约束

**问题描述**:
- 无集中的 task_type 定义（分散在多个文件中）
- 无编译时/运行时验证
- 客户端可能创建未定义的 task_type，导致派发失败

**当前实现**:
```javascript
// 定义地点 1: task-router.js (LOCATION_MAP)
// 定义地点 2: executor.js (getSkillForTaskType)
// 定义地点 3: executor.js (getPermissionModeForTaskType)
// 定义地点 4: tick.js (TASK_TYPE_AGENT_MAP)
// 定义地点 5: 隐式（通过 SQL 查询）

// 无定义的类型照样可以创建：
await pool.query(
  'INSERT INTO tasks (task_type) VALUES ($1)',
  ['unknown_type'] // ❌ 无验证
);
```

**验证 API**:
```javascript
// isValidTaskType 存在但未被广泛使用
function isValidTaskType(taskType) {
  const validTypes = ['dev', 'review', 'talk', 'data', 'qa', 'audit', 'research', 'exploratory'];
  return validTypes.includes(taskType?.toLowerCase());
}
```

**优化建议**:
- [ ] 创建 `TaskTypeRegistry` 或 `CapabilityRegistry` 集中定义
- [ ] API 端点创建任务时强制验证
- [ ] 数据库 constraint (ENUM 类型或 CHECK)
- [ ] 提供 GET /api/brain/task-types 端点查询有效类型
- [ ] 自动生成 TypeScript 类型定义

**影响范围**: routes.js (创建任务), task-router.js, executor.js

---

### 痛点 3: 能力与 Task Type 耦合度高，不支持动态匹配

**问题描述**:
- 当前模型：1 个 task_type → 1 个固定 skill / location
- 无法支持：多能力选择、能力备选方案、动态能力匹配
- 例如：某个"代码审查"任务，优先派给审查员，如果超时则派给 Opus /exploratory

**当前实现**:
```javascript
// 硬编码 1:1 映射
const skillMap = {
  'review': '/review',  // 总是用 /review，无备选
  'talk': '/talk',      // 总是用 /talk (MiniMax)
};

// 无条件选择机制
function getSkillForTaskType(taskType) {
  return skillMap[taskType] || '/dev'; // 单一回退
}
```

**无法实现的场景**:
```javascript
// 场景 1: 多能力选择
if (task.priority === 'P0') {
  skill = '/dev';  // Opus 高精度
} else {
  skill = '/exploratory';  // Sonnet 降成本
}

// 场景 2: 能力备选链 (fallback chain)
capabilities = ['specialist-review', 'general-review', 'sonnet-review'];
for (const cap of capabilities) {
  if (isAvailable(cap)) {
    skill = cap;
    break;
  }
}

// 场景 3: 基于能力约束的任务过滤
// 查询"有代码审查能力的 Agent"
const agents = await getAgentsByCapabilities(['code-review', 'design-review']);
```

**优化建议**:
- [ ] 创建 Capability Registry (DB 表)：
  ```sql
  CREATE TABLE capabilities (
    id UUID PRIMARY KEY,
    name VARCHAR, -- 'code-review', 'design-review', 'deployment'
    skill VARCHAR, -- '/review', '/review init'
    required_permissions VARCHAR[],
    quality_score FLOAT,
    availability FLOAT,
  );
  ```
- [ ] 实现 capability-based routing:
  ```javascript
  async function selectCapability(task) {
    const requiredCaps = task.payload?.required_capabilities || [];
    const candidates = await getCandidateCapabilities(requiredCaps, task);
    return selectBestCapability(candidates); // 基于可用性、质量等
  }
  ```
- [ ] 支持 Capability Fallback Chain
- [ ] 能力学习反馈 (tracking quality_score)

**影响范围**: executor.js, routes.js, database schema

---

### 痛点 4: Skill Override 机制过于简单，无审计/学习闭环

**问题描述**:
- 当前 `task.payload.skill_override` 允许任意覆盖，无约束
- 无法追踪覆盖原因、效果、成功率
- 无学习闭环：不知道某个覆盖是否成功，无法优化决策

**当前实现**:
```javascript
// executor.js 第 711-715 行
function preparePrompt(task) {
  const taskType = task.task_type || 'dev';
  const skill = task.payload?.skill_override ?? getSkillForTaskType(taskType);
  
  // ❌ 问题：直接用，无审计/学习
  if (task.prd_content) {
    return `${skill}\n\n${task.prd_content}`;
  }
}

// 使用示例：
await pool.query(
  'INSERT INTO tasks (payload) VALUES ($1)',
  [JSON.stringify({
    skill_override: '/custom-skill'  // ❌ 无审计，无验证
  })]
);
```

**无法实现的场景**:
```javascript
// 场景 1: 审计 override 原因
{
  "skill_override": "/custom-skill",
  "skill_override_reason": "User requested",  // ❌ 目前无法追踪
  "skill_override_approved_by": "user-123"    // ❌ 无权限控制
}

// 场景 2: 学习 override 效果
// 对比：默认 skill vs override skill 的成功率
SELECT
  skill_override,
  COUNT(*) as count,
  SUM(CASE WHEN status='completed' THEN 1 END) / COUNT(*) as success_rate
FROM tasks
WHERE payload->>'skill_override' IS NOT NULL
GROUP BY skill_override;

// 场景 3: 自适应路由
// 根据历史覆盖效果，自动优化路由
const historicalSuccess = await getSkillSuccessRate(skillOverride);
if (historicalSuccess > 0.95) {
  // 自动升级：下次默认用这个 skill
  await updateDefaultSkillForTaskType(taskType, skillOverride);
}
```

**优化建议**:
- [ ] 添加 skill_override 元数据：
  ```javascript
  {
    skill_override: '/custom-skill',
    skill_override_metadata: {
      reason: 'user_request | fallback | cost_optimization',
      approved_by: 'user-id | system',
      confidence: 0.8,
      applied_at: ISO8601
    }
  }
  ```
- [ ] 实现 skill override 审计日志 (新表 `skill_overrides`)
- [ ] 自动成功率追踪与报告
- [ ] 基于历史效果的自适应学习

**影响范围**: executor.js, task-updater.js, routes.js, database schema

---

### 痛点 5: 派发决策缺少观测和优化反馈

**问题描述**:
- 派发流程（dispatch.js / executor.js）没有：
  - 完整的决策日志 (为什么选了这个 skill/location?)
  - 性能度量 (派发成功率、平均响应时间、模型成本)
  - 优化建议 (基于数据的算法改进)
- 无法答复：
  - "为什么这个任务派给了 MiniMax?"
  - "dev task 的平均成功率是多少?"
  - "某个 skill 的成本是多少?"

**当前实现**:
```javascript
// executor.js 第 1045-1207 行
async function triggerCeceliaRun(task) {
  const location = getTaskLocation(task.task_type);  // ❌ 无日志为什么选了 US/HK
  const skill = getSkillForTaskType(task.task_type);  // ❌ 无日志为什么选了 /dev
  const mode = getPermissionModeForTaskType(task.task_type); // ❌ 无日志为什么选了 plan
  
  // 派发后也无完整记录
  return {
    success: true,
    taskId: task.id,
    checkpointId,
  };
}

// 结果：无法追踪派发决策的演化
```

**无法实现的场景**:
```javascript
// 场景 1: 派发决策解释
{
  task_id: 'task-123',
  dispatch_decision: {
    task_type: 'dev',
    location: 'us',  // 为什么？
    location_reason: 'hardcoded_mapping',
    skill: '/dev',   // 为什么？
    skill_reason: 'task_type_mapping',
    permission_mode: 'bypassPermissions',  // 为什么？
    timestamp: ISO8601,
    decision_version: 'v1.0',
  }
}

// 场景 2: 派发成功率统计
SELECT
  task_type,
  location,
  COUNT(*) as dispatched,
  SUM(CASE WHEN status='completed' THEN 1 END) / COUNT(*) as success_rate,
  AVG(EXTRACT(EPOCH FROM (updated_at - started_at))) as avg_duration_sec
FROM dispatch_log
GROUP BY task_type, location
ORDER BY success_rate DESC;

// 场景 3: 成本对比
SELECT
  task_type,
  skill,
  COUNT(*) as count,
  AVG(token_usage) as avg_tokens,
  SUM(token_usage) * cost_per_token as total_cost
FROM dispatch_log
GROUP BY task_type, skill
ORDER BY total_cost DESC;

// 场景 4: 性能分析 & 优化建议
// 如果 /dev 成功率 98%，/exploratory 仅 72%
// 系统自动建议：dev 任务的备选方案应该是 /dev，不是 /exploratory
```

**当前进度**:
- `dispatch-stats.js` (新文件) 已开始实现派发统计
- 已有 1 小时滚动窗口统计成功率
- 缺少：决策日志、成本追踪、自动优化建议

**优化建议**:
- [ ] 完整派发决策日志表：
  ```sql
  CREATE TABLE dispatch_decisions (
    id UUID PRIMARY KEY,
    task_id UUID,
    decision_timestamp TIMESTAMP,
    task_type VARCHAR,
    selected_location VARCHAR,
    location_reason VARCHAR,
    selected_skill VARCHAR,
    skill_reason VARCHAR,
    permission_mode VARCHAR,
    estimated_tokens INT,
    selected_model VARCHAR,
    confidence FLOAT,
    ...
  );
  ```
- [ ] 派发后追踪实际结果：
  ```sql
  CREATE TABLE dispatch_outcomes (
    dispatch_id UUID,
    status VARCHAR, -- 'success' | 'failure' | 'timeout'
    actual_tokens INT,
    actual_cost FLOAT,
    duration_ms INT,
    outcome_timestamp TIMESTAMP,
    failure_reason VARCHAR,
  );
  ```
- [ ] 自动生成优化报告 (每小时/每天)
- [ ] 实现 A/B 测试框架 (用于新路由算法验证)

**影响范围**: 新增 dispatch-stats.js 扩展, executor.js, routes.js

---

## 第四部分：能力-任务匹配算法总结

### 4.1 当前算法流程

```
Task Creation
    ↓
task_type 验证 (isValidTaskType)
    ↓
Location Routing (getTaskLocation)
    ├─ LOCATION_MAP[task_type] 查表
    └─ 默认值: 'us'
    ↓
Skill Selection (getSkillForTaskType)
    ├─ payload.skill_override 检查 (优先)
    ├─ skillMap[task_type] 查表
    └─ 默认值: '/dev'
    ↓
Permission Mode (getPermissionModeForTaskType)
    ├─ modeMap[task_type] 查表
    └─ 默认值: 'bypassPermissions'
    ↓
Resource Check (checkServerResources)
    ├─ CPU Load < threshold
    ├─ Memory > minimum
    ├─ Swap < max%
    └─ Billing pause 未激活
    ↓
Dedup Check (activeProcesses)
    └─ 防止任务重复派发
    ↓
Dispatch (triggerCeceliaRun / triggerMiniMaxExecutor)
    ├─ US: cecelia-bridge → claude -p /skill
    └─ HK: MiniMax HTTP API
    ↓
Process Registration (activeProcesses.set)
    ↓
Trace Logging
```

### 4.2 匹配规则的静态性

**当前约束**:
1. **LOCATION_MAP 硬编码** - 无法热更新
2. **Skill 映射 1:1** - 无备选方案
3. **权限模式固定** - task_type 决定
4. **无条件路由** - 不考虑优先级、时间、资源等
5. **无多能力约束** - 不支持"需要代码审查和设计审查能力"

**结果**:
- 新增 task_type → 需要修改代码 + 重启 Brain
- 无法灰度发布新路由策略
- 无法根据实时负载调整

---

## 第五部分：与其他系统的关系

### 5.1 Thalamus 快速路由 (thalamus.js 第 490-600 行)

```javascript
function quickRoute(event) {
  // Level 0: 纯代码规则（0成本）
  if (event.type === 'heartbeat') return { level: 0, action: 'skip' };
  if (event.type === 'task_completed') return { level: 0, action: 'update_task' };
  
  // Level 1: LLM 路由 (Sonnet, ~$0.003/call)
  if (event.type === 'task_failed') return { level: 1, action: 'analyze_event' };
}
```

**关系**:
- Thalamus 路由的是 **event**，不是 **task**
- Task 的能力匹配是派发时 (executor.js)
- Thalamus 的决策可能触发新任务创建，再调用 task 匹配

---

### 5.2 Planner KR 评分 (planner.js 第 45-78 行)

```javascript
function scoreKRs(state) {
  const scored = keyResults.map(kr => {
    let score = 0;
    if (focusKRIds.has(kr.id)) score += 100;      // 焦点 KR
    if (kr.priority === 'P0') score += 30;        // 优先级
    score += (100 - kr.progress) * 0.2;           // 进度缺口
    if (daysLeft < 7) score += 20;               // 截止期迫近
    return { kr, score };
  });
  return scored.sort((a, b) => b.score - a.score);
}
```

**关系**:
- Planner 选择 **下一个 KR**（下一个"大任务单位"）
- Task 匹配则选择**如何执行这个任务**（用哪个 skill/location）
- 两者独立但顺序执行

---

### 5.3 Learnings 记忆系统 (learning.js)

```javascript
function searchRelevantLearnings(taskType, failureClass) {
  // Task type 精确匹配 (权重 10)
  // Failure class 子字符串匹配 (权重 8)
  // ...
  // 返回相关的历史决策
}
```

**关系**:
- Learnings 记录**过去派发决策的结果**
- 当前算法不用 learnings，但可以优化（见痛点 5）
- 例如："dev 任务 90% 成功，exploratory 仅 70% → 优化默认选择"

---

## 第六部分：总结与建议优先级

### 6.1 5 个痛点的影响范围矩阵

```
┌────────┬──────────┬──────────┬──────────┬──────────┬─────────────┐
│ 痛点   │ 优先级   │ 工作量   │ 用户痛点 │ 代码复杂 │ 回报指数    │
├────────┼──────────┼──────────┼──────────┼──────────┼─────────────┤
│ 痛点 1 │ P1 (中) │ 2-3 天   │ 高       │ 中       │ 8/10        │
│ 痛点 2 │ P1 (中) │ 1-2 天   │ 中       │ 低       │ 7/10        │
│ 痛点 3 │ P2 (低) │ 1-2 周   │ 中       │ 高       │ 6/10        │
│ 痛点 4 │ P1 (中) │ 2-3 天   │ 中       │ 中       │ 7/10        │
│ 痛点 5 │ P0 (高) │ 3-5 天   │ 高       │ 中       │ 9/10        │
└────────┴──────────┴──────────┴──────────┴──────────┴─────────────┘
```

### 6.2 分阶段改进方案

#### 快速修复 (1-2 周，P0 + P1)

**第 1 周**:
- [ ] 痛点 2: 强制 task_type 验证 + ENUM 约束
- [ ] 痛点 5: 完整派发决策日志（已有骨架，需完成）

**第 2 周**:
- [ ] 痛点 1: LOCATION_MAP 迁移到 DB（基础版）
- [ ] 痛点 4: skill_override 审计日志

#### 中期优化 (3-4 周，P2)

- [ ] 痛点 3: Capability Registry 架构设计 + 原型
- [ ] 能力约束验证 (ensure task <= agent 能力集合)
- [ ] Fallback chain 支持

#### 长期进化 (1-2 月，P3)

- [ ] 基于 learnings 的自适应路由
- [ ] 向量相似度匹配 (semantic capability matching)
- [ ] 多模型成本优化器

### 6.3 核心文件改动清单

```
优先级修改:
├── task-router.js
│   └─ 新增: 集中定义所有有效 task_types
├── executor.js
│   ├─ getSkillForTaskType() - 改进注释、支持 default fallback
│   ├─ preparePrompt() - 完整决策日志
│   └─ triggerCeceliaRun() - 添加 dispatch decision 记录
├── routes.js
│   ├─ POST /create-task - 强制 task_type 验证
│   ├─ GET /task-types - 新端点列出有效类型
│   └─ GET /dispatch-decisions/{taskId} - 查询派发决策
├── database migrations
│   ├─ task_routing_config 表（若实现痛点 1）
│   ├─ dispatch_decisions 表（若实现痛点 5）
│   └─ capability_registry 表（若实现痛点 3）
└── dispatch-stats.js
    └─ 扩展为完整的派发分析系统
```

---

## 结语

Cecelia Core 的能力-任务匹配系统是 **决定论的、可追踪的、但缺乏灵活性的**。

- ✅ 优点：简单可靠，易于理解，无歧义
- ❌ 痛点：硬编码多，无热更新，缺少优化反馈

**改进方向**：从 **硬编码枚举** → **数据驱动策略** → **学习闭环优化**

---

**版本**: 1.0  
**最后更新**: 2026-02-18  
**相关文件**: 
- CAPABILITY_TASK_MATCHING_ANALYSIS.md (详细分析)
- CAPABILITY_TASK_MATCHING_QUICK_REFERENCE.md (速查表)
- DEEP_ANALYSIS_TASK_ROUTER.md (task-router.js 深度分析)
