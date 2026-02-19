# Cecelia Core: 能力-任务匹配体系分析

**分析日期**: 2026-02-18  
**工作目录**: /home/xx/perfect21/cecelia/core  
**分支**: cp-02182200-dispatch-stats  

---

## 执行摘要

Cecelia Core 的能力-任务匹配包含两个层面：

1. **简单层面（生产中）**：基于 `task_type` 的静态映射（任务类型 → Skill 命令 → 执行位置）
2. **高级层面（开发中）**：基于向量相似度的语义匹配（任务描述 → 能力向量 → 最佳匹配）

**现状**：系统按照 `task_type` 进行确定性路由，没有实现完整的能力学习机制。

---

## 第一部分：任务路由体系（生产）

### 1.1 关键文件地图

| 文件 | 行数 | 职责 | 关键函数 |
|------|------|------|---------|
| **task-router.js** | 212 | 任务类型识别 + 地理位置路由 | `identifyWorkType()`, `getTaskLocation()`, `routeTaskCreate()` |
| **executor.js** | 1000+ | 派发执行 + 权限映射 | `getSkillForTaskType()`, `getPermissionModeForTaskType()`, `preparePrompt()` |
| **tick.js** | 1500+ | 任务调度循环 | `routeTask()`, `TASK_TYPE_AGENT_MAP` |
| **routes.js** | 4500+ | HTTP API 端点 | 能力 API、任务创建/查询、LOCATION_MAP 导出 |
| **planner.js** | 300+ | KR 轮转和任务生成 | `scoreKRs()`, `selectTargetKR()`, `generateNextTask()` |
| **intent.js** | 600+ | 意图识别（基于关键词） | `parseIntent()`, `classifyIntent()`, INTENT_PHRASES |

### 1.2 Task Type 到 Skill 的映射

**关键常量**：`LOCATION_MAP` 和 `skillMap`

#### executor.js (Lines 656-668)
```javascript
function getSkillForTaskType(taskType) {
  const skillMap = {
    'dev': '/dev',           // 写代码：Opus
    'review': '/review',     // 审查：Sonnet，Plan Mode
    'qa_init': '/review init', // QA 初始化
    'exploratory': '/exploratory', // 探索性验证：Opus
    'talk': '/talk',         // 对话：写文档
    'research': null,        // 研究：完全只读
    // 兼容旧类型
    'qa': '/review',
    'audit': '/review',
  };
  return skillMap[taskType] || '/dev';
}
```

#### task-router.js (Lines 44-53)
```javascript
const LOCATION_MAP = {
  'dev': 'us',        // US (Nobel + Opus + /dev)
  'review': 'us',     // US (Sonnet + /review)
  'qa': 'us',         // US (Sonnet)
  'audit': 'us',      // US (Sonnet)
  'exploratory': 'us', // US (Opus + /exploratory)
  'talk': 'hk',       // HK (MiniMax)
  'research': 'hk',   // HK (MiniMax)
  'data': 'hk',       // HK (N8N)
};
```

#### tick.js (Lines 36-42)
```javascript
const TASK_TYPE_AGENT_MAP = {
  'dev': '/dev',           // Caramel - 编程
  'talk': '/talk',         // 对话任务 → HK MiniMax
  'qa': '/qa',             // 小检 - QA
  'audit': '/audit',       // 小审 - 审计
  'research': null         // 需要人工/Opus 处理
};
```

### 1.3 权限模型映射

#### executor.js (Lines 690-704)
```javascript
function getPermissionModeForTaskType(taskType) {
  const modeMap = {
    'dev': 'bypassPermissions',        // 写代码
    'review': 'plan',                  // 只读分析（唯一用 plan 的）
    'exploratory': 'bypassPermissions', // 探索性验证
    'talk': 'bypassPermissions',       // 要调 API 写数据库
    'research': 'bypassPermissions',   // 要调 API
    // 兼容旧类型
    'qa': 'plan',
    'audit': 'plan',
  };
  return modeMap[taskType] || 'bypassPermissions';
}
```

**权限含义**：
- `bypassPermissions`：完全权限（读写文件、执行 Bash、调 API）
- `plan`：只读模式（不能修改文件、不能执行 Bash）

### 1.4 Prompt 生成逻辑

#### executor.js (Lines 711-945)

1. **检查 skill_override**（Line 713）
   ```javascript
   const skill = task.payload?.skill_override ?? getSkillForTaskType(taskType);
   ```
   优先级：`skill_override` > `getSkillForTaskType()`

2. **OKR 拆解任务特殊处理**（Lines 717-763）
   - `task.payload.decomposition === 'true'` → 首次拆解
   - `task.payload.decomposition === 'continue'` → 继续拆解
   - 自动调用 `/okr` skill + Opus

3. **Prompt 模板组装**（Lines 922-945）
   ```javascript
   return `${skill}\n\n${task.prd_content}`;
   ```

### 1.5 任务类型识别

#### task-router.js (Lines 10-86)

**单任务 vs 功能识别**：

```javascript
const SINGLE_TASK_PATTERNS = [
  /修复/i, /fix/i, /改一下/i, /加个/i, /删掉/i, 
  /更新/i, /调整/i, /修改/i, /bugfix/i, ...
];

const FEATURE_PATTERNS = [
  /实现/i, /做一个/i, /新功能/i, /系统/i, 
  /模块/i, /重构/i, /implement/i, /feature/i, ...
];
```

**行为**：
- 匹配单任务模式 → `'single'`
- 匹配功能模式 → `'feature'`
- 都不匹配 → `'ask_autumnrice'`（交由秋米（OKR 专家）决定）

---

## 第二部分：向量相似度匹配体系（开发中）

### 2.1 向量嵌入基础设施

#### generate-capability-embeddings.mjs
- **功能**：为 capabilities 表中的每个能力生成 OpenAI embeddings
- **模型**：`text-embedding-3-small`
- **输入**：`capability.name + capability.description`
- **输出**：1536 维向量，存储在 `capabilities.embedding` (pgvector)

#### embedding-service.js (Line 19-33)
- **功能**：为任务生成异步向量嵌入
- **特性**：Fire-and-forget（不阻塞主流程）
- **失败处理**：静默失败，不影响任务生命周期

```javascript
export async function generateTaskEmbeddingAsync(taskId, title, description) {
  if (!process.env.OPENAI_API_KEY) return;
  try {
    const text = [title, description || ''].join('\n\n').substring(0, 4000);
    const embedding = await generateEmbedding(text);
    await pool.query(
      `UPDATE tasks SET embedding = $1::vector WHERE id = $2`,
      [embStr, taskId]
    );
  } catch (_err) {
    // 静默失败 — 不影响主流程
  }
}
```

### 2.2 相似度搜索

#### similarity.js (Lines 1-200)

**混合相似度算法**：
- 70% 向量相似度（pgvector + cosine）
- 30% Jaccard 相似度（token 交集/并集）

```javascript
async searchSimilar(query, topK = 5, filters = {}) {
  // 1. Query all active entities
  const entities = await this.getAllActiveEntities(filters);
  
  // 2. Calculate similarity scores
  const scored = entities.map(entity => ({
    ...entity,
    score: this.calculateScore(query, entity)
  }));
  
  // 3. Sort and take top K
  const topMatches = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .filter(m => m.score > 0.3);  // 过滤低分匹配
    
  return { matches: topMatches };
}
```

### 2.3 能力模型

**能力表结构** (capabilities 表)：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 能力唯一标识 |
| `name` | text | 能力名称 |
| `description` | text | 能力描述 |
| `current_stage` | int | 成熟度阶段（0-5） |
| `embedding` | pgvector | 向量表示 |
| `related_repos` | jsonb | 关联仓库列表 |
| `related_skills` | jsonb | 关联 Skills 列表 |
| `key_tables` | jsonb | 关键数据表 |
| `evidence` | text | 能力验证证据 |
| `owner` | text | 能力所有者 |
| `created_at` | timestamp | 创建时间 |
| `updated_at` | timestamp | 更新时间 |

**成熟度阶段**（Stage）：
- 0: Prototype（原型）
- 1: Alpha（内测）
- 2: Beta（公测）
- 3: Production（生产）
- 4: Mature（成熟）
- 5: Deprecated（废弃）

---

## 第三部分：现有匹配算法的工作方式

### 3.1 端到端派发流程

```
tick.js::executeTick()
  ↓
planner.js::planNextTask()
  ├─ selectTargetKR()  → 根据 focus + priority + progress 评分选 KR
  ├─ selectTargetProject()  → 根据 queued 任务数选 Project
  └─ generateNextTask()  → 返回 queued 任务或自动生成新任务
  ↓
executor.js::triggerCeceliaRun(task)
  ├─ checkServerResources()  → 检查 CPU/Memory/Swap 是否有名额
  ├─ getTaskLocation(taskType)  → 根据 task_type 选择 US 或 HK
  ├─ getSkillForTaskType(taskType)  → 选择 skill 命令
  ├─ getPermissionModeForTaskType(taskType)  → 选择权限模式
  ├─ preparePrompt(task)  → 组装 prompt（skill + PRD）
  └─ spawn('claude -p "...prompt..."')  → 启动无头进程
  ↓
Agent Worker (Caramel/小检/MiniMax/...)
  ↓
execution-callback (POST /api/brain/execution-callback)
  └─ updateTaskStatus()  → 更新 task.status
```

### 3.2 KR 轮转评分算法

#### planner.js (Lines 45-78)

```javascript
function scoreKRs(state) {
  const scored = keyResults.map(kr => {
    let score = 0;
    // 焦点倍增（+100）
    if (focusKRIds.has(kr.id)) score += 100;
    // 优先级倍增（+30/20/10）
    if (kr.priority === 'P0') score += 30;
    else if (kr.priority === 'P1') score += 20;
    else if (kr.priority === 'P2') score += 10;
    // 进度压力（进度越低分数越高）
    score += (100 - (kr.progress || 0)) * 0.2;
    // 截止日期压力（< 7 天 +40）
    if (daysLeft > 0 && daysLeft < 14) score += 20;
    if (daysLeft > 0 && daysLeft < 7) score += 20;
    // 待办队列（有 queued 任务 +15）
    if (queuedByGoal[kr.id]) score += 15;
    return { kr, score };
  });
  
  scored.sort((a, b) => b.score - a.score);
  return scored;
}
```

**评分权重**：
1. **焦点倍增** (+100)：每日焦点中的 KR 优先度最高
2. **优先级** (+30/20/10)：P0 > P1 > P2
3. **进度压力** (×0.2)：进度越低分数越高
4. **截止日期压力** (+40)：< 7 天内的 KR 被加分
5. **待办队列** (+15)：已有 queued 任务的 KR 被加分

### 3.3 Intent 分类（自然语言理解）

#### intent.js (Lines 1-300)

**多阶段分类**：

1. **关键词匹配**（低精度）
   ```javascript
   const INTENT_KEYWORDS = {
     CREATE_PROJECT: ['做一个', '创建', '开发', '搭建', ...],
     FIX_BUG: ['修复', '解决', '问题', 'bug', ...],
     REFACTOR: ['重构', '优化', '改进', ...],
     ...
   };
   ```

2. **短语模式匹配**（高精度）
   ```javascript
   const INTENT_PHRASES = {
     CREATE_PROJECT: [
       { pattern: /我想做一个(.+)/, weight: 0.3 },
       { pattern: /帮我创建一个(.+)/, weight: 0.3 },
       { pattern: /开发一个(.+)系统/, weight: 0.3 },
       ...
     ],
     ...
   };
   ```

3. **置信度加权**
   ```javascript
   confidence = keyword_score + phrase_weight
   ```

**识别的意图类型**（intent.js Lines 19-30）：
- CREATE_PROJECT（创建项目）
- CREATE_FEATURE（新功能）
- CREATE_GOAL（创建目标）
- CREATE_TASK（创建任务）
- FIX_BUG（修复 Bug）
- REFACTOR（重构）
- EXPLORE（探索）
- QUESTION（提问）

---

## 第四部分：可优化的地方

### 4.1 静态 vs 动态匹配

**现状**：完全静态
- `task_type` 固定映射到 skill
- 没有学习机制
- 没有历史成功率反馈

**优化方向**：
1. **动态路由**：基于历史成功率动态选择 skill
2. **失败学习**：失败任务重新分类到不同 skill
3. **能力评估**：定期评估 skill 在特定领域的能力强度

### 4.2 能力-任务匹配缺陷

**现状**：
- `embedding` 表存在但没有被实际使用
- `capabilities` 表数据不完整
- 没有实现语义匹配到 task 的流程

**优化方向**：
1. **完整能力库**：补全 capabilities 表的数据
2. **向量搜索 API**：实现 `/api/brain/capabilities/search` 端点
3. **自动匹配**：创建任务时自动推荐最佳 skill

### 4.3 权限模型不完整

**现状**：
- 只有 `bypassPermissions` 和 `plan` 两种模式
- `plan` 模式对应 review 任务（只读）
- 没有中间等级（如"只读代码但可以生成报告"）

**优化方向**：
1. **细粒度权限**：READ_ONLY / READ_WRITE_TEMP / FULL_ACCESS
2. **资源限制**：根据权限级别限制 CPU/内存使用
3. **审计追踪**：记录每个 skill 的权限使用

### 4.4 地理位置路由过于简化

**现状**：
- US vs HK 二分法
- 基于 task_type 固定映射
- 没有考虑资源可用性或延迟

**优化方向**：
1. **动态位置选择**：检查两个 region 的资源可用性后再决定
2. **延迟优化**：根据 task 的时间敏感性选择位置
3. **容量感知**：如果 US 满载，自动 fallback 到 HK

### 4.5 意图识别的局限

**现状**：
- 基于关键词和正则模式
- 没有上下文理解
- 不确定时交由 "ask_autumnrice"（但实现不完整）

**优化方向**：
1. **上下文感知**：考虑前一个任务的状态
2. **多意图识别**：一个请求可能包含多个意图
3. **置信度分级**：不同置信度对应不同处理流程

### 4.6 模型成本优化

**现状**（executor.js Lines 679-683）：
```javascript
function getModelForTask(task) {
  // 成本优化：全部使用 Sonnet
  // 返回 null = cecelia-run 默认模型 (Sonnet)
  return null;
}
```

**优化方向**：
1. **任务复杂度评估**：复杂 task 用 Opus，简单用 Haiku
2. **重试策略**：失败时升级模型
3. **成本追踪**：按 task_type/skill 统计成本

---

## 第五部分：关键数据结构

### 5.1 Task 表核心字段

```sql
CREATE TABLE tasks (
  id UUID PRIMARY KEY,
  title TEXT,
  description TEXT,
  task_type VARCHAR(50),        -- 'dev', 'review', 'talk', 'data', etc.
  status VARCHAR(50),           -- 'queued', 'in_progress', 'completed', 'failed', 'quarantined'
  priority VARCHAR(10),         -- 'P0', 'P1', 'P2'
  project_id UUID,              -- 关联 Project/Initiative
  goal_id UUID,                 -- 关联 KR/Goal
  skill_override VARCHAR(100),  -- 可选：覆盖默认 skill 映射
  embedding VECTOR(1536),       -- 任务的向量表示（OpenAI embedding）
  prd_content TEXT,             -- 完整 PRD 文档
  payload JSONB,                -- 灵活数据
  -- payload 常见字段：
  -- {
  --   "decomposition": "true|continue",  -- OKR 拆解标记
  --   "skill_override": "/dev|/review", -- Skill 覆盖
  --   "previous_result": "...",         -- 继续拆解时的前一个结果
  --   "exploratory": true,              -- 探索型任务标记
  --   "initiative_id": "...",           -- 关联 Initiative
  -- }
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

### 5.2 Capabilities 表

```sql
CREATE TABLE capabilities (
  id UUID PRIMARY KEY,
  name TEXT,                    -- 能力名称
  description TEXT,             -- 能力描述
  current_stage INT,            -- 成熟度阶段 (0-5)
  embedding VECTOR(1536),       -- 能力的向量表示
  related_repos JSONB,          -- 关联仓库
  related_skills JSONB,         -- 关联 Skills
  key_tables JSONB,             -- 关键数据表
  evidence TEXT,                -- 验证证据
  owner TEXT,                   -- 能力所有者
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

### 5.3 Working Memory 表

```sql
CREATE TABLE working_memory (
  key TEXT PRIMARY KEY,
  value_json JSONB,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- 关键 key：
-- 'tick_enabled'  → { "enabled": true/false }
-- 'tick_last'     → { "timestamp": "ISO8601" }
-- 'daily_focus'   → { "focus": { "key_results": [...] } }
```

---

## 第六部分：API 端点

### 6.1 任务相关

| 端点 | 方法 | 职责 |
|------|------|------|
| `/api/brain/tasks` | GET | 查询任务（支持 task_type 过滤） |
| `/api/brain/action/create-task` | POST | 创建新任务 |
| `/api/brain/action/route-task` | POST | 获取任务路由建议 |
| `/api/brain/task/{id}` | GET | 查询单个任务 |

### 6.2 能力相关

| 端点 | 方法 | 职责 |
|------|------|------|
| `/api/brain/capabilities` | GET | 列出所有能力 |
| `/api/brain/capabilities/search` | POST | 搜索能力（向量） |
| `/capabilities` | POST | 创建能力（已批准的提案） |

### 6.3 状态查询

| 端点 | 方法 | 职责 |
|------|------|------|
| `/api/brain/status/full` | GET | 完整系统状态 |
| `/api/brain/status/routing` | GET | 路由信息（task_types, LOCATION_MAP） |

---

## 第七部分：配置参数

### 7.1 executor.js 中的关键常量

```javascript
// 资源配置
const CPU_CORES = os.cpus().length;
const TOTAL_MEM_MB = Math.round(os.totalmem() / 1024 / 1024);
const MEM_PER_TASK_MB = 500;                // 每个 claude 进程平均 500MB
const CPU_PER_TASK = 0.5;                   // 每个 claude 进程平均 0.5 核
const INTERACTIVE_RESERVE = 2;              // 为用户会话预留 2 个位置
const USABLE_MEM_MB = TOTAL_MEM_MB * 0.8;  // 使用 80% 内存（保留 20% 余量）
const USABLE_CPU = CPU_CORES * 0.8;        // 使用 80% CPU（保留 20% 余量）
const MAX_SEATS = Math.max(
  Math.floor(Math.min(USABLE_MEM_MB / MEM_PER_TASK_MB, USABLE_CPU / CPU_PER_TASK)), 2
);

// 派发阈值
const LOAD_THRESHOLD = CPU_CORES * 0.85 - RESERVE_CPU;
const MEM_AVAILABLE_MIN_MB = TOTAL_MEM_MB * 0.15 + RESERVE_MEM_MB;
const SWAP_USED_MAX_PCT = 70;
```

### 7.2 tick.js 中的关键常量

```javascript
const TICK_INTERVAL_MINUTES = 5;           // 正式 tick 每 5 分钟执行一次
const TICK_LOOP_INTERVAL_MS = 5000;        // 检查循环每 5 秒执行一次
const TICK_TIMEOUT_MS = 60 * 1000;         // 单次 tick 超时 60 秒
const STALE_THRESHOLD_HOURS = 24;          // in_progress 24h 后标记为 stale
const DISPATCH_TIMEOUT_MINUTES = 60;       // 派发后 60 分钟自动失败
const AUTO_EXECUTE_CONFIDENCE = 0.8;       // 置信度 >= 0.8 自动执行决策
```

---

## 第八部分：性能指标

### 8.1 dispatch-stats.js

追踪派发成功率（1 小时滚动窗口）：

```javascript
const DISPATCH_RATE_THRESHOLD = 0.7;      // 70% 成功率阈值
const DISPATCH_MIN_SAMPLE = 10;           // 最少 10 个样本
```

**使用场景**：
- 派发成功率 < 70% → 触发告警
- 用于 cortex.js 决策优化派发策略

### 8.2 观测指标

| 指标 | 位置 | 说明 |
|------|------|------|
| 派发成功率 | dispatch-stats.js | 1 小时滚动窗口 |
| 资源压力 | executor.js::checkServerResources() | CPU/Memory/Swap 压力 (0-1 scale) |
| Tick 时长 | alertness/metrics.js | 每次 tick 的执行时间 |
| 隔离区大小 | quarantine.js | 当前隔离的任务数 |
| 警觉等级 | alertness/index.js | READY/ALERT/CRITICAL |

---

## 第九部分：改进建议排序表

| 优先级 | 改进项 | 估算工作量 | 期望收益 |
|--------|--------|----------|---------|
| **P0** | 完整能力库 + 向量搜索 API | 3d | 支持语义任务分配 |
| **P0** | 派发成功率反馈循环 | 2d | 自动优化路由 |
| **P1** | 动态模型选择（Opus vs Sonnet vs Haiku） | 2d | 成本优化 40-60% |
| **P1** | 细粒度权限模型 | 3d | 安全性提升 |
| **P2** | 地理位置动态选择 | 1d | 延迟优化 + 容量利用 |
| **P2** | 上下文感知意图识别 | 2d | 意图准确率 +15-20% |

---

## 附录 A：快速查询

### 所有 task_type 值

生产中支持的 task_type：
```
'dev', 'review', 'qa', 'audit', 'exploratory', 'talk', 'research', 'data'
```

### 所有 Skill 命令

```
/dev          → 代码开发
/review       → 代码审查（计划模式）
/qa           → QA 测试
/audit        → 代码审计
/exploratory  → 探索性验证
/talk         → 文档对话
/okr          → OKR 拆解（特殊，由秋米使用）
```

### 位置（Region）

```
'us'  → 美国 VPS (Claude Code, Opus/Sonnet)
'hk'  → 香港 VPS (MiniMax, N8N)
```

---

## 附录 B：开发清单

实现完整的能力-任务匹配需要：

- [ ] 补全 capabilities 表的数据（至少 50 个能力）
- [ ] 实现向量搜索 API (`/api/brain/capabilities/search`)
- [ ] 添加派发成功率反馈到决策循环
- [ ] 实现动态模型选择函数
- [ ] 添加细粒度权限级别（READ_ONLY / READ_WRITE_TEMP / FULL_ACCESS）
- [ ] 实现地理位置的动态选择
- [ ] 补全意图识别的 "ask_autumnrice" 分支
- [ ] 添加成本追踪和优化建议

---

## 附录 C：关键文件行号速查

| 文件 | 关键行 | 功能 |
|------|--------|------|
| task-router.js | 44-53 | LOCATION_MAP 定义 |
| task-router.js | 93-100 | getTaskLocation() |
| executor.js | 656-668 | getSkillForTaskType() |
| executor.js | 690-704 | getPermissionModeForTaskType() |
| executor.js | 679-683 | getModelForTask()（当前全用 Sonnet） |
| executor.js | 711-945 | preparePrompt()（组装完整 prompt） |
| tick.js | 36-59 | routeTask() 和 TASK_TYPE_AGENT_MAP |
| planner.js | 45-78 | scoreKRs()（KR 评分算法） |
| intent.js | 19-300 | 意图分类系统 |
| similarity.js | 29-46 | searchSimilar()（向量搜索） |
| routes.js | 2485-2515 | `/api/brain/status/routing` 端点 |

