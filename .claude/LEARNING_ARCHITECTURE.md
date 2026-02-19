# Cecelia Learning & Strategy 架构详图

## 1. 系统架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          CECELIA LEARNING ECOSYSTEM                         │
└─────────────────────────────────────────────────────────────────────────────┘

┌─── LAYER 0: 事件层 ──────────────────────────────────────────────────────┐
│                                                                             │
│  Failure Event  →  Task Failed  →  Repeated Failures  →  Systemic Issue  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─── LAYER 1: Thalamus (丘脑) ───────────────────────────────────────────────┐
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │ 1. 检索历史 Learning (searchRelevantLearnings)                      │  │
│  │    ├─ Task Type Match (weight: 10)                                 │  │
│  │    ├─ Failure Class Match (weight: 8)                             │  │
│  │    ├─ Event Type Match (weight: 6)                                │  │
│  │    ├─ Category Match (weight: 4)                                  │  │
│  │    └─ Freshness Score (weight: 1-3)                               │  │
│  │    ↓                                                                │  │
│  │    注入到 Sonnet 提示词作为背景                                     │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │ 2. Sonnet 快速判断 (Complexity Assessment)                         │  │
│  │    Level 0: 纯代码反应 (脑干)                                       │  │
│  │    Level 1: Sonnet 快速判断                                         │  │
│  │    Level 2: Opus 深度分析 → ESCALATE TO CORTEX                    │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
        ┌───────────────────────────┴───────────────────────────┐
        ↓                                                         ↓
┌─ LAYER 2a: Code-Based ─────────────┐   ┌─ LAYER 2b: Cortex (皮层) ────┐
│ (纯代码反应，不涉及 Learning)        │   │ (Opus 深度分析)              │
│                                     │   │                               │
│ • 标准重试逻辑                      │   │ ┌─────────────────────────┐  │
│ • 资源调整                          │   │ │ performRCA()            │  │
│ • 快速路由                          │   │ │ ├─ 注入历史 Learnings   │  │
│ • 无副作用                          │   │ │ ├─ 注入历史 Analyses    │  │
│                                     │   │ │ ├─ 深度分析 (Opus)     │  │
│                                     │   │ │ │  ├─ root_cause        │  │
│                                     │   │ │ │  ├─ contributing_factors
│                                     │   │ │ │  └─ impact_assessment │  │
│                                     │   │ │ ├─ 生成 strategy_updates│  │
│                                     │   │ │ ├─ 记录到 learnings    │  │
│                                     │   │ │ └─ 保存到 cortex_analyses
│                                     │   │ └─────────────────────────┘  │
│                                     │   │                               │
│                                     │   │  Cortex Output (Decision):   │
│                                     │   │  {                            │
│                                     │   │    level: 2,                  │
│                                     │   │    analysis: {...},           │
│                                     │   │    actions: [...],            │
│                                     │   │    strategy_updates: [{       │
│                                     │   │      key: "param_name",       │
│                                     │   │      old_value: "...",        │
│                                     │   │      new_value: "...",        │
│                                     │   │      reason: "..."            │
│                                     │   │    }],                        │
│                                     │   │    learnings: [...],          │
│                                     │   │    confidence: 0-1            │
│                                     │   │  }                            │
└─────────────────────────────────────┘   └─────────────────────────────┘
        ↓                                           ↓
        └───────────────────────┬───────────────────┘
                                ↓
┌─── LAYER 3: Decision Executor ──────────────────────────────────────────────┐
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ executeActions(decision)                                             │  │
│  │ ├─ FOR EACH action in decision.actions:                             │  │
│  │ │  ├─ create_task()    → 创建任务                                   │  │
│  │ │  ├─ cancel_task()    → 取消任务                                   │  │
│  │ │  ├─ retry_task()     → 重试任务                                   │  │
│  │ │  ├─ create_learning() → 保存学习 [需修复]                          │  │
│  │ │  ├─ record_learning() → 记录学习 [需修复]                          │  │
│  │ │  ├─ trigger_rca()    → 触发根因分析                               │  │
│  │ │  └─ ...                                                            │  │
│  │ │                                                                    │  │
│  │ └─ FOR EACH strategy_update in decision.strategy_updates:           │  │
│  │    └─ applyStrategyAdjustments(update)                              │  │
│  │       ├─ 验证白名单 ✓                                                │  │
│  │       ├─ 验证范围 ✓                                                  │  │
│  │       ├─ 更新 brain_config (ON CONFLICT DO UPDATE)                  │  │
│  │       ├─ 记录 metadata (learning_id, old_value, reason, applied_at) │  │
│  │       └─ 更新 learnings.applied = true                              │  │
│  │                                                                      │  │
│  │       [缺失] 应该插入 strategy_adoptions 记录                        │  │
│  │                                                                      │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─── LAYER 4: Storage & Tracking ─────────────────────────────────────────────┐
│                                                                             │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌────────────────┐  │
│  │  learnings 表        │  │ brain_config 表      │  │ strategy_*表  │  │
│  │ ─────────────────────│  │ ──────────────────────│  │ ─────────────-│  │
│  │ • id                 │  │ • key (PK)           │  │ adoptions:   │  │
│  │ • title              │  │ • value (JSONB)      │  │ • strategy_key
│  │ • category           │  │ • updated_at         │  │ • old_value  │  │
│  │ • trigger_event      │  │ • metadata (JSONB)   │  │ • new_value  │  │
│  │ • content (TEXT)     │  │                      │  │ • adopted_at │  │
│  │ • strategy_adjustmnt │  │ 示例:                │  │ • effectiveness_score
│  │ • applied ✓          │  │ {                    │  │              │  │
│  │ • applied_at         │  │   "key": "retry...  │  │ effectiveness:
│  │ • created_at         │  │   "value": {"..."}  │  │ • baseline_rate
│  │ • metadata (JSONB)   │  │   "metadata": {      │  │ • post_rate  │  │
│  │                      │  │     "learning_id": "
│  │ 索引:                │  │     "old_value": "..
│  │ • category           │  │     "reason": "...  │  │ • improvement│  │
│  │ • trigger_event      │  │     "applied_at": " │  │ • is_effective
│  │ • created_at         │  │   }                  │  │              │  │
│  │ • applied            │  │ }                    │  │              │  │
│  └──────────────────────┘  └──────────────────────┘  └────────────────┘  │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ cortex_analyses 表                                                   │  │
│  │ ├─ id, task_id, failure_class                                       │  │
│  │ ├─ root_cause, contributing_factors, mitigations                    │  │
│  │ ├─ quality_score, similarity_hash, duplicate_of                     │  │
│  │ ├─ user_feedback, reoccurrence_count                                │  │
│  │ └─ created_at, updated_at                                           │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─── LAYER 5: 效果评估 (7+ 天后) ──────────────────────────────────────────────┐
│                                                                             │
│  evaluateStrategyEffectiveness(strategy_key, days=7)                       │
│  ├─ 找采纳记录: SELECT FROM strategy_adoptions WHERE strategy_key = ...   │
│  ├─ 计算基线: 采纳前 7 天的成功率                                         │
│  ├─ 计算目标: 采纳后 7 天的成功率                                         │
│  ├─ 判断有效: improvement > 5% ?                                          │
│  ├─ 保存评估: INSERT INTO strategy_effectiveness                          │
│  └─ 评分: effectiveness_score = min(40, floor(improvement * 4))           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 数据流向示意

### 2.1 Learning 记录流
```
RCA Analysis (Cortex)
├─ decision.learnings = ["经验1", "经验2"]
├─ decision.actions (包含 record_learning 或隐含)
└─ decision.strategy_updates = [
     { key, old_value, new_value, reason }
   ]
     ↓
recordLearning(analysis)
├─ Extract: action.type === 'adjust_strategy' → strategy_adjustments
└─ INSERT INTO learnings (
     title: "RCA Learning: {root_cause}",
     category: "failure_pattern",
     trigger_event: "systemic_failure",
     content: { root_cause, contributing_factors, learnings },
     strategy_adjustments: JSONB,
     metadata: { task_id, confidence }
   )
     ↓
learnings 表
└─ applied=false (未应用状态)
```

### 2.2 Strategy 应用流
```
strategy_updates (from Cortex)
[ 
  { key: "retry.max_attempts", old_value: 3, new_value: 5, reason: "..." }
]
     ↓
Convert → strategy_adjustments
[
  { type: "adjust_strategy", params: { param: "retry.max_attempts", ... } }
]
     ↓
Decision Executor
└─ applyStrategyAdjustments(adjustments, learningId)
   ├─ FOR EACH adjustment:
   │  ├─ Validate: ADJUSTABLE_PARAMS[param] exists?
   │  ├─ Validate: min <= value <= max?
   │  ├─ INSERT INTO brain_config (key, value, metadata)
   │  │  ON CONFLICT (key) DO UPDATE
   │  │  metadata: { learning_id, old_value, reason, applied_at }
   │  └─ applied++ (计数)
   │
   └─ UPDATE learnings SET applied=true WHERE id=$learningId
     ↓
brain_config
└─ key="retry.max_attempts", value=5, metadata={...}

[缺失流程]:
└─ INSERT INTO strategy_adoptions (
     strategy_key, old_value, new_value, adopted_at, adopted_by
   )
```

### 2.3 效果评估流
```
7+ 天后
     ↓
evaluateStrategyEffectiveness("retry.max_attempts", days=7)
├─ 1. Get adoption record
│  └─ SELECT FROM strategy_adoptions WHERE strategy_key = "retry.max_attempts"
│     adopted_at = T0
│
├─ 2. Calculate baseline (T0-7 ~ T0)
│  └─ SELECT COUNT(*), SUM(completed) FROM tasks 
│     WHERE created_at >= T0-7 AND created_at < T0
│     baseline_rate = completed/total * 100
│
├─ 3. Calculate post (T0 ~ T0+7)
│  └─ SELECT COUNT(*), SUM(completed) FROM tasks
│     WHERE created_at >= T0 AND created_at < T0+7
│     post_rate = completed/total * 100
│
├─ 4. Evaluate effectiveness
│  ├─ improvement = post_rate - baseline_rate
│  └─ is_effective = improvement > 5%
│
├─ 5. Insert into strategy_effectiveness
│  └─ INSERT INTO strategy_effectiveness (
│       adoption_id, baseline_success_rate, post_adjustment_success_rate,
│       improvement_percentage, is_effective
│     )
│
└─ 6. Update adoption score
   └─ UPDATE strategy_adoptions
      SET effectiveness_score = is_effective ? min(40, floor(improvement*4)) : 0
         WHERE id = adoption_id
       ↓
strategy_effectiveness & strategy_adoptions
└─ Result: { is_effective: true/false, improvement: +12.5% }
```

---

## 3. 白名单与约束

### 3.1 ADJUSTABLE_PARAMS 白名单
```javascript
{
  'alertness.emergency_threshold': {
    min: 0.5, max: 1.0, type: 'number',
    desc: '系统紧急模式的触发阈值'
  },
  'alertness.alert_threshold': {
    min: 0.3, max: 0.8, type: 'number',
    desc: '系统告警阈值'
  },
  'retry.max_attempts': {
    min: 1, max: 5, type: 'number',
    desc: '最大重试次数'
  },
  'retry.base_delay_minutes': {
    min: 1, max: 30, type: 'number',
    desc: '基础重试延迟（分钟）'
  },
  'resource.max_concurrent': {
    min: 1, max: 20, type: 'number',
    desc: '最大并发任务数'
  },
  'resource.memory_threshold_mb': {
    min: 500, max: 4000, type: 'number',
    desc: '内存阈值（MB）'
  }
}
```

### 3.2 ACTION_WHITELIST 中的 Learning Actions
```
Thalamus Level (LEVEL 1):
├─ create_learning ✓
├─ update_learning ✓
└─ trigger_rca ✓

Cortex Level (LEVEL 2 扩展):
├─ adjust_strategy ✓ (dangerous=true, 需要验证)
├─ record_learning ✓
└─ create_rca_report ✓
```

### 3.3 Strategy Update 约束
```
生成约束:
├─ 只能调整白名单中的参数 (ADJUSTABLE_PARAMS)
├─ new_value 必须在允许范围内 [min, max]
└─ 必须提供 reason 字段（审计追踪）

应用约束:
├─ 白名单验证
├─ 范围验证
└─ ON CONFLICT (key) 处理并发更新

评估约束:
├─ 采纳后必须 >= 7 天才能评估
├─ 改进 > 5% 才算有效
└─ 基线和目标样本数都必须 > 0
```

---

## 4. 关键路径映射

### 4.1 从 Learning 到 Strategy (完整路径)

```
INPUT:  Cortex RCA Decision
        {
          strategy_updates: [
            { key: "X", old_value: A, new_value: B, reason: "Y" }
          ]
        }

PATH 1: Implicit (当前实现)
        cortex.js:performRCA() 
        └─ Extract strategy_updates → strategy_adjustments
           └─ decision-executor 调用 applyStrategyAdjustments()
              └─ learning.js:applyStrategyAdjustments()
                 └─ 更新 brain_config

PATH 2: Explicit (应该有但缺失)
        decision-executor.js:adjust_strategy()
        ├─ 验证 strategy_updates
        └─ 调用 applyStrategyAdjustments()

PATH 3: Via Actions (混合)
        Cortex 生成 action:
        { type: "adjust_strategy", params: {...} }
        └─ decision-executor:adjust_strategy()
           └─ applyStrategyAdjustments()

OUTPUT: brain_config 更新 + strategy_adoptions 记录 [缺失]
```

### 4.2 从 Strategy 到评估 (完整路径)

```
CHECKPOINT: T0 (策略采纳时刻)
            ├─ 插入 strategy_adoptions [缺失]
            │  { strategy_key, old_value, new_value, adopted_at=NOW(), adopted_by }
            └─ 更新 brain_config
               { key, value, metadata: { learning_id, old_value, reason } }

WAIT:       7 天 (evaluation_period_days = 7)

TRIGGER:    T0 + 7 (或更晚)
            evaluateStrategyEffectiveness(strategy_key, days=7)
            ├─ Get adoption record from strategy_adoptions
            ├─ Query baseline (T0-7 ~ T0)
            ├─ Query post (T0 ~ T0+7)
            ├─ Calculate improvement
            └─ Store in strategy_effectiveness

OUTPUT:     strategy_effectiveness 表
            + strategy_adoptions.effectiveness_score 更新
```

---

## 5. 缺失部分详细规范

### 5.1 Strategy Adoptions 记录缺失

**应该在**: `learning.js:applyStrategyAdjustments()` 完成后

```javascript
// 当前实现停在这里：
UPDATE learnings SET applied=true WHERE id=$learningId;

// 应该继续：
FOR EACH successfully applied adjustment:
  INSERT INTO strategy_adoptions (
    analysis_id: null,  // 需要从 learningId 反向查询
    strategy_key: paramName,
    old_value: old_value,
    new_value: new_value,
    adopted_at: NOW(),
    adopted_by: 'system',
    effectiveness_score: null  // 等待 7 天后评估
  ) RETURNING id;
  
  // 然后可以用这个 adoption_id 链接未来的评估
```

**影响**: 
- 无法追踪策略采纳历史
- 效果评估需要另外查询 brain_config.metadata，容易出错

### 5.2 Decision-Executor 中的缺失实现

**缺失 1**: async adjust_strategy() 处理函数

```javascript
// 应该在 decision-executor.js 的 actionHandlers 中添加：
async adjust_strategy(params, context) {
  const { adjustments, learning_id } = params;
  
  if (!Array.isArray(adjustments)) {
    return { success: false, error: 'adjustments must be array' };
  }
  
  const { applyStrategyAdjustments } = await import('./learning.js');
  const result = await applyStrategyAdjustments(adjustments, learning_id);
  
  return {
    success: result.applied > 0,
    applied: result.applied,
    skipped: result.skipped,
    errors: result.errors
  };
}
```

**缺失 2**: create_learning() 实现错误

```javascript
// 当前错误实现（在 decision-executor.js）:
async create_learning(params, context) {
  const { content, tags = [], source_task_id = null } = params;
  // 直接插入 learnings 表（但 learnings 表的 schema 不支持 tags）
  // 应该调用 learning.js:recordLearning()
}

// 正确实现应该：
async create_learning(params, context) {
  const { title, category, content, trigger_event } = params;
  const { recordLearning } = await import('./learning.js');
  
  // 或直接插入：
  const result = await pool.query(`
    INSERT INTO learnings (title, category, trigger_event, content, metadata)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id
  `, [title, category, trigger_event, content, JSON.stringify({})]);
  
  return { success: true, learning_id: result.rows[0].id };
}
```

**缺失 3**: record_learning() 实现不完整

```javascript
// 当前实现只记录到 cecelia_events：
async record_learning(params, context) {
  await pool.query(`
    INSERT INTO cecelia_events (event_type, source, payload)
    VALUES ('learning', 'cortex', $1)
  `, [...]);
}

// 应该真正写入 learnings 表：
async record_learning(params, context) {
  const { learning, category, analysis_id } = params;
  const { recordLearning } = await import('./learning.js');
  
  const result = await pool.query(`
    INSERT INTO learnings (
      title, category, trigger_event, content, metadata
    ) VALUES ($1, $2, $3, $4, $5)
    RETURNING id
  `, [
    learning,
    category || 'general',
    'cortex_analysis',
    JSON.stringify({ analysis_id }),
    JSON.stringify({})
  ]);
  
  return { success: true, learning_id: result.rows[0].id };
}
```

---

## 6. 实现优先级

| 优先级 | 类别 | 具体任务 | 影响 |
|--------|------|--------|------|
| P0 | 缺失功能 | Strategy Adoptions 记录 | 无法追踪策略历史 |
| P0 | Bug 修复 | decision-executor 的 Learning Actions | 无法正确执行 |
| P1 | API | Learning 管理 API (GET/POST/SEARCH) | 用户无法查询 |
| P1 | API | Strategy 管理 API (GET/DELETE) | 用户无法管理策略 |
| P2 | 测试 | 完整端到端集成测试 | 质量保障 |
| P2 | 文档 | Strategy Adjustment Protocol | 可维护性 |
| P3 | 优化 | Parameter 版本管理 | 并发安全 |
| P3 | 扩展 | 多维度 Learning 搜索 | 更好的相关性 |

