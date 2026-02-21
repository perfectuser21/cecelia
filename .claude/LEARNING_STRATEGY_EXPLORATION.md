# Cecelia Core - Learning 到 Strategy 自动化探索报告

## 执行摘要

在 cecelia/core 中，Learning 和 Strategy 已建立完整的数据结构和部分工作流，但**缺少关键的自动化连接**：

- ✅ Learning 数据结构完整（learnings 表）
- ✅ Strategy Adoption 数据结构完整（strategy_adoptions 表）
- ✅ Strategy Effectiveness 评估能力（strategy_effectiveness 表）
- ✅ Cortex 生成 strategy_updates
- ✅ Tick 记录 Learning 并应用 Strategy Adjustments
- ❌ **缺失：自动触发 Effectiveness 评估的机制**
- ❌ **缺失：基于 Effectiveness 自动更新 Strategy 的流程**
- ❌ **缺失：反馈循环（失败 → RCA → Learning → Strategy 更新 → 验证）**

---

## 1. 相关文件路径和关键函数

### 核心实现文件

| 文件 | 职责 | 关键函数 |
|------|------|---------|
| `/home/xx/perfect21/cecelia/core/brain/src/learning.js` | Learning 生命周期 | `recordLearning`, `applyStrategyAdjustments`, `evaluateStrategyEffectiveness`, `searchRelevantLearnings` |
| `/home/xx/perfect21/cecelia/core/brain/src/cortex.js` | 深度分析+策略生成 | `performRCA`, 产生 `strategy_updates` 在 decision 中 |
| `/home/xx/perfect21/cecelia/core/brain/src/tick.js` | 任务调度和学习应用 | 第 508-552 行，处理 `requires_learning` 任务 |
| `/home/xx/perfect21/cecelia/core/brain/src/routes.js` | API 端点 | `/api/brain/learning/evaluate-strategy` (4625-4638 行) |
| `/home/xx/perfect21/cecelia/core/brain/src/executor.js` | 任务执行 | 处理失败分类和重试策略 |

### 数据库 Migration 文件

| Migration | 功能 | 关键表 |
|-----------|------|--------|
| `012_learnings_table.sql` | 学习记录存储 | `learnings` |
| `015_cortex_quality_system.sql` | Cortex 质量和策略采纳 | `cortex_analyses`, `strategy_adoptions` |
| `016_immune_system_connections.sql` | 策略有效性追踪 | `strategy_effectiveness` |

### 测试文件

| 文件 | 测试范围 |
|------|---------|
| `/home/xx/perfect21/cecelia/core/brain/src/__tests__/learning.test.js` | Learning 记录、Adjustment 应用、任务创建 |
| `/home/xx/perfect21/cecelia/core/brain/src/__tests__/learning-effectiveness.test.js` | Effectiveness 评估算法 |
| `/home/xx/perfect21/cecelia/core/brain/src/__tests__/learning-search.test.js` | Learning 搜索和相关性评分 |

---

## 2. Learning 数据结构

### learnings 表（Migration 012）

```sql
CREATE TABLE learnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  category VARCHAR(50),  -- 'failure_pattern', 'optimization', 'strategy_adjustment'
  trigger_event VARCHAR(100),  -- 'systemic_failure', 'alertness_emergency', etc.
  content TEXT,  -- 学习内容描述（JSON 字符串）
  strategy_adjustments JSONB,  -- 策略调整建议（从 Cortex recommended_actions 提取）
  applied BOOLEAN DEFAULT false,  -- 调整是否已应用
  applied_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  metadata JSONB  -- { task_id, confidence, ... }
);

索引：
- idx_learnings_category
- idx_learnings_trigger_event
- idx_learnings_created_at
- idx_learnings_applied
```

### Learning 对象结构（从 recordLearning 参数）

```javascript
{
  task_id: string,
  analysis: {
    root_cause: string,
    contributing_factors: string[],
    impact_assessment: string,
  },
  recommended_actions: [
    {
      type: 'adjust_strategy' | 'pause_p2_tasks' | ...,
      params: {
        param: 'alertness.emergency_threshold',
        old_value: number,
        new_value: number,
        reason: string
      }
    }
  ],
  learnings: string[],  // 关键学习点数组
  confidence: number  // 0-1
}
```

### brain_config 表（记录调整后的参数）

调整应用后的记录：
```javascript
{
  key: 'alertness.emergency_threshold',
  value: JSON.stringify(0.8),
  metadata: {
    learning_id: uuid,
    old_value: 0.9,
    reason: 'Lower threshold for earlier detection',
    applied_at: ISO8601
  }
}
```

---

## 3. Strategy 数据结构

### strategy_adoptions 表（Migration 015）

```sql
CREATE TABLE strategy_adoptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID REFERENCES cortex_analyses(id) ON DELETE CASCADE,
  strategy_key TEXT NOT NULL,  -- e.g. 'alertness.emergency_threshold'
  old_value TEXT,
  new_value TEXT NOT NULL,
  adopted_at TIMESTAMPTZ,
  adopted_by TEXT,
  effectiveness_score INTEGER,  -- 0-40 points (max)
  evaluated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

索引：
- idx_strategy_adoptions_analysis_id
- idx_strategy_adoptions_strategy_key
```

### strategy_effectiveness 表（Migration 016）

```sql
CREATE TABLE strategy_effectiveness (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  adoption_id UUID UNIQUE REFERENCES strategy_adoptions(id) ON DELETE CASCADE,
  strategy_key TEXT NOT NULL,
  baseline_success_rate NUMERIC(5,2),  -- 调整前的成功率
  post_adjustment_success_rate NUMERIC(5,2),  -- 调整后的成功率
  sample_size INTEGER,  -- 评估任务数
  evaluation_period_days INTEGER DEFAULT 7,
  is_effective BOOLEAN,  -- 成功率提升 > 5%
  improvement_percentage NUMERIC(5,2),  -- 实际提升百分比
  evaluated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

索引：
- idx_strategy_effectiveness_strategy_key
```

### Cortex 输出中的 strategy_updates

```javascript
decision.strategy_updates: [
  {
    key: 'alertness.emergency_threshold',
    old_value: 0.9,
    new_value: 0.8,
    reason: 'Lower threshold for earlier detection'
  }
]
```

### ADJUSTABLE_PARAMS 白名单（learning.js 第 16-23 行）

```javascript
const ADJUSTABLE_PARAMS = {
  'alertness.emergency_threshold': { min: 0.5, max: 1.0, type: 'number' },
  'alertness.alert_threshold': { min: 0.3, max: 0.8, type: 'number' },
  'retry.max_attempts': { min: 1, max: 5, type: 'number' },
  'retry.base_delay_minutes': { min: 1, max: 30, type: 'number' },
  'resource.max_concurrent': { min: 1, max: 20, type: 'number' },
  'resource.memory_threshold_mb': { min: 500, max: 4000, type: 'number' },
};
```

---

## 4. 当前两者之间的关联逻辑

### 工作流程 1：RCA 触发 → Learning 记录 → Strategy 应用

**位置**：`tick.js` 第 507-552 行

```javascript
// 步骤 1：Cortex 执行 RCA 分析
const rcaResult = await performRCA({
  task_id, 
  failureInfo, 
  recentFailures
});

// 步骤 2：如果任务标记为 requires_learning = true
if (task.payload.requires_learning === true) {
  // 2.1 记录学习（包含 strategy_adjustments）
  const learningRecord = await recordLearning(rcaResult);
  
  // 2.2 应用策略调整
  const strategyAdjustments = rcaResult.recommended_actions?.filter(
    action => action.type === 'adjust_strategy'
  );
  
  if (strategyAdjustments.length > 0) {
    const applyResult = await applyStrategyAdjustments(
      strategyAdjustments,
      learningRecord.id
    );
  }
}
```

### 工作流程 2：Strategy Adjustment 应用

**位置**：`learning.js` 第 80-162 行

```javascript
export async function applyStrategyAdjustments(adjustments, learningId) {
  // 遍历每个调整
  for (const adjustment of adjustments) {
    const paramName = adjustment.params.param;
    const newValue = adjustment.params.new_value;
    
    // 1. 白名单校验
    const paramConfig = ADJUSTABLE_PARAMS[paramName];
    if (!paramConfig) {
      // 跳过未白名单的参数
      continue;
    }
    
    // 2. 范围校验
    if (newValue < paramConfig.min || newValue > paramConfig.max) {
      // 跳过超出范围的值
      continue;
    }
    
    // 3. 应用到 brain_config
    await pool.query(`
      INSERT INTO brain_config (key, value, metadata)
      VALUES ($1, $2, $3)
      ON CONFLICT (key) DO UPDATE SET ...
    `, [paramName, JSON.stringify(newValue), metadata]);
  }
  
  // 4. 标记 learning 为已应用
  await pool.query(`
    UPDATE learnings SET applied = true, applied_at = NOW()
    WHERE id = $1
  `, [learningId]);
}
```

### 工作流程 3：Strategy Effectiveness 评估（手动 API 调用）

**位置**：`learning.js` 第 348-493 行 + `routes.js` 第 4625-4638 行

```javascript
// API 端点
router.post('/learning/evaluate-strategy', async (req, res) => {
  const { strategy_key, days = 7 } = req.body;
  const result = await evaluateStrategyEffectiveness(strategy_key, days);
  res.json(result);
});

// 评估函数
export async function evaluateStrategyEffectiveness(strategyKey, days = 7) {
  // 1. 找到最近的 strategy_adoptions 记录
  const adoption = await pool.query(`
    SELECT * FROM strategy_adoptions
    WHERE strategy_key = $1
    ORDER BY adopted_at DESC LIMIT 1
  `, [strategyKey]);
  
  // 2. 计算调整前的成功率（调整前 7 天）
  const baselineResult = await pool.query(`
    SELECT COUNT(*) AS total, 
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
    FROM tasks
    WHERE created_at BETWEEN $1 AND $2
  `);
  
  // 3. 计算调整后的成功率（调整后 7 天）
  const postResult = await pool.query(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
    FROM tasks
    WHERE created_at BETWEEN $1 AND $2
  `);
  
  // 4. 判断是否有效（improvement > 5%）
  const isEffective = (postSuccessRate - baselineSuccessRate) > 5;
  
  // 5. 保存到 strategy_effectiveness 表
  await pool.query(`
    INSERT INTO strategy_effectiveness (...)
    VALUES (...)
  `);
  
  // 6. 更新 strategy_adoptions.effectiveness_score
  const effectivenessScore = isEffective
    ? Math.min(40, Math.floor(improvement * 4))
    : 0;
  
  return result;
}
```

---

## 5. 缺失的关键功能（Gap 分析）

### Gap 1：自动触发 Effectiveness 评估

**当前状态**：
- ✅ `evaluateStrategyEffectiveness()` 函数存在，但只通过手动 API 调用
- ❌ 没有自动调度机制

**缺失内容**：
```javascript
// 需要在 tick.js 或 nightly-tick.js 中添加：
async function evaluateAllAdoptedStrategies() {
  // 1. 找所有已采纳但未评估的 strategy_adoptions
  const unevaluated = await pool.query(`
    SELECT DISTINCT strategy_key FROM strategy_adoptions
    WHERE adopted_at < NOW() - INTERVAL '7 days'
      AND evaluated_at IS NULL
  `);
  
  // 2. 对每个策略评估有效性
  for (const { strategy_key } of unevaluated) {
    await evaluateStrategyEffectiveness(strategy_key, 7);
  }
}
```

### Gap 2：基于 Effectiveness 的自动 Strategy 更新

**当前状态**：
- ✅ Strategy Effectiveness 数据保存，但不进行任何自动化操作
- ❌ 没有机制在策略被判定为"无效"时进行自动反转或调整

**缺失内容**：
```javascript
// 需要实现的逻辑：
async function rollbackIneffectiveStrategies() {
  // 1. 找所有无效的 strategy_adoptions
  const ineffective = await pool.query(`
    SELECT sa.id, sa.strategy_key, sa.new_value, sa.old_value
    FROM strategy_adoptions sa
    JOIN strategy_effectiveness se ON se.adoption_id = sa.id
    WHERE se.is_effective = false
  `);
  
  // 2. 回滚到旧值
  for (const { strategy_key, old_value } of ineffective) {
    await pool.query(`
      INSERT INTO brain_config (key, value)
      VALUES ($1, $2)
      ON CONFLICT (key) DO UPDATE SET value = $2
    `, [strategy_key, JSON.stringify(old_value)]);
    
    // 3. 记录回滚事件
    await pool.query(`
      INSERT INTO learning_strategy_rollbacks (strategy_key, reason, rolled_back_at)
      VALUES ($1, 'Ineffective strategy', NOW())
    `);
  }
}
```

### Gap 3：完整的反馈循环自动化

**当前状态**：
- ✅ Learning 记录存储
- ✅ Strategy 应用
- ✅ Effectiveness 评估（手动触发）
- ❌ 没有端到端的自动化编排

**缺失内容**（高层流程）：
```
失败任务
  ↓
自动 RCA (execution-callback 第 2089-2102 行触发)
  ↓
记录 Learning + 应用 Strategy (tick.js 第 508-526 行)
  ↓
[缺失] 调度 Effectiveness 评估任务（7-10 天后）
  ↓
[缺失] 如果无效，自动回滚或调整
  ↓
[缺失] 记录反馈循环完成并更新 Cortex 决策库
```

### Gap 4：Strategy → Learning 的反向链接

**当前状态**：
- ✅ Learning 表有 `strategy_adjustments` 字段
- ✅ `strategy_adoptions` 有 `analysis_id` 指向 Cortex 分析
- ❌ 当 Strategy 无效时，没有机制回溯到原 Learning 记录并标记为"已失效"

**缺失表或字段**：
```sql
-- 建议添加
ALTER TABLE learnings ADD COLUMN IF NOT EXISTS effectiveness_status VARCHAR(50);
-- 值: 'pending' | 'effective' | 'ineffective' | 'obsolete'

ALTER TABLE learnings ADD COLUMN IF NOT EXISTS effectiveness_evaluated_at TIMESTAMP;

-- 或者创建关联表
CREATE TABLE learning_strategy_effectiveness_links (
  learning_id UUID REFERENCES learnings(id),
  strategy_adoption_id UUID REFERENCES strategy_adoptions(id),
  effectiveness_status VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 6. API 端点现状

### 已实现

| 端点 | 方法 | 功能 | 位置 |
|------|------|------|------|
| `/api/brain/learning/evaluate-strategy` | POST | 手动评估单个策略的有效性 | routes.js 4625 |

### 缺失

| 端点 | 方法 | 功能 | 优先级 |
|------|------|------|--------|
| `/api/brain/learning/evaluate-all` | POST | 批量评估所有未评估的策略 | P1 |
| `/api/brain/learning/rollback-ineffective` | POST | 回滚无效策略 | P1 |
| `/api/brain/learning/feedback-loop-status` | GET | 查看反馈循环的进度（失败 → 学习 → 策略 → 验证） | P2 |
| `/api/brain/learning/effectiveness-report` | GET | 生成 Strategy Effectiveness 报告 | P2 |

---

## 7. 时序和调度缺口

### 问题

Effectiveness 评估需要 7-10 天的数据，但目前没有自动调度机制。

### 解决方案

在 `nightly-tick.js` 或新的 `strategy-evaluation-loop.js` 中添加：

```javascript
// 每天夜间运行一次
export async function runStrategyEvaluationLoop() {
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  
  // 找所有应该被评估的 strategy_adoptions
  const shouldEvaluate = await pool.query(`
    SELECT DISTINCT strategy_key
    FROM strategy_adoptions
    WHERE adopted_at <= $1
      AND (evaluated_at IS NULL OR evaluated_at < adopted_at + INTERVAL '10 days')
  `, [oneWeekAgo]);
  
  for (const { strategy_key } of shouldEvaluate) {
    await evaluateStrategyEffectiveness(strategy_key, 7);
  }
}
```

---

## 8. 优先级修复清单

### Phase 1：建立反馈循环的自动化基础（P0）

- [ ] 在 `learning.js` 中添加 `rollbackIneffectiveStrategies()` 函数
- [ ] 在 `nightly-tick.js` 中添加自动评估调度
- [ ] 添加 API 端点 `/api/brain/learning/rollback-ineffective`
- [ ] 添加数据库字段跟踪策略有效性状态

### Phase 2：完善反馈循环（P1）

- [ ] 建立 Learning ↔ Strategy Effectiveness 的链接（新表或字段）
- [ ] 实现策略无效时的自动反向追溯（标记 Learning 为 `ineffective`）
- [ ] 添加 API `/api/brain/learning/feedback-loop-status`

### Phase 3：可观测性和报告（P2）

- [ ] 实现完整的 Effectiveness 报告 API
- [ ] 添加 Dashboard 可视化（在 workspace）
- [ ] 添加警报机制（策略连续失败时告警）

---

## 9. 数据流图

```
失败任务
  │
  ├─→ execution-callback (routes.js 2089-2102)
  │    │
  │    └─→ triggerAutoRCA() → performRCA(Cortex)
  │
  ├─→ Cortex 输出
  │    ├─ analysis.root_cause
  │    ├─ analysis.contributing_factors
  │    ├─ actions (execute 或 route)
  │    └─ strategy_updates (新的参数值)
  │
  ├─→ tick.js 处理 RCA 结果
  │    │
  │    ├─ recordLearning(rcaResult)  [learnings 表]
  │    │  ├─ title, category, content
  │    │  ├─ strategy_adjustments (从 actions 提取)
  │    │  └─ metadata (task_id, confidence)
  │    │
  │    └─ applyStrategyAdjustments()  [brain_config 表 + learnings.applied = true]
  │       ├─ 白名单检查
  │       ├─ 范围检查
  │       └─ INSERT/UPDATE brain_config
  │
  │ [**缺失**：自动调度评估]
  │
  ├─→ [7-10 天后，需要自动化触发] evaluateStrategyEffectiveness()  [strategy_effectiveness 表]
  │    ├─ 查询调整前的成功率
  │    ├─ 查询调整后的成功率
  │    ├─ 比较：improvement > 5% ?
  │    └─ 保存结果到 strategy_effectiveness
  │
  │ [**缺失**：基于结果的自动化操作]
  │
  └─→ [if is_effective = false] **需要实现**
       ├─ rollbackIneffectiveStrategies()
       │  └─ UPDATE brain_config (restore old_value)
       ├─ 记录回滚事件
       └─ 标记 Learning 为 ineffective
```

---

## 10. 关键发现

1. **架构完整性**：
   - 数据表、存储结构完整
   - Learning 记录和 Strategy 应用逻辑已实现
   - Effectiveness 评估算法已实现

2. **自动化缺口**：
   - ❌ 没有自动调度 Effectiveness 评估
   - ❌ 没有基于评估结果的自动化回滚
   - ❌ 没有反向链接（失效的 Strategy → 标记相关 Learning）

3. **可观测性缺口**：
   - ❌ 没有完整的反馈循环状态追踪
   - ❌ 没有 Dashboard 可视化
   - ❌ 没有警报/通知机制

4. **关键参数安全性**：
   - ✅ ADJUSTABLE_PARAMS 白名单完整（6 个参数）
   - ✅ 参数范围校验严格
   - ✅ 所有调整都记录 learning_id 用于审计

---

## 11. 测试覆盖度

| 功能 | 测试文件 | 覆盖度 |
|------|---------|--------|
| recordLearning | learning.test.js | ✅ 完整 |
| applyStrategyAdjustments | learning.test.js | ✅ 完整（包括白名单和范围检查） |
| evaluateStrategyEffectiveness | learning-effectiveness.test.js | ✅ 完整 |
| searchRelevantLearnings | learning-search.test.js | ✅ 完整 |
| [缺失] rollbackIneffectiveStrategies | - | ❌ 不存在 |
| [缺失] 自动调度 | - | ❌ 不存在 |

---

## 结论

Cecelia Core 已为 Learning → Strategy 自动化奠定坚实基础，但**缺少中间层的自动化编排**。主要任务是：

1. 实现自动化的 Effectiveness 评估调度（nightly-tick 集成）
2. 实现无效策略的自动回滚机制
3. 建立完整的反馈循环追踪和可观测性

这三项工作可以在 2-3 周内完成，并将极大提升 Cecelia 的自学习能力。

