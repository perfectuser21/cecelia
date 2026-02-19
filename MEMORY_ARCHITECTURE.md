# Cecelia Core 记忆与决策系统架构探索报告

## 执行摘要

本报告对 Cecelia-Core 仓库的记忆（Memory）、决策（Decision）、以及三层大脑（脑干、丘脑、皮层）的记忆检索集成进行了深入探索。

**关键发现**：
- 记忆系统已有基础实现：`learning.js` + `similarity.js` + `routes/memory.js`
- 决策引擎已集成记忆检索：Thalamus (L1) 和 Cortex (L2) 都会在做决策前检索历史经验
- 数据库Schema已支持：`learnings` 表（记录学习）+ `cortex_analyses` 表（记录深度分析）
- 现有实现采用混合检索：关键字匹配 + 语义相关性评分

---

## 1. 文件结构与位置清单

### 1.1 核心记忆相关文件

```
/home/xx/perfect21/cecelia/core/brain/src/
├── services/
│   └── memory-service.js          # 记忆服务业务逻辑层
├── routes/
│   └── memory.js                  # Memory API 端点（3个 REST API）
├── learning.js                    # 学习闭环实现
├── similarity.js                  # 相似度计算（混合搜索）
├── embedding-service.js           # 向量嵌入服务
```

### 1.2 决策相关文件

```
/home/xx/perfect21/cecelia/core/brain/src/
├── thalamus.js                    # 丘脑（L1 决策）- Sonnet 模型
├── cortex.js                      # 皮层（L2 决策）- Opus 模型
├── decision.js                    # 决策对比分析
├── decision-executor.js           # 决策执行器
├── thalamus.js (L362-L372)       # ← 记忆注入点（在 analyzeEvent 中）
├── cortex.js (L343-L357)         # ← 记忆注入点（在 analyzeDeep 中）
```

### 1.3 测试文件

```
/home/xx/perfect21/cecelia/core/brain/src/__tests__/
├── cortex-memory.test.js          # Cortex 记忆持久化测试
├── learning-search.test.js        # 学习检索功能测试
├── learning.test.js               # 学习闭环测试
├── memory-capabilities-search.test.js  # 能力搜索测试
```

### 1.4 数据库迁移

```
/home/xx/perfect21/cecelia/core/brain/migrations/
├── 012_learnings_table.sql        # CREATE TABLE learnings
├── 013_cortex_analyses.sql        # CREATE TABLE cortex_analyses
├── ... 其他 schema
```

---

## 2. 记忆系统架构

### 2.1 三层存储结构

```
┌─────────────────────────────────────────────────────┐
│  记忆存储层 (PostgreSQL)                              │
├─────────────────────────────────────────────────────┤
│  learnings 表                                        │
│  ├─ id, title, category                             │
│  ├─ trigger_event (systemic_failure/rca_request)   │
│  ├─ content (RCA 分析内容)                          │
│  ├─ strategy_adjustments (参数调整建议)            │
│  ├─ applied (是否已应用)                            │
│  └─ metadata (JSON: task_type, failure_class等)    │
├─────────────────────────────────────────────────────┤
│  cortex_analyses 表                                  │
│  ├─ id, root_cause, confidence_score                │
│  ├─ mitigations (JSON 数组)                         │
│  ├─ failure_pattern (JSON: class, task_type等)     │
│  ├─ trigger_event_type                              │
│  └─ analyst ('cortex')                              │
├─────────────────────────────────────────────────────┤
│  decision_log 表                                     │
│  ├─ trigger ('thalamus' / 'cortex')                │
│  ├─ input_summary                                   │
│  ├─ llm_output_json (完整决策)                      │
│  └─ status ('pending' / 'executed')                │
└─────────────────────────────────────────────────────┘
```

### 2.2 MemoryService 类（业务逻辑层）

位置：`src/services/memory-service.js`

**主要方法**：

```javascript
// 1. 概要搜索 (Summary 层)
async search(query, options = {topK: 5, mode: 'summary'})
  // 返回: {matches: [{id, level, title, similarity, preview}, ...]}
  
// 2. 详情查询 (Detail 层)
async getDetail(id)
  // 返回: {id, level, title, description, status, metadata, created_at}
  
// 3. 相关搜索 (Related 层)
async searchRelated(id, options = {})
  // 返回: {matches: [...]}（与某个记录相关的其他记录）
```

**特点**：
- 使用 SimilarityService 进行向量搜索
- Summary/Detail/Related 三层递进式查询
- 可调整返回模式（summary vs full）

### 2.3 相似度计算（Hybrid Search）

位置：`src/similarity.js`

**算法**：
- 70% 向量相似度（OpenAI embeddings + pgvector）
- 30% Jaccard 相似度（token 集合交集/并集）

```javascript
async searchWithVectors(query, {topK = 5, filters = {}})
  // 1. 生成查询向量
  // 2. 在 PostgreSQL pgvector 中搜索相似向量
  // 3. 计算混合分数
  // 4. 返回排序结果
```

**支持的过滤器**：
- `repo`: 按仓库名筛选
- `project_id`: 按项目筛选
- `date_from / date_to`: 按日期范围筛选
- `limit`: 最多返回条数

### 2.4 学习检索（Learning Search）

位置：`src/learning.js`

**核心函数**：

```javascript
// ★ 关键函数：根据上下文检索相关历史学习
async searchRelevantLearnings(context = {}, limit = 10)
  // 输入: {task_type, failure_class, event_type}
  // 输出: [{id, title, content, relevance_score, ...}]
  // 评分策略:
  //   - task_type 精确匹配: +10 分
  //   - failure_class 包含匹配: +8 分
  //   - event_type 精确匹配: +6 分
  //   - category=='failure_pattern': +4 分
  //   - 新近度 (7天内): +3, (30天内): +2, 其他: +1
  
// 后向兼容函数
async getRecentLearnings(category = null, limit = 10)
  // 简单按创建时间倒序返回
```

**特点**：
- 关键字+metadata 权重评分（无向量计算，快速）
- 支持按 task_type、failure_class、event_type 多维度匹配
- 新近度自动衰减

---

## 3. 决策系统中的记忆集成

### 3.1 三层大脑决策流程

```
Event 输入
    ↓
Level 0: quickRoute(event) [纯代码，无记忆]
    ├─ NO → 继续
    └─ YES → 直接返回 Decision
    
    ↓
Level 1: thalamus.analyzeEvent(event) [Sonnet + 记忆]
    ├─ searchRelevantLearnings({task_type, failure_class, event_type}, 20)
    ├─ 构建 learningBlock（注入 20 条最相关学习）
    ├─ 调用 Sonnet: "根据历史经验和当前事件做决策"
    └─ 返回 Decision (level 0/1/2)
    
    ↓
Level 2: cortex.analyzeDeep(event, thalamusDecision) [Opus + 双重记忆]
    ├─ searchRelevantLearnings({task_type, failure_class, event_type}, 20)
    │  └─ 注入历史学习经验
    ├─ searchRelevantAnalyses({task_type, failure_class, trigger_event}, 5)
    │  └─ 注入历史 Cortex 分析结论
    ├─ 调用 Opus: "深度分析，考虑历史经验和相似问题分析"
    └─ 返回 Decision (level 2)
```

### 3.2 Thalamus (L1) 中的记忆注入

**位置**：`src/thalamus.js` L362-L372

```javascript
// Thalamus analyzeEvent() 函数核心代码
async function analyzeEvent(event) {
  // Build #1: 注入历史经验（使用语义检索）
  const learnings = await searchRelevantLearnings({
    task_type: event.task?.task_type,
    failure_class: event.failure_info?.class,
    event_type: event.type
  }, 20);  // ← 最多 20 条

  // 构建 learning block
  let learningBlock = '';
  if (learnings.length > 0) {
    learningBlock = `
## 系统历史经验（参考，按相关性排序）
${learnings.map((l, i) => 
  `- [${i+1}] **${l.title}** (相关度: ${l.relevance_score}): ${l.content.slice(0, 200)}`
).join('\n')}
`;
  }

  // 注入到 Sonnet prompt
  const prompt = `${THALAMUS_PROMPT}${learningBlock}\n\n\`\`\`json\n${eventJson}\n\`\`\``;
  
  // 调用 Sonnet 并记录 token 消耗
  const {text: response, usage} = await callSonnet(prompt);
  await recordTokenUsage('thalamus', 'claude-sonnet-4-20250514', usage, {
    learnings_injected: learnings.length,  // ← 记录注入数量
  });
}
```

**关键特点**：
- **实时检索**：在每次决策时都检索相关学习
- **多维匹配**：基于 task_type / failure_class / event_type
- **可观测性**：记录注入学习数量到 token_usage 事件

### 3.3 Cortex (L2) 中的双重记忆注入

**位置**：`src/cortex.js` L343-L378

```javascript
// Cortex analyzeDeep() 函数核心代码
async function analyzeDeep(event, thalamusDecision = null) {
  // Build #1: 注入历史学习经验（20 条）
  const learnings = await searchRelevantLearnings({
    task_type: event.failed_task?.task_type || event.task?.task_type,
    failure_class: event.failure_history?.[0]?.failure_classification?.class,
    event_type: event.type
  }, 20);

  if (learnings.length > 0) {
    context.historical_learnings = learnings.map((l, i) => ({
      rank: i + 1,
      relevance_score: l.relevance_score || 0,
      title: l.title,
      insight: l.content.slice(0, 300)
    }));
  }

  // Build #2: 注入历史 Cortex 分析（5 条）
  //           相似问题的深度分析结论
  const historicalAnalyses = await searchRelevantAnalyses({
    task_type: event.failed_task?.task_type || event.task?.task_type,
    failure_class: event.failure_history?.[0]?.failure_classification?.class,
    trigger_event: event.type
  }, 5);  // ← 最多 5 条前次深度分析

  if (historicalAnalyses.length > 0) {
    context.historical_analyses = historicalAnalyses.map((a, i) => ({
      rank: i + 1,
      relevance_score: a.relevance_score || 0,
      root_cause: a.root_cause,
      mitigations: a.mitigations ? JSON.parse(a.mitigations).slice(0, 3) : [],
      created_at: a.created_at
    }));
  }

  // 构建 prompt（包含双重记忆）
  const contextJson = JSON.stringify(context, null, 2);
  const prompt = `${CORTEX_PROMPT}\n\n\`\`\`json\n${contextJson}\n\`\`\``;
  
  const response = await callOpus(prompt);  // Opus 做深度分析
}
```

**关键特点**：
- **双重记忆源**：
  1. 历史学习（learnings 表，包含 RCA 分析）
  2. 历史分析（cortex_analyses 表，前次深度分析结论）
- **按相关性排名**：提供 `rank` + `relevance_score`，帮助 LLM 识别最关键信息
- **结构化注入**：历史信息以 JSON 结构注入，便于 LLM 处理

### 3.4 Prompt 中的记忆说明

**Thalamus Prompt 中的记忆部分**（THALAMUS_PROMPT 常量中）：

```
## 系统历史经验（参考，按相关性排序）
- [1] **RCA Learning: Network timeout on retry** (相关度: 15): 
  "网络超时问题根源在于 DNS 缓存失效，建议增加重试延迟..."
- [2] **RCA Learning: Rate limit handling** (相关度: 12): 
  "API 限流问题，建议使用指数退避策略..."
```

**Cortex Prompt 中的记忆部分**（CORTEX_PROMPT 常量中）：

```json
{
  "historical_learnings": [
    {
      "rank": 1,
      "relevance_score": 15,
      "title": "Network timeout RCA",
      "insight": "网络超时问题根源..."
    }
  ],
  "historical_analyses": [
    {
      "rank": 1,
      "relevance_score": 12,
      "root_cause": "DNS 缓存失效",
      "mitigations": ["增加重试延迟", "使用 CDN", ...]
    }
  ]
}
```

---

## 4. Memory API 端点

位置：`src/routes/memory.js`

### 4.1 POST /api/brain/memory/search

**概要搜索**（Summary 层）

```http
POST /api/brain/memory/search
Content-Type: application/json

{
  "query": "用户登录验证",
  "topK": 5,
  "mode": "summary"
}

Response 200:
{
  "matches": [
    {
      "id": "abc-123",
      "level": "task",
      "title": "feat(auth): cross-subdomain cookie auth",
      "similarity": 0.92,
      "preview": "用 cookie 替代 localStorage 实现跨域认证..."
    },
    ...
  ]
}
```

### 4.2 GET /api/brain/memory/detail/:id

**详情查询**（Detail 层）

```http
GET /api/brain/memory/detail/abc-123

Response 200:
{
  "id": "abc-123",
  "level": "task",
  "title": "feat(auth): cross-subdomain cookie auth",
  "description": "完整描述内容...",
  "status": "completed",
  "metadata": {...},
  "created_at": "2024-01-15"
}
```

### 4.3 POST /api/brain/memory/search-related

**相关搜索**（Related 层）

```http
POST /api/brain/memory/search-related
Content-Type: application/json

{
  "id": "abc-123",
  "topK": 5
}

Response 200:
{
  "matches": [
    {
      "id": "def-456",
      "similarity": 0.75,
      ...
    }
  ]
}
```

---

## 5. 学习闭环实现

位置：`src/learning.js`

### 5.1 学习记录流程

```javascript
// ★ 核心函数：记录 RCA 分析产生的学习
async function recordLearning(analysis) {
  // 输入:
  // {
  //   task_id: "xyz",
  //   analysis: {root_cause: "...", contributing_factors: [...], ...},
  //   learnings: ["学到的经验1", "经验2"],
  //   recommended_actions: [{type: "adjust_strategy", ...}],
  //   confidence: 0.9
  // }

  // 插入 learnings 表
  await pool.query(`
    INSERT INTO learnings (
      title, 
      category,        // 'failure_pattern'
      trigger_event,   // 'systemic_failure'
      content,         // JSON: {root_cause, contributing_factors, learnings}
      strategy_adjustments,  // JSON: [{params: {...}}]
      metadata         // JSON: {task_id, confidence}
    ) VALUES (...)
  `);
  
  // 返回: {id, ...created learning record}
}
```

### 5.2 策略调整应用流程

```javascript
// ★ 核心函数：应用从 RCA 学习中推荐的参数调整
async function applyStrategyAdjustments(adjustments, learningId) {
  // 输入: adjustments = [
  //   {
  //     params: {
  //       param: "retry.max_attempts",
  //       old_value: 3,
  //       new_value: 5,
  //       reason: "增加重试次数以处理瞬时网络故障"
  //     }
  //   }
  // ]

  // 可调整参数白名单（安全措施）
  const ADJUSTABLE_PARAMS = {
    'alertness.emergency_threshold': {min: 0.5, max: 1.0},
    'alertness.alert_threshold': {min: 0.3, max: 0.8},
    'retry.max_attempts': {min: 1, max: 5},
    'retry.base_delay_minutes': {min: 1, max: 30},
    'resource.max_concurrent': {min: 1, max: 20},
    'resource.memory_threshold_mb': {min: 500, max: 4000}
  };

  // 验证 + 应用到 brain_config 表
  for (const adjustment of adjustments) {
    // 1. 验证参数是否在白名单
    // 2. 验证新值是否在允许范围内
    // 3. INSERT/UPDATE brain_config
    //    SET value = JSON.stringify(newValue),
    //        metadata = {learning_id, old_value, reason, applied_at}
  }

  // 标记 learning 记录为已应用
  await pool.query(`
    UPDATE learnings SET applied = true, applied_at = NOW()
    WHERE id = $1
  `, [learningId]);
}
```

**白名单策略参数**（支持的可调整项）：

| 参数 | 范围 | 说明 |
|------|------|------|
| `alertness.emergency_threshold` | 0.5-1.0 | 紧急警觉阈值 |
| `alertness.alert_threshold` | 0.3-0.8 | 警告阈值 |
| `retry.max_attempts` | 1-5 | 最大重试次数 |
| `retry.base_delay_minutes` | 1-30 | 基础重试延迟（分钟） |
| `resource.max_concurrent` | 1-20 | 最大并发任务数 |
| `resource.memory_threshold_mb` | 500-4000 | 内存阈值（MB） |

---

## 6. 核心代码流程图

### 6.1 决策前的记忆检索流程

```
┌─────────────────────────────────────────────────────────┐
│ Event 到达 (例如: TASK_FAILED)                           │
└──────────────┬──────────────────────────────────────────┘
               ↓
┌─────────────────────────────────────────────────────────┐
│ thalamus.processEvent(event)                            │
│  1. quickRoute(event) → 快速规则 (L0)                   │
│     ├─ heartbeat? → no_action                           │
│     ├─ normal tick? → fallback_to_tick                  │
│     └─ 其他 → 继续到 Sonnet                             │
└──────────────┬──────────────────────────────────────────┘
               ↓
┌─────────────────────────────────────────────────────────┐
│ 2. analyzeEvent(event) [Sonnet + Memory]                │
│                                                          │
│   ★ 记忆检索：                                           │
│   searchRelevantLearnings({                             │
│     task_type: event.task?.task_type,                   │
│     failure_class: event.failure_info?.class,           │
│     event_type: event.type                              │
│   }, 20)  ← 最多 20 条                                  │
│                                                          │
│   ★ 构建 prompt：                                        │
│   THALAMUS_PROMPT + learningBlock + eventJson           │
│                                                          │
│   ★ 调用 Sonnet：                                        │
│   callSonnet(prompt)                                    │
│                                                          │
│   ★ 记录成本：                                           │
│   recordTokenUsage('thalamus', ..., {                   │
│     learnings_injected: learnings.length                │
│   })                                                    │
└──────────────┬──────────────────────────────────────────┘
               ↓
               Decision (level 0/1/2)
               ├─ level < 2 → 返回 (不升级)
               └─ level === 2 → 升级到 Cortex
                      ↓
┌─────────────────────────────────────────────────────────┐
│ 3. cortex.analyzeDeep(event, thalamusDecision) [Opus + Memory]
│                                                          │
│   ★ 记忆检索 #1：历史学习                               │
│   searchRelevantLearnings({...}, 20)                    │
│   → context.historical_learnings                        │
│                                                          │
│   ★ 记忆检索 #2：历史分析                               │
│   searchRelevantAnalyses({...}, 5)                      │
│   → context.historical_analyses                         │
│                                                          │
│   ★ 构建 prompt：                                        │
│   CORTEX_PROMPT + contextJson (包含 2 个记忆源)         │
│                                                          │
│   ★ 调用 Opus：                                          │
│   callOpus(prompt)                                      │
│   → {                                                   │
│       level: 2,                                         │
│       analysis: {...},                                  │
│       actions: [...],                                   │
│       strategy_updates: [...],  ← ★ 新策略建议         │
│       learnings: [...],         ← ★ 新学习记录         │
│       absorption_policy: {...}  ← ★ 免疫策略           │
│     }                                                   │
└──────────────┬──────────────────────────────────────────┘
               ↓
       ★ 保存学习记录：
       recordLearnings(decision.learnings, event)
       
       ★ 保存吸收策略：
       storeAbsorptionPolicy(decision.absorption_policy)
       
       ↓
       返回 Decision (执行)
```

### 6.2 学习反馈闭环

```
Cortex 做出深度分析（RCA）
    ↓
decision.learnings[] 包含学习要点
decision.strategy_updates[] 包含参数调整建议
    ↓
★ recordLearnings()
   → 保存到 learnings 表
   → 每条学习记录包含：
      - title / content (RCA 分析要点)
      - strategy_adjustments (参数调整建议)
      - metadata (task_type, failure_class, confidence)
    ↓
★ applyStrategyAdjustments()
   → 验证参数在白名单内
   → 验证新值在允许范围内
   → 更新 brain_config 表
   → 标记 learning 记录为 applied=true
    ↓
下次执行 thalamus/cortex 时：
    searchRelevantLearnings() 检索到这条新学习
    → 注入到 prompt
    → Sonnet/Opus 可以参考上次的分析结论
    → 形成正反馈闭环
```

---

## 7. 现有实现的特点

### 7.1 优势

✅ **实时性**：每次决策都进行记忆检索，不依赖预计算  
✅ **多维匹配**：基于 task_type / failure_class / event_type 多个维度  
✅ **权重评分**：关键字精确匹配 10 分，包含匹配 8 分等  
✅ **新近度衰减**：7 天内 +3 分，30 天内 +2 分，自动倾向新学习  
✅ **成本可观测**：记录每次注入的学习数量到 token_usage 事件  
✅ **双重记忆源**（Cortex 层）：learnings + cortex_analyses  
✅ **结构化存储**：metadata JSONB、strategy_adjustments JSONB，易于查询  
✅ **安全参数白名单**：可调整的策略参数有明确范围限制  
✅ **向量 + 关键字混合**：SimilarityService 支持 pgvector + Jaccard  

### 7.2 当前实现的局限

⚠️ **Thalamus 层记忆检索不带历史分析**：只注入 learnings，不注入前次 Cortex 分析（因为可能没有前次分析）  
⚠️ **检索精度依赖 metadata 质量**：如果 failure_class 标注不准，匹配效果下降  
⚠️ **缺少跨域学习转迁**：不同 task_type 间的学习转迁机制未明确  
⚠️ **记忆更新实时性**：新学习只有在下一次决策时才被检索到（无推送）  
⚠️ **向量模型固定**：目前使用 OpenAI embeddings，无法自定义  
⚠️ **搜索结果去重**：未明确处理重复或相似的学习记录  

---

## 8. 记忆相关的核心数据结构

### 8.1 learnings 表 Schema

```sql
CREATE TABLE learnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  category VARCHAR(50),  -- 'failure_pattern', 'success_pattern', etc.
  trigger_event VARCHAR(100),  -- 'systemic_failure', 'rca_request', etc.
  content TEXT,  -- JSON: {root_cause, contributing_factors, learnings}
  strategy_adjustments TEXT,  -- JSON: [{params: {param, old_value, new_value, reason}}]
  applied BOOLEAN DEFAULT FALSE,  -- 是否已应用
  applied_at TIMESTAMP,  -- 应用时间
  metadata JSONB,  -- {task_id, confidence, failure_class, task_type}
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### 8.2 cortex_analyses 表 Schema

```sql
CREATE TABLE cortex_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID,
  event_id UUID,
  trigger_event_type VARCHAR(100),  -- 'rca_request', 'systemic_failure'
  root_cause TEXT,
  mitigations TEXT,  -- JSON: [{action, reason, confidence}]
  confidence_score DECIMAL(3,2),
  failure_pattern JSONB,  -- {class, task_type, frequency, severity}
  strategy_updates TEXT,  -- JSON array
  analyst VARCHAR(50),  -- 'cortex'
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### 8.3 decision_log 表 Schema

```sql
CREATE TABLE decision_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger VARCHAR(50),  -- 'thalamus', 'cortex', 'quickRoute'
  input_summary TEXT,
  llm_output_json JSONB,  -- 完整的 Decision 对象
  action_result_json JSONB,
  status VARCHAR(50),  -- 'pending', 'executed', 'failed'
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 9. 关键函数速查表

### 记忆检索函数

| 函数 | 位置 | 输入 | 输出 | 调用方 |
|------|------|------|------|--------|
| `searchRelevantLearnings()` | learning.js | context (task_type/failure_class/event_type), limit | [Learning] 按相关度排序 | Thalamus, Cortex |
| `getRecentLearnings()` | learning.js | category, limit | [Learning] 按时间倒序 | 后向兼容 |
| `MemoryService.search()` | services/memory-service.js | query, topK, mode | {matches} | API: POST /search |
| `MemoryService.getDetail()` | services/memory-service.js | id | 详细对象 | API: GET /detail/:id |
| `SimilarityService.searchWithVectors()` | similarity.js | query, topK, filters | {matches} 混合评分 | MemoryService |

### 决策函数

| 函数 | 位置 | 输入 | 输出 | 说明 |
|------|------|------|------|------|
| `processEvent()` | thalamus.js | event | Decision | 主入口：L0→L1→L2 |
| `quickRoute()` | thalamus.js | event | Decision \| null | Level 0 快速规则 |
| `analyzeEvent()` | thalamus.js | event | Decision | Level 1: Sonnet + Memory |
| `analyzeDeep()` | cortex.js | event, thalamusDecision | Decision | Level 2: Opus + 双重 Memory |

### 学习闭环函数

| 函数 | 位置 | 输入 | 输出 | 说明 |
|------|------|------|------|------|
| `recordLearning()` | learning.js | analysis | Learning record | 保存 RCA 学习 |
| `applyStrategyAdjustments()` | learning.js | adjustments, learningId | {applied, skipped, errors} | 应用参数调整 |
| `shouldTriggerLearning()` | learning.js | failureInfo | boolean | 是否应创建学习任务 |
| `createLearningTask()` | learning.js | failureContext | taskId | 为 RCA 创建任务 |

---

## 10. 开发路线图建议

### Phase 1: 记忆检索优化（4-6 周）
- [ ] **增强检索精度**
  - 实现向量重排序（vector reranking）
  - 添加语义去重（semantic deduplication）
  - 支持多个 failure_class 组合匹配

- [ ] **扩展记忆源**
  - 从 execution_logs 提取高频错误模式
  - 从 absorption_policies 记录已验证的解决方案
  - 实现跨域学习转迁（domain transfer）

- [ ] **改进记忆可观测性**
  - 添加记忆命中率指标
  - 追踪"是否有历史学习被注入"
  - 对比有/无记忆的决策质量差异

### Phase 2: 记忆推送与主动学习（6-8 周）
- [ ] **主动记忆推送**
  - Tick loop 中主动检查新学习
  - 对新学习进行反向验证
  - 快速反馈是否有效

- [ ] **学习优先级排序**
  - 基于应用成功率排序（已应用且有效果）
  - 基于使用频率排序（被检索次数多）
  - 衰减过时学习的权重

### Phase 3: 免疫系统深度集成（8-10 周）
- [ ] **Absorption Policy 与学习的双向反馈**
  - Policy 应用成功 → 转化为 learning
  - Learning 验证有效 → 自动生成 Policy
  - Policy 失败 → 标记 learning 为"需要重新 RCA"

- [ ] **系统参数自适应**
  - 根据学习历史自动调整 retry.max_attempts
  - 根据资源消耗学习调整 resource.max_concurrent
  - 从多个 alertness 阈值学习中选出最优值

### Phase 4: 跨服务记忆网络（10-12 周）
- [ ] **连接多个 agents 的学习**
  - Caramel (/dev) 的代码修复学习
  - 秋米 (/autumnrice) 的 OKR 拆解学习
  - 小检 (/qa) 的测试策略学习
  - 交叉引用与知识图谱

---

## 11. 文件路径汇总

**绝对路径列表**（便于快速定位）：

### 核心记忆模块
- `/home/xx/perfect21/cecelia/core/brain/src/services/memory-service.js`
- `/home/xx/perfect21/cecelia/core/brain/src/routes/memory.js`
- `/home/xx/perfect21/cecelia/core/brain/src/learning.js`
- `/home/xx/perfect21/cecelia/core/brain/src/similarity.js`
- `/home/xx/perfect21/cecelia/core/brain/src/embedding-service.js`

### 决策模块（含记忆集成）
- `/home/xx/perfect21/cecelia/core/brain/src/thalamus.js` (L362-L372: 记忆注入)
- `/home/xx/perfect21/cecelia/core/brain/src/cortex.js` (L343-L378: 双重记忆注入)
- `/home/xx/perfect21/cecelia/core/brain/src/decision.js`
- `/home/xx/perfect21/cecelia/core/brain/src/decision-executor.js`

### 测试文件
- `/home/xx/perfect21/cecelia/core/brain/src/__tests__/cortex-memory.test.js`
- `/home/xx/perfect21/cecelia/core/brain/src/__tests__/learning-search.test.js`
- `/home/xx/perfect21/cecelia/core/brain/src/__tests__/learning.test.js`
- `/home/xx/perfect21/cecelia/core/brain/src/__tests__/memory-capabilities-search.test.js`

### 数据库
- `/home/xx/perfect21/cecelia/core/brain/migrations/012_learnings_table.sql`
- `/home/xx/perfect21/cecelia/core/brain/migrations/013_cortex_analyses.sql`

---

## 12. 研究问题与假设

### 开放问题
1. **记忆遗忘机制**：如何让旧学习逐渐衰退而保留关键模式？
2. **记忆冲突**：两个互相矛盾的学习如何处理？
3. **跨域泛化**：从 dev 任务的学习如何应用到 qa 任务？
4. **记忆验证**：应用的学习是否真的改善了决策质量（需要 A/B 测试）？
5. **向量漂移**：同一文本在不同时间的 embedding 是否一致？

### 验证假设
- 记忆注入是否能提升 Cortex 分析质量（用 confidence 分数对比）？
- 有历史学习的决策是否更容易成功执行？
- 新学习应用后是否减少了相同故障的发生率？

---

## 附录：快速开始指南

### 查看当前学习记录
```bash
curl -X POST http://localhost:5221/api/brain/memory/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "network timeout",
    "topK": 5,
    "mode": "summary"
  }'
```

### 查看特定学习的详情
```bash
curl http://localhost:5221/api/brain/memory/detail/{learning_id}
```

### 查看最近的学习记录（SQL 直接查询）
```sql
SELECT id, title, category, trigger_event, created_at, applied
FROM learnings
ORDER BY created_at DESC
LIMIT 20;
```

### 查看策略调整历史
```sql
SELECT 
  l.id, l.title,
  l.strategy_adjustments->0->'params'->>'param' as param_adjusted,
  l.applied, l.applied_at
FROM learnings l
WHERE l.strategy_adjustments IS NOT NULL
ORDER BY l.created_at DESC;
```

---

**报告生成时间**: 2026-02-18  
**仓库**: `/home/xx/perfect21/cecelia/core`  
**Git Branch**: cp-02181225-bb5b9630-7997-4a57-a3e9-c5ba10
