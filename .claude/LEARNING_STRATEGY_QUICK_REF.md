# Learning ↔ Strategy 快速参考表

## 关键函数速查

### Learning 模块 (learning.js)

```javascript
// 1. 记录学习
recordLearning(analysis) → Promise<learningRecord>
  输入: { task_id, analysis, recommended_actions, learnings, confidence }
  输出: { id, title, category, trigger_event, content, applied, ... }
  位置: 54 行

// 2. 应用策略调整
applyStrategyAdjustments(adjustments, learningId) → Promise<{ applied, skipped, errors }>
  输入: adjustments[], learningId
  输出: { applied: int, skipped: int, errors: [] }
  位置: 80 行

// 3. 评估策略有效性
evaluateStrategyEffectiveness(strategyKey, days=7) → Promise<effectivenessResult>
  输入: strategyKey: string, days: number
  输出: { strategy_key, baseline_success_rate, post_adjustment_success_rate, is_effective, improvement_percentage, ... }
  位置: 348 行
  现状: 只能手动调用

// 4. 搜索相关学习
searchRelevantLearnings(context, limit=10) → Promise<learnings[]>
  输入: { task_type, failure_class, event_type }
  输出: learnings[] with relevance_score
  位置: 173 行

// 5. 创建学习任务
createLearningTask(failureContext) → Promise<taskId>
  输入: { trigger, failures, signals }
  输出: taskId
  位置: 296 行

// 6. 检查是否触发学习
shouldTriggerLearning(failureInfo) → boolean
  输入: { is_systemic }
  输出: boolean
  位置: 281 行
```

### Cortex 模块 (cortex.js)

```javascript
// 执行 RCA 分析
performRCA(event, rcaContext) → Promise<analysisResult>
  输出包含:
    - analysis.root_cause
    - analysis.contributing_factors
    - actions[] (includes adjust_strategy)
    - strategy_updates[]
    - learnings[]
  关键行: 756 行转换 strategy_updates → strategy_adjustments
```

### Tick 模块 (tick.js)

```javascript
// 处理学习和策略
if (task.payload.requires_learning === true) {
  recordLearning(rcaResult)
  applyStrategyAdjustments(strategyAdjustments, learningId)
}
  位置: 508-552 行
```

---

## 数据库表速查

### learnings 表结构

| 字段 | 类型 | 用途 |
|------|------|------|
| id | UUID PK | 学习记录 ID |
| title | VARCHAR(255) | "RCA Learning: {root_cause}" |
| category | VARCHAR(50) | 'failure_pattern', 'optimization' |
| trigger_event | VARCHAR(100) | 'systemic_failure', 'alertness_emergency' |
| content | TEXT | JSON: { root_cause, contributing_factors, learnings } |
| strategy_adjustments | JSONB | 从 recommended_actions 提取 |
| applied | BOOLEAN | 是否已应用调整 |
| applied_at | TIMESTAMP | 应用时间 |
| created_at | TIMESTAMP | 创建时间 |
| metadata | JSONB | { task_id, confidence } |

### strategy_adoptions 表结构

| 字段 | 类型 | 关键信息 |
|------|------|----------|
| id | UUID PK | 采纳记录 ID |
| analysis_id | UUID FK → cortex_analyses | 关联的 RCA 分析 |
| strategy_key | TEXT | 策略参数名（如 'alertness.emergency_threshold'） |
| old_value | TEXT | 原始值 |
| new_value | TEXT | 新值 |
| adopted_at | TIMESTAMPTZ | 采纳时间 |
| adopted_by | TEXT | 采纳者 |
| effectiveness_score | INTEGER | 0-40 分 |
| evaluated_at | TIMESTAMPTZ | 评估时间（**缺失自动化**） |

### strategy_effectiveness 表结构

| 字段 | 类型 | 含义 |
|------|------|------|
| id | UUID PK | 评估记录 ID |
| adoption_id | UUID FK → strategy_adoptions | UNIQUE |
| strategy_key | TEXT | 参数名 |
| baseline_success_rate | NUMERIC(5,2) | 调整前成功率 (%) |
| post_adjustment_success_rate | NUMERIC(5,2) | 调整后成功率 (%) |
| sample_size | INTEGER | 评估样本数（任务数） |
| evaluation_period_days | INTEGER | 评估周期（默认 7） |
| is_effective | BOOLEAN | **improvement > 5%?** |
| improvement_percentage | NUMERIC(5,2) | 实际改善百分比 |

### brain_config 表（记录最终的参数值）

```javascript
{
  key: 'alertness.emergency_threshold',
  value: '0.8',  // JSON.stringify() 的值
  metadata: {
    learning_id: 'uuid',  // 审计链接
    old_value: 0.9,
    reason: 'Lower threshold for earlier detection',
    applied_at: '2026-02-18T...'
  }
}
```

---

## 白名单参数 (ADJUSTABLE_PARAMS)

| 参数 | 最小值 | 最大值 | 类型 |
|------|--------|--------|------|
| `alertness.emergency_threshold` | 0.5 | 1.0 | number |
| `alertness.alert_threshold` | 0.3 | 0.8 | number |
| `retry.max_attempts` | 1 | 5 | number |
| `retry.base_delay_minutes` | 1 | 30 | number |
| `resource.max_concurrent` | 1 | 20 | number |
| `resource.memory_threshold_mb` | 500 | 4000 | number |

**安全性**：
- ✅ 所有参数都在白名单中
- ✅ 都有严格的范围限制
- ✅ 单位、类型明确
- ✅ 所有调整都记录 learning_id 用于审计追溯

---

## 工作流程核心链路

### 链路 A：失败 → RCA → Learning → Strategy 应用

```
失败任务完成
  ↓ execution-callback (routes.js 1857)
  ├→ classifyFailure() [quarantine.js]
  ├→ triggerAutoRCA() (routes.js 2089)
  │  └→ performRCA(Cortex) → { analysis, strategy_updates, learnings }
  ↓
tick.js (下个周期)
  ├→ 发现任务有 requires_learning = true
  ├→ recordLearning(rcaResult) → learnings 表
  └→ applyStrategyAdjustments(adjustments, learningId) → brain_config 表
```

### 链路 B：Strategy 有效性评估【目前是手动的】

```
[7-10 天后]
  ↓ 手动 API: POST /api/brain/learning/evaluate-strategy
  ├→ evaluateStrategyEffectiveness(strategyKey, days=7)
  │  ├→ 查询 baseline success rate (before adoption)
  │  ├→ 查询 post success rate (after adoption)
  │  ├→ 比较: improvement > 5% ?
  │  └→ 保存到 strategy_effectiveness 表
  ↓ 更新 strategy_adoptions.effectiveness_score
  ↓ 结束【未来需要自动化】
```

### 链路 C：无效策略回滚【完全缺失】

```
【需要实现】
  ↓ 查询 strategy_effectiveness WHERE is_effective = false
  ├→ 找到对应的 strategy_adoptions
  └→ UPDATE brain_config SET value = old_value
  ↓ 记录回滚事件
  ↓ 标记相关 Learning 为 'ineffective'
```

---

## 3 个核心缺口

### 缺口 1️⃣：自动调度评估

```javascript
// 需要在 nightly-tick.js 中添加

async function scheduleStrategyEvaluations() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  
  const shouldEvaluate = await pool.query(`
    SELECT DISTINCT strategy_key FROM strategy_adoptions
    WHERE adopted_at <= $1 AND evaluated_at IS NULL
  `, [sevenDaysAgo]);
  
  for (const { strategy_key } of shouldEvaluate) {
    await evaluateStrategyEffectiveness(strategy_key, 7);
  }
}
```

### 缺口 2️⃣：自动回滚无效策略

```javascript
// 需要在 learning.js 中添加

export async function rollbackIneffectiveStrategies() {
  const ineffective = await pool.query(`
    SELECT sa.id, sa.strategy_key, sa.old_value
    FROM strategy_adoptions sa
    JOIN strategy_effectiveness se ON se.adoption_id = sa.id
    WHERE se.is_effective = false
  `);
  
  for (const { strategy_key, old_value } of ineffective) {
    await pool.query(`
      UPDATE brain_config SET value = $2 WHERE key = $1
    `, [strategy_key, JSON.stringify(old_value)]);
  }
}
```

### 缺口 3️⃣：反向链接（失效 Strategy → Learning）

```sql
-- 需要添加的字段
ALTER TABLE learnings ADD COLUMN effectiveness_status VARCHAR(50);
-- 值: 'pending' | 'effective' | 'ineffective' | 'obsolete'

ALTER TABLE learnings ADD COLUMN effectiveness_evaluated_at TIMESTAMP;

-- 或者新建关联表
CREATE TABLE learning_strategy_links (
  learning_id UUID REFERENCES learnings(id),
  adoption_id UUID REFERENCES strategy_adoptions(id),
  effectiveness_status VARCHAR(50),
  PRIMARY KEY (learning_id, adoption_id)
);
```

---

## API 端点速查

### 现有端点

```bash
# 手动评估单个策略
POST /api/brain/learning/evaluate-strategy
Body: { strategy_key: "alertness.emergency_threshold", days: 7 }
Response: { strategy_key, baseline_success_rate, post_adjustment_success_rate, is_effective, improvement_percentage, ... }
```

### 缺失端点（Priority）

```bash
# [P1] 批量评估所有未评估的策略
POST /api/brain/learning/evaluate-all
Response: { evaluated: int, failed: int, results: [...] }

# [P1] 回滚无效策略
POST /api/brain/learning/rollback-ineffective
Response: { rolled_back: int, failed: int, details: [...] }

# [P2] 反馈循环状态
GET /api/brain/learning/feedback-loop-status
Response: { 
  total_learnings: int, 
  total_strategies: int,
  effective: int, 
  ineffective: int,
  pending: int,
  timeline: [...]
}

# [P2] Effectiveness 报告
GET /api/brain/learning/effectiveness-report
Response: { period, strategies: [{ key, effectiveness, trend, ... }] }
```

---

## 测试文件 - 跑什么测试

```bash
# 运行现有的学习测试
npm test -- learning.test.js

# 运行有效性评估测试
npm test -- learning-effectiveness.test.js

# 运行学习搜索测试
npm test -- learning-search.test.js

# 【缺失】需要添加的测试
# - rollbackIneffectiveStrategies 的测试
# - 自动调度的集成测试
# - 反馈循环端到端测试
```

---

## 关键时间参数

| 参数 | 值 | 含义 |
|------|-----|------|
| Effectiveness 评估周期 | 7 天 | 调整后需要 7 天才能评估 |
| 采纳等待期 | 7 天 | 调整后 7 天，是否有足够数据 |
| 重新评估周期 | 10 天 | 定期重新评估（建议每 10 天） |
| 改善阈值 | 5% | 成功率提升 > 5% 才算有效 |
| Effectiveness 积分 | 0-40 分 | 最多 40 分（improvement * 4） |

---

## 调试技巧

### 查看最近的学习记录

```sql
SELECT id, title, category, trigger_event, applied, created_at
FROM learnings
ORDER BY created_at DESC
LIMIT 10;
```

### 查看策略采纳历史

```sql
SELECT sa.id, sa.strategy_key, sa.new_value, sa.adopted_at, sa.evaluated_at, se.is_effective
FROM strategy_adoptions sa
LEFT JOIN strategy_effectiveness se ON se.adoption_id = sa.id
ORDER BY sa.adopted_at DESC;
```

### 查看应用的参数值

```sql
SELECT key, value, metadata->>'learning_id' as learning_id, 
       metadata->>'applied_at' as applied_at
FROM brain_config
WHERE key IN ('alertness.emergency_threshold', 'retry.max_attempts', ...)
ORDER BY metadata->>'applied_at' DESC;
```

### 手动测试评估 API

```bash
curl -X POST http://localhost:5221/api/brain/learning/evaluate-strategy \
  -H "Content-Type: application/json" \
  -d '{
    "strategy_key": "alertness.emergency_threshold",
    "days": 7
  }'
```

---

## 关键发现总结

| 特性 | 状态 | 备注 |
|------|------|------|
| Learning 记录 | ✅ 完整 | recordLearning() |
| Strategy 应用 | ✅ 完整 | applyStrategyAdjustments() + 白名单 |
| Effectiveness 评估 | ✅ 算法完整 | 但只有手动 API，无自动化 |
| 自动化调度 | ❌ 缺失 | 需要 nightly-tick 集成 |
| 自动回滚 | ❌ 缺失 | 无法自动处理失效策略 |
| 反向链接 | ❌ 缺失 | 失效策略无法回溯至 Learning |
| API 覆盖 | 🟡 部分 | 1/5 个端点实现 |
| 测试覆盖 | 🟡 部分 | 3/5 个功能有测试 |

