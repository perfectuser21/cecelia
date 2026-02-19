# Cecelia Core 记忆与决策系统 - 快速参考

## 核心概念 (3 分钟速览)

### 三层大脑架构
```
Event 处理流程：
  L0 (脑干): quickRoute() - 纯代码规则，无记忆
  L1 (丘脑): analyzeEvent(Sonnet) - + 历史学习记忆
  L2 (皮层): analyzeDeep(Opus) - + 历史学习 + 历史分析记忆
```

### 记忆三层查询
```
API 端点：
  POST /api/brain/memory/search      → Summary 概要搜索
  GET  /api/brain/memory/detail/:id  → Detail 详情查询
  POST /api/brain/memory/search-related → Related 相关搜索
```

### 学习闭环
```
Cortex 分析 → 生成 learnings[] → 记录到 learnings 表
           → 生成 strategy_updates[] → 更新 brain_config 表
           ↓
下次决策时：searchRelevantLearnings() → 检索到新学习 → 注入 Prompt → 正反馈
```

---

## 关键文件速查 (5 个核心文件)

| 文件 | 职责 | 核心函数 |
|------|------|---------|
| `thalamus.js` | L1 决策 (Sonnet) | `analyzeEvent()` - 注入 20 条学习 |
| `cortex.js` | L2 决策 (Opus) | `analyzeDeep()` - 注入 20 条学习 + 5 条分析 |
| `learning.js` | 学习管理 | `searchRelevantLearnings()` - 按相关度评分 |
| `memory-service.js` | 记忆查询 API | `search()` / `getDetail()` |
| `similarity.js` | 向量搜索 | `searchWithVectors()` - 70%向量 + 30%关键字 |

---

## 记忆检索关键参数

### searchRelevantLearnings() 评分规则
```javascript
score = 0
if (context.task_type === learning.metadata.task_type) score += 10  // 精确匹配
if (content.includes(context.failure_class)) score += 8             // 包含匹配
if (context.event_type === learning.trigger_event) score += 6       // 事件匹配
if (learning.category === 'failure_pattern') score += 4             // 分类匹配
score += freshness_points  // 新近度: 7天内+3, 30天内+2, 其他+1
```

### 可调整策略参数（白名单）
```
alertness.emergency_threshold     (0.5-1.0)
alertness.alert_threshold         (0.3-0.8)
retry.max_attempts                (1-5)
retry.base_delay_minutes          (1-30)
resource.max_concurrent           (1-20)
resource.memory_threshold_mb      (500-4000)
```

---

## 数据表关系

```
learnings (学习记录)
├─ id, title, category
├─ trigger_event (systemic_failure / rca_request)
├─ content (JSON: {root_cause, contributing_factors, learnings})
├─ strategy_adjustments (JSON: 推荐的参数调整)
├─ applied (是否已应用)
└─ metadata (JSON: {task_type, failure_class, confidence})

cortex_analyses (深度分析记录)
├─ id, root_cause, confidence_score
├─ failure_pattern (JSON: {class, task_type, frequency})
├─ mitigations (JSON array)
└─ trigger_event_type

brain_config (系统配置)
├─ key (参数名，如 "retry.max_attempts")
├─ value (参数值)
└─ metadata (JSON: {learning_id, reason, applied_at})
```

---

## 实战示例

### 1. 查看系统学习了什么
```bash
# 查询最近 20 条学习
curl -X POST http://localhost:5221/api/brain/memory/search \
  -H "Content-Type: application/json" \
  -d '{"query": "network error", "topK": 5}'

# 查看某条学习的详情
curl http://localhost:5221/api/brain/memory/detail/{id}
```

### 2. 追踪决策中注入了多少学习
```bash
# 查看 token_usage 事件（包含 learnings_injected 数量）
curl http://localhost:5221/api/brain/events?type=token_usage&source=thalamus
```

### 3. 监控策略调整应用
```sql
-- 查看已应用的学习
SELECT id, title, strategy_adjustments, applied_at
FROM learnings
WHERE applied = true
ORDER BY applied_at DESC
LIMIT 10;

-- 查看对应的配置更新
SELECT key, value, metadata->>'reason' as reason, metadata->>'applied_at' as time
FROM brain_config
WHERE metadata->>'learning_id' IS NOT NULL
ORDER BY (metadata->>'applied_at')::timestamp DESC;
```

---

## 常见问题

### Q: 为什么新学习没有被注入到决策中？
**A**: 两个原因：
1. **评分太低**：新学习可能与当前事件匹配度不高，被排在 top-20 之外
   - 检查 learnings.metadata 中的 task_type / failure_class 是否正确标注
2. **还未被检索到**：新学习刚刚保存，需要等到下一次决策触发
   - 检查 learnings.trigger_event 是否正确设置

### Q: 策略参数调整是否能自动生效？
**A**: **需要应用程序读取 brain_config**。调整只是保存到数据库，具体应用需要：
1. 应用启动时读取 brain_config 初始化参数
2. 运行时检查 brain_config 是否有更新
3. 目前需要应用程序主动查询和应用这些参数

### Q: 如何判断学习质量是否良好？
**A**: 看三个指标：
1. **应用率**：`SELECT COUNT(*) FROM learnings WHERE applied = true`
2. **成功率**：检查应用参数后系统故障率是否下降
3. **相关度**：`relevance_score` ≥ 10 说明匹配度高

---

## 性能特性

| 操作 | 耗时 | 说明 |
|------|------|------|
| `searchRelevantLearnings(20)` | < 50ms | 关键字评分，无向量计算 |
| `SimilarityService.searchWithVectors(5)` | 100-500ms | 向量搜索 + 混合评分 |
| Thalamus 决策 | 500-1000ms | 含记忆检索 (20) + Sonnet 调用 |
| Cortex 决策 | 2000-4000ms | 含双重记忆 (20+5) + Opus 调用 |
| 保存新学习 | < 10ms | 单条 INSERT |
| 应用策略调整 | < 5ms/条 | 单条参数 UPDATE |

---

## 开发清单

- [ ] 部署时确保 learnings 和 cortex_analyses 表已创建
- [ ] 配置 OpenAI API key（用于向量生成）
- [ ] 配置 Anthropic API key（Sonnet/Opus 调用）
- [ ] 验证 brain_config 表支持动态参数读取
- [ ] 监控 token_usage 事件确保成本可观测
- [ ] 定期导出学习记录进行离线分析
- [ ] 设置告警：如果 learnings 表无新增记录超过 24 小时

---

## 最常用的 SQL 查询

```sql
-- 1. 查看最近学习的按相关性权重排序
SELECT title, category, metadata->>'task_type' as task_type,
       metadata->>'failure_class' as failure_class,
       created_at
FROM learnings
ORDER BY created_at DESC
LIMIT 20;

-- 2. 查看哪些学习已被应用并生效
SELECT id, title, applied_at,
       strategy_adjustments->'params'->>'param' as param,
       strategy_adjustments->'params'->>'new_value' as new_value
FROM learnings
WHERE applied = true
ORDER BY applied_at DESC;

-- 3. 按 failure_class 统计学习数量
SELECT metadata->>'failure_class' as failure_class, COUNT(*) as count
FROM learnings
GROUP BY failure_class
ORDER BY count DESC;

-- 4. 查看决策日志中记忆注入量
SELECT trigger, COUNT(*) as count,
       AVG((payload->>'learnings_injected')::int) as avg_learnings
FROM cecelia_events
WHERE event_type = 'token_usage'
GROUP BY trigger;
```

---

## 相关阅读

- 完整架构文档：`/home/xx/perfect21/cecelia/core/MEMORY_ARCHITECTURE.md`
- Cortex 定义：`cortex.js` 开头的注释
- Thalamus 定义：`thalamus.js` 开头的注释
- 学习闭环：`learning.js` 开头的注释

