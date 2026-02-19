# Learning ↔ Strategy 自动化体系 - 文档索引

生成时间：2026-02-18
探索范围：Cecelia Core 学习系统的完整架构和缺口分析

---

## 📚 文档导航

### 1. 快速开始（5 分钟）
👉 **LEARNING_STRATEGY_QUICK_REF.md**
- 关键函数速查
- 数据库表结构简表
- 3 个核心缺口的代码片段
- API 端点现状
- 调试技巧

### 2. 完整探索报告（20 分钟）
👉 **LEARNING_STRATEGY_EXPLORATION.md**
- 11 个章节的详尽分析
- Gap 分析
- 工作流程逐行代码解读
- 优先级修复清单
- 测试覆盖度评估

### 3. 本索引文档（2 分钟）
👉 **LEARNING_STRATEGY_INDEX.md**（当前文件）
- 文档导航
- 关键发现速览
- 问题快速定位

---

## 🎯 关键发现速览

### 架构完整度

| 层级 | 状态 | 关键组件 |
|------|------|---------|
| **数据存储** | ✅ 完整 | learnings, strategy_adoptions, strategy_effectiveness, brain_config |
| **业务逻辑** | ✅ 完整 | recordLearning, applyStrategyAdjustments, evaluateStrategyEffectiveness |
| **自动化流程** | 🟡 部分 | 缺少：评估调度、无效回滚、反向链接 |
| **API 端点** | 🟡 部分 | 1/5 个实现（仅 evaluate-strategy） |
| **可观测性** | ❌ 缺失 | 无反馈循环追踪、无 Dashboard、无警报 |

### 3 个核心缺口

1. **自动调度 Effectiveness 评估**
   - 现状：evaluateStrategyEffectiveness() 只能手动 API 调用
   - 需要：nightly-tick 集成，7 天后自动触发

2. **无效策略自动回滚**
   - 现状：没有 rollbackIneffectiveStrategies() 函数
   - 需要：自动检测 is_effective=false，回滚到旧值

3. **反向链接和可观测性**
   - 现状：失效策略无法追溯至原 Learning
   - 需要：建立 Learning ↔ Strategy Effectiveness 的双向链接

---

## 🔍 问题快速定位

### "我想了解 Learning 怎么工作"
👉 快速参考 → 关键函数速查 → recordLearning()
👉 详细探索 → 第 2 章：Learning 数据结构

### "我想了解 Strategy 怎么工作"
👉 快速参考 → 数据库表速查 → strategy_adoptions 表
👉 详细探索 → 第 3 章：Strategy 数据结构

### "我想了解两者如何关联"
👉 快速参考 → 工作流程核心链路（3 个链路）
👉 详细探索 → 第 4 章：当前关联逻辑

### "我想看缺口的代码是什么"
👉 快速参考 → 3 个核心缺口（完整代码）
👉 详细探索 → 第 5 章：缺失的关键功能

### "我想看白名单参数有什么"
👉 快速参考 → 白名单参数表（6 个参数，范围限制）
👉 详细探索 → ADJUSTABLE_PARAMS 配置

### "我想知道后续怎么做"
👉 快速参考 → 缺失端点（Priority）+ API 速查
👉 详细探索 → 第 8 章：优先级修复清单

### "我想看数据流全景图"
👉 详细探索 → 第 9 章：数据流图（完整的失败→学习→策略流程）

### "我想查看测试覆盖"
👉 详细探索 → 第 11 章：测试覆盖度

---

## 📂 相关源文件速查

### 核心实现文件

| 文件 | 行数 | 关键函数 | 优先度 |
|------|------|---------|--------|
| learning.js | 496 | recordLearning, applyStrategyAdjustments, evaluateStrategyEffectiveness | P0 |
| cortex.js | 800+ | performRCA (生成 strategy_updates) | P0 |
| tick.js | 1500+ | 学习应用流程 (508-552 行) | P0 |
| routes.js | 183KB | /api/brain/learning/evaluate-strategy (4625 行) | P1 |
| nightly-tick.js | - | 【缺失】应该在这里添加自动调度 | P1 |

### 数据库 Migration 文件

| 文件 | 功能 | 表名 |
|------|------|------|
| 012_learnings_table.sql | Learning 记录存储 | learnings |
| 015_cortex_quality_system.sql | Cortex 质量 + Strategy 采纳 | cortex_analyses, strategy_adoptions |
| 016_immune_system_connections.sql | Strategy 有效性追踪 | strategy_effectiveness |

### 测试文件

```
learning.test.js                      ✅ recordLearning, applyStrategyAdjustments
learning-effectiveness.test.js        ✅ evaluateStrategyEffectiveness
learning-search.test.js               ✅ searchRelevantLearnings

【缺失】
rollback-ineffective.test.js          ❌ 不存在
strategy-scheduling.test.js           ❌ 不存在
feedback-loop-integration.test.js     ❌ 不存在
```

---

## 💾 数据库关键表

### learnings 表
- 9 个字段：id, title, category, trigger_event, content, strategy_adjustments, applied, applied_at, created_at, metadata
- 4 个索引：category, trigger_event, created_at, applied
- 作用：存储 RCA 分析得出的学习记录

### strategy_adoptions 表
- 10 个字段：id, analysis_id, strategy_key, old_value, new_value, adopted_at, adopted_by, effectiveness_score, evaluated_at, created_at
- 2 个索引：analysis_id, strategy_key
- 作用：跟踪策略采纳历史

### strategy_effectiveness 表
- 9 个字段：id, adoption_id, strategy_key, baseline_success_rate, post_adjustment_success_rate, sample_size, evaluation_period_days, is_effective, improvement_percentage, evaluated_at, created_at
- 1 个索引：strategy_key
- 作用：评估策略改进效果

### brain_config 表
- 关键字段：key, value, metadata (包含 learning_id, old_value, reason, applied_at)
- 作用：存储最终的参数值（带审计链接）

---

## 🛡️ 安全性检查清单

✅ **已实现**
- ADJUSTABLE_PARAMS 白名单（6 个参数）
- 参数范围严格校验
- 所有调整都记录 learning_id 用于审计追踪
- 完整的数据链：Learning → Strategy Adoption → Effectiveness

⚠️ **需要注意**
- 没有回滚机制，失效策略无法自动恢复
- 没有反向链接追踪，失效策略无法标记原 Learning
- 没有警报机制，可能长期使用失效策略

---

## 📊 时间线和关键参数

| 参数 | 值 | 用途 |
|------|-----|------|
| Effectiveness 评估窗口 | 7 天 | 调整后需要 7 天数据才能评估 |
| 采纳等待期 | 7 天 | 调整后 7 天，足以累积数据 |
| 改善阈值 | 5% | 成功率提升 > 5% 才算有效 |
| Effectiveness 积分 | 0-40 | 最多 40 分（improvement * 4） |
| 强制回滚时间 | 10 天 | 建议 10 天后自动回滚失效策略 |

---

## 🎯 优先级路线图（完整版）

### Phase 1：自动化基础（P0 - 1-2 周）
```
□ 添加 rollbackIneffectiveStrategies() 函数
□ 在 nightly-tick.js 集成 evaluateAllAdoptedStrategies()
□ 添加 API /api/brain/learning/rollback-ineffective
□ 添加字段 learnings.effectiveness_status
□ 编写 rollback 测试
```

### Phase 2：完善链接（P1 - 1-2 周）
```
□ 创建 learning_strategy_effectiveness_links 表
□ 实现失效策略反向追溯
□ 添加 API /api/brain/learning/feedback-loop-status
□ 编写集成测试
```

### Phase 3：可观测性（P2 - 1 周）
```
□ 添加 /api/brain/learning/effectiveness-report API
□ Workspace Dashboard 可视化
□ 警报/通知机制
□ 性能优化
```

---

## 🔧 快速开始实施

### 1. 阅读现有代码
```bash
# 了解 Learning 流程
cat /home/xx/perfect21/cecelia/core/brain/src/learning.js | head -100

# 查看测试模式
cat /home/xx/perfect21/cecelia/core/brain/src/__tests__/learning-effectiveness.test.js
```

### 2. 参考代码片段
👉 见 LEARNING_STRATEGY_QUICK_REF.md 的"3 个核心缺口"部分

### 3. 查看现有 API
```bash
# 手动测试现有 API
curl -X POST http://localhost:5221/api/brain/learning/evaluate-strategy \
  -H "Content-Type: application/json" \
  -d '{"strategy_key":"alertness.emergency_threshold","days":7}'
```

### 4. SQL 调试查询
👉 见 LEARNING_STRATEGY_QUICK_REF.md 的"调试技巧"部分

---

## 📖 文档版本

| 文件 | 版本 | 更新时间 | 备注 |
|------|------|----------|------|
| LEARNING_STRATEGY_QUICK_REF.md | 1.0 | 2026-02-18 | 快速参考 |
| LEARNING_STRATEGY_EXPLORATION.md | 1.0 | 2026-02-18 | 完整分析 |
| LEARNING_STRATEGY_INDEX.md | 1.0 | 2026-02-18 | 本文档 |

---

## 💬 使用建议

1. **第一次接触**：从 QUICK_REF 开始，5 分钟快速了解
2. **深度学习**：看 EXPLORATION 的第 4 章和第 5 章
3. **实施方案**：参考 QUICK_REF 的"3 个核心缺口"代码片段
4. **日常参考**：收藏 QUICK_REF 的函数速查部分

---

## 🆘 常见问题

**Q: Learning 和 Strategy 的关系是什么？**
A: Learning 记录从 RCA 分析得出的策略调整建议；Strategy 是这些建议的执行和追踪；Effectiveness 则评估调整是否真的有效。

**Q: 为什么需要自动化？**
A: 目前手动评估意味着很多失效策略可能被长期使用而无人知晓。自动化能确保每个策略都被正确评估和管理。

**Q: 安全吗？**
A: 很安全。白名单、范围检查、审计链接都完整。缺的是自动化，不是安全性。

**Q: 实施难度如何？**
A: 相对简单。函数已有，只需要集成调度和回滚逻辑。3-5 天可完成 Phase 1。

---

## 📞 相关联系

- Cecelia Core 仓库：/home/xx/perfect21/cecelia/core
- Brain 源代码：/home/xx/perfect21/cecelia/core/brain/src
- 数据库 Migrations：/home/xx/perfect21/cecelia/core/brain/migrations
- 测试：/home/xx/perfect21/cecelia/core/brain/src/__tests__

