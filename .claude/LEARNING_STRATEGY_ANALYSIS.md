# Cecelia Core Learning & Strategy 系统完整分析

## 1. Learning 相关功能现有实现

### 1.1 核心模块：learning.js
**路径**: `/home/xx/perfect21/cecelia/core/brain/src/learning.js`

**主要功能**:
1. **recordLearning()** - 记录 Cortex RCA 分析的学习
   - 输入：RCA 分析结果（task_id, analysis, learnings, recommended_actions）
   - 存储到 learnings 表（title, category, trigger_event, content, strategy_adjustments）
   - 提取 adjust_strategy 类型的 action 存储为 strategy_adjustments

2. **applyStrategyAdjustments()** - 应用策略调整到 brain_config
   - 验证参数是否在 ADJUSTABLE_PARAMS 白名单内
   - 检查新值是否在允许范围内（min/max）
   - 将调整写入 brain_config 表（ON CONFLICT DO UPDATE）
   - 记录 learning_id 和元数据用于审计追踪
   - 更新 learnings.applied = true

3. **searchRelevantLearnings()** - 语义检索相关学习
   - 按相关度评分（task_type match: 10分, failure_class: 8分, event_type: 6分）
   - 考虑新鲜度（7天内+3分, 30天内+2分）
   - 返回前 N 条最相关的学习记录

4. **getRecentLearnings()** - 获取最近学习（后备方案）

5. **shouldTriggerLearning()** - 判断是否触发学习
   - 仅对 is_systemic 失败触发

6. **createLearningTask()** - 创建学习任务（派发给 Cortex）
   - task_type='research', priority='P1'
   - 包含失败上下文、信号、所需分析

7. **evaluateStrategyEffectiveness()** - 评估策略调整效果（7+ 天后）
   - 比较采纳前后的成功率
   - 计算改进百分比
   - 存储到 strategy_effectiveness 表
   - 更新 strategy_adoptions 的 effectiveness_score

**ADJUSTABLE_PARAMS 白名单**:
```javascript
{
  'alertness.emergency_threshold': { min: 0.5, max: 1.0, type: 'number' },
  'alertness.alert_threshold': { min: 0.3, max: 0.8, type: 'number' },
  'retry.max_attempts': { min: 1, max: 5, type: 'number' },
  'retry.base_delay_minutes': { min: 1, max: 30, type: 'number' },
  'resource.max_concurrent': { min: 1, max: 20, type: 'number' },
  'resource.memory_threshold_mb': { min: 500, max: 4000, type: 'number' },
}
```

### 1.2 Thalamus 中的 Learning Actions
**路径**: `/home/xx/perfect21/cecelia/core/brain/src/thalamus.js`

在 ACTION_WHITELIST 中定义的学习相关 action:
```javascript
// 知识/学习操作
'create_learning': { dangerous: false, description: '保存经验教训到 learnings 表' },
'update_learning': { dangerous: false, description: '更新已有 learning 记录' },
'trigger_rca': { dangerous: false, description: '触发根因分析 (RCA) 流程' },
```

Thalamus 会在处理事件时注入历史学习：
```javascript
const learnings = await searchRelevantLearnings({
  task_type: ...,
  failure_class: ...,
  event_type: ...
}, 10);

learningBlock = `\n\n## 系统历史经验（参考，按相关性排序）\n...`;
```

### 1.3 Cortex 中的 Learning 处理
**路径**: `/home/xx/perfect21/cecelia/core/brain/src/cortex.js`

Cortex 的扩展 action 列表：
```javascript
const CORTEX_ACTION_WHITELIST = {
  ...ACTION_WHITELIST,
  'adjust_strategy': { dangerous: true, description: '调整系统策略参数' },
  'record_learning': { dangerous: false, description: '记录学习到的经验' },
  'create_rca_report': { dangerous: false, description: '创建根因分析报告' },
};
```

Cortex 输出格式包含：
```json
{
  "level": 2,
  "analysis": { "root_cause": "...", "contributing_factors": [...] },
  "actions": [...],
  "strategy_updates": [
    {"key": "param_name", "old_value": "...", "new_value": "...", "reason": "..."}
  ],
  "learnings": ["learning1", "learning2"],
  "absorption_policy": {...},  // OPTIONAL
  "rationale": "...",
  "confidence": 0.0-1.0,
  "safety": false
}
```

Cortex 处理流程：
1. 记录 learnings：`recordLearnings(decision.learnings, event)` (第 404 行)
2. 存储 absorption_policy (第 408-419 行)
3. 提取 strategy_updates 并转换为 strategy_adjustments
4. 保存到 cortex_analyses

---

## 2. Strategy 相关功能现有实现

### 2.1 数据库 Schema

#### learnings 表 (Migration 012)
```sql
CREATE TABLE learnings (
  id UUID PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  category VARCHAR(50),  -- 'failure_pattern', 'optimization', 'strategy_adjustment'
  trigger_event VARCHAR(100),  -- 'systemic_failure', 'alertness_emergency'
  content TEXT,  -- Learning content description
  strategy_adjustments JSONB,  -- Strategy adjustment recommendations
  applied BOOLEAN DEFAULT false,  -- Whether adjustments have been applied
  applied_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  metadata JSONB
);
```

#### strategy_adoptions 表 (Migration 015)
```sql
CREATE TABLE strategy_adoptions (
  id UUID PRIMARY KEY,
  analysis_id UUID REFERENCES cortex_analyses(id),
  strategy_key TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT NOT NULL,
  adopted_at TIMESTAMPTZ,
  adopted_by TEXT,
  effectiveness_score INTEGER,  -- 评分结果（0-40）
  evaluated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### strategy_effectiveness 表 (Migration 016)
```sql
CREATE TABLE strategy_effectiveness (
  id UUID PRIMARY KEY,
  adoption_id UUID UNIQUE REFERENCES strategy_adoptions(id),
  strategy_key TEXT NOT NULL,
  baseline_success_rate NUMERIC(5,2),
  post_adjustment_success_rate NUMERIC(5,2),
  sample_size INTEGER,
  evaluation_period_days INTEGER DEFAULT 7,
  is_effective BOOLEAN,  -- Success rate improvement > 5%
  improvement_percentage NUMERIC(5,2),
  evaluated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### brain_config 表（存储策略参数）
```sql
CREATE TABLE brain_config (
  key TEXT PRIMARY KEY,
  value JSONB,
  updated_at TIMESTAMP,
  metadata JSONB  -- 包含 learning_id, old_value, reason, applied_at
);
```

### 2.2 Strategy 更新流程

**完整流程**:
```
1. 系统失败（重复失败模式）
   ↓
2. Thalamus 检测到需要深度分析，升级到 Level 2
   ↓
3. Cortex (Opus) 执行 RCA：
   - 分析根本原因
   - 识别可调整的策略参数
   - 生成 strategy_updates 建议
   ↓
4. 转换 strategy_updates → strategy_adjustments
   - key → params.param
   - new_value → params.new_value
   - old_value → params.old_value
   - reason → params.reason
   ↓
5. recordLearning() 记录分析结果到 learnings 表
   - title: "RCA Learning: {root_cause}"
   - category: "failure_pattern"
   - trigger_event: "systemic_failure"
   - strategy_adjustments: JSONB
   ↓
6. applyStrategyAdjustments() 应用到 brain_config
   - 验证白名单 ✓
   - 验证范围 ✓
   - 更新 brain_config (ON CONFLICT DO UPDATE)
   - 更新 learnings.applied = true
   ↓
7. 效果评估（7+ 天后）
   evaluateStrategyEffectiveness():
   - 获取采纳记录
   - 计算采纳前 7 天的成功率（基线）
   - 计算采纳后 7 天的成功率（目标）
   - 判断是否有效（改进 > 5%）
   - 存储到 strategy_effectiveness
```

### 2.3 API 端点

**POST /api/brain/learning/evaluate-strategy**
```javascript
// 用途：评估特定策略的调整效果
Request: { strategy_key: string, days?: number }
Response: {
  strategy_key: string,
  adoption_id: UUID,
  baseline_success_rate: number,
  post_adjustment_success_rate: number,
  improvement_percentage: number,
  is_effective: boolean,
  sample_size: integer,
  evaluation_period_days: integer
}
```

---

## 3. 目前 Learning 如何被记录和使用

### 3.1 Recording (记录)
- **触发时机**: 当 Cortex RCA 完成时
- **记录方式**: `recordLearning()` 将分析结果写入 learnings 表
- **包含内容**: root_cause, contributing_factors, learnings 数组, strategy_adjustments
- **元数据**: task_id, confidence

### 3.2 Searching (检索)
- **使用时机**: Thalamus 处理新事件时
- **搜索方式**: `searchRelevantLearnings()` 按多维度评分
  - Task type 匹配 (weight: 10)
  - Failure class 匹配 (weight: 8)
  - Event type 匹配 (weight: 6)
  - Category 匹配 (weight: 4)
  - 新鲜度 (weight: 1-3)
- **注入位置**: Thalamus 会将检索到的学习作为背景信息注入到 Sonnet 提示词
- **可见性**: Sonnet 可以参考历史学习来快速判断，避免重复分析

### 3.3 Application (应用)
- **应用对象**: brain_config 中的可调整参数
- **应用方式**: ON CONFLICT (key) DO UPDATE
- **审计追踪**: metadata 字段记录 learning_id, old_value, reason, applied_at
- **验证机制**: 白名单 + 范围检查

---

## 4. Learning 到 Strategy 更新的当前流程

### 4.1 完整端到端流程

```
Failure Event
├─ Thalamus 分析
│  ├─ 注入历史 learnings (searchRelevantLearnings)
│  └─ 判断复杂度 → Level 0/1/2
│
├─ Level 2: 升级到 Cortex
│  ├─ Cortex.analyzeDeep()
│  │  ├─ 注入相关 learnings (第 344-357 行)
│  │  ├─ 注入历史分析 (searchRelevantAnalyses)
│  │  └─ 调用 Opus LLM
│  │
│  └─ Opus 返回决策
│     ├─ analysis { root_cause, contributing_factors, impact_assessment }
│     ├─ actions []
│     ├─ strategy_updates [{ key, old_value, new_value, reason }]
│     ├─ learnings []
│     ├─ absorption_policy? {}
│     └─ confidence & rationale
│
├─ Cortex.performRCA()
│  ├─ 提取 strategy_updates
│  ├─ 转换为 strategy_adjustments
│  ├─ 保存到 cortex_analyses 表
│  └─ 返回 analysisResult
│
└─ Decision Executor
   └─ executeActions()
      ├─ 如果有 adjust_strategy action:
      │  └─ applyStrategyAdjustments()
      │     ├─ 验证白名单 ✓
      │     ├─ 验证值范围 ✓
      │     ├─ 更新 brain_config
      │     └─ 更新 learnings.applied = true
      │
      └─ 如果有 record_learning action:
         └─ 记录到 cecelia_events
```

### 4.2 关键接触点

| 步骤 | 文件 | 函数 | 作用 |
|------|------|------|------|
| 1. 检索历史学习 | learning.js | searchRelevantLearnings() | 为 Thalamus/Cortex 提供背景 |
| 2. RCA 分析 | cortex.js | performRCA() | 生成 strategy_updates |
| 3. 策略转换 | cortex.js | performRCA() (756-772) | strategy_updates → strategy_adjustments |
| 4. 记录学习 | learning.js | recordLearning() | 将分析存入 learnings |
| 5. 应用调整 | learning.js | applyStrategyAdjustments() | 写入 brain_config |
| 6. 评估效果 | learning.js | evaluateStrategyEffectiveness() | 计算 ROI (7+ 天后) |

---

## 5. 缺失的实现部分

### 5.1 关键缺失

1. **Strategy Adoption 记录**
   - `strategy_adoptions` 表已存在，但没有代码主动插入采纳记录
   - 应该在 `applyStrategyAdjustments()` 完成时插入记录
   - 需要包含：analysis_id, strategy_key, old_value, new_value, adopted_at, adopted_by

2. **Cortex 决策中的 adjust_strategy Action**
   - ACTION_WHITELIST 中只有 create_learning, update_learning, trigger_rca
   - Cortex 的 CORTEX_ACTION_WHITELIST 中有 adjust_strategy
   - 但 decision-executor.js 中没有对应的 async adjust_strategy() 处理函数
   - 目前只能通过 strategy_updates 隐式应用

3. **Learning 的 API 端点缺失**
   - 没有 GET /api/brain/learnings - 查询学习记录
   - 没有 GET /api/brain/learnings/:id - 获取单条学习
   - 没有 POST /api/brain/learnings - 手动创建学习
   - 没有 POST /api/brain/learning/search - 搜索相关学习

4. **Strategy 的管理 API 缺失**
   - 没有 GET /api/brain/strategy/adoptions - 查看所有采纳
   - 没有 GET /api/brain/strategy/adoptions/:key - 查看特定策略的采纳历史
   - 没有 GET /api/brain/strategy/effectiveness - 效果总览
   - 没有 DELETE /api/brain/strategy/:key - 回滚策略调整

5. **Learning 中缺失关键字段**
   - learnings 表中缺少 `effectiveness_score` 字段（应参考 strategy_adoptions）
   - learnings 表中缺少 `task_types` 数组（应支持多任务类型匹配）
   - learnings 表中缺少 `failure_classes` 数组（应支持多失败类别匹配）
   - metadata 中没有标准化的 task_type 字段

6. **策略参数版本管理**
   - 当 Cortex 生成 strategy_updates 时，如何验证 old_value 与当前值一致？
   - 没有版本号，容易导致并发冲突
   - brain_config 应该加上 version/revision 字段

7. **Learning 链接追踪**
   - learnings 表中没有 corpus_analysis_id 字段，无法追踪来源
   - strategy_adjustments 中没有记录哪个 learning 被应用
   - 反向追踪链断裂：cortex_analysis → learnings → brain_config

8. **Decision-Executor 中的 Learning Action 实现**
   - create_learning() 的实现有问题（在 learning.js 中不存在对应函数）
   - update_learning() 也没有对应实现
   - record_learning() 只是记录到 cecelia_events，没有真正存入 learnings 表

### 5.2 测试覆盖缺失

- `learning.test.js`: 测试 recordLearning, applyStrategyAdjustments ✓
- `learning-effectiveness.test.js`: 测试 evaluateStrategyEffectiveness ✓
- 缺失: searchRelevantLearnings 的集成测试
- 缺失: Strategy Adoptions 的完整流程测试
- 缺失: Cortex strategy_updates 到 brain_config 的端到端测试

### 5.3 文档缺失

- 没有 Strategy Adjustment Protocol 文档
- 没有 Learning to Strategy 的决策树文档
- 没有 Absorption Policy 与 Learning 的关系说明
- 没有 Parameter Whitelist 的扩展指南

---

## 6. 代码关键片段

### 6.1 Learning 记录流程
```javascript
// cortex.js - 第 403-405 行
if (decision.learnings && decision.learnings.length > 0) {
  await recordLearnings(decision.learnings, event);
}

// learning.js - recordLearning()
export async function recordLearning(analysis) {
  const strategyAdjustments = recommended_actions?.filter(
    action => action.type === 'adjust_strategy'
  ) || [];
  
  await pool.query(`
    INSERT INTO learnings (title, category, trigger_event, content, strategy_adjustments, metadata)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [...]);
}
```

### 6.2 Strategy 应用流程
```javascript
// learning.js - applyStrategyAdjustments()
for (const adjustment of adjustments) {
  const paramName = params.param;
  const newValue = params.new_value;
  
  // 验证白名单
  const paramConfig = ADJUSTABLE_PARAMS[paramName];
  if (!paramConfig) {
    results.errors.push({ adjustment, reason: 'param_not_whitelisted' });
    continue;
  }
  
  // 验证范围
  if (newValue < paramConfig.min || newValue > paramConfig.max) {
    results.errors.push({ adjustment, reason: 'value_out_of_range' });
    continue;
  }
  
  // 应用到 brain_config
  await pool.query(`
    INSERT INTO brain_config (key, value, updated_at, metadata)
    VALUES ($1, $2, NOW(), $3)
    ON CONFLICT (key) DO UPDATE SET value = $2, metadata = $3
  `, [paramName, JSON.stringify(newValue), JSON.stringify({
    learning_id: learningId,
    old_value: params.old_value,
    reason: params.reason,
    applied_at: new Date().toISOString()
  })]);
}
```

### 6.3 Strategy 效果评估
```javascript
// learning.js - evaluateStrategyEffectiveness()
// 1. 找到采纳记录
const adoption = (await pool.query(`
  SELECT id, adopted_at, strategy_key, old_value, new_value
  FROM strategy_adoptions
  WHERE strategy_key = $1
  ORDER BY adopted_at DESC LIMIT 1
`, [strategyKey])).rows[0];

// 2. 计算采纳前基线（前 7 天）
const baselineSuccessRate = ...;

// 3. 计算采纳后成功率（后 7 天）
const postSuccessRate = ...;

// 4. 判断是否有效（改进 > 5%）
const isEffective = postSuccessRate - baselineSuccessRate > 5;

// 5. 保存效果评估
await pool.query(`
  INSERT INTO strategy_effectiveness (...) 
  VALUES (...)
`);

// 6. 更新 effectiveness_score
const effectivenessScore = isEffective
  ? Math.min(40, Math.floor(improvement * 4))
  : 0;
```

---

## 7. 总结

### 核心现状
- **Learning 系统**: 90% 实现，能记录/检索/注入历史
- **Strategy 系统**: 70% 实现，能生成建议/应用调整/评估效果
- **集成**: 70% 完成，缺少 API 和完整的管理界面

### 下一步建议
1. **Priority 1**: 修复 decision-executor 中的 Learning Action 实现
2. **Priority 2**: 补全 Strategy Adoption 记录机制
3. **Priority 3**: 添加 Learning/Strategy 管理 API
4. **Priority 4**: 扩展参数白名单和版本管理
5. **Priority 5**: 编写完整的集成测试

