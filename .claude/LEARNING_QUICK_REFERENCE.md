# Cecelia Learning & Strategy 快速参考卡

## 1. 核心文件一览

### 主要实现文件
| 文件 | 行数 | 主要函数 | 完成度 |
|------|------|--------|--------|
| `brain/src/learning.js` | 498 | recordLearning, applyStrategyAdjustments, searchRelevantLearnings, evaluateStrategyEffectiveness | 90% ✓ |
| `brain/src/thalamus.js` | ~1000 | ACTION_WHITELIST (Learning Actions), searchRelevantLearnings 注入 | 85% ✓ |
| `brain/src/cortex.js` | ~800 | performRCA, strategy_updates 生成和转换 | 90% ✓ |
| `brain/src/decision-executor.js` | ~400 | actionHandlers (Learning Actions) | 70% ⚠️ |
| `brain/src/routes.js` | ~5000+ | API 端点 | 60% ⚠️ |

### 数据库
| 表名 | 迁移 | 功能 | 状态 |
|------|------|------|------|
| learnings | 012 | 存储学习记录 | ✓ |
| brain_config | (base) | 存储策略参数 | ✓ |
| strategy_adoptions | 015 | 策略采纳记录 | ⚠️ (表存在但代码未使用) |
| strategy_effectiveness | 016 | 效果评估 | ✓ |

---

## 2. 关键函数速查

### Learning 相关

#### recordLearning(analysis)
```javascript
功能: 记录 Cortex RCA 分析的学习
输入: {
  task_id, analysis, learnings, recommended_actions, confidence
}
输出: learnings 表记录
核心逻辑:
  1. 提取 adjust_strategy action → strategy_adjustments
  2. INSERT INTO learnings
  3. 返回记录 ID
状态: ✓ 完整实现
位置: brain/src/learning.js:34-72
```

#### applyStrategyAdjustments(adjustments, learningId)
```javascript
功能: 应用策略调整到 brain_config
输入: adjustments 数组, learningId
输出: { applied, skipped, errors }
核心逻辑:
  FOR EACH adjustment:
    ├─ 验证白名单
    ├─ 验证范围 [min, max]
    ├─ UPDATE brain_config (ON CONFLICT DO UPDATE)
    ├─ 记录 metadata (learning_id, old_value, reason)
    └─ applied++
  UPDATE learnings.applied = true
缺失: 应该插入 strategy_adoptions 记录 ❌
位置: brain/src/learning.js:80-162
```

#### searchRelevantLearnings(context, limit=10)
```javascript
功能: 按相关度检索历史学习
输入: { task_type, failure_class, event_type }, limit
输出: 排序的学习记录数组
评分: task_type(10) + failure_class(8) + event_type(6) + 
       category(4) + freshness(1-3)
用途: Thalamus/Cortex 注入背景信息
状态: ✓ 完整实现
位置: brain/src/learning.js:173-242
```

#### evaluateStrategyEffectiveness(strategyKey, days=7)
```javascript
功能: 评估策略调整是否有效（7+ 天后）
输入: strategy_key, evaluation_period_days
输出: {
  baseline_success_rate, post_adjustment_success_rate,
  improvement_percentage, is_effective, sample_size
}
核心逻辑:
  1. GET adoption record FROM strategy_adoptions
  2. 计算采纳前 7 天成功率 (基线)
  3. 计算采纳后 7 天成功率 (目标)
  4. improvement = post - baseline
  5. is_effective = improvement > 5%
  6. INSERT INTO strategy_effectiveness
  7. UPDATE adoption.effectiveness_score
状态: ✓ 完整实现
位置: brain/src/learning.js:348-493
```

### Strategy 相关

#### strategy_updates (Cortex 输出)
```javascript
格式: [{
  key: "param_name",
  old_value: 3,
  new_value: 5,
  reason: "Increase retry attempts to handle transient network failures"
}]

转换过程:
  cortex.js:performRCA() 第 756-763 行
  → strategy_adjustments [{
      type: "adjust_strategy",
      params: {
        param: "retry.max_attempts",
        new_value: 5,
        current_value: 3,
        reason: "..."
      }
    }]
```

---

## 3. Learning & Strategy 完整流程

```
┌─ 事件阶段
Failure Event → Thalamus → Level 2? → Cortex.performRCA()

├─ 分析阶段
Cortex.analyzeDeep()
├─ 注入历史 learnings (searchRelevantLearnings) ✓
├─ Opus 分析 (LLM)
└─ 生成 Decision {
    analysis, actions, strategy_updates,
    learnings, confidence
  }

├─ 记录阶段
├─ recordLearning() → learnings 表 ✓
└─ 存储到 cortex_analyses ✓

├─ 执行阶段
Decision Executor
├─ FOR action: execute(action)
│  ├─ create_task() ✓
│  ├─ create_learning() ⚠️ [bug]
│  ├─ record_learning() ⚠️ [bug]
│  └─ trigger_rca() ✓
│
└─ FOR strategy_update: apply()
   ├─ applyStrategyAdjustments() ✓
   ├─ UPDATE brain_config ✓
   ├─ UPDATE learnings.applied ✓
   └─ INSERT strategy_adoptions ❌ [缺失]

├─ 评估阶段 (7+ 天后)
└─ evaluateStrategyEffectiveness()
   ├─ GET adoption record ❌ (数据来源有问题)
   ├─ 计算 baseline/post ✓
   ├─ INSERT strategy_effectiveness ✓
   └─ UPDATE adoption.effectiveness_score ✓
```

---

## 4. 可调整参数 (ADJUSTABLE_PARAMS 白名单)

```javascript
'alertness.emergency_threshold': { min: 0.5, max: 1.0 }
'alertness.alert_threshold': { min: 0.3, max: 0.8 }
'retry.max_attempts': { min: 1, max: 5 }
'retry.base_delay_minutes': { min: 1, max: 30 }
'resource.max_concurrent': { min: 1, max: 20 }
'resource.memory_threshold_mb': { min: 500, max: 4000 }
```

---

## 5. ACTION_WHITELIST 中的 Learning Actions

### Thalamus Level (Level 1)
```javascript
'create_learning': 保存经验教训到 learnings 表
'update_learning': 更新已有 learning 记录
'trigger_rca': 触发根因分析 (RCA) 流程
```

### Cortex Level (Level 2 扩展)
```javascript
'adjust_strategy': 调整系统策略参数 (dangerous=true)
'record_learning': 记录学习到的经验
'create_rca_report': 创建根因分析报告
```

---

## 6. 关键缺失部分

### P0 - 致命 (影响核心流程)

#### 1. Strategy Adoptions 记录缺失
```
位置: brain/src/learning.js:162 后
应该添加:
  FOR EACH successfully applied adjustment:
    INSERT INTO strategy_adoptions (
      strategy_key, old_value, new_value,
      adopted_at, adopted_by
    )
```

#### 2. Decision-Executor Learning Actions
```
缺失:
  ├─ async adjust_strategy(params, context)
  ├─ async create_learning() - 实现有 bug
  └─ async record_learning() - 实现不完整

影响:
  - Cortex 无法通过 action 应用策略
  - 无法通过 action 创建/记录学习
```

### P1 - 重要 (功能不完整)

```
├─ Learning 管理 API
│  ├─ GET /api/brain/learnings
│  ├─ GET /api/brain/learnings/:id
│  ├─ POST /api/brain/learnings
│  └─ POST /api/brain/learning/search
│
├─ Strategy 管理 API
│  ├─ GET /api/brain/strategy/adoptions
│  ├─ GET /api/brain/strategy/adoptions/:key
│  ├─ GET /api/brain/strategy/effectiveness
│  └─ DELETE /api/brain/strategy/:key
│
└─ Learning 表扩展
   ├─ effectiveness_score
   ├─ task_types (array)
   ├─ failure_classes (array)
   └─ cortex_analysis_id
```

---

## 7. 测试清单

### 已有 ✓
- `learning.test.js` - recordLearning, applyStrategyAdjustments, ADJUSTABLE_PARAMS
- `learning-effectiveness.test.js` - evaluateStrategyEffectiveness 完整流程

### 缺失 ❌
- searchRelevantLearnings 集成测试
- Strategy Adoptions 完整流程
- Cortex strategy_updates → brain_config 端到端
- Decision-Executor Learning Actions 集成
- 并发更新冲突测试

---

## 8. 快速验证命令

```bash
# 检查 Learning 表数据
psql -h localhost -U cecelia -d cecelia \
  -c "SELECT COUNT(*) as learning_count FROM learnings;"

# 检查 Strategy Adoptions 使用
grep -r "strategy_adoptions" brain/src/*.js

# 检查缺失的 adjust_strategy
grep -n "async adjust_strategy" brain/src/decision-executor.js

# 运行现有测试
npm test -- learning.test.js
npm test -- learning-effectiveness.test.js

# 检查 API 端点
grep -n "learning/evaluate-strategy" brain/src/routes.js
```

---

## 9. 修复优先级 (Roadmap)

| 优先级 | 任务 | 估计工作量 | 影响 |
|--------|------|----------|------|
| P0 | 添加 strategy_adoptions 记录 | 1-2h | Critical |
| P0 | 修复 decision-executor Learning Actions | 2-3h | Critical |
| P1 | 添加 Learning 管理 API | 3-4h | High |
| P1 | 添加 Strategy 管理 API | 3-4h | High |
| P2 | 完整的集成测试 | 4-6h | Medium |
| P2 | 参数版本管理 | 2-3h | Medium |
| P3 | 多维度检索优化 | 2-3h | Low |

**总工作量**: 17-25 小时 (3-4 天)

---

## 10. 文件导航快速链接

```
核心模块:
  brain/src/learning.js (498 行)
  brain/src/thalamus.js (~1000 行)
  brain/src/cortex.js (~800 行)

缺失修复:
  brain/src/decision-executor.js (~400 行) ⚠️
  brain/src/routes.js (~5000 行) ⚠️

数据库:
  brain/migrations/012_learnings_table.sql
  brain/migrations/015_cortex_quality_system.sql
  brain/migrations/016_immune_system_connections.sql

测试:
  brain/src/__tests__/learning.test.js
  brain/src/__tests__/learning-effectiveness.test.js

文档 (本次分析生成):
  .claude/LEARNING_STRATEGY_ANALYSIS.md
  .claude/LEARNING_ARCHITECTURE.md
  .claude/LEARNING_STRATEGY_FINAL_SUMMARY.md
  .claude/LEARNING_QUICK_REFERENCE.md (本文件)
```

---

## 11. 关键概念速记

### Learning (学习)
- 记录系统分析的经验教训
- 从 Cortex RCA 中提取
- 存储到 learnings 表
- 按相关度检索并注入到 LLM 提示词
- 帮助 LLM 快速识别重复问题

### Strategy (策略)
- 调整 Brain 的系统参数
- Cortex 生成 strategy_updates 建议
- 由 Decision Executor 应用
- 在白名单范围内调整
- 7+ 天后评估效果

### 策略采纳 (Strategy Adoption)
- 策略从 brain_config 更新的时刻
- 应记录采纳时间、参数、数值变化
- 用于追踪历史和计算效果
- **目前缺失记录** ❌

### 效果评估 (Effectiveness Evaluation)
- 对比采纳前后的成功率
- 需要 >= 7 天数据
- 改进 > 5% 才算有效
- 评分 = min(40, floor(improvement × 4))
- 结果存储到 strategy_effectiveness

---

**快速参考卡版本**: 1.0
**最后更新**: 2026-02-18
**作用**: 在修复和扩展时快速查阅
