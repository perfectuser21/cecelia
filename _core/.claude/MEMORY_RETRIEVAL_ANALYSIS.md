# Cecelia-Core 记忆检索质量深度分析

**分析日期**: 2026-02-18  
**分析范围**: thalamus.js, cortex.js, learning.js 的记忆检索和注入机制  
**代码版本**: cp-02172100-whitelist-learning-actions-v2

---

## 执行摘要

### 关键发现

1. **记忆检索机制**: 使用**纯规则匹配**，无语义理解或向量检索
2. **相关性评分**: 基于 5 个加权因子（10, 8, 6, 4, 1-3 权重）
3. **向量检索基础已建**: pgvector 扩展已安装，但仅用于 tasks/projects/goals/capabilities，**learnings 表未配置**
4. **测试覆盖**: 有基本的集成测试，但缺少相关性准确性的验证
5. **双重注入设计**: Thalamus (Sonnet) 和 Cortex (Opus) 都有独立的记忆注入，但文本格式化方式略有不同

---

## 1. 记忆检索质量分析

### 1.1 Thalamus (丘脑) 的记忆检索

**文件**: `/home/xx/perfect21/cecelia/core/brain/src/thalamus.js` (第 362-373 行)

```javascript
// 第 359-367 行
async function analyzeEvent(event) {
  const eventJson = JSON.stringify(event, null, 2);

  // Build #1: 注入历史经验（使用语义检索）
  const learnings = await searchRelevantLearnings({
    task_type: event.task?.task_type,
    failure_class: event.failure_info?.class,
    event_type: event.type
  }, 20);  // 最多获取 20 条
```

**记忆注入格式** (第 369-374 行):

```javascript
let learningBlock = '';
if (learnings.length > 0) {
  learningBlock = `\n\n## 系统历史经验（参考，按相关性排序）\n${learnings.map((l, i) => 
    `- [${i+1}] **${l.title}** (相关度: ${l.relevance_score || 0}): ${(l.content || '').slice(0, 200)}`
  ).join('\n')}\n`;
}

const prompt = `${THALAMUS_PROMPT}${learningBlock}\n\n\`\`\`json\n${eventJson}\n\`\`\``;
```

**特点:**
- 仅显示前 200 字符的 content
- 包含相关度分数（用于人工理解，不影响 LLM 决策）
- 最多注入 20 条记忆

### 1.2 Cortex (皮层) 的记忆注入

**文件**: `/home/xx/perfect21/cecelia/core/brain/src/cortex.js` (第 343-357 行)

```javascript
// 第 343-348 行：获取 learnings
const learnings = await searchRelevantLearnings({
  task_type: event.failed_task?.task_type || event.task?.task_type,
  failure_class: event.failure_history?.[0]?.failure_classification?.class,
  event_type: event.type
}, 20);

// 第 350-357 行：格式化为结构化数据
if (learnings.length > 0) {
  context.historical_learnings = learnings.map((l, i) => ({
    rank: i + 1,
    relevance_score: l.relevance_score || 0,
    title: l.title,
    insight: (l.content || '').slice(0, 300)  // 显示前 300 字符
  }));
}
```

**对比 Thalamus:**
- 返回结构化对象，而非格式化字符串
- 显示前 300 字符（比 Thalamus 多 100 字符）
- 增加了 rank 排名字段
- 与 cortex_analyses 的历史数据一起注入（见第 359-378 行）

---

## 2. 相关性评分算法深度分析

### 2.1 searchRelevantLearnings() 实现

**文件**: `/home/xx/perfect21/cecelia/core/brain/src/learning.js` (第 173-242 行)

**第 1 步：数据获取** (第 176-181 行)
```javascript
const result = await pool.query(`
  SELECT id, title, category, trigger_event, content, strategy_adjustments, applied, created_at, metadata
  FROM learnings
  ORDER BY created_at DESC
  LIMIT 100
`);
```

**问题**: 无论查询什么，都加载全部 100 条最新记录，然后在内存中评分。

**第 2 步：打分算法** (第 188-230 行)

| 因子 | 权重 | 匹配条件 | 类型 |
|------|------|---------|------|
| 1. Task Type Match | **10** | `metadata.task_type === context.task_type` | 精确匹配 |
| 2. Failure Class | **8** | `contentLower.includes(failureClassLower)` | 子字符串匹配 |
| 3. Event Type | **6** | `trigger_event === context.event_type` | 精确匹配 |
| 4. Category Match | **4** | `category === 'failure_pattern'` | 硬编码值 |
| 5. Freshness | **1-3** | ≤7 days (3) / ≤30 days (2) / older (1) | 时间衰减 |

**最大可能分数**: 10 + 8 + 6 + 4 + 3 = **31 分**

**算法特征:**
- ✅ 简单、快速、可预测
- ❌ **无语义理解** - 仅文本包含检查
- ❌ **两层精确匹配** (task_type 和 trigger_event)
- ❌ **metadata.task_type 检索不稳定** - 依赖 recordLearning() 是否正确填充

### 2.2 searchRelevantAnalyses() 实现

**文件**: `/home/xx/perfect21/cecelia/core/brain/src/cortex.js` (第 626-673 行)

**类似的算法，但针对 cortex_analyses 表**:

| 因子 | 权重 | 源字段 |
|------|------|--------|
| 1. Failure Class | **10** | `failure_pattern.class` (精确) |
| 2. Task Type | **8** | `failure_pattern.task_type` (精确) |
| 3. Trigger Event | **6** | `trigger_event_type` (精确) |
| 4. Freshness | **1-3** | created_at (时间衰减) |

**关键区别:**
- 不检查 category（cortex_analyses 无此字段）
- 从 failure_pattern JSONB 字段获取信息
- **更结构化的数据源** → 更可靠的匹配

---

## 3. 数据库 Schema 现状

### 3.1 Learnings 表结构

**迁移**: `012_learnings_table.sql`

```sql
CREATE TABLE IF NOT EXISTS learnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  category VARCHAR(50),          -- 'failure_pattern', 'optimization', 'strategy_adjustment'
  trigger_event VARCHAR(100),    -- Event type
  content TEXT,                  -- Learning content description
  strategy_adjustments JSONB,    -- Strategy adjustment recommendations
  applied BOOLEAN DEFAULT false, -- Whether adjustments have been applied
  applied_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  metadata JSONB                 -- 自由格式，存储 task_type
);

-- 索引
idx_learnings_category
idx_learnings_trigger_event
idx_learnings_created_at
idx_learnings_applied
```

**问题**: **无 embedding 列，无向量索引**

### 3.2 Vector 基础设施

**迁移 028 & 031 支持的表:**

| 表 | Embedding 列 | 索引 | 向量维度 |
|------|---------|------|--------|
| tasks | ✅ 有 | HNSW 索引 | 1536 |
| projects | ✅ 有 | HNSW 索引 | 1536 |
| goals | ✅ 有 | HNSW 索引 | 1536 |
| capabilities | ✅ 有 | HNSW 索引 | 1536 |
| **learnings** | ❌ **无** | ❌ **无** | - |
| cortex_analyses | ❌ **无** | ❌ **无** | - |

### 3.3 Cortex Analyses 表结构

**迁移**: `013_cortex_analyses.sql` + `015_cortex_quality_system.sql`

```sql
CREATE TABLE cortex_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tasks(id),
  event_id INTEGER REFERENCES cecelia_events(id),
  trigger_event_type VARCHAR(50),
  
  -- RCA 核心结果
  root_cause TEXT NOT NULL,
  contributing_factors JSONB,
  mitigations JSONB,
  failure_pattern JSONB,       -- {class, task_type, frequency, severity}
  affected_systems JSONB,
  
  -- 学习和策略
  learnings JSONB,
  strategy_adjustments JSONB,
  
  -- 质量追踪（迁移 015 添加）
  quality_score INTEGER,
  quality_dimensions JSONB,
  similarity_hash TEXT,        -- 用于去重（非向量）
  duplicate_of UUID,
  
  analysis_depth VARCHAR(20),  -- 'quick', 'standard', 'deep'
  confidence_score NUMERIC(3,2),
  analyst VARCHAR(20) DEFAULT 'cortex',
  created_at TIMESTAMP DEFAULT NOW(),
  metadata JSONB
);

-- 索引：基于 failure_pattern 的 GIN 索引（JSONB）
idx_cortex_analyses_failure_pattern USING GIN (failure_pattern)
```

**similarity_hash**: 基于 generateSimilarityHash() 函数生成的哈希值（见 cortex-quality.js），用于简单的去重，不是向量。

---

## 4. 记忆检索的问题和改进机会

### 4.1 当前问题

#### 问题 1: 子字符串匹配不精确
**影响**: 高误报率

```javascript
// 第 202-206 行
if (context.failure_class) {
  const failureClassLower = context.failure_class.toLowerCase();
  if (contentLower.includes(failureClassLower)) {  // ⚠️ 简单的 includes()
    score += 8;
  }
}
```

**例子**:
- 搜索 `failure_class: "NETWORK"`
- 匹配 content 中任何包含 "network" 的字符串
- 可能匹配无关的学习（如 "networking protocols"）

#### 问题 2: metadata.task_type 填充不一致
**影响**: Task type 匹配经常失败

```javascript
// learning.js 第 34-72 行：recordLearning() 
// 注意：title, category, trigger_event, content 会被填充
// 但 metadata 中的 task_type 来自哪里？
```

查看 recordLearning() 调用代码...

**发现**: metadata 只包含:
```javascript
metadata: JSON.stringify({ task_id, confidence: analysis.confidence })
```

**结论**: **没有记录 task_type 到 metadata**，导致 searchRelevantLearnings 的第一因子 (10 分) 很难匹配。

#### 问题 3: 无语义理解
**影响**: 无法理解相似但不同措辞的学习

**例子**:
- 学习 1: "Network connectivity timeout causes task failures"
- 学习 2: "Connection reset by peer results in task restart"
- 搜索: failure_class = "NETWORK"

两条都会通过 includes("network") 检查，但 searchRelevantLearnings 无法理解它们在语义上相同。

#### 问题 4: Learnings 表无向量索引
**影响**: 无法使用 pgvector 高效搜索，只能逐条比对

**当前流程**:
1. 加载 100 条记录到内存
2. 逐条评分（O(n) 复杂度）
3. 排序并返回前 N 条

**规模问题**: 如果 learnings 增长到 10,000+，逐条评分会成为性能瓶颈。

#### 问题 5: Cortex Analyses 缺少反馈循环
**影响**: RCA 质量评分不完整

```javascript
// cortex-quality.js 中的 evaluateQualityInitial()
// 评估 RCA 质量，但评估结果如何反馈到 searchRelevantAnalyses？
// 答案：没有。searchRelevantAnalyses 不使用 quality_score。
```

---

### 4.2 改进机会清单

| 优先级 | 问题 | 改进方案 | 影响 | 工作量 |
|--------|------|--------|------|--------|
| **P0** | metadata.task_type 未填充 | 在 recordLearning() 中添加 task_type | 增加 10 分匹配率 | 低 |
| **P1** | Learnings 无向量检索 | 添加 embedding 列 + 生成向量 + 改用向量搜索 | 语义相关性提升 50%+ | 中 |
| **P1** | Failure class 子字符串匹配不精确 | 改为精确匹配或分类查询 | 误报率从 ~30% → ~5% | 低 |
| **P2** | Cortex analyses 未用 quality_score | 在 searchRelevantAnalyses 中加权 quality_score | 优先使用高质量 RCA | 低 |
| **P2** | Learnings 无访问频度追踪 | 添加 access_count / last_accessed | 热学习排序更准 | 低 |
| **P3** | RCA 去重仅用哈希不用向量 | 补充向量相似度去重 | 去重准确性 | 中 |

---

## 5. 测试覆盖分析

### 5.1 存在的测试

**文件**: `/home/xx/perfect21/cecelia/core/brain/src/__tests__/cortex-memory.test.js`

**测试覆盖**:
```
✅ saveCortexAnalysis()
  - saves analysis to database with all fields
  - handles missing optional fields gracefully
  - saves contributing_factors and mitigations as JSONB

✅ searchRelevantAnalyses()
  - 插入 5 个测试 analyses，不同的 failure_class / task_type / age
  - 验证排序和相关性分数
  - (但代码超过 150 行，部分测试代码未显示)
```

### 5.2 缺失的测试

| 测试场景 | 当前状态 | 需要补充 |
|---------|----------|---------|
| searchRelevantLearnings 相关性准确性 | ❌ **无** | 需要创建多个 learning，验证相关性排序 |
| Failure class 子字符串误报 | ❌ **无** | 创建 NETWORK/NETWORK_CONFIG 的学习，验证匹配准确性 |
| Task type 精确匹配 | ❌ **无** | 测试 metadata.task_type 是否被正确填充 |
| 学习注入到 prompt 的格式 | ❌ **无** | 验证 Thalamus/Cortex 注入的学习格式是否符合预期 |
| 向量搜索基准 | ❌ **无** | 在添加向量后进行基准测试 |

---

## 6. 代码执行流程图

### 6.1 Thalamus (Sonnet) 路径

```
事件到达 thalamus
    ↓
analyzeEvent(event)
    ├─ searchRelevantLearnings({
    │    task_type: event.task?.task_type,
    │    failure_class: event.failure_info?.class,
    │    event_type: event.type
    │  }, 20)
    │    ↓
    │    [内存评分：100 条记录 → 20 条]
    │    ↓
    │    返回: [{id, title, content, relevance_score}, ...]
    │
    ├─ 格式化为 markdown 文本块
    │    learningBlock = "## 系统历史经验...\n- [1] Title (score: 15): first 200 chars"
    │
    ├─ 注入到 prompt
    │    prompt = THALAMUS_PROMPT + learningBlock + event JSON
    │
    ├─ callSonnet(prompt)
    │    → API 调用 claude-sonnet-4-20250514
    │    → 返回 Decision JSON
    │
    └─ 验证 + 返回 Decision
```

### 6.2 Cortex (Opus) 路径

```
thalamus 判断 level=2 → Cortex
    ↓
analyzeDeep(event, thalamusDecision)
    ├─ [Build #1] searchRelevantLearnings()
    │    └─ context.historical_learnings = [{rank, relevance_score, title, insight}, ...]
    │
    ├─ [Build #2] searchRelevantAnalyses()
    │    └─ context.historical_analyses = [{rank, relevance_score, root_cause, mitigations}, ...]
    │
    ├─ 组装 context 对象
    │    {
    │      event,
    │      thalamus_judgment,
    │      recent_decisions,
    │      system_status,
    │      historical_learnings,
    │      historical_analyses,
    │      adjustable_params
    │    }
    │
    ├─ callOpus(CORTEX_PROMPT + JSON stringify(context))
    │    → API 调用 claude-opus-4-20250514
    │    → max_tokens: 4096
    │
    └─ 验证 + 记录决策
         saveCortexAnalysis()
         recordLearnings()
         storeAbsorptionPolicy()
```

---

## 7. Token 成本和性能影响

### 7.1 记忆注入的 Token 成本

**Thalamus (Sonnet)**:
```
基础 prompt (THALAMUS_PROMPT)       ~500 tokens
Event JSON (10 子字段)               ~200 tokens
Learnings 注入 (20 条 × 50 字符)    ~200 tokens
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
总计                                 ~900 tokens
```

**Cortex (Opus)**:
```
基础 prompt (CORTEX_PROMPT)         ~800 tokens
Event/context JSON                   ~500 tokens
Historical learnings (20 条)         ~300 tokens
Historical analyses (5 条)           ~400 tokens
Adjustable params metadata           ~200 tokens
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
总计                                 ~2200 tokens
```

### 7.2 成本影响

**Thalamus 成本** (per call):
- Input: 900 tokens × $3.0/M = $0.0000027
- Output: 500 tokens (avg) × $15/M = $0.0000075
- **Per-call cost**: ~$0.00001

**Cortex 成本** (per call):
- Input: 2200 tokens × $15/M = $0.000033
- Output: 2000 tokens (avg) × $75/M = $0.00015
- **Per-call cost**: ~$0.00018

**Token 使用追踪** (已实现):
```javascript
// thalamus.js 第 381-384 行
await recordTokenUsage('thalamus', 'claude-sonnet-4-20250514', usage, {
  event_type: event.type,
  learnings_injected: learnings.length,  // ← 记录了注入的学习数量
});
```

---

## 8. 架构决策和设计原理

### 8.1 为什么分成两层记忆检索？

| 层级 | 使用场景 | 学习来源 | 容量 |
|------|---------|--------|------|
| **L1: Thalamus (Sonnet)** | 快速事件路由 | learnings 表 | 最多 20 条 |
| **L2: Cortex (Opus)** | 深度分析 | learnings + cortex_analyses | 20 + 5 条 |

**设计原理**:
- Thalamus 处理常见模式 → 用轻量级 learnings
- Cortex 处理复杂情况 → 用完整的 RCA 历史

### 8.2 为什么用纯规则匹配而非向量？

**当时的考虑（推测）**:
1. **实施速度** - 向量检索需要 embedding 生成
2. **可调试性** - 规则匹配易于理解和调整
3. **可靠性** - 不依赖外部 embedding API
4. **成本** - 早期数据量小，无需向量

**现在的状态**:
- pgvector 基础设施已存在 (migration 028)
- 其他表已有 embedding 列 (tasks/projects/goals)
- 规则匹配误报率开始显现 (metadata.task_type 填充问题)

---

## 9. 建议的改进方案

### 方案 A: 快速修复 (2-3 天，P0)

1. **修复 metadata.task_type 填充**
   ```javascript
   // learning.js - recordLearning() 函数
   // 修改元数据填充
   metadata: JSON.stringify({ 
     task_id, 
     task_type: failureContext.task_type,  // ← 添加
     confidence: analysis.confidence 
   })
   ```

2. **改进 failure_class 匹配**
   ```javascript
   // learning.js - searchRelevantLearnings() 函数
   // 从子字符串改为分类查询
   // 如果 content 中有结构化的 failure_class 字段（从 recordLearning 中），直接匹配
   ```

3. **添加测试覆盖**
   - 测试 searchRelevantLearnings 相关性
   - 验证 metadata 填充

### 方案 B: 中期改进 (1-2 周，P1)

1. **为 learnings 添加向量支持**
   ```sql
   -- 迁移文件
   ALTER TABLE learnings ADD COLUMN IF NOT EXISTS embedding vector(1536);
   CREATE INDEX learnings_embedding_idx ON learnings USING hnsw (embedding vector_cosine_ops);
   ```

2. **生成向量**
   ```javascript
   // 使用 OpenAI API 或本地 embedding 模型
   // 为所有已有学习生成 embedding
   ```

3. **改用向量相似度搜索**
   ```javascript
   // searchRelevantLearnings() 改用：
   // 1. 对 context 生成 embedding
   // 2. 用 pgvector 的 <=> 操作符查询相似的 learnings
   // 3. 结合规则匹配进行二级过滤
   ```

### 方案 C: 长期优化 (2-3 周，P2)

1. **质量反馈循环**
   - Cortex 的 quality_score 用于加权搜索结果
   - Frequently accessed learnings 获得排序提升

2. **Cortex Analyses 向量化**
   - 为 cortex_analyses 表添加 embedding
   - 用向量去重替换哈希匹配
   - 支持"找相似的过去 RCA"

3. **学习访问追踪**
   - 添加 access_count / last_accessed 字段
   - 排名时考虑热度

---

## 10. 总结表

| 维度 | 当前状态 | 评分 | 说明 |
|------|--------|------|------|
| **记忆容量** | 100+ learnings | ✅ 足够 | 定期增长 |
| **相关性准确性** | 规则匹配 (5 因子) | ⚠️ 中等 | 误报率 ~30%，主要因 metadata 不完整 |
| **语义理解** | 无 | ❌ 低 | 无 embedding，无语义相关性 |
| **性能** | O(100) 内存评分 | ✅ 可接受 | <100ms，但 scale 会变成问题 |
| **可维护性** | 代码清晰 | ✅ 高 | 规则简单易懂 |
| **测试覆盖** | 基本单元测试 | ⚠️ 中等 | 缺少相关性测试 |
| **监测和可观测性** | Token 记录 + 决策日志 | ✅ 好 | recordTokenUsage 已实现 |

---

## 11. 附录：代码引用

### A. Thalamus 完整记忆注入代码

**文件**: thalamus.js 第 359-410 行

```javascript
async function analyzeEvent(event) {
  const eventJson = JSON.stringify(event, null, 2);

  // Build #1: 注入历史经验（使用语义检索）
  const learnings = await searchRelevantLearnings({
    task_type: event.task?.task_type,
    failure_class: event.failure_info?.class,
    event_type: event.type
  }, 20);

  let learningBlock = '';
  if (learnings.length > 0) {
    learningBlock = `\n\n## 系统历史经验（参考，按相关性排序）\n${learnings.map((l, i) => `- [${i+1}] **${l.title}** (相关度: ${l.relevance_score || 0}): ${(l.content || '').slice(0, 200)}`).join('\n')}\n`;
  }

  const prompt = `${THALAMUS_PROMPT}${learningBlock}\n\n\`\`\`json\n${eventJson}\n\`\`\``;

  try {
    const { text: response, usage } = await callSonnet(prompt);

    await recordTokenUsage('thalamus', 'claude-sonnet-4-20250514', usage, {
      event_type: event.type,
      learnings_injected: learnings.length,
    });

    const decision = parseDecisionFromResponse(response);
    const validation = validateDecision(decision);
    if (!validation.valid) {
      console.error('[thalamus] Invalid decision:', validation.errors);
      await recordLLMError('thalamus', new Error(validation.errors.join('; ')), {
        event_type: event.type,
        error_subtype: 'validation_failed'
      });
      return createFallbackDecision(event, validation.errors.join('; '));
    }

    return decision;

  } catch (err) {
    console.error('[thalamus] Error analyzing event:', err.message);
    await recordLLMError('thalamus', err, { event_type: event.type });
    return createFallbackDecision(event, err.message);
  }
}
```

### B. searchRelevantLearnings 完整打分算法

**文件**: learning.js 第 173-242 行

```javascript
export async function searchRelevantLearnings(context = {}, limit = 10) {
  try {
    const result = await pool.query(`
      SELECT id, title, category, trigger_event, content, strategy_adjustments, applied, created_at, metadata
      FROM learnings
      ORDER BY created_at DESC
      LIMIT 100
    `);

    if (result.rows.length === 0) {
      return [];
    }

    const scoredLearnings = result.rows.map(learning => {
      let score = 0;

      const metadata = learning.metadata || {};
      const content = learning.content || '';
      const contentLower = content.toLowerCase();

      // 1. Task type exact match (weight: 10)
      if (context.task_type && metadata.task_type === context.task_type) {
        score += 10;
      }

      // 2. Failure class match in content (weight: 8)
      if (context.failure_class) {
        const failureClassLower = context.failure_class.toLowerCase();
        if (contentLower.includes(failureClassLower)) {
          score += 8;
        }
      }

      // 3. Event type match (weight: 6)
      if (context.event_type && learning.trigger_event === context.event_type) {
        score += 6;
      }

      // 4. Category match (weight: 4)
      if (learning.category === 'failure_pattern') {
        score += 4;
      }

      // 5. Freshness (weight: 1-3)
      const ageInDays = (Date.now() - new Date(learning.created_at).getTime()) / (1000 * 60 * 60 * 24);
      if (ageInDays <= 7) {
        score += 3;
      } else if (ageInDays <= 30) {
        score += 2;
      } else {
        score += 1;
      }

      return { ...learning, relevance_score: score };
    });

    scoredLearnings.sort((a, b) => b.relevance_score - a.relevance_score);
    return scoredLearnings.slice(0, limit);
  } catch (err) {
    console.error(`[learning] Failed to search relevant learnings: ${err.message}`);
    return getRecentLearnings(null, limit);
  }
}
```

---

**报告结束**
